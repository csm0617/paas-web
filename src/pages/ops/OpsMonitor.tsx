import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpRight, RefreshCw, RotateCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { formatDate, formatNumber, formatPercent, nodeAddress, nodeReady } from '@/lib/format'
import type { ClusterSummary, CockpitData, NodesResponse, NodeSummary, ServiceList } from '@/types'
import { RingGauge } from '@/components/charts'
import { Badge, Button, Meter, Modal, PageHeader, Panel, StatusDot, Tip, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function OpsMonitorPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.get<NodesResponse>('/cloud/nodes'),
    refetchInterval: 20_000,
  })
  const nodeSummaryQuery = useQuery({
    queryKey: ['nodes-summary'],
    queryFn: () => api.get<NodeSummary>('/cloud/nodesummary'),
    refetchInterval: 20_000,
  })
  const summaryQuery = useQuery({
    queryKey: ['cluster-summary'],
    queryFn: () => api.get<ClusterSummary>('/cloud/summary'),
    refetchInterval: 20_000,
  })
  const cockpitQuery = useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<CockpitData>('/api/v2/dashboards/cockpit'),
    refetchInterval: 30_000,
  })
  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
    refetchInterval: 30_000,
  })
  const modeQuery = useQuery({
    queryKey: ['platform-mode'],
    queryFn: async () => {
      const [current, list] = await Promise.all([
        api.get<{ id?: number; mode?: string; modeName?: string }>('/v1/mode/current'),
        api.get<{ modeList?: Array<{ id: number; mode: string; modeName: string; used: number }> }>('/v1/mode/list'),
      ])
      return { current, modes: list?.modeList ?? [] }
    },
    refetchInterval: 60_000,
  })
  const promQuery = useQuery({
    queryKey: ['prometheus-health'],
    queryFn: () =>
      api.get<{
        healthy?: boolean
        status?: string
        message?: string
        latestSampleTime?: string
        checkedAt?: string
        prometheusClockSkewSeconds?: number
      }>('/v1/prometheus/health'),
    refetchInterval: 30_000,
  })
  const lokiQuery = useQuery({
    queryKey: ['loki-info'],
    queryFn: () =>
      api.get<{
        totalMemory?: number
        logMaxMemory?: number
        logDeleteLastTime?: number
        logRetainDay?: number
        logRetainMaxDay?: number
        logMaxMemoryStatus?: string
        logRetainDayStatus?: string
        deleteStatus?: boolean
        lokiPodStatus?: boolean
      }>('/loki/logs/getLogsAssertInfo'),
    refetchInterval: 60_000,
  })

  const nodes = nodesQuery.data?.nodes?.nodes ?? []
  const services = servicesQuery.data?.services ?? []

  const queryClient = useQueryClient()
  const [lokiMemory, setLokiMemory] = useState('')
  const [lokiDays, setLokiDays] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTime, setDeleteTime] = useState('')
  useEffect(() => {
    if (!lokiQuery.data) return
    setLokiMemory(String(lokiQuery.data.logMaxMemory ?? ''))
    setLokiDays(String(lokiQuery.data.logRetainMaxDay ?? ''))
  }, [lokiQuery.dataUpdatedAt])
  const lokiSettingMutation = useMutation({
    mutationFn: async () => {
      const memory = Number(lokiMemory)
      const day = Number(lokiDays)
      if (!memory || memory <= 0) throw new Error('日志内存上限需大于 0')
      if (!day || day <= 0) throw new Error('日志保留天数需大于 0')
      await api.put('/loki/logs/setLogMaxMemory', undefined, { val: memory })
      await api.put('/loki/logs/setLokiLogRetainMaxDay', undefined, { day })
    },
    onSuccess: () => {
      toast.success('日志治理策略已更新')
      queryClient.invalidateQueries({ queryKey: ['loki-info'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })
  const deleteLogsMutation = useMutation({
    mutationFn: async () => {
      const ms = new Date(deleteTime).getTime()
      if (!deleteTime || Number.isNaN(ms)) throw new Error('请选择要清理的时间点')
      if (ms > Date.now()) throw new Error('清理时间不能晚于当前时间')
      const last = lokiQuery.data?.logDeleteLastTime ?? 0
      if (last > 0 && Math.floor(ms / 1000) < last) throw new Error('清理时间不能早于上次清理时间')
      return api.del<string>('/loki/logs/deleteLogs', undefined, { deleteTime: Math.floor(ms / 1000) })
    },
    onSuccess: () => {
      toast.success('日志清理任务已提交', '后台正在删除所选时间之前的日志')
      setDeleteOpen(false)
      queryClient.invalidateQueries({ queryKey: ['loki-info'] })
    },
    onError: (error) => toast.error('提交失败', errorMessage(error)),
  })
  useEffect(() => {
    if (!lokiQuery.data?.deleteStatus) return
    const timer = window.setInterval(async () => {
      try {
        const running = await api.get<boolean>('/loki/logs/getDeleteStatus')
        if (!running) {
          window.clearInterval(timer)
          toast.success('历史日志清理完成')
          queryClient.invalidateQueries({ queryKey: ['loki-info'] })
        }
      } catch {
        /* 轮询期间忽略瞬时错误，等待下一轮 */
      }
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [lokiQuery.data?.deleteStatus, queryClient])
  const modeMutation = useMutation({
    mutationFn: (id: number) => api.post('/v1/mode/updateModeType', undefined, { id }),
    onSuccess: () => {
      toast.success('运行模式已切换')
      queryClient.invalidateQueries({ queryKey: ['platform-mode'] })
    },
    onError: (error) => toast.error('模式切换失败', errorMessage(error)),
  })
  const promRepairMutation = useMutation({
    mutationFn: () => api.post('/v1/prometheus/repair'),
    onSuccess: () => {
      toast.success('Prometheus 修复任务已提交', '时间跳变数据将在后台处理')
      promQuery.refetch()
    },
    onError: (error) => toast.error('修复失败', errorMessage(error)),
  })

  const anomalies = useMemo(
    () =>
      services
        .map((service) => {
          const ready = service.deployment?.status?.readyReplicas ?? 0
          const desired = service.deployment?.spec?.replicas ?? 0
          return { service, ready, desired, restarts: service.restartCount ?? 0 }
        })
        .filter((item) => item.ready < item.desired || item.restarts > 0)
        .sort((a, b) => b.restarts - a.restarts),
    [services],
  )

  const cpu = summaryQuery.data ? summaryQuery.data.dynamic?.useRate?.cpu ?? 0 : null
  const mem = summaryQuery.data ? summaryQuery.data.dynamic?.useRate?.mem ?? 0 : null
  const pods = cockpitQuery.data?.podHealthRateInfo
  const unhealthyPods = pods?.podHealthRateList?.reduce((sum, item) => sum + item.unHealth, 0) ?? 0
  const metricsMissing = summaryQuery.isError || nodeSummaryQuery.isError || cockpitQuery.isError

  return (
    <div>
      <PageHeader
        index="04 / 01"
        en="OPERATIONS · STATUS MONITORING"
        title="资源监控"
        description="面向运维值班的全局监控面板。聚合节点水位、Pod 健康与异常服务，支持快速定位与重启处置。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={metricsMissing ? 'warn' : unhealthyPods > 0 ? 'warn' : 'ok'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {metricsMissing
                  ? 'METRICS DEGRADED'
                  : unhealthyPods > 0
                    ? `${unhealthyPods} POD ANOMALIES`
                    : 'ALL SYSTEMS NOMINAL'}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">AUTO REFRESH 20S</span>
          </>
        }
        actions={
          <Button
            size="sm"
            loading={nodesQuery.isFetching}
            onClick={() => {
              nodesQuery.refetch()
              summaryQuery.refetch()
              servicesQuery.refetch()
              cockpitQuery.refetch()
            }}
          >
            <RefreshCw size={11} /> 刷新
          </Button>
        }
      />

      {metricsMissing && (
        <div className="mb-4 flex items-center gap-3 border-l-2 border-warn bg-warn/[0.06] px-4 py-2.5">
          <AlertTriangle size={13} className="text-warn" />
          <span className="text-[11.5px] text-ink">
            资源指标采集暂不可用，部分水位与 Pod 健康数据缺失；服务副本状态仍可正常查看。
          </span>
        </div>
      )}

      {anomalies.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 border-l-2 border-warn bg-warn/[0.06] px-4 py-2.5">
          <AlertTriangle size={14} className="text-warn" />
          <span className="text-[11.5px] text-ink">
            检测到 {anomalies.length} 个服务存在异常副本或重启记录，建议优先核查。
          </span>
          <button
            onClick={() => navigate('/ops/alert-record')}
            className="mono ml-auto flex items-center gap-1 text-[9.5px] tracking-widest text-warn hover:underline"
          >
            查看告警记录 <ArrowUpRight size={10} />
          </button>
        </div>
      )}

      <section className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Panel bodyClassName="px-4 py-3.5">
          <div className="label">集群 CPU</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{cpu === null ? '—' : formatNumber(cpu, 1)}</span>
            <span className="text-[12px] text-mute">%</span>
          </div>
          <div className="mt-2.5">
            <Meter value={cpu ?? 0} />
          </div>
        </Panel>
        <Panel bodyClassName="px-4 py-3.5">
          <div className="label">集群内存</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{mem === null ? '—' : formatNumber(mem, 1)}</span>
            <span className="text-[12px] text-mute">%</span>
          </div>
          <div className="mt-2.5">
            <Meter value={mem ?? 0} />
          </div>
        </Panel>
        <Panel bodyClassName="px-4 py-3.5">
          <div className="label">运行 Pod</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{pods?.running ?? '—'}</span>
            <span className="text-[12px] text-mute">/ {pods?.total ?? '—'}</span>
          </div>
          <div className="mt-2.5">
            <Meter value={(pods?.normalRate ?? 0) * 100} tone="ok" />
          </div>
        </Panel>
        <Panel bodyClassName="px-4 py-3.5">
          <div className="label">异常服务</div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className={cn('num text-[30px] leading-none', anomalies.length ? 'text-signal' : 'text-ink')}>
              {anomalies.length}
            </span>
            <span className="text-[12px] text-mute">/ {services.length}</span>
          </div>
          <div className="mono mt-2.5 text-[9px] tracking-widest text-mute">RESTART + REPLICA DRIFT</div>
        </Panel>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-8" kicker="NODE MATRIX" title="节点水位矩阵" bodyClassName="p-0">
          <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(2n)]:border-l">
            {nodes.map((node) => {
              const name = node.objectMeta.name
              const ncpu = nodeSummaryQuery.data ? nodeSummaryQuery.data.cpu?.find((item) => item.name === name)?.used ?? 0 : null
              const nmem = nodeSummaryQuery.data ? nodeSummaryQuery.data.memory?.find((item) => item.name === name)?.used ?? 0 : null
              const podInfo = cockpitQuery.data?.podHealthRateInfo?.podHealthRateList?.find((item) => item.nodeName === name)
              const podFallback = nodesQuery.data?.pod_count?.find((item) => (item.name || item.nodeName) === name)?.count
              const ready = nodeReady(node)
              const ip = nodeAddress(node)
              return (
                <div key={name} className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusDot tone={ready ? 'ok' : 'bad'} />
                        <span className="font-mono text-[12px] text-ink">{name}</span>
                      </div>
                      <div className="mono mt-1 text-[8.5px] tracking-widest text-mute">{ip}</div>
                    </div>
                    <RingGauge
                      value={Math.max(ncpu ?? 0, nmem ?? 0) / 100}
                      size={54}
                      stroke={4}
                      display={ncpu === null || nmem === null ? '—' : ''}
                      color={(Math.max(ncpu ?? 0, nmem ?? 0) >= 85 ? 'var(--color-signal)' : ncpu === null ? 'var(--color-line-strong)' : 'var(--color-ink)')}
                    />
                  </div>
                  <div className="mt-3 space-y-2.5">
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="label">CPU</span>
                        <span className="mono text-[10px] text-ink">{ncpu === null ? '—' : formatPercent(ncpu)}</span>
                      </div>
                      <Meter value={ncpu ?? 0} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="label">MEMORY</span>
                        <span className="mono text-[10px] text-ink">{nmem === null ? '—' : formatPercent(nmem)}</span>
                      </div>
                      <Meter value={nmem ?? 0} />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
                    <span className="mono text-[8.5px] tracking-widest text-mute">
                      PODS {podInfo ? `${podInfo.health}/${podInfo.total}` : podFallback ?? '—'}
                    </span>
                    <Badge tone={ready ? 'ok' : 'bad'}>{ready ? 'READY' : 'DOWN'}</Badge>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <div className="flex flex-col gap-4 xl:col-span-4">
          <Panel kicker="POD HEALTH" title="Pod 健康度" bodyClassName="px-4 py-4">
            <div className="flex items-center justify-around">
              <RingGauge
                value={pods?.normalRate ?? 0}
                size={116}
                label="NORMAL"
                display={`${Math.round((pods?.normalRate ?? 0) * 100)}%`}
              />
              <div className="space-y-2 text-right">
                <div>
                  <div className="label">运行中</div>
                  <div className="num text-[22px] text-ok">{pods?.running ?? '—'}</div>
                </div>
                <div>
                  <div className="label">异常</div>
                  <div className={cn('num text-[22px]', unhealthyPods ? 'text-signal' : 'text-ink')}>{unhealthyPods}</div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            kicker="SYSTEM SERVICES"
            title="系统服务"
            actions={
              <button onClick={() => navigate('/software/application/service')} className="mono text-[8.5px] tracking-widest text-mute hover:text-signal">
                ALL
              </button>
            }
            bodyClassName="p-0"
          >
            <div className="max-h-[190px] divide-y divide-line/60 overflow-y-auto">
              {(cockpitQuery.data?.systemService?.serviceList ?? []).slice(0, 8).map((service) => (
                <div key={`${service.namespace}-${service.name}`} className="flex items-center gap-2 px-4 py-2">
                  <StatusDot tone={service.normal === service.total ? 'ok' : 'warn'} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{service.name}</span>
                  <span className="mono text-[9.5px] text-mute">
                    {service.normal}/{service.total}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <Panel className="xl:col-span-12" kicker="ANOMALY QUEUE" title="异常服务队列" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>服务</th>
                  <th>副本 READY / DESIRED</th>
                  <th>重启次数</th>
                  <th>镜像</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {anomalies.map(({ service, ready, desired, restarts }) => (
                  <tr key={service.nameUs || service.nameFr}>
                    <td>
                      <div className="flex items-center gap-2">
                        <StatusDot tone={ready === 0 ? 'bad' : 'warn'} />
                        <span className="font-mono text-[11px] text-ink">{service.nameUs || service.nameFr}</span>
                      </div>
                    </td>
                    <td>
                      <span className="num text-[12px] text-warn">
                        {ready}
                        <span className="text-[9.5px] text-mute"> / {desired}</span>
                      </span>
                    </td>
                    <td>
                      <span className={cn('mono text-[11px]', restarts > 0 ? 'text-signal' : 'text-mute')}>{restarts}</span>
                    </td>
                    <td>
                      <span className="mono max-w-[260px] truncate text-[9.5px] text-mute">
                        {typeof service.imageInfo === 'string' ? service.imageInfo : '—'}
                      </span>
                    </td>
                    <td>
                      <Badge tone={ready === 0 ? 'bad' : 'warn'}>{ready === 0 ? 'UNSERVED' : 'DEGRADED'}</Badge>
                    </td>
                    <td className="text-right">
                      <Tip content="滚动重启该服务">
                        <Button size="sm" onClick={() => servicesQuery.refetch()}>
                          <RotateCw size={10} /> 核查
                        </Button>
                      </Tip>
                    </td>
                  </tr>
                ))}
                {anomalies.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-[11px] text-mute">
                      当前没有异常服务，全部副本处于就绪状态。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel kicker="PLATFORM MODE" title="运行模式">
          <div className="flex items-center gap-2">
            <Badge tone="info">{modeQuery.data?.current?.mode || '—'}</Badge>
            <span className="text-[12px] font-medium text-ink">{modeQuery.data?.current?.modeName || '未获取模式'}</span>
          </div>
          <div className="mt-3 space-y-2">
            {(modeQuery.data?.modes ?? []).map((mode) => (
              <div key={mode.id} className="flex items-center justify-between border-b border-line pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <StatusDot tone={mode.used ? 'ok' : 'idle'} />
                  <span className="text-[11px] text-ink-3">{mode.modeName}</span>
                  <span className="mono text-[8.5px] text-mute">{mode.mode}</span>
                </div>
                {mode.used ? (
                  <Badge tone="ok">ACTIVE</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={modeMutation.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `切换到「${mode.modeName}」模式？`,
                        description: '运行模式切换可能影响平台内服务的调度与资源分配，请确认当前无正在执行的关键任务。',
                        confirmText: '切换模式',
                      })
                      if (ok) modeMutation.mutate(mode.id)
                    }}
                  >
                    切换
                  </Button>
                )}
              </div>
            ))}
            {(modeQuery.data?.modes ?? []).length === 0 && <div className="text-[10.5px] text-mute">暂未配置运行模式</div>}
          </div>
          <div className="mono mt-3 text-[8px] leading-relaxed tracking-wider text-mute">
            模式切换依赖 TenX 组件，若组件缺失将切换失败。
          </div>
        </Panel>

        <Panel kicker="PROMETHEUS" title="指标采集">
          <div className="flex items-center gap-2">
            <Badge tone={promQuery.data?.healthy ? 'ok' : 'bad'}>{promQuery.data?.status || 'UNKNOWN'}</Badge>
            <span className="text-[11px] text-ink-3">{promQuery.data?.message || '—'}</span>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="label">最近采样</span>
              <span className="mono text-[9.5px] text-ink-3">{formatDate(promQuery.data?.latestSampleTime)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="label">时钟偏差</span>
              <span className="mono text-[9.5px] text-ink-3">{promQuery.data?.prometheusClockSkewSeconds ?? '—'} s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="label">探测时间</span>
              <span className="mono text-[9.5px] text-ink-3">{formatDate(promQuery.data?.checkedAt)}</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="sm" loading={promQuery.isFetching} onClick={() => promQuery.refetch()}>
              <RefreshCw size={10} /> 重新探测
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={promRepairMutation.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: '修复 Prometheus 时间跳变数据？',
                  description: '平台将清理因系统时钟跳变产生的异常采样点，修复期间监控曲线可能短暂断点。',
                  confirmText: '开始修复',
                })
                if (ok) promRepairMutation.mutate()
              }}
            >
              修复时间跳变
            </Button>
          </div>
        </Panel>

        <Panel kicker="LOKI · LOG GOVERNANCE" title="日志治理">
          <div className="flex items-center gap-2">
            <Badge tone={lokiQuery.data?.lokiPodStatus ? 'ok' : 'warn'}>
              {lokiQuery.data?.lokiPodStatus ? 'LOKI RUNNING' : 'LOKI UNAVAILABLE'}
            </Badge>
            <span className="mono text-[9px] text-mute">
              RETAIN {lokiQuery.data?.logRetainDay ?? '—'} / {lokiQuery.data?.logRetainMaxDay ?? '—'} DAYS
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="label">日志内存</span>
              <span className="mono text-[9.5px] text-ink-3">
                {formatNumber(lokiQuery.data?.totalMemory ?? 0, 2)} GiB / {lokiQuery.data?.logMaxMemory ?? '—'} MB
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="label">内存状态</span>
              <Badge tone={lokiQuery.data?.logMaxMemoryStatus === 'NORMAL' ? 'ok' : 'warn'}>
                {lokiQuery.data?.logMaxMemoryStatus || '—'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="label">清理状态</span>
              <Badge tone={lokiQuery.data?.deleteStatus ? 'warn' : 'default'}>
                {lokiQuery.data?.deleteStatus ? 'RUNNING' : 'IDLE'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="label">上次清理</span>
              <span className="mono text-[9.5px] text-ink-3">
                {lokiQuery.data?.logDeleteLastTime
                  ? formatDate(lokiQuery.data.logDeleteLastTime * 1000)
                  : '—'}
              </span>
            </div>
          </div>
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="label">内存上限 / MB</span>
                <input
                  className="field mt-1 h-8 font-mono text-[11px]"
                  type="number"
                  min={1}
                  value={lokiMemory}
                  onChange={(event) => setLokiMemory(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="label">保留天数</span>
                <input
                  className="field mt-1 h-8 font-mono text-[11px]"
                  type="number"
                  min={1}
                  value={lokiDays}
                  onChange={(event) => setLokiDays(event.target.value)}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                className="w-full"
                variant="primary"
                loading={lokiSettingMutation.isPending}
                onClick={() => lokiSettingMutation.mutate()}
              >
                保存策略
              </Button>
              <Button
                size="sm"
                className="w-full"
                variant="ghost"
                onClick={() => {
                  setDeleteTime(toLocalInput(new Date()))
                  setDeleteOpen(true)
                }}
              >
                <Trash2 size={10} /> 清理历史
              </Button>
            </div>
          </div>
          <div className="mono mt-3 text-[8px] leading-relaxed tracking-wider text-mute">
            日志保留策略由平台治理任务执行，超过保留天数的日志将自动清理。
          </div>
        </Panel>
      </div>

      <Modal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="清理历史日志"
        kicker="LOKI · LOG PURGE"
        description="删除所选时间点之前的全部历史日志，操作不可撤销。"
        width={440}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={deleteLogsMutation.isPending}
              onClick={() => deleteLogsMutation.mutate()}
            >
              确认清理
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="label">清理截止时间</span>
            <input
              type="datetime-local"
              className="field mt-1 h-9 font-mono text-[12px]"
              value={deleteTime}
              max={toLocalInput(new Date())}
              min={
                lokiQuery.data?.logDeleteLastTime
                  ? toLocalInput(new Date(lokiQuery.data.logDeleteLastTime * 1000))
                  : undefined
              }
              onChange={(event) => setDeleteTime(event.target.value)}
            />
          </label>
          <div className="mono text-[9px] leading-relaxed tracking-wider text-mute">
            仅能选择上次清理时间
            {lokiQuery.data?.logDeleteLastTime
              ? `（${formatDate(lokiQuery.data.logDeleteLastTime * 1000)}）`
              : ''}
            之后的时间。清理任务将在后台执行，可在“清理状态”中查看进度。
          </div>
        </div>
      </Modal>
    </div>
  )
}
