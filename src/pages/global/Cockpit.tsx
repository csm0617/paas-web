import { useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpRight, Gauge, Network, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { formatBytes, formatNumber, nodeAddress, nodeCapacityCpu, nodeCapacityMemMiB, nodeReady, parseCpu, parseMemoryMiB } from '@/lib/format'
import type { CockpitData, NodesResponse } from '@/types'
import { AreaTrend, BarList, Donut, RingGauge, Sparkline } from '@/components/charts'
import { Badge, Button, KV, Meter, PageHeader, Panel, StatusDot } from '@/components/ui'

export default function CockpitPage() {
  const navigate = useNavigate()
  const cockpitQuery = useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<CockpitData>('/api/v2/dashboards/cockpit'),
    refetchInterval: 30_000,
  })
  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => api.get<NodesResponse>('/cloud/nodes'),
    refetchInterval: 60_000,
  })

  const cockpit = cockpitQuery.data
  const nodes = nodesQuery.data?.nodes?.nodes ?? []

  const nodeSeries = useMemo(() => {
    return (cockpit?.nodeInfo ?? []).map((node) => {
      const k8sNode = nodes.find((item) => item.objectMeta.name === node.name)
      const memCapacityBytes = nodeCapacityMemMiB(k8sNode) * 1024 * 1024
      return {
        name: node.name,
        ip: node.nodeIp || nodeAddress(k8sNode),
        cpu: node.nodeCpu.map((point) => ({
          label: new Date(point.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          value: Number(point.floatValue ?? point.value) * 100,
        })),
        memory: (node.nodeMemory ?? []).map((point) => ({
          label: new Date(point.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          value: memCapacityBytes ? (Number(point.floatValue ?? point.value) / memCapacityBytes) * 100 : 0,
        })),
        networkIn: (node.nodeNetWorkIn ?? []).map((point) => ({
          label: new Date(point.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          value: Number(point.floatValue ?? point.value) / 1024 / 1024,
        })),
        networkOut: (node.nodeNetWorkOut ?? []).map((point) => ({
          label: new Date(point.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          value: Number(point.floatValue ?? point.value) / 1024 / 1024,
        })),
        capacityCpu: nodeCapacityCpu(k8sNode),
        capacityMem: nodeCapacityMemMiB(k8sNode),
      }
    })
  }, [cockpit, nodes])

  const primary = nodeSeries[0]
  const cpuNow = primary?.cpu.at(-1)?.value ?? 0
  const memNow = primary?.memory.at(-1)?.value ?? 0
  const netInNow = primary?.networkIn.at(-1)?.value ?? 0

  const nodeCards = nodes.map((node) => {
    const series = nodeSeries.find((item) => item.name === node.objectMeta.name)
    return {
      name: node.objectMeta.name,
      ip: series?.ip || nodeAddress(node),
      capacityCpu: nodeCapacityCpu(node),
      capacityMem: nodeCapacityMemMiB(node),
      cpu: series?.cpu.at(-1)?.value ?? null,
      mem: series?.memory.at(-1)?.value ?? null,
      ready: nodeReady(node),
    }
  })

  const primaryNode = nodeCards[0]
  const podHealth = cockpit?.podHealthRateInfo
  const harbor = cockpit?.harborInfo

  const podPhases = [
    { label: 'Running', value: podHealth?.running ?? 0, color: 'var(--color-ok)' },
    { label: 'Unhealthy', value: podHealth?.podHealthRateList?.reduce((sum, item) => sum + item.unHealth, 0) ?? 0, color: 'var(--color-signal)' },
  ].filter((item) => item.value > 0)

  const serviceLimit = (cockpit?.serviceCpuLimit ?? []).map((item) => ({
    label: item.serviceName,
    value: parseCpu(item.value),
    hint: `${item.replicas} REPLICA(S)`,
  }))

  const memLimit = (cockpit?.serviceMemoryLimit ?? []).map((item) => ({
    label: item.serviceName,
    value: parseMemoryMiB(item.value),
    hint: `${item.replicas} REPLICA(S)`,
  }))

  return (
    <div>
      <PageHeader
        index="01 / 03"
        en="GLOBAL · OPERATIONS COCKPIT"
        title="运行驾驶舱"
        description="按分钟粒度观测节点、Pod 与系统服务的资源走向。用于容量评估、异常定位与变更前的态势确认。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={cockpitQuery.isError ? 'warn' : cockpit ? 'ok' : 'idle'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {cockpitQuery.isError ? 'TELEMETRY DEGRADED' : cockpit ? '60 SAMPLES / NODE' : 'SYNCING TELEMETRY'}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">
              {primary
                ? `PRIMARY ${primary.name} · ${primary.ip}`
                : primaryNode
                  ? `PRIMARY ${primaryNode.name} · ${primaryNode.ip}`
                  : 'WAITING FOR TELEMETRY'}
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={cockpitQuery.isFetching} onClick={() => cockpitQuery.refetch()}>
              <RefreshCw size={11} /> 刷新遥测
            </Button>
            <Button size="sm" variant="primary" onClick={() => navigate('/global/system-overview')}>
              节点总览 <ArrowUpRight size={11} />
            </Button>
          </>
        }
      />

      {cockpitQuery.isError && (
        <div className="mb-4 flex items-center gap-3 border-l-2 border-warn bg-warn/[0.06] px-4 py-2.5">
          <span className="h-1.5 w-1.5 bg-warn" />
          <span className="text-[11.5px] text-ink">
            驾驶舱遥测暂不可用（metrics-server / Prometheus 未返回数据），图表将在采集恢复后自动填充。
          </span>
        </div>
      )}

      <section className="panel mb-4 grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="label">节点 CPU</span>
            <Gauge size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-end justify-between">
            <span className="num text-[36px] leading-none text-ink">
              {cockpit ? formatNumber(cpuNow, 1) : '—'}
              <span className="text-[14px] text-mute">%</span>
            </span>
            <Sparkline data={(primary?.cpu ?? []).map((p) => p.value)} width={90} height={30} color="var(--color-signal)" />
          </div>
          <div className="mono mt-2 text-[9px] tracking-widest text-mute">
            {formatNumber(primary?.capacityCpu ?? primaryNode?.capacityCpu ?? 0, 1)} CORE CAPACITY
          </div>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="label">节点内存</span>
            <Activity size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-end justify-between">
            <span className="num text-[36px] leading-none text-ink">
              {cockpit ? formatNumber(memNow, 1) : '—'}
              <span className="text-[14px] text-mute">%</span>
            </span>
            <Sparkline data={(primary?.memory ?? []).map((p) => p.value)} width={90} height={30} color="var(--color-ink)" />
          </div>
          <div className="mono mt-2 text-[9px] tracking-widest text-mute">
            {formatNumber((primary?.capacityMem ?? primaryNode?.capacityMem ?? 0) / 1024, 1)} GiB CAPACITY
          </div>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="label">运行 Pod</span>
            <span className="mono text-[9px] text-mute">{podHealth?.total ?? '—'} TOTAL</span>
          </div>
          <div className="mt-2 num text-[36px] leading-none text-ink">{cockpit ? (podHealth?.running ?? '—') : '—'}</div>
          <div className="mt-3 flex items-center gap-2">
            <Meter value={(podHealth?.normalRate ?? 0) * 100} tone="ok" />
            <span className="mono text-[9px] text-ok">{cockpit ? `${Math.round((podHealth?.normalRate ?? 0) * 100)}%` : '—'}</span>
          </div>
        </div>
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <span className="label">网卡入站</span>
            <Network size={13} className="text-mute" />
          </div>
          <div className="mt-2 flex items-end justify-between">
            <span className="num text-[36px] leading-none text-ink">
              {cockpit ? formatNumber(netInNow, 1) : '—'}
              <span className="text-[14px] text-mute">MB/s</span>
            </span>
            <Sparkline data={(primary?.networkIn ?? []).map((p) => p.value)} width={90} height={30} color="var(--color-info)" />
          </div>
          <div className="mono mt-2 text-[9px] tracking-widest text-mute">
            OUT {cockpit ? `${formatNumber(primary?.networkOut?.at(-1)?.value ?? 0, 1)} MB/s` : '—'}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-8"
          kicker="CPU / MEMORY"
          title="节点资源趋势"
          actions={<span className="mono text-[9px] tracking-widest text-mute">1 MINUTE INTERVAL</span>}
        >
          {primary ? (
            <AreaTrend
              height={252}
              unit="%"
              yMax={100}
              reference={85}
              series={[
                { name: 'CPU', points: primary.cpu, color: 'var(--color-signal)' },
                { name: 'MEMORY', points: primary.memory, color: 'var(--color-ink)' },
              ]}
            />
          ) : (
            <div className="empty-chart flex h-[252px] flex-col items-center justify-center gap-2 text-mute">
              <span className="mono text-[9px] tracking-[0.2em]">NO TELEMETRY SAMPLES</span>
              <span className="text-[11px]">等待 metrics-server 恢复采集</span>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4 xl:col-span-4">
          <Panel kicker="POD HEALTH" title="Pod 健康率" bodyClassName="px-4 py-4">
            <div className="flex items-center gap-4">
              <RingGauge
                value={podHealth?.normalRate ?? 0}
                size={122}
                label="HEALTHY"
                display={cockpit ? `${Math.round((podHealth?.normalRate ?? 0) * 100)}%` : '—'}
                color={cockpit ? 'var(--color-signal)' : 'var(--color-line-strong)'}
              />
              <div className="flex-1">
                {cockpit ? (
                  <Donut segments={podPhases} size={104} thickness={12} centerValue={String(podHealth?.total ?? 0)} centerLabel="TOTAL" />
                ) : (
                  <div className="flex h-[104px] items-center justify-center border border-dashed border-line-strong text-[9.5px] tracking-widest text-mute">
                    NO POD DATA
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {(podHealth?.podHealthRateList ?? []).map((item) => (
                <div key={item.nodeName} className="flex items-center justify-between border-t border-line pt-2">
                  <span className="font-mono text-[10px] text-ink-3">{item.nodeName}</span>
                  <span className="mono text-[10px] text-ink">
                    {item.health} 正常 / {item.unHealth} 异常
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel kicker="REGISTRY" title="镜像仓库容量" bodyClassName="px-4 py-4">
            <div className="flex items-end justify-between">
              <span className="num text-[34px] leading-none text-ink">
                {harbor ? formatNumber(harbor.useRate * 100, 1) : '—'}
                <span className="text-[15px] text-mute">%</span>
              </span>
              <span className="mono text-[9px] text-mute">{formatBytes(harbor?.total)} TOTAL</span>
            </div>
            <div className="mt-3">
              <Meter value={(harbor?.useRate ?? 0) * 100} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
              <div>
                <div className="label">项目</div>
                <div className="num mt-1 text-[18px] text-ink">{harbor?.projectNum ?? '—'}</div>
              </div>
              <div>
                <div className="label">镜像</div>
                <div className="num mt-1 text-[18px] text-ink">{harbor?.imageNum ?? '—'}</div>
              </div>
              <div>
                <div className="label">空闲</div>
                <div className="num mt-1 text-[18px] text-ink">{formatBytes(harbor?.free)}</div>
              </div>
            </div>
          </Panel>
        </div>

        <Panel
          className="xl:col-span-6"
          kicker="POD CPU TOP"
          title="Pod CPU 占用"
          actions={<span className="mono text-[9px] tracking-widest text-mute">CORE</span>}
        >
          {(cockpit?.podCpuUsageList?.length ?? 0) > 0 ? (
            <BarList
              items={(cockpit?.podCpuUsageList ?? []).slice(0, 10).map((item) => ({ label: item.podName, value: item.value }))}
              unit="C"
              formatter={(value) => formatNumber(value, 3)}
              maxRows={10}
              tone="signal"
            />
          ) : (
            <div className="flex h-[132px] items-center justify-center border border-dashed border-line-strong text-[10px] tracking-widest text-mute">
              POD CPU METRICS UNAVAILABLE
            </div>
          )}
        </Panel>

        <Panel
          className="xl:col-span-6"
          kicker="POD MEMORY TOP"
          title="Pod 内存占用"
          actions={<span className="mono text-[9px] tracking-widest text-mute">MiB</span>}
        >
          {(cockpit?.podMemoryUsageList?.length ?? 0) > 0 ? (
            <BarList
              items={(cockpit?.podMemoryUsageList ?? []).slice(0, 10).map((item) => ({ label: item.podName, value: item.value }))}
              unit="Mi"
              formatter={(value) => formatNumber(value, 0)}
              maxRows={10}
            />
          ) : (
            <div className="flex h-[132px] items-center justify-center border border-dashed border-line-strong text-[10px] tracking-widest text-mute">
              POD MEMORY METRICS UNAVAILABLE
            </div>
          )}
        </Panel>

        <Panel className="xl:col-span-7" kicker="SERVICE QUOTA" title="服务资源限额">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
                <span className="label">CPU LIMIT</span>
                <span className="mono text-[9px] text-mute">CORE</span>
              </div>
              {serviceLimit.length > 0 ? (
                <BarList items={serviceLimit.slice(0, 8)} maxRows={8} formatter={(v) => formatNumber(v, 2)} tone="ink" />
              ) : (
                <div className="flex h-[120px] items-center justify-center border border-dashed border-line-strong text-[10px] tracking-widest text-mute">
                  NO QUOTA DATA
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
                <span className="label">MEMORY LIMIT</span>
                <span className="mono text-[9px] text-mute">MiB</span>
              </div>
              {memLimit.length > 0 ? (
                <BarList items={memLimit.slice(0, 8)} maxRows={8} formatter={(v) => formatNumber(v, 0)} tone="signal" />
              ) : (
                <div className="flex h-[120px] items-center justify-center border border-dashed border-line-strong text-[10px] tracking-widest text-mute">
                  NO QUOTA DATA
                </div>
              )}
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-5" kicker="SYSTEM SERVICES" title="系统服务健康" bodyClassName="p-0">
          <div className="max-h-[340px] divide-y divide-line/60 overflow-y-auto">
            {(cockpit?.systemService?.serviceList ?? []).map((service) => (
              <div key={`${service.namespace}-${service.name}`} className="flex items-center gap-3 px-4 py-2.5">
                <StatusDot tone={service.normal === service.total ? 'ok' : 'warn'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[10.5px] text-ink">{service.name}</div>
                  <div className="mono mt-0.5 text-[8px] tracking-widest text-mute">
                    {service.namespace} / {service.type}
                  </div>
                </div>
                <Badge tone={service.normal === service.total ? 'ok' : 'warn'}>
                  {service.normal}/{service.total}
                </Badge>
              </div>
            ))}
            {(cockpit?.systemService?.serviceList ?? []).length === 0 && (
              <div className="flex h-[132px] items-center justify-center text-[10px] tracking-widest text-mute">
                SYSTEM SERVICE DATA UNAVAILABLE
              </div>
            )}
          </div>
        </Panel>

        <Panel className="xl:col-span-12" kicker="NETWORK THROUGHPUT" title="节点网络吞吐" actions={<span className="mono text-[9px] tracking-widest text-mute">MB / S</span>}>
          {primary ? (
            <AreaTrend
              height={196}
              unit=" MB/s"
              series={[
                { name: 'INBOUND', points: primary.networkIn, color: 'var(--color-info)' },
                { name: 'OUTBOUND', points: primary.networkOut, color: 'var(--color-signal)' },
              ]}
            />
          ) : (
            <div className="empty-chart flex h-[196px] flex-col items-center justify-center gap-2 text-mute">
              <span className="mono text-[9px] tracking-[0.2em]">NETWORK SAMPLES UNAVAILABLE</span>
              <span className="text-[11px]">等待节点网络遥测</span>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Panel kicker="NODE INVENTORY" title="节点清单">
          <div className="space-y-2">
            {nodeCards.map((node) => (
              <div key={node.name} className="border-b border-line pb-2 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-ink">{node.name}</span>
                  <Badge tone={node.ready ? 'ok' : 'bad'}>{node.ready ? 'READY' : 'NOT READY'}</Badge>
                </div>
                <div className="mono mt-1 text-[9px] text-mute">{node.ip}</div>
                <div className="mono mt-1 flex gap-3 text-[8.5px] text-mute">
                  <span>CPU {node.cpu === null ? '—' : `${formatNumber(node.cpu, 1)}%`}</span>
                  <span>MEM {node.mem === null ? '—' : `${formatNumber(node.mem, 1)}%`}</span>
                </div>
              </div>
            ))}
            {nodeCards.length === 0 && <div className="py-3 text-[11px] text-mute">暂无节点</div>}
          </div>
        </Panel>
        <Panel kicker="CAPACITY" title="集群容量">
          <KV k="CPU 总量" v={`${formatNumber(nodeCards.reduce((sum, n) => sum + n.capacityCpu, 0), 1)} CORE`} />
          <KV k="内存总量" v={`${formatNumber(nodeCards.reduce((sum, n) => sum + n.capacityMem, 0) / 1024, 1)} GiB`} />
          <KV k="可用节点" v={`${nodeCards.length} / ${nodeCards.length}`} />
        </Panel>
        <Panel kicker="SAMPLING" title="采集信息">
          <KV k="采样点" v={primary ? `${primary.cpu.length} × 1 MIN` : '—'} />
          <KV k="刷新周期" v="30 SEC" />
          <KV k="数据源" v="PROMETHEUS" />
        </Panel>
      </div>
    </div>
  )
}
