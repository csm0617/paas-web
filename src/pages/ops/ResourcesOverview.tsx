import { useQuery } from '@tanstack/react-query'
import { Activity, Database, HardDrive, Layers, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { ClusterSummary } from '@/types'
import { AreaTrend, RingGauge, type TrendPoint } from '@/components/charts'
import { Badge, Button, PageHeader, Panel, StatusDot } from '@/components/ui'
import { cn } from '@/lib/utils'

interface MetricPoint {
  timestamp: string
  value: string
  floatValue: string
}

interface ApiServerData {
  name?: string
  requestRate?: MetricPoint[]
  requestDelay?: {
    delayAvg?: MetricPoint[]
    delayGet?: MetricPoint[]
    delayPost?: MetricPoint[]
    delayPut?: MetricPoint[]
    delayDelete?: MetricPoint[]
  }
}

interface EtcdData {
  name?: string
  raft?: { applied?: MetricPoint[]; commit?: MetricPoint[]; failed?: MetricPoint[]; pending?: MetricPoint[] }
  db?: MetricPoint[]
  clientNetwork?: { networkOut?: MetricPoint[]; networkIn?: MetricPoint[] }
}

interface LokiInfo {
  totalMemory?: number
  logMaxMemory?: number
  logRetainDay?: number
  logRetainMaxDay?: number
  logMaxMemoryStatus?: string
  logRetainDayStatus?: string
}

const RANGES = [
  { key: '1h', label: '最近1小时', hours: 1 },
  { key: '6h', label: '最近6小时', hours: 6 },
  { key: '24h', label: '最近24小时', hours: 24 },
  { key: '7d', label: '最近7天', hours: 168 },
  { key: '30d', label: '最近30天', hours: 720 },
] as const

function toSeries(points: MetricPoint[] | undefined, short: boolean): TrendPoint[] {
  return (points ?? []).map((point) => {
    const date = new Date(point.timestamp)
    const label = Number.isNaN(date.getTime())
      ? point.timestamp
      : short
        ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        : `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    return { label, value: Number(point.floatValue ?? point.value ?? 0) }
  })
}

export default function ResourcesOverviewPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('1h')
  const hours = RANGES.find((item) => item.key === range)?.hours ?? 1
  const rangeQuery = useMemo(() => {
    const end = new Date()
    const start = new Date(end.getTime() - hours * 3_600_000)
    return { queryTimeType: false, start: start.toISOString(), end: end.toISOString() }
  }, [hours])

  const summaryQuery = useQuery({
    queryKey: ['cluster-summary'],
    queryFn: () => api.get<ClusterSummary>('/cloud/summary', { query: JSON.stringify({ excludeTainted: false }) }),
    refetchInterval: 60_000,
  })
  const lokiQuery = useQuery({
    queryKey: ['loki-info'],
    queryFn: () => api.get<LokiInfo>('/loki/logs/getLogsAssertInfo'),
    refetchInterval: 60_000,
  })
  const apiServerQuery = useQuery({
    queryKey: ['dashboard-apiserver', range],
    queryFn: () => api.get<ApiServerData>('/api/v2/dashboards/apiServer', rangeQuery),
    refetchInterval: 60_000,
  })
  const etcdQuery = useQuery({
    queryKey: ['dashboard-etcd', range],
    queryFn: () => api.get<EtcdData>('/api/v2/dashboards/etcd', rangeQuery),
    refetchInterval: 60_000,
  })

  const staticInfo = summaryQuery.data?.static
  const useRate = summaryQuery.data?.dynamic?.useRate
  const resource = staticInfo?.resource
  const pods = staticInfo?.pod ?? {}
  const short = hours <= 24

  const containers = pods.Running ?? 0
  const podTotal = Object.values(pods).reduce((sum, value) => sum + (value || 0), 0)
  const cpuAlloc = resource ? resource.allocatedCPU : 0
  const cpuSum = resource ? resource.cupSum : 0
  const memAlloc = resource ? resource.allocatedMemByKB / 1024 / 1024 : 0
  const memSum = resource ? resource.memSumByKB / 1024 / 1024 : 0

  const apiServer = apiServerQuery.data
  const etcd = etcdQuery.data

  const rateSeries = toSeries(apiServer?.requestRate, short)
  const delaySeries = toSeries(apiServer?.requestDelay?.delayAvg, short)
  const raftSeries = [
    { name: 'APPLIED', points: toSeries(etcd?.raft?.applied, short), color: 'var(--color-signal)' },
    { name: 'COMMIT', points: toSeries(etcd?.raft?.commit, short), color: 'var(--color-ink)' },
    { name: 'FAILED', points: toSeries(etcd?.raft?.failed, short), color: 'var(--color-warn)' },
    { name: 'PENDING', points: toSeries(etcd?.raft?.pending, short), color: 'var(--color-info)' },
  ]
  const dbSeries = toSeries(etcd?.db, short).map((point) => ({ ...point, value: point.value / 1024 / 1024 }))
  const networkSeries = [
    { name: 'IN', points: toSeries(etcd?.clientNetwork?.networkIn, short), color: 'var(--color-ok)' },
    { name: 'OUT', points: toSeries(etcd?.clientNetwork?.networkOut, short), color: 'var(--color-signal)' },
  ]

  const refreshing =
    summaryQuery.isFetching || lokiQuery.isFetching || apiServerQuery.isFetching || etcdQuery.isFetching

  return (
    <div>
      <PageHeader
        index="04 / 02"
        en="OPERATIONS · RESOURCE OVERVIEW"
        title="资源概览"
        description="集群资源分配与使用水位、日志存储治理，以及 etcd 与 APIServer 的核心指标趋势。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={summaryQuery.isError ? 'warn' : 'ok'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {summaryQuery.isError ? 'METRICS DEGRADED' : 'CLUSTER ONLINE'}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">STEP 1 MIN</span>
          </>
        }
        actions={
          <>
            <div className="flex flex-wrap items-center gap-1 border border-line">
              {RANGES.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setRange(item.key)}
                  className={cn(
                    'mono px-2.5 py-1.5 text-[9px] tracking-widest transition-colors',
                    range === item.key ? 'bg-signal text-white' : 'text-mute hover:text-ink',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              loading={refreshing}
              onClick={() => {
                summaryQuery.refetch()
                lokiQuery.refetch()
                apiServerQuery.refetch()
                etcdQuery.refetch()
              }}
            >
              <RefreshCw size={11} /> 刷新
            </Button>
          </>
        }
      />

      <section className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Panel bodyClassName="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div className="label">主机状态</div>
            <Layers size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{staticInfo?.node?.nodeRunning ?? '—'}</span>
            <span className="text-[12px] text-mute">/ {staticInfo?.node?.nodeSum ?? '—'}</span>
          </div>
          <div className="mono mt-2.5 text-[9px] tracking-widest text-mute">
            SCHEDULABLE {staticInfo?.node?.schedulable ?? '—'}
          </div>
        </Panel>
        <Panel bodyClassName="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div className="label">CPU 分配</div>
            <Activity size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{formatNumber(cpuAlloc, 1)}</span>
            <span className="text-[12px] text-mute">/ {formatNumber(cpuSum, 0)} 核</span>
          </div>
          <div className="mt-2.5 h-[3px] w-full bg-line">
            <div
              className="h-full bg-signal transition-[width] duration-700"
              style={{ width: `${cpuSum ? Math.min(100, (cpuAlloc / cpuSum) * 100) : 0}%` }}
            />
          </div>
        </Panel>
        <Panel bodyClassName="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div className="label">内存分配</div>
            <HardDrive size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{formatNumber(memAlloc, 1)}</span>
            <span className="text-[12px] text-mute">/ {formatNumber(memSum, 1)} G</span>
          </div>
          <div className="mt-2.5 h-[3px] w-full bg-line">
            <div
              className="h-full bg-signal transition-[width] duration-700"
              style={{ width: `${memSum ? Math.min(100, (memAlloc / memSum) * 100) : 0}%` }}
            />
          </div>
        </Panel>
        <Panel bodyClassName="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div className="label">容器</div>
            <Layers size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{containers}</span>
            <span className="text-[12px] text-mute">/ {podTotal}</span>
          </div>
          <div className="mono mt-2.5 text-[9px] tracking-widest text-mute">
            RUNNING · PENDING {pods.Pending ?? 0} · FAILED {pods.Failed ?? 0}
          </div>
        </Panel>
      </section>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-5" kicker="CLUSTER UTILIZATION" title="集群资源使用情况">
          <div className="flex items-center justify-around py-2">
            <RingGauge value={(useRate?.cpu ?? 0) / 100} size={122} label="CPU" display={`${formatNumber(useRate?.cpu ?? 0, 1)}%`} />
            <RingGauge
              value={(useRate?.mem ?? 0) / 100}
              size={122}
              label="MEMORY"
              display={`${formatNumber(useRate?.mem ?? 0, 1)}%`}
              color="var(--color-ink)"
            />
          </div>
          <div className="mono mt-2 border-t border-line pt-2 text-[8px] leading-relaxed tracking-wider text-mute">
            使用率由 Prometheus 采集节点实际水位，与上方“分配”口径不同。
          </div>
        </Panel>
        <Panel className="xl:col-span-3" kicker="LOG CAPACITY" title="日志存储容量">
          <div className="mt-1 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{formatNumber(lokiQuery.data?.totalMemory ?? 0, 2)}</span>
            <span className="text-[12px] text-mute">GiB</span>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between">
              <span className="label">告警值</span>
              <span className="mono text-[10px] text-ink">{lokiQuery.data?.logMaxMemory ?? '—'} MB</span>
            </div>
            <div className="h-[3px] w-full bg-line">
              <div
                className="h-full bg-signal transition-[width] duration-700"
                style={{
                  width: `${lokiQuery.data?.logMaxMemory ? Math.min(100, ((lokiQuery.data.totalMemory ?? 0) / lokiQuery.data.logMaxMemory) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
            <span className="label">状态</span>
            <Badge tone={lokiQuery.data?.logMaxMemoryStatus === 'NORMAL' ? 'ok' : 'warn'}>
              {lokiQuery.data?.logMaxMemoryStatus || '—'}
            </Badge>
          </div>
        </Panel>
        <Panel className="xl:col-span-4" kicker="LOG RETENTION" title="日志存储时长">
          <div className="mt-1 flex items-baseline gap-1">
            <span className="num text-[30px] leading-none text-ink">{lokiQuery.data?.logRetainDay ?? '—'}</span>
            <span className="text-[12px] text-mute">
              / {lokiQuery.data?.logRetainMaxDay ?? '—'} 天
            </span>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between">
              <span className="label">保留策略</span>
              <Badge tone={lokiQuery.data?.logRetainDayStatus === 'NORMAL' ? 'ok' : 'warn'}>
                {lokiQuery.data?.logRetainDayStatus || '—'}
              </Badge>
            </div>
            <div className="h-[3px] w-full bg-line">
              <div
                className="h-full bg-signal transition-[width] duration-700"
                style={{
                  width: `${lokiQuery.data?.logRetainMaxDay ? Math.min(100, ((lokiQuery.data.logRetainDay ?? 0) / lokiQuery.data.logRetainMaxDay) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
          <div className="mono mt-3 border-t border-line pt-2 text-[8px] leading-relaxed tracking-wider text-mute">
            超期日志由平台治理任务自动清理。
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-12"
          kicker="ETCD MONITORING"
          title="ETCD 监控"
          actions={<span className="mono text-[8.5px] tracking-widest text-mute">RAFT · DB · NETWORK</span>}
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div>
              <div className="label mb-2">Raft 提议（次/秒）</div>
              <AreaTrend series={raftSeries} height={180} legend />
            </div>
            <div>
              <div className="label mb-2">数据库大小</div>
              <AreaTrend series={[{ name: 'DB SIZE', points: dbSeries }]} height={180} unit=" MB" />
            </div>
            <div>
              <div className="label mb-2">客户端流量</div>
              <AreaTrend series={networkSeries} height={180} />
            </div>
          </div>
        </Panel>

        <Panel
          className="xl:col-span-12"
          kicker="APISERVER MONITORING"
          title="APIServer 监控"
          actions={<span className="mono text-[8.5px] tracking-widest text-mute">RATE · LATENCY</span>}
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <div className="label mb-2">请求速率（次/秒）</div>
              <AreaTrend series={[{ name: 'REQUEST RATE', points: rateSeries }]} height={190} />
            </div>
            <div>
              <div className="label mb-2">请求延迟（毫秒）</div>
              <AreaTrend series={[{ name: 'DELAY AVG', points: delaySeries }]} height={190} unit=" ms" />
            </div>
          </div>
        </Panel>
      </div>

      <div className="mono mt-4 flex items-center gap-2 text-[8px] tracking-wider text-mute">
        <Database size={10} /> 指标来源 PROMETHEUS · 采样步长 1 分钟 · 区间 {RANGES.find((item) => item.key === range)?.label}
      </div>
    </div>
  )
}
