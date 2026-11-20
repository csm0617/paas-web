import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, Plus } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { ServiceItem } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import { AreaTrend } from '@/components/charts'
import { DateTimeRangePicker } from '@/components/DateTimeRangePicker'
import { ActionMenu, Button, Drawer, Field, PageToolbar, Panel, Select, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

const ServiceConsole = lazy(() =>
  import('@/components/console/ServiceConsole').then((module) => ({ default: module.ServiceConsole })),
)

const ServiceConfigPanel = lazy(() => import('@/pages/software/ServiceConfigPage'))

const BASE_TYPE = 1

const MONITOR_RANGES = [
  { key: 'ONE_HOURS', label: '最近1小时' },
  { key: 'SIX_HOURS', label: '最近6小时' },
  { key: 'TWENTY_FOUR_HOURS', label: '最近24小时' },
  { key: 'SEVEN_DAY', label: '最近7天' },
  { key: 'THIRTY_DAY', label: '最近30天' },
] as const

type MonitorRange = (typeof MONITOR_RANGES)[number]['key']

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

function monitorTrend(list: MonitorSeries[] | undefined, factor = 1, pod?: string) {
  const seen = new Set<string>()
  const source = pod ? (list ?? []).filter((series) => series.podName === pod) : (list ?? [])
  const unique = source.filter((series) => {
    if (!series.podName) return true
    if (seen.has(series.podName)) return false
    seen.add(series.podName)
    return true
  })
  const span = monitorTimeSpan(source)
  return unique.slice(0, 4).map((series, index) => ({
    name: series.podName || `SERIES ${index + 1}`,
    points: (series.metrics ?? [])
      .filter(
        (point) =>
          point.floatValue !== null && point.floatValue !== undefined && Number.isFinite(Number(point.floatValue)),
      )
      .map((point) => {
        const value = Number(point.floatValue) * factor
        return { ...monitorPointLabel(point.timestamp, span), value }
      }),
  }))
}

function monitorTimeSpan(list: MonitorSeries[] | undefined) {
  let min = Infinity
  let max = -Infinity
  ;(list ?? []).forEach((series) => {
    ;(series.metrics ?? []).forEach((point) => {
      const time = point.timestamp ? new Date(point.timestamp).getTime() : Number.NaN
      if (!Number.isFinite(time)) return
      if (time < min) min = time
      if (time > max) max = time
    })
  })
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0
}

function monitorPointLabel(timestamp: string | undefined, span: number) {
  const date = timestamp ? new Date(timestamp) : null
  if (!date || Number.isNaN(date.getTime())) return { label: '', tip: '' }
  const pad = (n: number) => String(n).padStart(2, '0')
  const mmdd = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const label = span >= 7 * 86_400_000 ? mmdd : span >= 86_400_000 ? `${mmdd} ${hhmm}` : hhmm
  const tip = `${date.getFullYear()}-${mmdd} ${hhmm}:${pad(date.getSeconds())}`
  return { label, tip }
}

function sumTrend(list: MonitorSeries[] | undefined, factor = 1) {
  const values = new Map<string, number>()
  ;(list ?? []).forEach((series) => {
    ;(series.metrics ?? []).forEach((point) => {
      const raw = point.floatValue
      if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return
      const key = point.timestamp || ''
      values.set(key, (values.get(key) ?? 0) + Number(raw) * factor)
    })
  })
  const span = monitorTimeSpan(list)
  return Array.from(values.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([timestamp, value]) => ({ ...monitorPointLabel(timestamp, span), value }))
}

function serviceName(service: ServiceItem) {
  return service.nameUs || service.nameFr
}

function k8sName(service: ServiceItem) {
  return service.deployment?.metadata?.name || serviceName(service)
}

function serviceLabel(service: ServiceItem) {
  return service.deployment?.spec?.template?.metadata?.annotations?.['gaop/serviceLabel'] || '--'
}

function imageOf(service: ServiceItem) {
  if (typeof service.imageInfo === 'string') return service.imageInfo
  if (service.imageInfo?.image) return service.imageInfo.image
  return service.deployment?.spec?.template?.spec?.containers?.[0]?.image || '—'
}

function imageShort(service: ServiceItem) {
  return (service.deployment?.spec?.template?.spec?.containers ?? [])
    .map((container) => {
      const parts = (container.image || '').split('/')
      return parts[1] || parts[2] ? `${parts[1] || '--'}/${parts[2] || '--'}` : '--'
    })
    .join(',')
}

function statusOf(service: ServiceItem) {
  const ready = service.deployment?.status?.readyReplicas ?? 0
  const desired = service.deployment?.status?.replicas ?? service.deployment?.spec?.replicas ?? 0
  if (service.terminated) return { label: '已停止', tone: 'text-mute', ready, desired }
  if (ready > 0 && desired > 0 && ready < desired) return { label: '滚动发布中', tone: 'text-[#4aa3f0]', ready, desired }
  if (ready > 0) return { label: '运行中', tone: 'text-ok', ready, desired }
  if (desired > 0) return { label: '启动中', tone: 'text-warn', ready, desired }
  return { label: '已停止', tone: 'text-mute', ready, desired }
}

export default function BaseServicesPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [consoleState, setConsoleState] = useState<{
    service: string
    mode: 'history' | 'logs' | 'terminal'
  } | null>(null)
  const [versionTarget, setVersionTarget] = useState<ServiceItem | null>(null)
  const [versionImage, setVersionImage] = useState('')
  const [versionTag, setVersionTag] = useState('')
  const [versionStrategy, setVersionStrategy] = useState<'1' | '2'>('2')
  const [monitorTarget, setMonitorTarget] = useState<ServiceItem | null>(null)
  const [monitorRange, setMonitorRange] = useState<MonitorRange>('ONE_HOURS')
  const [monitorCustom, setMonitorCustom] = useState(false)
  const [monitorStart, setMonitorStart] = useState('')
  const [monitorEnd, setMonitorEnd] = useState('')
  const [monitorMode, setMonitorMode] = useState<'1' | '2'>('1')
  const [monitorPod, setMonitorPod] = useState('')
  const [configTarget, setConfigTarget] = useState<ServiceItem | null>(null)

  const query = useQuery({
    queryKey: ['base-services'],
    queryFn: () =>
      api.get<{ services?: ServiceItem[]; total?: number; count?: number }>('/v1/service/gaop', {
        type: BASE_TYPE,
        page: 1,
        size: 50,
        keyword: '',
      }),
    refetchInterval: 3_000,
  })

  const services = query.data?.services ?? []

  const actionMutation = useMutation({
    mutationFn: ({ path, name }: { path: string; name: string }) => api.put(path, [name]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['base-services'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  const restartMutation = useMutation({
    mutationFn: (podName: string) => api.post('/v1/service/reStartBaseService', undefined, { podName }),
    onSuccess: () => {
      toast.success('重启指令已下发')
      queryClient.invalidateQueries({ queryKey: ['base-services'] })
    },
    onError: (error) => toast.error('重启失败', errorMessage(error)),
  })

  const versionTagsQuery = useQuery({
    queryKey: ['base-version-tags', versionImage],
    queryFn: () =>
      api.get<{ list: Array<{ name: string }> }>('/v1/image/tagInfo', {
        imageName: imageRepo(versionImage),
        page: 1,
        size: 200,
      }),
    enabled: !!versionTarget && !!versionImage,
  })

  const versionMutation = useMutation({
    mutationFn: async () => {
      if (!versionTarget) throw new Error('未选择服务')
      if (!versionImage.trim() || !versionTag.trim()) throw new Error('请填写镜像与版本')
      return api.put('/v1/service/rollingUpdate', {
        name: serviceName(versionTarget),
        version: `${versionImage.trim()}:${versionTag.trim()}`,
        type: Number(versionStrategy),
      })
    },
    onSuccess: () => {
      toast.success('镜像版本已切换', 'Deployment 将触发滚动更新')
      setVersionTarget(null)
      queryClient.invalidateQueries({ queryKey: ['base-services'] })
    },
    onError: (error) => toast.error('版本切换失败', errorMessage(error)),
  })

  const monitorQuery = useQuery({
    queryKey: [
      'base-service-monitor',
      monitorTarget ? serviceName(monitorTarget) : '',
      monitorCustom ? `${monitorStart}~${monitorEnd}` : monitorRange,
    ],
    queryFn: () =>
      api.get<MonitorData>(
        '/v1/pub/serviceMonitor',
        monitorCustom
          ? {
              namespace: monitorTarget?.service?.metadata?.namespace || 'gaop-namespace',
              name: monitorTarget ? serviceName(monitorTarget) : '',
              queryTimeType: false,
              start: monitorStart ? new Date(monitorStart).toISOString() : undefined,
              end: monitorEnd ? new Date(monitorEnd).toISOString() : undefined,
            }
          : {
              namespace: monitorTarget?.service?.metadata?.namespace || 'gaop-namespace',
              name: monitorTarget ? serviceName(monitorTarget) : '',
              queryTimeType: true,
              timeType: monitorRange,
            },
      ),
    enabled: !!monitorTarget && (!monitorCustom || (!!monitorStart && !!monitorEnd)),
  })

  useEffect(() => {
    if (!monitorTarget) return
    setMonitorRange('ONE_HOURS')
    setMonitorCustom(false)
    setMonitorStart('')
    setMonitorEnd('')
    setMonitorMode('1')
    setMonitorPod('')
  }, [monitorTarget])

  const monitorPods = Array.from(
    new Set((monitorQuery.data?.cpu ?? []).map((series) => series.podName || '').filter(Boolean)),
  )
  const monitorPodKey = monitorPods.join('|')

  useEffect(() => {
    if (!monitorPods.length) return
    setMonitorPod((prev) => (prev && monitorPods.includes(prev) ? prev : monitorPods[0]))
  }, [monitorPodKey])

  const combined = monitorMode === '1'
  const cpuSeries = combined
    ? [{ name: 'CPU', points: sumTrend(monitorQuery.data?.cpu, 1000) }]
    : monitorTrend(monitorQuery.data?.cpu, 1000, monitorPod)
  const memorySeries = combined
    ? [{ name: '内存', points: sumTrend(monitorQuery.data?.memory, 1 / 1024 / 1024) }]
    : monitorTrend(monitorQuery.data?.memory, 1 / 1024 / 1024, monitorPod)
  const networkSeries = combined
    ? [
        { name: '网络-入站', points: sumTrend(monitorQuery.data?.inboundNetwork, 1 / 1024) },
        { name: '网络-出站', points: sumTrend(monitorQuery.data?.outboundNetwork, 1 / 1024) },
      ]
    : [
        ...monitorTrend(monitorQuery.data?.inboundNetwork, 1 / 1024, monitorPod).map((series) => ({
          ...series,
          name: `${series.name}-入站`,
        })),
        ...monitorTrend(monitorQuery.data?.outboundNetwork, 1 / 1024, monitorPod).map((series) => ({
          ...series,
          name: `${series.name}-出站`,
        })),
      ]
  const diskSeries = combined
    ? [
        { name: '磁盘-读', points: sumTrend(monitorQuery.data?.diskReadIo, 1 / 1024) },
        { name: '磁盘-写', points: sumTrend(monitorQuery.data?.diskWriteIo, 1 / 1024) },
      ]
    : [
        ...monitorTrend(monitorQuery.data?.diskReadIo, 1 / 1024, monitorPod).map((series) => ({
          ...series,
          name: `${series.name}-读`,
        })),
        ...monitorTrend(monitorQuery.data?.diskWriteIo, 1 / 1024, monitorPod).map((series) => ({
          ...series,
          name: `${series.name}-写`,
        })),
      ]

  function imageRepo(image: string) {
    const colon = image.lastIndexOf(':')
    const slash = image.lastIndexOf('/')
    return colon > slash ? image.slice(0, colon) : image
  }

  function openVersion(service: ServiceItem) {
    const image = imageOf(service)
    const colon = image.lastIndexOf(':')
    const slash = image.lastIndexOf('/')
    if (colon > slash) {
      setVersionImage(image.slice(0, colon))
      setVersionTag(image.slice(colon + 1))
    } else {
      setVersionImage(image)
      setVersionTag('')
    }
    setVersionTarget(service)
  }

  const columns: Array<Column<ServiceItem>> = [
    {
      key: 'index',
      header: '序号',
      width: 80,
      align: 'center',
      cell: (_row, index) => <span className="text-[14px] text-ink">{index + 1}</span>,
    },
    {
      key: 'label',
      header: '服务名称',
      width: 120,
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{serviceLabel(row)}</span>,
    },
    {
      key: 'key',
      header: '服务标识',
      width: 120,
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{k8sName(row)}</span>,
    },
    {
      key: 'status',
      header: '状态',
      width: 160,
      align: 'center',
      cell: (row) => {
        const status = statusOf(row)
        const allRunning = status.desired > 0 && status.ready === status.desired
        return (
          <div className="leading-[1.5715]">
            <div className={cn('text-[14px]', status.tone)}>{status.label}</div>
            <div className="text-[14px] text-ink">
              {status.ready}/{status.desired}
              {status.desired === 0 ? '全部停止' : allRunning ? '全部运行' : '部分运行'}
            </div>
            <div className="text-[14px] text-ink">已重启 {row.restartCount ?? 0} 次</div>
          </div>
        )
      },
    },
    {
      key: 'image',
      header: '镜像',
      width: 350,
      align: 'center',
      cell: (row) => <span className="mx-auto block max-w-[330px] truncate text-[14px] text-ink">{imageShort(row)}</span>,
    },
    {
      key: 'created',
      header: '创建时间',
      width: 180,
      align: 'center',
      cell: (row) => (
        <span className="whitespace-nowrap text-[14px] text-ink">
          {row.deployment?.metadata?.creationTimestamp
            ? formatDate(row.deployment.metadata.creationTimestamp, true)
            : '--'}
        </span>
      ),
    },
    {
      key: 'updated',
      header: '更新时间',
      width: 120,
      align: 'center',
      cell: (row) => {
        const stamp = row.deployment?.spec?.template?.metadata?.annotations?.['gaop/updateTimestamp']
        return (
          <span className="whitespace-nowrap text-[14px] text-ink">
            {stamp ? formatDate(Number(stamp), true) : '--'}
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: '操作',
      width: 180,
      fixed: 'right',
      align: 'center',
      headerAlign: 'center',
      cell: (row) => {
        const status = statusOf(row)
        const running = status.label === '运行中' || status.label === '滚动发布中' || status.label === '启动中'
        return (
          <div className="flex items-center justify-center gap-2.5 text-[14px]">
            <button
              className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
              onClick={() => setConfigTarget(row)}
            >
              配置
            </button>
            <button
              className={cn(
                'transition-colors',
                running ? 'text-[#ff7b7b] hover:text-[#ff9a9a]' : 'text-[#4aa3f0] hover:text-[#7cc4ff]',
              )}
              onClick={async () => {
                const name = k8sName(row)
                const ok = await confirm({
                  title: `${running ? '停止' : '启动'} ${name}？`,
                  description: '框架服务为平台运行的基础组件，操作后可能短暂影响对应功能。',
                  confirmText: running ? '停止' : '启动',
                  danger: running,
                })
                if (ok) {
                  actionMutation.mutate({ path: running ? '/v1/service/stop' : '/v1/service/start', name })
                }
              }}
            >
              {running ? '停止' : '启动'}
            </button>
            <ActionMenu
              triggerText="更多"
              items={[
                { label: '版本切换', onSelect: () => openVersion(row) },
                {
                  label: '历史日志',
                  onSelect: () => setConsoleState({ service: k8sName(row), mode: 'history' }),
                },
                { label: '实时日志', onSelect: () => setConsoleState({ service: k8sName(row), mode: 'logs' }) },
                { label: '终端登录', onSelect: () => setConsoleState({ service: k8sName(row), mode: 'terminal' }) },
                { label: '监控', onSelect: () => setMonitorTarget(row) },
                { label: '重启', danger: true, onSelect: () => restartMutation.mutate(k8sName(row)) },
              ]}
            />
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <PageToolbar>
        <Button size="sm" variant="signal" onClick={() => navigate('/mirror/group')}>
          <Plus size={12} /> 服务镜像组
        </Button>
      </PageToolbar>

      <Panel bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={services}
          rowKey={(row) => k8sName(row)}
          loading={query.isLoading}
          pageSize={12}
          emptyTitle="暂无框架服务"
          emptyDescription="未检测到平台基础组件，或当前账户无权查看。"
        />
      </Panel>

      <Drawer
        open={!!versionTarget}
        onOpenChange={(open) => !open && setVersionTarget(null)}
        title={versionTarget ? `${serviceName(versionTarget)} 版本切换` : '版本切换'}
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setVersionTarget(null)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={versionMutation.isPending} onClick={() => versionMutation.mutate()}>
              确定
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="镜像仓库" required>
            <input
              className="field"
              value={versionImage}
              onChange={(event) => {
                setVersionImage(event.target.value)
                setVersionTag('')
              }}
            />
          </Field>
          <Field label="镜像版本" required>
            <div className="flex gap-2">
              <input
                className="field flex-1"
                value={versionTag}
                onChange={(event) => setVersionTag(event.target.value)}
              />
              <Select
                className="w-[140px]"
                placeholder="选择版本"
                value=""
                options={(versionTagsQuery.data?.list ?? []).map((tag) => ({
                  value: tag.name,
                  label: tag.name,
                }))}
                onChange={(value) => {
                  if (value) setVersionTag(value)
                }}
              />
            </div>
          </Field>
          <Field label="更新策略">
            <Select
              value={versionStrategy}
              options={[
                { value: '2', label: '滚动更新' },
                { value: '1', label: '先停止再启动' },
              ]}
              onChange={(value) => setVersionStrategy(value as '1' | '2')}
            />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={!!monitorTarget}
        onOpenChange={(open) => !open && setMonitorTarget(null)}
        title={monitorTarget ? `${serviceName(monitorTarget)} 资源监控` : '服务监控'}
        width={920}
        footer={
          <Button size="sm" onClick={() => setMonitorTarget(null)}>
            关闭
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center">
          <button
            onClick={() => setMonitorCustom(true)}
            className={cn(
              'inline-flex h-7 items-center border px-3 text-[14px] transition-colors',
              monitorCustom ? 'border-signal bg-[#1670c2] text-white' : 'border-[#2f6fa8] text-ink-3 hover:text-ink',
            )}
          >
            自定义日期
          </button>
          {MONITOR_RANGES.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setMonitorCustom(false)
                setMonitorRange(item.key)
              }}
              className={cn(
                '-ml-px inline-flex h-7 items-center border px-3 text-[14px] transition-colors',
                !monitorCustom && monitorRange === item.key
                  ? 'border-signal bg-[#1670c2] text-white'
                  : 'border-[#2f6fa8] text-ink-3 hover:text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {monitorCustom && (
          <div className="mb-4">
            <DateTimeRangePicker
              start={monitorStart}
              end={monitorEnd}
              className="w-[380px]"
              onChange={(start, end) => {
                setMonitorStart(start)
                setMonitorEnd(end)
              }}
            />
          </div>
        )}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[14px] text-ink-3">
            <span>容器实例：</span>
            <Select
              className="w-[300px]"
              placeholder="暂无实例"
              value={monitorPod}
              disabled={monitorMode === '1'}
              options={monitorPods.map((item) => ({ value: item, label: item }))}
              onChange={setMonitorPod}
            />
          </div>
          <div className="flex border border-line">
            {(
              [
                { key: '1', label: '合并显示' },
                { key: '2', label: '单独显示' },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                onClick={() => setMonitorMode(item.key)}
                className={cn(
                  'px-3 py-1 text-[14px] transition-colors',
                  monitorMode === item.key ? 'bg-[#1670c2] text-white' : 'text-ink-3 hover:text-ink',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3 text-[14px] text-ink-3">时间间隔：1 分钟</div>
        {monitorCustom && (!monitorStart || !monitorEnd) ? (
          <div className="py-10 text-center text-[14px] text-mute">请选择起止时间</div>
        ) : monitorQuery.isLoading ? (
          <div className="py-10 text-center text-[14px] text-mute">正在采集服务指标…</div>
        ) : monitorQuery.data &&
          !monitorQuery.data.cpu?.length &&
          !monitorQuery.data.memory?.length &&
          !monitorQuery.data.inboundNetwork?.length &&
          !monitorQuery.data.outboundNetwork?.length &&
          !monitorQuery.data.diskReadIo?.length &&
          !monitorQuery.data.diskWriteIo?.length ? (
          <div className="py-10 text-center text-[14px] text-mute">该时间范围内暂无监控数据</div>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-[14px] text-ink-3">CPU 使用量（m）</div>
              <AreaTrend series={cpuSeries} height={170} unit=" m" />
            </div>
            <div>
              <div className="mb-2 text-[14px] text-ink-3">内存使用量（MB）</div>
              <AreaTrend series={memorySeries} height={170} unit=" MB" />
            </div>
            <div>
              <div className="mb-2 text-[14px] text-ink-3">网络吞吐（KB/s）</div>
              <AreaTrend series={networkSeries} height={170} unit=" KB/s" />
            </div>
            <div>
              <div className="mb-2 text-[14px] text-ink-3">磁盘 IO（KB/s）</div>
              <AreaTrend series={diskSeries} height={170} unit=" KB/s" />
            </div>
          </div>
        )}
        <div className="mono mt-3 flex items-center gap-2 text-[12px] text-mute">
          <Activity size={11} /> 指标来自 Prometheus，采样间隔约 1 分钟。
        </div>
      </Drawer>

      {configTarget && (
        <Suspense fallback={null}>
          <ServiceConfigPanel service={k8sName(configTarget)} onClose={() => setConfigTarget(null)} />
        </Suspense>
      )}

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
