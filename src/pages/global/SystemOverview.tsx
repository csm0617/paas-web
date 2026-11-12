import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Plus, RefreshCw, RotateCw, Scale, Server, Cpu, MemoryStick, Boxes } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import {
  formatNumber,
  formatPercent,
  nodeAddress,
  nodeCapacityCpu,
  nodeCapacityMemMiB,
  nodePodCapacity,
  nodeReady,
  parseMilliCores,
  parseMemoryKb,
} from '@/lib/format'
import type { ClusterSummary, CockpitData, NodesResponse, NodeSummary } from '@/types'
import { AreaTrend, Donut, RingGauge, Sparkline } from '@/components/charts'
import { Badge, Button, KV, Meter, Modal, PageHeader, Panel, StatusDot, TabStrip } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

interface Consumption {
  [node: string]: {
    limits?: { cpu?: string; memory?: string }
    requests?: { cpu?: string; memory?: string }
  }
}

interface BalancePod {
  namespace?: string
  serviceName?: string
  callServiceName?: string
  podName?: string
  nodeName?: string
  requestCpuSize?: number
  requestMemorySize?: number
  restartCount?: number
  status?: string
}

function nodeIp(node: NodesResponse['nodes']['nodes'][number]) {
  return nodeAddress(node)
}

function isReady(node: NodesResponse['nodes']['nodes'][number]) {
  return nodeReady(node)
}

export default function SystemOverviewPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [balanceNode, setBalanceNode] = useState('')
  const [balanceSelected, setBalanceSelected] = useState<string[]>([])

  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.get<NodesResponse>('/cloud/nodes'),
    refetchInterval: 20_000,
  })
  const summaryQuery = useQuery({
    queryKey: ['cluster-summary'],
    queryFn: () => api.get<ClusterSummary>('/cloud/summary'),
    refetchInterval: 20_000,
  })
  const nodeSummaryQuery = useQuery({
    queryKey: ['nodes-summary'],
    queryFn: () => api.get<NodeSummary>('/cloud/nodesummary'),
    refetchInterval: 20_000,
  })
  const cockpitQuery = useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<CockpitData>('/api/v2/dashboards/cockpit'),
    refetchInterval: 30_000,
  })
  const consumptionQuery = useQuery({
    queryKey: ['node-consumption'],
    queryFn: () => api.get<Consumption>('/cloud/nodes/resource-consumption'),
    refetchInterval: 30_000,
  })
  const balanceQuery = useQuery({
    queryKey: ['balance-pods'],
    queryFn: () => api.get<Record<string, BalancePod[]>>('/cloud/nodes/sorted_pods'),
    enabled: balanceOpen,
    refetchInterval: balanceOpen ? 10_000 : false,
  })
  const balanceMap = balanceQuery.data ?? {}
  const balanceNodes = Object.keys(balanceMap)
  const balancePods = balanceMap[balanceNode] ?? []
  useEffect(() => {
    if (!balanceNodes.length) return
    if (!balanceNodes.includes(balanceNode)) {
      setBalanceNode(balanceNodes[0])
      setBalanceSelected([])
    }
  }, [balanceNodes, balanceNode])
  const restartPodsMutation = useMutation({
    mutationFn: (podNames: string[]) =>
      api.del('/v1/service/servicePods', { namespace: 'gaop-namespace', force: false, podNames }),
    onSuccess: () => {
      toast.success('Pod 重启指令已下发', '工作负载将重建所选容器')
      setBalanceSelected([])
      balanceQuery.refetch()
    },
    onError: (error) => toast.error('重启失败', errorMessage(error)),
  })

  const nodes = nodesQuery.data?.nodes?.nodes ?? []
  const summary = summaryQuery.data
  const nodeSummary = nodeSummaryQuery.data
  const cockpit = cockpitQuery.data
  const consumption = consumptionQuery.data

  const cpuSeries = useMemo(() => {
    const node = cockpit?.nodeInfo?.[0]
    return (node?.nodeCpu ?? []).slice(-30).map((point) => ({
      label: new Date(point.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      value: Number(point.floatValue ?? point.value) * 100,
    }))
  }, [cockpit])

  const memSeries = useMemo(() => {
    const node = cockpit?.nodeInfo?.[0]
    return (node?.nodeMemory ?? []).slice(-30).map((point) => ({
      label: new Date(point.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      value: Number(point.floatValue ?? point.value) * 100,
    }))
  }, [cockpit])

  const trend = useMemo(() => {
    const source = cpuSeries.length ? cpuSeries : [{ label: '—', value: 0 }]
    return source.map((point, index) => ({
      label: point.label,
      value: point.value,
      mem: memSeries[index]?.value ?? 0,
    }))
  }, [cpuSeries, memSeries])

  const podPhases = summary?.static?.pod ?? {}
  const podSegments = [
    { label: 'Running', value: podPhases.Running ?? 0, color: 'var(--color-ok)' },
    { label: 'Pending', value: podPhases.Pending ?? 0, color: 'var(--color-warn)' },
    { label: 'Failed', value: podPhases.Failed ?? 0, color: 'var(--color-signal)' },
    { label: 'Succeeded', value: podPhases.Succeeded ?? 0, color: 'var(--color-info)' },
    { label: 'Unknown', value: podPhases.Unknown ?? 0, color: 'var(--color-line-strong)' },
  ].filter((segment) => segment.value > 0)

  const podTotal = podSegments.reduce((sum, item) => sum + item.value, 0)
  const podCountFallback = (nodesQuery.data?.pod_count ?? []).reduce((sum, item) => sum + (item.count ?? item.podCount ?? 0), 0)
  const healthRate = cockpit?.podHealthRateInfo?.normalRate ?? null
  const harbor = cockpit?.harborInfo

  const cpuValue = summary?.dynamic?.useRate?.cpu ?? nodeSummary?.cpu?.[0]?.used ?? null
  const memValue = summary?.dynamic?.useRate?.mem ?? nodeSummary?.memory?.[0]?.used ?? null
  const cpuAlloc = summary?.static?.resource
    ? (summary.static.resource.allocatedCPU / Math.max(1, summary.static.resource.cupSum)) * 100
    : null
  const memAlloc = summary?.static?.resource
    ? (summary.static.resource.allocatedMemByKB / Math.max(1, summary.static.resource.memSumByKB)) * 100
    : null
  const readyNodes = nodes.filter((node) => nodeReady(node)).length
  const metricsDegraded = nodeSummaryQuery.isError || summaryQuery.isError || cockpitQuery.isError

  const selectedNode = nodes.find((node) => node.objectMeta.name === selected)
  const selectedIp = selectedNode ? nodeIp(selectedNode) : ''
  const selectedPods = cockpit?.podHealthRateInfo?.podHealthRateList?.find((n) => n.nodeName === selected)

  const lastUpdated = new Date().toLocaleTimeString('zh-CN', { hour12: false })

  return (
    <div>
      <PageHeader
        index="01 / 01"
        en="GLOBAL · SYSTEM OVERVIEW"
        title="系统总览"
        description="集群、节点与核心服务的实时运行态势。数据由平台网关与 Prometheus 采集，自动刷新周期 20 秒。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={metricsDegraded ? 'warn' : 'ok'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {metricsDegraded ? 'TELEMETRY DEGRADED' : 'TELEMETRY ONLINE'}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">最后刷新 {lastUpdated}</span>
            <span className="mono text-[9.5px] tracking-widest text-mute">CLUSTER / {platformName()}</span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              onClick={() => {
                nodesQuery.refetch()
                summaryQuery.refetch()
                nodeSummaryQuery.refetch()
                cockpitQuery.refetch()
              }}
              loading={nodesQuery.isFetching}
            >
              <RefreshCw size={11} /> 刷新数据
            </Button>
            <Button size="sm" onClick={() => navigate('/global/host-service?action=add')}>
              <Plus size={11} /> 添加节点
            </Button>
            <Button size="sm" onClick={() => navigate('/global/host-service')}>
              <Server size={11} /> 节点运维
            </Button>
            <Button size="sm" onClick={() => setBalanceOpen(true)}>
              <Scale size={11} /> 资源均衡
            </Button>
            <Button size="sm" variant="primary" onClick={() => navigate('/global/cockpit')}>
              运行驾驶舱 <ArrowUpRight size={11} />
            </Button>
          </>
        }
      />

      {metricsDegraded && (
        <div className="mb-4 flex flex-wrap items-center gap-3 border-l-2 border-warn bg-warn/[0.06] px-4 py-2.5">
          <span className="h-1.5 w-1.5 flex-none bg-warn" />
          <span className="text-[11.5px] text-ink">
            监控指标暂不可用（metrics-server 未返回数据），已切换为降级视图；节点就绪状态与 Pod 数量仍基于 Kubernetes 实时数据。
          </span>
          <button
            onClick={() => {
              nodeSummaryQuery.refetch()
              summaryQuery.refetch()
              cockpitQuery.refetch()
            }}
            className="mono ml-auto text-[9px] uppercase tracking-widest text-warn hover:underline"
          >
            重试指标采集
          </button>
        </div>
      )}

      {/* Stat strip */}
      <section className="panel mb-4 grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        <div className="px-4 py-4">
          <div className="flex items-start justify-between">
            <span className="label">节点健康 / NODES</span>
            <Server size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="num text-[38px] leading-none text-ink">
              {nodeSummary?.nodeInfo?.health ?? readyNodes}
            </span>
            <span className="num text-[18px] leading-none text-mute">/ {nodeSummary?.nodeInfo?.total ?? nodes.length}</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Meter value={(readyNodes / Math.max(1, nodes.length)) * 100} />
            <span className="mono text-[9px] text-ok">{readyNodes > 0 ? 'READY' : 'NO READY'}</span>
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="flex items-start justify-between">
            <span className="label">POD 运行 / PODS</span>
            <Boxes size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="num text-[38px] leading-none text-ink">
              {summary ? (podPhases.Running ?? '—') : podCountFallback || '—'}
            </span>
            <span className="num text-[18px] leading-none text-mute">/ {summary ? podTotal || '—' : podCountFallback || '—'}</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            {podSegments.map((segment) => (
              <span
                key={segment.label}
                className="h-1.5"
                style={{ width: `${Math.max(4, (segment.value / Math.max(1, podTotal)) * 100)}%`, background: segment.color }}
                title={`${segment.label} ${segment.value}`}
              />
            ))}
            {!summary && (
              <span className="mono text-[9px] tracking-widest text-mute">
                {podCountFallback ? `${podCountFallback} PODS SCHEDULED` : 'POD METRICS UNAVAILABLE'}
              </span>
            )}
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="flex items-start justify-between">
            <span className="label">CPU 使用率 / CPU</span>
            <Cpu size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="num text-[38px] leading-none text-ink">
              {cpuValue === null ? '—' : formatNumber(cpuValue, 1)}
              <span className="ml-0.5 text-[15px] text-mute">%</span>
            </div>
            {trend.length > 1 ? (
              <Sparkline data={trend.map((point) => point.value)} width={96} height={30} color="var(--color-signal)" />
            ) : (
              <span className="mono text-[8px] tracking-widest text-mute">NO SAMPLE</span>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="mono text-[9px] text-mute">
              {summary?.static?.resource
                ? `ALLOC ${formatNumber(cpuAlloc ?? 0, 1)}% · ${formatNumber(summary.static.resource.cupSum, 1)} CORE`
                : 'ALLOCATION DATA UNAVAILABLE'}
            </span>
          </div>
        </div>

        <div className="px-4 py-4">
          <div className="flex items-start justify-between">
            <span className="label">内存使用率 / MEMORY</span>
            <MemoryStick size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <div className="num text-[38px] leading-none text-ink">
              {memValue === null ? '—' : formatNumber(memValue, 1)}
              <span className="ml-0.5 text-[15px] text-mute">%</span>
            </div>
            {(memSeries.length ? memSeries : trend).length > 1 ? (
              <Sparkline
                data={(memSeries.length ? memSeries : trend).map((point) => point.value)}
                width={96}
                height={30}
                color="var(--color-ink)"
              />
            ) : (
              <span className="mono text-[8px] tracking-widest text-mute">NO SAMPLE</span>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="mono text-[9px] text-mute">
              {summary?.static?.resource
                ? `ALLOC ${formatNumber(memAlloc ?? 0, 1)}% · ${formatNumber(summary.static.resource.memSumByKB / 1024 / 1024, 1)} GB`
                : 'ALLOCATION DATA UNAVAILABLE'}
            </span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Node inventory */}
        <Panel
          className="xl:col-span-8"
          kicker="NODE INVENTORY"
          title="节点清单"
          actions={
            <span className="mono text-[9px] tracking-widest text-mute">
              {nodes.length} NODES · {summary?.static?.node?.schedulable ?? '—'} SCHEDULABLE
            </span>
          }
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>节点 / NODE</th>
                  <th>地址</th>
                  <th>CPU</th>
                  <th>内存</th>
                  <th>POD</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {nodesQuery.isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j}>
                          <div className="h-3 animate-pulse bg-line/60" style={{ width: `${40 + j * 6}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))}
                {nodes.map((node) => {
                  const name = node.objectMeta.name
                  const cpu = nodeSummary ? nodeSummary.cpu?.find((item) => item.name === name)?.used ?? 0 : null
                  const mem = nodeSummary ? nodeSummary.memory?.find((item) => item.name === name)?.used ?? 0 : null
                  const pods = cockpit?.podHealthRateInfo?.podHealthRateList?.find((item) => item.nodeName === name)
                  const podFallback = nodesQuery.data?.pod_count?.find((item) => (item.name || item.nodeName) === name)?.count
                  const ready = isReady(node)
                  const unknown = node.ready === undefined && !node.status?.conditions?.length
                  const role =
                    node.objectMeta.labels?.['node-role.kubernetes.io/control-plane'] !== undefined
                      ? 'CONTROL PLANE'
                      : 'WORKER'
                  return (
                    <tr key={name} className="cursor-pointer" onClick={() => setSelected(name)}>
                      <td>
                        <div className="flex items-center gap-2">
                          <StatusDot tone={unknown ? 'idle' : ready ? 'ok' : 'bad'} />
                          <div>
                            <div className="font-mono text-[11.5px] text-ink">{name}</div>
                            <div className="mono mt-0.5 text-[8px] tracking-widest text-mute">{role}</div>
                          </div>
                        </div>
                      </td>
                      <td className="font-mono text-[10.5px] text-ink-3">{nodeIp(node)}</td>
                      <td className="w-[130px]">
                        {cpu === null ? (
                          <span className="mono text-[10px] text-mute">指标不可用</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Meter value={cpu} />
                            <span className="num w-9 text-right text-[12px] text-ink">{formatNumber(cpu, 1)}</span>
                          </div>
                        )}
                      </td>
                      <td className="w-[130px]">
                        {mem === null ? (
                          <span className="mono text-[10px] text-mute">指标不可用</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Meter value={mem} />
                            <span className="num w-9 text-right text-[12px] text-ink">{formatNumber(mem, 1)}</span>
                          </div>
                        )}
                      </td>
                      <td className="mono text-[10.5px] text-ink-3">
                        {pods ? `${pods.health}/${pods.total}` : podFallback !== undefined ? `${podFallback} SCHEDULED` : '—'}
                      </td>
                      <td>
                        <Badge tone={unknown ? 'default' : ready ? 'ok' : 'bad'}>
                          {unknown ? 'UNKNOWN' : ready ? 'READY' : 'NOT READY'}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <ArrowUpRight size={12} className="inline text-mute" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!nodesQuery.isLoading && nodes.length === 0 && (
            <div className="px-4 py-8 text-center text-[11px] text-mute">未获取到节点数据</div>
          )}
          {nodes.length > 0 && (
            <div className="grid grid-cols-2 divide-x divide-line border-t border-line sm:grid-cols-4">
              {[
                ['CPU 容量', `${formatNumber(nodes.reduce((sum, node) => sum + nodeCapacityCpu(node), 0), 1)} CORE`],
                ['内存容量', `${formatNumber(nodes.reduce((sum, node) => sum + nodeCapacityMemMiB(node), 0) / 1024, 1)} GiB`],
                ['Pod 容量', `${nodes.reduce((sum, node) => sum + nodePodCapacity(node), 0)} SLOTS`],
                ['控制面', `${nodes.filter((node) => node.objectMeta.labels?.['node-role.kubernetes.io/control-plane'] !== undefined).length} NODE`],
              ].map(([label, value], index) => (
                <div key={label} className={index >= 2 ? 'px-4 py-3 sm:border-t-0' : 'px-4 py-3'}>
                  <div className="label">{label}</div>
                  <div className="mono mt-1 text-[12px] text-ink">{value}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Cluster health */}
        <div className="flex flex-col gap-4 xl:col-span-4">
          <Panel kicker="CLUSTER HEALTH" title="集群健康度" bodyClassName="p-0">
            <div className="flex items-center gap-4 px-4 py-4">
              <RingGauge
                value={healthRate ?? 0}
                size={128}
                label="POD HEALTH"
                display={healthRate === null ? '—' : `${Math.round(healthRate * 100)}%`}
                color={healthRate === null ? 'var(--color-line-strong)' : 'var(--color-signal)'}
              />
              <div className="min-w-0 flex-1 space-y-2.5">
                <KV k="运行 POD" v={cockpit?.podHealthRateInfo?.running ?? podPhases.Running ?? podCountFallback ?? '—'} />
                <KV
                  k="异常 POD"
                  v={cockpit ? (cockpit.podHealthRateInfo?.podHealthRateList?.reduce((sum, item) => sum + item.unHealth, 0) ?? 0) : '—'}
                />
                <KV
                  k="调度状态"
                  v={
                    <Badge tone={summary ? ((summary.static?.node?.schedulable ?? 0) > 0 ? 'ok' : 'warn') : 'default'}>
                      {summary ? ((summary.static?.node?.schedulable ?? 0) > 0 ? 'SCHEDULABLE' : 'CORDONED') : 'UNKNOWN'}
                    </Badge>
                  }
                />
              </div>
            </div>
            <div className="border-t border-line px-4 py-3">
              <div className="label mb-2">POD 相位分布</div>
              {summary ? (
                <div className="flex items-center gap-4">
                  <Donut segments={podSegments} size={104} thickness={13} centerValue={String(podTotal)} centerLabel="TOTAL" />
                  <div className="flex-1 space-y-1.5">
                    {podSegments.map((segment) => (
                      <div key={segment.label} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5" style={{ background: segment.color }} />
                        <span className="mono flex-1 text-[9.5px] uppercase text-mute">{segment.label}</span>
                        <span className="num text-[12px] text-ink">{segment.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-[104px] items-center justify-center border border-dashed border-line-strong text-[10.5px] text-mute">
                  Pod 相位指标不可用
                </div>
              )}
            </div>
          </Panel>

          <Panel kicker="RESOURCE POOL" title="资源与镜像仓库" bodyClassName="p-4">
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex justify-between">
                  <span className="label">CPU 配额占用</span>
                  <span className="mono text-[10px] text-ink">{cpuAlloc === null ? '—' : formatPercent(cpuAlloc)}</span>
                </div>
                <Meter value={cpuAlloc ?? 0} />
              </div>
              <div>
                <div className="mb-1.5 flex justify-between">
                  <span className="label">内存配额占用</span>
                  <span className="mono text-[10px] text-ink">{memAlloc === null ? '—' : formatPercent(memAlloc)}</span>
                </div>
                <Meter value={memAlloc ?? 0} />
              </div>
              <div className="border-t border-line pt-3">
                <div className="mb-1.5 flex justify-between">
                  <span className="label">镜像仓库容量</span>
                  <span className="mono text-[10px] text-ink">
                    {harbor ? `${formatPercent(harbor.useRate * 100)} · ${harbor.imageNum} IMAGES` : '—'}
                  </span>
                </div>
                <Meter value={(harbor?.useRate ?? 0) * 100} />
                <div className="mono mt-1.5 flex justify-between text-[8.5px] tracking-wider text-mute">
                  <span>{harbor?.projectNum ?? '—'} PROJECTS</span>
                  <span>{harbor ? `${(harbor.free / 1024 / 1024 / 1024).toFixed(1)} GB FREE` : 'NO DATA'}</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          kicker="CORE SERVICES"
          title="核心系统服务"
          actions={<span className="mono text-[9px] tracking-widest text-mute">NAMESPACE / SYSTEM</span>}
          bodyClassName="p-0"
        >
          <div className="grid grid-cols-1 divide-y divide-line/70 sm:grid-cols-2 sm:divide-y-0">
            {(cockpit?.systemService?.serviceList ?? []).slice(0, 12).map((service) => {
              const healthy = service.normal === service.total
              return (
                <div
                  key={`${service.namespace}-${service.name}`}
                  className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 last:border-0"
                >
                  <StatusDot tone={healthy ? 'ok' : 'warn'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] text-ink">{service.name}</div>
                    <div className="mono mt-0.5 text-[8px] tracking-widest text-mute">{service.namespace} / {service.type}</div>
                  </div>
                  <span className={cn('num text-[13px]', healthy ? 'text-ink' : 'text-warn')}>
                    {service.normal}
                    <span className="text-[10px] text-mute">/{service.total}</span>
                  </span>
                </div>
              )
            })}
            {!cockpit && (
              <div className="px-4 py-8 text-[11px] text-mute">
                {cockpitQuery.isError ? '系统服务指标不可用，请在运维监控中查看服务状态。' : '正在获取系统服务…'}
              </div>
            )}
          </div>
        </Panel>

        <Panel
          className="xl:col-span-5"
          kicker="UTILISATION TREND"
          title="资源水位 · 近 30 采样"
          actions={<span className="mono text-[9px] tracking-widest text-mute">CPU / MEMORY</span>}
        >
          {trend.length > 1 ? (
            <AreaTrend
              height={196}
              unit="%"
              yMax={100}
              reference={85}
              series={[
                { name: 'CPU', points: trend.map((p) => ({ label: p.label, value: p.value })) },
                { name: 'MEM', points: trend.map((p) => ({ label: p.label, value: p.mem })), color: 'var(--color-ink)' },
              ]}
            />
          ) : (
            <div className="empty-chart flex h-[196px] flex-col items-center justify-center gap-2 text-mute">
              <span className="mono text-[9px] tracking-[0.2em]">NO TELEMETRY SAMPLES</span>
              <span className="text-[11px]">等待资源采样恢复</span>
            </div>
          )}
        </Panel>
      </div>

      {/* Node detail dialog */}
      <Modal
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        kicker="NODE / DETAIL"
        title={selectedNode?.objectMeta.name || '节点详情'}
        description={
          selectedNode
            ? `内部地址 ${selectedIp} · ${nodeReady(selectedNode) ? 'Ready' : selectedNode.ready === undefined ? '状态未知' : 'Not Ready'}`
            : undefined
        }
        width={680}
        footer={
          <>
            <Button size="sm" onClick={() => setSelected(null)}>
              关闭
            </Button>
            <Button
              size="sm"
              onClick={() => navigate(`/global/system-overview/${encodeURIComponent(selected || '')}`)}
            >
              节点运维
            </Button>
            <Button size="sm" variant="primary" onClick={() => navigate(`/software/application/service?node=${encodeURIComponent(selected || '')}`)}>
              查看该节点服务 <ArrowUpRight size={11} />
            </Button>
          </>
        }
      >
        {selectedNode && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <div className="label mb-2">节点规格</div>
              <KV k="CPU 容量" v={`${formatNumber(nodeCapacityCpu(selectedNode), 1)} CORE`} />
              <KV k="内存容量" v={`${formatNumber(nodeCapacityMemMiB(selectedNode) / 1024, 1)} GiB`} />
              <KV k="Pod 上限" v={nodePodCapacity(selectedNode) || '—'} />
              <KV k="镜像 OS" v={selectedNode.status?.nodeInfo?.osImage ?? selectedNode.versions?.kernel ?? '—'} />
              <KV k="架构" v={selectedNode.objectMeta.labels?.['kubernetes.io/arch'] ?? selectedNode.status?.nodeInfo?.architecture ?? '—'} />
              <KV k="Kubelet" v={selectedNode.versions?.kubelet ?? selectedNode.status?.nodeInfo?.kubeletVersion ?? '—'} />
              <KV k="容器运行时" v={selectedNode.versions?.docker ?? '—'} />
              <KV k="Pod CIDR" v={selectedNode.spec?.podCIDR ?? selectedNode.objectMeta.annotations?.['projectcalico.org/IPv4IPIPTunnelAddr'] ?? '—'} />
              <KV k="创建时间" v={selectedNode.objectMeta.creationTimestamp?.slice(0, 19).replace('T', ' ') ?? '—'} />
            </div>
            <div>
              <div className="label mb-2">实时负载</div>
              <div className="flex items-center justify-around border border-line px-2 py-3">
                <RingGauge
                  value={(nodeSummary?.cpu?.find((item) => item.name === selected)?.used ?? 0) / 100}
                  size={96}
                  stroke={6}
                  label="CPU"
                  display={nodeSummary ? undefined : '—'}
                  color={nodeSummary ? 'var(--color-signal)' : 'var(--color-line-strong)'}
                />
                <RingGauge
                  value={(nodeSummary?.memory?.find((item) => item.name === selected)?.used ?? 0) / 100}
                  size={96}
                  stroke={6}
                  label="MEM"
                  display={nodeSummary ? undefined : '—'}
                  color={nodeSummary ? 'var(--color-ink)' : 'var(--color-line-strong)'}
                />
              </div>
              <div className="mt-4">
                <div className="label mb-2">资源配额</div>
                <KV
                  k="CPU 限额"
                  v={`${formatNumber(parseMilliCores(consumption?.[selected || '']?.limits?.cpu), 2)} / ${formatNumber(
                    parseMilliCores(consumption?.[selected || '']?.requests?.cpu),
                    2,
                  )} CORE`}
                />
                <KV
                  k="内存限额"
                  v={`${formatNumber(parseMemoryKb(consumption?.[selected || '']?.limits?.memory) / 1024, 1)} / ${formatNumber(
                    parseMemoryKb(consumption?.[selected || '']?.requests?.memory) / 1024,
                    1,
                  )} GiB`}
                />
                <KV
                  k="POD 数量"
                  v={
                    selectedPods
                      ? `${selectedPods.health} 正常 / ${selectedPods.total} 总数`
                      : `${nodesQuery.data?.pod_count?.find((item) => (item.name || item.nodeName) === selected)?.count ?? '—'} 已调度`
                  }
                />
              </div>
              <div className="mt-4">
                <div className="label mb-2">标签</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(selectedNode.objectMeta.labels ?? {})
                    .slice(0, 8)
                    .map(([key, value]) => (
                      <Badge key={key}>{key.split('/').pop()}{value ? `=${value}` : ''}</Badge>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={balanceOpen}
        onOpenChange={setBalanceOpen}
        kicker="NODE / RESOURCE BALANCE"
        title="节点资源均衡"
        description="平台按节点资源水位筛选需要迁移的 Pod；重启后工作负载会在其他节点重建，从而缓解资源倾斜。"
        width={900}
        footer={
          <>
            <Button size="sm" onClick={() => setBalanceOpen(false)}>
              关闭
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={balanceSelected.length === 0}
              loading={restartPodsMutation.isPending}
              onClick={() => restartPodsMutation.mutate(balanceSelected)}
            >
              <RotateCw size={10} /> 重启所选（{balanceSelected.length}）
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabStrip
              value={balanceNode}
              onChange={(value) => {
                setBalanceNode(value)
                setBalanceSelected([])
              }}
              tabs={balanceNodes.map((name) => ({
                value: name,
                label: name,
                count: balanceMap[name]?.length ?? 0,
              }))}
            />
            <Button size="sm" loading={balanceQuery.isFetching} onClick={() => balanceQuery.refetch()}>
              <RefreshCw size={10} /> 重新评估
            </Button>
          </div>
          {balanceNodes.length === 0 ? (
            <div className="border border-line px-4 py-10 text-center">
              <div className="text-[11px] text-ink-3">
                {balanceQuery.isLoading ? '正在评估节点资源…' : '当前无需均衡：各节点资源分配处于合理区间。'}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto border border-line">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-8">
                      <input
                        type="checkbox"
                        className="check"
                        checked={balancePods.length > 0 && balanceSelected.length === balancePods.length}
                        onChange={(event) =>
                          setBalanceSelected(
                            event.target.checked
                              ? balancePods.map((pod) => pod.podName || '').filter(Boolean)
                              : [],
                          )
                        }
                      />
                    </th>
                    <th>服务</th>
                    <th>Pod</th>
                    <th>节点</th>
                    <th>CPU 请求</th>
                    <th>内存请求</th>
                    <th>重启</th>
                    <th>状态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {balancePods.map((pod) => {
                    const podName = pod.podName || ''
                    return (
                      <tr key={podName}>
                        <td>
                          <input
                            type="checkbox"
                            className="check"
                            checked={balanceSelected.includes(podName)}
                            onChange={(event) =>
                              setBalanceSelected((prev) =>
                                event.target.checked
                                  ? [...prev, podName]
                                  : prev.filter((item) => item !== podName),
                              )
                            }
                          />
                        </td>
                        <td>
                          <span className="font-mono text-[10.5px] text-ink">
                            {pod.callServiceName || pod.serviceName || '—'}
                          </span>
                        </td>
                        <td>
                          <span className="mono block max-w-[220px] truncate text-[9.5px] text-mute">
                            {podName || '—'}
                          </span>
                        </td>
                        <td>
                          <span className="mono text-[9.5px] text-ink-3">{pod.nodeName || '—'}</span>
                        </td>
                        <td>
                          <span className="mono text-[9.5px] text-ink-3">
                            {formatNumber((pod.requestCpuSize ?? 0) / 1000, 2)} CORE
                          </span>
                        </td>
                        <td>
                          <span className="mono text-[9.5px] text-ink-3">
                            {formatNumber((pod.requestMemorySize ?? 0) / 1024 / 1024, 2)} GiB
                          </span>
                        </td>
                        <td>
                          <span className={cn('mono text-[10px]', (pod.restartCount ?? 0) > 0 ? 'text-signal' : 'text-mute')}>
                            {pod.restartCount ?? 0}
                          </span>
                        </td>
                        <td>
                          <Badge tone={(pod.status || '').toUpperCase() === 'RUNNING' ? 'ok' : 'warn'}>
                            {pod.status || '—'}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <Button
                            size="sm"
                            loading={restartPodsMutation.isPending}
                            onClick={() => restartPodsMutation.mutate([podName])}
                          >
                            <RotateCw size={10} /> 重启
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mono text-[8.5px] leading-relaxed tracking-wider text-mute">
            数据每 10 秒重新评估；重启操作会删除所选 Pod，由控制器在可用节点重建。
          </div>
        </div>
      </Modal>
    </div>
  )
}

function platformName() {
  return (import.meta.env.VITE_PLATFORM_HOST as string | undefined) || '172.16.209.170'
}
