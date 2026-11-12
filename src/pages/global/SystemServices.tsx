import { useQuery } from '@tanstack/react-query'
import { Activity, Layers, RefreshCw, ScrollText, SquareTerminal } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import { Badge, Button, EmptyState, Modal, PageHeader, Panel, StatusDot, TabStrip } from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { cn } from '@/lib/utils'

const ServiceConsole = lazy(() =>
  import('@/components/console/ServiceConsole').then((module) => ({ default: module.ServiceConsole })),
)

interface K8sWorkload {
  kind?: string
  metadata?: {
    name?: string
    namespace?: string
    creationTimestamp?: string
    labels?: Record<string, string> | null
  }
  spec?: {
    replicas?: number
    template?: { spec?: { containers?: Array<{ name?: string; image?: string }> } }
    selector?: { matchLabels?: Record<string, string> } | null
  }
  status?: {
    readyReplicas?: number
    availableReplicas?: number
    numberReady?: number
    desiredNumberScheduled?: number
    currentNumberScheduled?: number
    replicas?: number
    readyScheduled?: number
  }
}

interface PluginResponse {
  daemonSetList?: K8sWorkload[]
  deploymentList?: K8sWorkload[]
  statefulSetList?: K8sWorkload[]
}

interface WorkloadRow {
  key: string
  kind: 'Deployment' | 'DaemonSet' | 'StatefulSet'
  name: string
  namespace: string
  image: string
  ready: number
  desired: number
  createdAt?: string
  labels?: Record<string, string> | null
  selector?: Record<string, string> | null
}

interface K8sPod {
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> | null }
  spec?: { nodeName?: string; containers?: Array<{ name?: string }> }
  status?: {
    phase?: string
    containerStatuses?: Array<{ restartCount?: number; ready?: boolean }>
  }
}

interface EventItem {
  type?: string
  reason?: string
  message?: string
  count?: number
  lastTimestamp?: string
  firstTimestamp?: string
  involvedObject?: { name?: string; kind?: string }
}

interface CorePod {
  metadata?: { name?: string; namespace?: string }
  status?: {
    phase?: string
    containerStatuses?: Array<{ ready?: boolean }>
  }
}

type KindFilter = 'ALL' | WorkloadRow['kind']

export default function SystemServicesPage() {
  const params = useParams()
  const [filter, setFilter] = useState<KindFilter>('ALL')
  const [detail, setDetail] = useState<WorkloadRow | null>(null)
  const [consoleState, setConsoleState] = useState<{
    service: string
    mode: 'logs' | 'terminal'
    pod?: string
    namespace?: string
    container?: string
  } | null>(null)

  const query = useQuery({
    queryKey: ['system-services'],
    queryFn: () => api.get<PluginResponse>('/v1/service/otherPlugin'),
    refetchInterval: 30_000,
  })
  const eventsQuery = useQuery({
    queryKey: ['system-service-events', detail?.name],
    queryFn: () => api.get<EventItem[]>('/v1/service/event', { name: detail?.name }),
    enabled: !!detail,
  })
  const podQuery = useQuery({
    queryKey: ['system-service-pods', detail?.namespace, detail?.name],
    queryFn: () =>
      api.get<{ items?: K8sPod[] }>('/k8s/api/v1/pods', {
        pretty: 'true',
        fieldSelector: `metadata.namespace=${detail?.namespace}`,
      }),
    enabled: !!detail,
    refetchInterval: 15_000,
  })
  const detailPods = useMemo(() => {
    if (!detail) return [] as K8sPod[]
    const selector = detail.selector && Object.keys(detail.selector).length ? detail.selector : null
    return (podQuery.data?.items ?? []).filter((pod) => {
      const labels = pod.metadata?.labels ?? {}
      if (selector) return Object.entries(selector).every(([key, value]) => labels[key] === value)
      return (pod.metadata?.name ?? '').includes(detail.name)
    })
  }, [podQuery.data, detail])
  function openConsole(mode: 'logs' | 'terminal', pod?: K8sPod) {
    if (!detail) return
    const target = pod ?? detailPods[0]
    setConsoleState({
      service: detail.name,
      mode,
      pod: target?.metadata?.name,
      namespace: detail.namespace,
      container: target?.spec?.containers?.[0]?.name || detail.name,
    })
  }
  const componentsQuery = useQuery({
    queryKey: ['k8s-components'],
    queryFn: () => api.get<CorePod[]>('/v1/k8s/components'),
    refetchInterval: 30_000,
  })
  const corePods = (componentsQuery.data ?? []).filter((pod) => pod.metadata?.name)
  const coreReady = corePods.filter(
    (pod) =>
      pod.status?.phase === 'Running' &&
      (pod.status?.containerStatuses ?? []).every((item) => item.ready),
  ).length

  const rows = useMemo<WorkloadRow[]>(() => {
    const data = query.data
    if (!data) return []
    const toRows = (list: K8sWorkload[] | undefined, kind: WorkloadRow['kind']) =>
      (list ?? []).map((item) => {
        const name = item.metadata?.name || '—'
        const ready =
          kind === 'DaemonSet'
            ? item.status?.numberReady ?? 0
            : item.status?.readyReplicas ?? item.status?.replicas ?? 0
        const desired =
          kind === 'DaemonSet'
            ? item.status?.desiredNumberScheduled ?? item.status?.currentNumberScheduled ?? 0
            : item.spec?.replicas ?? item.status?.replicas ?? 0
        return {
          key: `${kind}/${item.metadata?.namespace ?? ''}/${name}`,
          kind,
          name,
          namespace: item.metadata?.namespace || '—',
          image: item.spec?.template?.spec?.containers?.[0]?.image || '—',
          ready,
          desired,
          createdAt: item.metadata?.creationTimestamp,
          labels: item.metadata?.labels,
          selector: item.spec?.selector?.matchLabels ?? null,
        }
      })
    return [
      ...toRows(data.deploymentList, 'Deployment'),
      ...toRows(data.daemonSetList, 'DaemonSet'),
      ...toRows(data.statefulSetList, 'StatefulSet'),
    ]
  }, [query.data])

  const filtered = useMemo(() => {
    if (filter === 'ALL') return rows
    return rows.filter((row) => row.kind === filter)
  }, [rows, filter])

  useEffect(() => {
    if (!params.name || detail) return
    const match = rows.find((row) => row.name === params.name)
    if (match) setDetail(match)
  }, [params.name, rows, detail])

  const healthy = rows.filter((row) => row.desired > 0 && row.ready >= row.desired).length
  const events = eventsQuery.data ?? []

  const columns: Array<Column<WorkloadRow>> = [
    {
      key: 'name',
      header: '组件 / COMPONENT',
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <StatusDot tone={row.desired > 0 && row.ready >= row.desired ? 'ok' : 'warn'} />
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] text-ink">{row.name}</div>
            <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.namespace}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'kind',
      header: '类型',
      cell: (row) => <Badge tone={row.kind === 'Deployment' ? 'info' : 'default'}>{row.kind.toUpperCase()}</Badge>,
    },
    {
      key: 'ready',
      header: '就绪',
      align: 'center',
      sortValue: (row) => (row.desired ? row.ready / row.desired : 0),
      cell: (row) => (
        <span className={cn('mono text-[10.5px]', row.ready >= row.desired ? 'text-ink' : 'text-warn')}>
          {row.ready}/{row.desired}
        </span>
      ),
    },
    {
      key: 'image',
      header: '镜像',
      cell: (row) => <span className="mono block max-w-[320px] truncate text-[9.5px] text-ink-3">{row.image}</span>,
    },
    {
      key: 'created',
      header: '创建时间',
      cell: (row) => <span className="mono text-[9px] text-mute">{formatDate(row.createdAt, false)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button size="sm" onClick={() => setDetail(row)}>
          <Activity size={10} /> 事件
        </Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="01 / 03"
        en="GLOBAL · SYSTEM COMPONENTS"
        title="系统组件"
        description="集群内所有 Deployment、DaemonSet 与 StatefulSet 的运行概览，用于核对平台组件健康度。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={healthy === rows.length ? 'ok' : 'warn'} />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {healthy}/{rows.length} HEALTHY
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">KUBE / SYSTEM</span>
          </>
        }
        actions={
          <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
            <RefreshCw size={11} /> 刷新
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ['组件总数', rows.length, 'WORKLOADS'],
          ['Deployment', rows.filter((row) => row.kind === 'Deployment').length, 'STATELESS'],
          ['DaemonSet', rows.filter((row) => row.kind === 'DaemonSet').length, 'NODE AGENT'],
          ['StatefulSet', rows.filter((row) => row.kind === 'StatefulSet').length, 'STATEFUL'],
        ].map(([label, value, hint]) => (
          <Panel key={label} bodyClassName="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[28px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </Panel>
        ))}
      </div>

      <Panel
        className="mb-4"
        kicker="KUBE / CORE COMPONENTS"
        title="K8s 核心组件"
        actions={
          <span className="flex items-center gap-1.5">
            <StatusDot tone={corePods.length > 0 && coreReady === corePods.length ? 'ok' : 'warn'} />
            <span className="mono text-[9px] tracking-widest text-ink-3">
              {coreReady}/{corePods.length} READY
            </span>
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {corePods.slice(0, 12).map((pod) => {
            const ready =
              pod.status?.phase === 'Running' &&
              (pod.status?.containerStatuses ?? []).every((item) => item.ready)
            return (
              <div
                key={`${pod.metadata?.namespace}-${pod.metadata?.name}`}
                className="flex items-center gap-2 border border-line px-2.5 py-1.5"
              >
                <StatusDot tone={ready ? 'ok' : 'warn'} />
                <span className="mono min-w-0 flex-1 truncate text-[9.5px] text-ink-3">{pod.metadata?.name}</span>
                <Badge tone={ready ? 'ok' : 'warn'}>{pod.status?.phase || 'UNKNOWN'}</Badge>
              </div>
            )
          })}
          {corePods.length === 0 && (
            <div className="col-span-full py-4 text-center text-[10.5px] text-mute">
              {componentsQuery.isLoading ? '正在读取 K8s 核心组件…' : '未返回 K8s 核心组件状态'}
            </div>
          )}
        </div>
      </Panel>

      <div className="mb-4">
        <TabStrip
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'ALL', label: '全部', count: rows.length },
            { value: 'Deployment', label: 'Deployment', count: rows.filter((row) => row.kind === 'Deployment').length },
            { value: 'DaemonSet', label: 'DaemonSet', count: rows.filter((row) => row.kind === 'DaemonSet').length },
            { value: 'StatefulSet', label: 'StatefulSet', count: rows.filter((row) => row.kind === 'StatefulSet').length },
          ]}
        />
      </div>

      <Panel kicker="CLUSTER WORKLOADS" title="组件清单" bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.key}
          loading={query.isLoading}
          pageSize={12}
          emptyTitle="暂无系统组件"
          emptyDescription="集群尚未返回 Deployment / DaemonSet / StatefulSet 列表。"
        />
      </Panel>

      <Modal
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        kicker="SYSTEM COMPONENT / DETAIL"
        title={detail ? `${detail.name}` : '组件详情'}
        description="组件实例、运行状态与最近事件，可进入实时日志或容器终端排查问题。"
        width={760}
        footer={
          <Button size="sm" onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 border border-line px-3 py-2.5 sm:grid-cols-4">
              {[
                ['类型', detail.kind],
                ['命名空间', detail.namespace],
                ['就绪', `${detail.ready}/${detail.desired}`],
                ['创建时间', formatDate(detail.createdAt, false)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="label">{label}</div>
                  <div className="mono mt-1 truncate text-[10px] text-ink">{value}</div>
                </div>
              ))}
            </div>
            <div className="border border-line bg-paper-2/40 px-3 py-2">
              <div className="label mb-1">镜像</div>
              <div className="mono break-all text-[10px] text-ink-3">{detail.image}</div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone={detailPods.length ? 'ok' : 'warn'} />
                  <span className="label">Pod 实例</span>
                  <Badge tone="info">{detailPods.length}</Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" onClick={() => openConsole('logs')}>
                    <ScrollText size={10} /> 实时日志
                  </Button>
                  <Button size="sm" onClick={() => openConsole('terminal')}>
                    <SquareTerminal size={10} /> 容器终端
                  </Button>
                  <Button size="sm" loading={podQuery.isFetching} onClick={() => podQuery.refetch()}>
                    <RefreshCw size={10} />
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-line/60 border border-line">
                {detailPods.map((pod) => {
                  const statuses = pod.status?.containerStatuses ?? []
                  const restarts = statuses.reduce((sum, item) => sum + (item.restartCount ?? 0), 0)
                  const running =
                    (pod.status?.phase || '').toUpperCase() === 'RUNNING' &&
                    (statuses.length === 0 || statuses.every((item) => item.ready))
                  return (
                    <div key={pod.metadata?.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <StatusDot tone={running ? 'ok' : 'warn'} />
                      <span className="mono min-w-0 flex-1 truncate text-[10px] text-ink">
                        {pod.metadata?.name || '—'}
                      </span>
                      <span className="mono text-[9px] text-mute">{pod.spec?.nodeName || '—'}</span>
                      <Badge tone={restarts > 0 ? 'warn' : 'default'}>×{restarts}</Badge>
                      <Badge tone={running ? 'ok' : 'warn'}>{pod.status?.phase || 'UNKNOWN'}</Badge>
                      <button
                        className="mono text-[8.5px] tracking-widest text-ink-3 hover:text-signal"
                        onClick={() => openConsole('logs', pod)}
                      >
                        日志
                      </button>
                    </div>
                  )
                })}
                {detailPods.length === 0 && (
                  <div className="px-3 py-6 text-center text-[10.5px] text-mute">
                    {podQuery.isLoading ? '正在读取 Pod 实例…' : '该组件暂无运行中的 Pod'}
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={12} className="text-mute" />
                  <span className="label">事件</span>
                  <Badge tone="info">{events.length}</Badge>
                </div>
                <Button size="sm" loading={eventsQuery.isFetching} onClick={() => eventsQuery.refetch()}>
                  <RefreshCw size={10} /> 刷新事件
                </Button>
              </div>
              <div className="max-h-[320px] divide-y divide-line/60 overflow-y-auto border border-line">
                {events.map((event, index) => (
                  <div key={`${event.reason}-${index}`} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={event.type === 'Warning' ? 'warn' : 'default'}>{event.type || 'Normal'}</Badge>
                        <span className="mono text-[10px] text-ink">{event.reason || '—'}</span>
                      </div>
                      <span className="mono text-[8.5px] text-mute">
                        {event.count ? `×${event.count}` : ''} {formatDate(event.lastTimestamp || event.firstTimestamp, false)}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] leading-relaxed text-ink-3">{event.message || '—'}</div>
                  </div>
                ))}
                {events.length === 0 && !eventsQuery.isLoading && (
                  <div className="px-3 py-8">
                    <EmptyState title="暂无事件" description="该组件当前没有产生 Kubernetes 事件。" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Suspense fallback={null}>
        <ServiceConsole
          open={!!consoleState}
          serviceName={consoleState?.service || ''}
          initialMode={consoleState?.mode || 'logs'}
          podOverride={consoleState?.pod}
          namespaceOverride={consoleState?.namespace}
          containerOverride={consoleState?.container}
          onClose={() => setConsoleState(null)}
        />
      </Suspense>
    </div>
  )
}
