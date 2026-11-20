import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { dump } from 'js-yaml'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import SockJS from 'sockjs-client'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { DataTable, type Column } from '@/components/DataTable'
import { AreaTrend } from '@/components/charts'
import { ActionMenu, Button, Modal, PageToolbar, Panel, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

const ServiceConsole = lazy(() =>
  import('@/components/console/ServiceConsole').then((module) => ({ default: module.ServiceConsole })),
)

const NAMESPACE = 'gaop-namespace'

const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const stripAnsi = (value: string) => value.replace(ANSI_RE, '')

type SockJsClient = InstanceType<typeof SockJS>

interface PodItem {
  metadata?: {
    name?: string
    namespace?: string
    creationTimestamp?: string
    deletionTimestamp?: string
    labels?: Record<string, string>
    ownerReferences?: Array<{ kind?: string; name?: string }>
  }
  spec?: { nodeName?: string; containers?: Array<{ name?: string; image?: string }> }
  status?: {
    phase?: string
    podIP?: string
    hostIP?: string
    startTime?: string
    containerStatuses?: Array<{ ready?: boolean; restartCount?: number; state?: Record<string, unknown> }>
  }
}

function serviceOf(pod: PodItem) {
  return pod.metadata?.labels?.name || ''
}

function imageOf(pod: PodItem) {
  const images = (pod.spec?.containers ?? []).map((container) => container.image || '--')
  return images.join(',') || '--'
}

function runningOf(pod: PodItem) {
  const statuses = pod.status?.containerStatuses ?? []
  const running = statuses.filter((item) => (item.state as { running?: unknown } | undefined)?.running).length
  const terminated = statuses.filter((item) => (item.state as { terminated?: unknown } | undefined)?.terminated).length
  return { running, total: statuses.length, partial: running > 0 && terminated > 0 }
}

interface MonitorPoint {
  timestamp?: string
  floatValue?: string | null
}

interface MonitorSeries {
  podName?: string
  metrics?: MonitorPoint[]
}

interface MonitorData {
  cpu?: MonitorSeries[]
  memory?: MonitorSeries[]
  outboundNetwork?: MonitorSeries[]
  inboundNetwork?: MonitorSeries[]
  diskReadIo?: MonitorSeries[]
  diskWriteIo?: MonitorSeries[]
}

function monitorTrend(list: MonitorSeries[] | undefined, factor = 1) {
  // 接口对同一 Pod 会返回多条重复序列（名称相同），仅保留第一条，避免图例出现重复曲线
  const seen = new Set<string>()
  return (list ?? [])
    .filter((series) => {
      const name = series.podName || ''
      if (!name) return true
      if (seen.has(name)) return false
      seen.add(name)
      return true
    })
    .map((series, index) => ({
      name: series.podName || `SERIES ${index + 1}`,
      points: (series.metrics ?? [])
        .filter(
          (point) =>
            point.floatValue !== null && point.floatValue !== undefined && Number.isFinite(Number(point.floatValue)),
        )
        .map((point) => {
          const value = Number(point.floatValue) * factor
          const date = point.timestamp ? new Date(point.timestamp) : null
          if (!date || Number.isNaN(date.getTime())) return { label: '', value, tip: '' }
          const pad = (n: number) => String(n).padStart(2, '0')
          const label = `${pad(date.getHours())}:${pad(date.getMinutes())}`
          const tip = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
          return { label, value, tip }
        }),
    }))
}

function YamlView({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="h-[540px] overflow-auto border border-line bg-[#0e2233]">
      <div className="flex min-w-max">
        <div className="select-none bg-[#19476f] py-2 text-right font-mono text-[12px] leading-[18px] text-[#d7e6f5]">
          {lines.map((_, index) => (
            <div key={index} className="px-2">
              {index + 1}
            </div>
          ))}
        </div>
        <pre className="px-2 py-2 font-mono text-[12px] leading-[18px]">
          {lines.map((line, index) => {
            const match = line.match(/^(\s*(?:- )?)([\w.\-/]+)(:)(.*)$/)
            if (match) {
              return (
                <div key={index}>
                  <span className="text-[#cfe3f5]">{match[1]}</span>
                  <span className="text-[#7fb3f0]">{match[2]}</span>
                  <span className="text-[#9db4ca]">:</span>
                  <span className="text-[#cfe3f5]">{match[4]}</span>
                </div>
              )
            }
            return (
              <div key={index} className="text-[#cfe3f5]">
                {line || ' '}
              </div>
            )
          })}
        </pre>
      </div>
    </div>
  )
}

const MONITOR_RANGES = [
  { key: 'ONE_HOURS', label: '最近1小时' },
  { key: 'SIX_HOURS', label: '最近6小时' },
  { key: 'TWENTY_FOUR_HOURS', label: '最近24小时' },
  { key: 'SEVEN_DAY', label: '最近7天' },
  { key: 'THIRTY_DAY', label: '最近30天' },
] as const

type MonitorRange = (typeof MONITOR_RANGES)[number]['key']

function phaseText(phase?: string) {
  const value = phase || 'Unknown'
  switch (value) {
    case 'Running':
      return { text: '运行中', tone: 'text-ok' }
    case 'Pending':
      return { text: '启动中', tone: 'text-warn' }
    case 'Failed':
      return { text: '异常', tone: 'text-danger' }
    case 'Succeeded':
      return { text: '已完成', tone: 'text-mute' }
    case 'Terminating':
      return { text: '删除中', tone: 'text-mute' }
    default:
      return { text: value, tone: 'text-ink-3' }
  }
}

function restartsOf(pod: PodItem) {
  return (pod.status?.containerStatuses ?? []).reduce((sum, item) => sum + (item.restartCount ?? 0), 0)
}

export default function PodsPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [detail, setDetail] = useState<PodItem | null>(null)
  const [detailTab, setDetailTab] = useState<'yaml' | 'monitor' | 'log' | 'events'>('yaml')
  const [podRange, setPodRange] = useState<MonitorRange>('ONE_HOURS')
  const [customRange, setCustomRange] = useState(false)
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [logText, setLogText] = useState('')
  const [logState, setLogState] = useState<'idle' | 'connecting' | 'open' | 'closed' | 'error'>('idle')
  const logBoxRef = useRef<HTMLDivElement | null>(null)
  const [consoleState, setConsoleState] = useState<{ service: string; mode: 'logs' | 'terminal' } | null>(null)

  const query = useQuery({
    queryKey: ['pods', NAMESPACE],
    queryFn: () =>
      api.get<{ items?: PodItem[] }>(`/k8s/api/v1/namespaces/${NAMESPACE}/pods`, { pretty: 'true' }),
    refetchInterval: 20_000,
  })

  const pods = useMemo(() => query.data?.items ?? [], [query.data])
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return pods
    return pods.filter((pod) => (pod.metadata?.name || '').toLowerCase().includes(q))
  }, [pods, keyword])

  const deleteMutation = useMutation({
    mutationFn: ({ name, force }: { name: string; force: boolean }) =>
      api.del(
        `/k8s/api/v1/namespaces/${NAMESPACE}/pods/${name}`,
        undefined,
        force ? { gracePeriodSeconds: 0 } : undefined,
      ),
    onSuccess: (_data, variables) => {
      toast.success(variables.force ? '容器已强制删除' : '容器已重新分配')
      queryClient.invalidateQueries({ queryKey: ['pods'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  const podName = detail?.metadata?.name || ''

  const detailQuery = useQuery({
    queryKey: ['pod-detail', podName],
    queryFn: () =>
      api.get<PodItem>(`/k8s/api/v1/namespaces/${NAMESPACE}/pods/${podName}`, { pretty: 'true' }),
    enabled: !!detail,
  })

  /* 日志走厂商同款 SockJS 流式接口（REST k8s 代理会把纯文本日志按 JSON 解析导致 500） */
  useEffect(() => {
    if (!detail || detailTab !== 'log') return
    const pod = detail.metadata?.name || ''
    const container = detail.spec?.containers?.[0]?.name || ''
    if (!pod) return
    setLogText('')
    setLogState('connecting')
    let socket: SockJsClient | null = null
    let disposed = false
    const timer = window.setTimeout(() => {
      if (disposed) return
      try {
        socket = new SockJS(
          `${API_BASE}/logs?pod=${encodeURIComponent(pod)}&container=${encodeURIComponent(container)}&namespace=${encodeURIComponent(NAMESPACE)}`,
        )
      } catch {
        setLogState('error')
        return
      }
      socket.onopen = () => {
        if (!disposed) setLogState('open')
      }
      socket.onmessage = (event: MessageEvent) => {
        if (disposed) return
        const chunk = typeof event.data === 'string' ? stripAnsi(event.data) : ''
        if (!chunk) return
        setLogText((prev) => {
          const next = prev + chunk
          return next.length > 900_000 ? next.slice(next.length - 700_000) : next
        })
      }
      socket.onclose = () => {
        if (!disposed) setLogState((prev) => (prev === 'error' ? 'error' : 'closed'))
      }
      socket.onerror = () => {
        if (!disposed) setLogState('error')
      }
    }, 300)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
    }
  }, [detail, detailTab])

  useEffect(() => {
    if (detailTab === 'log' && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight
    }
  }, [logText, detailTab])

  const podEventsQuery = useQuery({
    queryKey: ['pod-events', podName],
    queryFn: () =>
      api.get<{ items?: Array<{ reason?: string; message?: string; lastTimestamp?: string; type?: string }> }>(
        `/k8s/api/v1/namespaces/${NAMESPACE}/events`,
        { pretty: 'true', fieldSelector: `involvedObject.kind=Pod,involvedObject.name=${podName}` },
      ),
    enabled: !!detail && detailTab === 'events',
  })

  const podMonitorQuery = useQuery({
    queryKey: ['pod-monitor', podName, customRange ? `${rangeStart}~${rangeEnd}` : podRange],
    queryFn: () =>
      api.get<MonitorData>(
        '/v1/pub/serviceMonitor',
        customRange
          ? {
              namespace: NAMESPACE,
              name: podName,
              podName,
              queryTimeType: false,
              start: rangeStart ? new Date(rangeStart).toISOString() : undefined,
              end: rangeEnd ? new Date(rangeEnd).toISOString() : undefined,
            }
          : {
              namespace: NAMESPACE,
              name: podName,
              podName,
              queryTimeType: true,
              timeType: podRange,
            },
      ),
    enabled:
      !!detail &&
      detailTab === 'monitor' &&
      (!customRange || (!!rangeStart && !!rangeEnd)),
  })

  const yamlText = useMemo(() => {
    const source = detailQuery.data
    if (!source) return ''
    const clone = JSON.parse(JSON.stringify(source)) as Record<string, unknown>
    const metadata = clone.metadata as Record<string, unknown> | undefined
    if (metadata) delete metadata.managedFields
    return dump(clone)
  }, [detailQuery.data])

  async function remove(pod: PodItem, force: boolean) {
    const name = pod.metadata?.name
    if (!name) return
    const ok = await confirm({
      title: `${force ? '删除' : '重启'}容器 ${name}？`,
      description: force
        ? '删除后，所属 Deployment 会按副本数自动重建容器。'
        : '重启将删除当前容器并由调度器重新创建。',
      confirmText: force ? '删除' : '重启',
      danger: force,
    })
    if (ok) deleteMutation.mutate({ name, force })
  }

  async function batch(force: boolean) {
    if (selected.length === 0) return
    const ok = await confirm({
      title: `${force ? '删除' : '重启'} ${selected.length} 个容器？`,
      description: '操作将对所选容器逐一执行，所属工作负载会自动重建。',
      confirmText: force ? '删除' : '重启',
      danger: force,
    })
    if (!ok) return
    for (const name of selected) {
      await deleteMutation.mutateAsync({ name, force })
    }
    setSelected([])
  }

  const columns: Array<Column<PodItem>> = [
    {
      key: 'index',
      header: '序号',
      width: 80,
      align: 'center',
      cell: (_row, index) => <span className="text-[14px] text-ink">{index + 1}</span>,
    },
    {
      key: 'name',
      header: '容器名称',
      width: 180,
      align: 'center',
      cell: (row) => (
        <button
          onClick={() => setDetail(row)}
          className="mx-auto block max-w-[220px] truncate text-center text-[14px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
        >
          {row.metadata?.name || '—'}
        </button>
      ),
    },
    {
      key: 'status',
      header: '状态',
      width: 160,
      align: 'center',
      cell: (row) => {
        const phase = phaseText(row.metadata?.deletionTimestamp ? 'Terminating' : row.status?.phase)
        const { running, total, partial } = runningOf(row)
        return (
          <div className="leading-[1.5715]">
            <div className={cn('text-[14px]', phase.tone)}>{phase.text}</div>
            {total > 0 && row.status?.phase === 'Running' && (
              <div className="text-[14px] text-ink">
                {running}/{total}
                {partial ? '部分运行' : '全部运行'}
              </div>
            )}
            <div className="text-[14px] text-ink">已重启 {restartsOf(row)} 次</div>
          </div>
        )
      },
    },
    {
      key: 'service',
      header: '所属服务',
      width: 160,
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{serviceOf(row) || '--'}</span>,
    },
    {
      key: 'image',
      header: '镜像',
      width: 200,
      align: 'center',
      cell: (row) => (
        <span className="mx-auto block max-w-[190px] truncate text-[14px] text-ink" title={imageOf(row)}>
          {imageOf(row)}
        </span>
      ),
    },
    {
      key: 'ip',
      header: '访问地址',
      width: 180,
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{row.status?.podIP || '—'}</span>,
    },
    {
      key: 'created',
      header: '创建时间',
      width: 180,
      align: 'center',
      cell: (row) => (
        <span className="whitespace-nowrap text-[14px] text-ink">
          {row.metadata?.creationTimestamp ? formatDate(row.metadata.creationTimestamp, true) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: 200,
      fixed: 'right',
      align: 'center',
      headerAlign: 'center',
      cell: (row) => {
        const service = serviceOf(row)
        return (
          <div className="flex items-center justify-center gap-2.5 text-[14px]">
            <button
              className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
              onClick={() => {
                if (!service) {
                  toast.error('该容器没有关联服务名称')
                  return
                }
                setConsoleState({ service, mode: 'terminal' })
              }}
            >
              终端登录
            </button>
            <ActionMenu
              triggerText="更多"
              items={[
                { label: '删除容器', danger: true, onSelect: () => remove(row, true) },
                { label: '重启容器', onSelect: () => remove(row, false) },
              ]}
            />
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <PageToolbar
        search={{ value: keyword, onChange: setKeyword, placeholder: '请输入容器名称搜索' }}
      >
        <Button
          size="sm"
          variant="signal"
          disabled={selected.length === 0}
          onClick={() => batch(false)}
        >
          重启容器
        </Button>
        <Button
          size="sm"
          disabled={selected.length === 0}
          className={cn(
            'border-[#a01820] bg-[#a01820] text-white hover:border-[#c03039] hover:bg-[#b8202a]',
            selected.length === 0 &&
              'border-[#1e3448] bg-[#122434] text-[#4f6a82] hover:border-[#1e3448] hover:bg-[#122434]',
          )}
          loading={deleteMutation.isPending}
          onClick={() => batch(true)}
        >
          删除容器
        </Button>
      </PageToolbar>

      <Panel bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.metadata?.name || ''}
          loading={query.isLoading}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          pageSize={12}
          emptyTitle="暂无容器"
          emptyDescription="命名空间内没有正在运行的容器实例。"
        />
      </Panel>

      <Modal
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null)
            setDetailTab('yaml')
          }
        }}
        title={`Pod详情：${podName}`}
        width={1000}
        footer={null}
      >
        <div className="flex h-[560px]">
          <div className="flex w-[68px] flex-none flex-col gap-1 border-r border-line pt-1">
            {(
              [
                { key: 'yaml', label: 'yaml' },
                { key: 'monitor', label: '监控' },
                { key: 'log', label: '日志' },
                { key: 'events', label: '事件' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setDetailTab(tab.key)}
                className={cn(
                  'border-l-2 px-3 py-2 text-left text-[14px] transition-colors',
                  detailTab === tab.key
                    ? 'border-signal text-signal'
                    : 'border-transparent text-ink-3 hover:text-ink',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1 pl-3">
            {detailTab === 'yaml' &&
              (detailQuery.isLoading ? (
                <div className="py-16 text-center text-[14px] text-mute">正在读取 Pod 定义…</div>
              ) : (
                <YamlView text={yamlText} />
              ))}
            {detailTab === 'monitor' && (
              <div className="h-[540px] overflow-auto">
                <div className="mb-4 flex flex-wrap items-center">
                  <button
                    onClick={() => setCustomRange(true)}
                    className={cn(
                      'inline-flex h-7 items-center border px-3 text-[14px] transition-colors',
                      customRange
                        ? 'border-signal bg-[#1670c2] text-white'
                        : 'border-[#2f6fa8] text-ink-3 hover:text-ink',
                    )}
                  >
                    自定义日期
                  </button>
                  {MONITOR_RANGES.map((range) => (
                    <button
                      key={range.key}
                      onClick={() => {
                        setCustomRange(false)
                        setPodRange(range.key)
                      }}
                      className={cn(
                        '-ml-px inline-flex h-7 items-center border px-3 text-[14px] transition-colors',
                        !customRange && podRange === range.key
                          ? 'border-signal bg-[#1670c2] text-white'
                          : 'border-[#2f6fa8] text-ink-3 hover:text-ink',
                      )}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
                {customRange && (
                  <div className="mb-4 flex items-center gap-2 text-[14px] text-ink-3">
                    <input
                      type="datetime-local"
                      step={1}
                      className="field h-8 w-[210px]"
                      value={rangeStart}
                      onChange={(event) => setRangeStart(event.target.value)}
                    />
                    <span>至</span>
                    <input
                      type="datetime-local"
                      step={1}
                      className="field h-8 w-[210px]"
                      value={rangeEnd}
                      onChange={(event) => setRangeEnd(event.target.value)}
                    />
                  </div>
                )}
                <div className="mb-3 text-[14px] text-ink-3">时间间隔：1minute</div>
                {podMonitorQuery.isLoading ? (
                  <div className="py-16 text-center text-[14px] text-mute">正在采集指标…</div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div>
                      <div className="mb-2 text-[14px] text-ink-3">CPU 使用量（m）</div>
                      <AreaTrend series={monitorTrend(podMonitorQuery.data?.cpu, 1000)} height={200} unit=" m" />
                    </div>
                    <div>
                      <div className="mb-2 text-[14px] text-ink-3">内存使用量（MB）</div>
                      <AreaTrend
                        series={monitorTrend(podMonitorQuery.data?.memory, 1 / 1024 / 1024)}
                        height={200}
                        unit=" MB"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-[14px] text-ink-3">网络吞吐（KB/s）</div>
                      <AreaTrend
                        series={[
                          ...monitorTrend(podMonitorQuery.data?.inboundNetwork, 1 / 1024).map((series) => ({
                            ...series,
                            name: `${series.name}-入站`,
                          })),
                          ...monitorTrend(podMonitorQuery.data?.outboundNetwork, 1 / 1024).map((series) => ({
                            ...series,
                            name: `${series.name}-出站`,
                          })),
                        ]}
                        height={200}
                        unit=" KB/s"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-[14px] text-ink-3">磁盘 IO（KB/s）</div>
                      <AreaTrend
                        series={[
                          ...monitorTrend(podMonitorQuery.data?.diskReadIo, 1 / 1024).map((series) => ({
                            ...series,
                            name: `${series.name}-读`,
                          })),
                          ...monitorTrend(podMonitorQuery.data?.diskWriteIo, 1 / 1024).map((series) => ({
                            ...series,
                            name: `${series.name}-写`,
                          })),
                        ]}
                        height={200}
                        unit=" KB/s"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            {detailTab === 'log' && (
              <div
                ref={logBoxRef}
                className="h-[540px] overflow-auto border border-line bg-[#0e2233] px-3 py-2 font-mono text-[12px] leading-[18px] text-[#cfe3f5]"
              >
                {logState === 'connecting' && !logText ? (
                  <div className="py-16 text-center font-sans text-[14px] text-mute">正在连接日志…</div>
                ) : logState === 'error' ? (
                  <div className="py-16 text-center font-sans text-[14px] text-danger">日志连接失败，请确认 Pod 处于运行状态</div>
                ) : (
                  <pre className="whitespace-pre-wrap break-all">{logText || '暂无日志'}</pre>
                )}
              </div>
            )}
            {detailTab === 'events' && (
              <div className="h-[540px] space-y-2 overflow-auto">
                {(podEventsQuery.data?.items ?? []).map((event, index) => (
                  <div key={index} className="border border-line px-3 py-2">
                    <div className="flex items-center gap-3 text-[14px]">
                      <span
                        className={cn(
                          'w-[120px] flex-none',
                          event.type === 'Warning' ? 'text-danger' : 'text-ok',
                        )}
                      >
                        {event.reason || '—'}
                      </span>
                      <span className="flex-none text-ink-3">消息</span>
                      <span className="min-w-0 flex-1 text-ink">{event.message || '—'}</span>
                      <span className="mono flex-none text-[12px] text-mute">
                        {event.lastTimestamp ? formatDate(event.lastTimestamp, true) : ''}
                      </span>
                    </div>
                  </div>
                ))}
                {!podEventsQuery.isLoading && (podEventsQuery.data?.items ?? []).length === 0 && (
                  <div className="py-16 text-center text-[14px] text-mute">暂无事件</div>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Suspense fallback={null}>
        <ServiceConsole
          open={!!consoleState}
          serviceName={consoleState?.service || ''}
          initialMode={consoleState?.mode || 'logs'}
          onClose={() => setConsoleState(null)}
        />
      </Suspense>
    </div>
  )
}
