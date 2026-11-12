import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, RefreshCw, RotateCw, ScrollText, Settings2, SquareTerminal } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { ServiceItem } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge, Button, KV, Modal, PageHeader, Panel, StatusDot, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

const ServiceConsole = lazy(() =>
  import('@/components/console/ServiceConsole').then((module) => ({ default: module.ServiceConsole })),
)

const BASE_TYPE = 1

function serviceName(service: ServiceItem) {
  return service.nameUs || service.nameFr
}

function k8sName(service: ServiceItem) {
  return service.service?.metadata?.name || service.deployment?.metadata?.name || serviceName(service)
}

function imageOf(service: ServiceItem) {
  if (typeof service.imageInfo === 'string') return service.imageInfo
  if (service.imageInfo?.image) return service.imageInfo.image
  return '—'
}

function statusOf(service: ServiceItem) {
  const ready = service.deployment?.status?.readyReplicas ?? 0
  const desired = service.deployment?.spec?.replicas ?? 0
  if (service.terminated) return { label: 'STOPPED', tone: 'default' as const, ready, desired }
  if (ready > 0) return { label: 'RUNNING', tone: 'ok' as const, ready, desired }
  if (desired > 0) return { label: 'PENDING', tone: 'warn' as const, ready, desired }
  return { label: 'STOPPED', tone: 'default' as const, ready, desired }
}

export default function BaseServicesPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [keyword, setKeyword] = useState('')
  const [detail, setDetail] = useState<ServiceItem | null>(null)
  const [eventTarget, setEventTarget] = useState<ServiceItem | null>(null)
  const [consoleState, setConsoleState] = useState<{ service: string; mode: 'logs' | 'terminal' } | null>(null)

  const query = useQuery({
    queryKey: ['base-services'],
    queryFn: () =>
      api.get<{ services?: ServiceItem[]; total?: number; count?: number }>('/v1/service/gaop', {
        type: BASE_TYPE,
        page: 1,
        size: 50,
        keyword: '',
      }),
    refetchInterval: 30_000,
  })

  const eventsQuery = useQuery({
    queryKey: ['base-service-events', eventTarget ? k8sName(eventTarget) : ''],
    queryFn: () =>
      api.get<Array<{ reason?: string; message?: string; type?: string; count?: number; lastTimestamp?: string; firstTimestamp?: string }>>(
        '/v1/service/baseEvent',
        { baseServiceName: eventTarget ? k8sName(eventTarget) : '' },
      ),
    enabled: !!eventTarget,
  })

  const services = query.data?.services ?? []

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return services
    return services.filter((item) => {
      const name = `${serviceName(item)} ${item.nameFr || ''} ${k8sName(item)}`.toLowerCase()
      return name.includes(q)
    })
  }, [services, keyword])

  const actionMutation = useMutation({
    mutationFn: ({ path, name }: { path: string; name: string }) => api.put(path, [name]),
    onSuccess: (_data, variables) => {
      toast.success('操作已下发', `${variables.name} 的变更请求已提交至集群`)
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

  async function toggle(service: ServiceItem) {
    const status = statusOf(service)
    const stopping = status.label === 'RUNNING'
    const ok = await confirm({
      title: `${stopping ? '停止' : '启动'} ${k8sName(service)}？`,
      description: stopping
        ? '框架服务为平台运行的基础组件，停止后可能导致对应功能不可用，请确认影响范围。'
        : '启动后框架服务将重新调度工作负载，可能需要一段时间才能就绪。',
      confirmText: stopping ? '停止' : '启动',
      danger: stopping,
    })
    if (!ok) return
    actionMutation.mutate({ path: stopping ? '/v1/service/stop' : '/v1/service/start', name: k8sName(service) })
  }

  const running = services.filter((item) => statusOf(item).label === 'RUNNING').length
  const restarts = services.reduce((sum, item) => sum + (item.restartCount ?? 0), 0)

  const columns: Array<Column<ServiceItem>> = [
    {
      key: 'index',
      header: '#',
      width: '48px',
      cell: (_row, index) => <span className="mono text-[9.5px] text-mute">{String(index + 1).padStart(2, '0')}</span>,
    },
    {
      key: 'name',
      header: '框架服务 / COMPONENT',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Box size={13} className="text-mute" />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-ink">{serviceName(row)}</div>
            <div className="mono mt-0.5 text-[9px] tracking-wider text-mute">{k8sName(row)}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => {
        const status = statusOf(row)
        return (
          <div className="flex items-center gap-2">
            <StatusDot tone={status.label === 'RUNNING' ? 'ok' : status.label === 'PENDING' ? 'warn' : 'idle'} />
            <span className="mono text-[9.5px] tracking-widest text-ink-3">{status.label}</span>
          </div>
        )
      },
    },
    {
      key: 'replicas',
      header: '副本',
      cell: (row) => {
        const status = statusOf(row)
        return (
          <span className="num text-[12px] text-ink">
            {status.ready}
            <span className="text-[9.5px] text-mute"> / {status.desired || '—'}</span>
          </span>
        )
      },
    },
    {
      key: 'image',
      header: '镜像',
      cell: (row) => <span className="mono max-w-[240px] truncate text-[9.5px] text-ink-3">{imageOf(row)}</span>,
    },
    {
      key: 'restart',
      header: '重启',
      cell: (row) => (
        <span className={cn('mono text-[11px]', (row.restartCount ?? 0) > 0 ? 'text-signal' : 'text-mute')}>
          {row.restartCount ?? 0}
        </span>
      ),
    },
    {
      key: 'created',
      header: '创建时间',
      cell: (row) => (
        <span className="mono text-[9.5px] text-mute">
          {row.deployment?.metadata?.creationTimestamp
            ? formatDate(row.deployment.metadata.creationTimestamp, false)
            : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => {
        const status = statusOf(row)
        const stopped = status.label === 'STOPPED'
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" onClick={() => setDetail(row)}>
              <Settings2 size={10} /> 配置
            </Button>
            <Button size="sm" onClick={() => toggle(row)} disabled={actionMutation.isPending}>
              {stopped ? '启动' : '停止'}
            </Button>
            <Button size="sm" onClick={() => setEventTarget(row)}>
              更多
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <PageHeader
        index="04 / 05"
        en="OPERATIONS · BASE SERVICES"
        title="框架服务"
        description="平台自身运行所依赖的基础组件：鉴权、后端、网关、数据库、缓存与前端。此处提供状态核查与启停处置。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={running === services.length ? 'ok' : 'warn'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {running}/{services.length} RUNNING
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">RESTARTS {restarts}</span>
          </>
        }
        actions={
          <>
            <input
              className="field h-8 w-[200px]"
              placeholder="搜索框架服务"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
          </>
        }
      />

      <Panel kicker="FRAMEWORK COMPONENTS" title="组件清单" bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => k8sName(row)}
          loading={query.isLoading}
          pageSize={12}
          emptyTitle="暂无框架服务"
          emptyDescription="未检测到平台基础组件，或当前账户无权查看。"
        />
      </Panel>

      <Modal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        kicker="BASE SERVICE / CONFIG"
        title={detail ? k8sName(detail) : '配置'}
        description="框架服务的镜像、端口与调度信息。如需调整环境变量或存储，请在服务配置中操作。"
        width={680}
        footer={
          <>
            <Button size="sm" onClick={() => setDetail(null)}>
              关闭
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!detail) return
                setConsoleState({ service: k8sName(detail), mode: 'logs' })
                setDetail(null)
              }}
            >
              <ScrollText size={10} /> 实时日志
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!detail) return
                setConsoleState({ service: k8sName(detail), mode: 'terminal' })
                setDetail(null)
              }}
            >
              <SquareTerminal size={10} /> 容器终端
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={restartMutation.isPending}
              onClick={() => {
                if (!detail) return
                restartMutation.mutate(k8sName(detail))
              }}
            >
              <RotateCw size={10} /> 重启组件
            </Button>
          </>
        }
      >
        {detail && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <div className="label mb-2">服务信息</div>
              <KV k="组件名称" v={serviceName(detail)} />
              <KV k="K8S 名称" v={k8sName(detail)} />
              <KV k="镜像" v={imageOf(detail)} />
              <KV k="命名空间" v={detail.service?.metadata?.namespace || '—'} />
              <KV k="重启次数" v={detail.restartCount ?? 0} />
            </div>
            <div>
              <div className="label mb-2">端口映射</div>
              {(detail.service?.spec?.ports ?? []).length === 0 && <div className="py-2 text-[11px] text-mute">未声明端口</div>}
              {(detail.service?.spec?.ports ?? []).map((port) => (
                <KV
                  key={`${port.name}-${port.port}`}
                  k={port.name || port.protocol || 'PORT'}
                  v={`${port.port} → ${port.targetPort || '—'}${port.nodePort ? ` (NodePort ${port.nodePort})` : ''}`}
                />
              ))}
              <div className="label mb-2 mt-4">Deployment 状态</div>
              <KV k="可用副本" v={detail.deployment?.status?.availableReplicas ?? 0} />
              <KV k="就绪副本" v={detail.deployment?.status?.readyReplicas ?? 0} />
              <KV k="期望副本" v={detail.deployment?.spec?.replicas ?? 0} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!eventTarget}
        onOpenChange={(open) => !open && setEventTarget(null)}
        kicker="BASE SERVICE / EVENTS"
        title={eventTarget ? `${k8sName(eventTarget)} 事件` : '事件'}
        description="Kubernetes 事件流，用于排查调度失败、镜像拉取异常与健康检查失败。"
        width={720}
        footer={
          <>
            <Button size="sm" onClick={() => setEventTarget(null)}>
              关闭
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={restartMutation.isPending}
              onClick={() => {
                if (!eventTarget) return
                restartMutation.mutate(k8sName(eventTarget))
              }}
            >
              <RotateCw size={10} /> 重启组件
            </Button>
          </>
        }
      >
        <div className="max-h-[380px] space-y-2 overflow-y-auto">
          {(eventsQuery.data ?? []).map((event, index) => (
            <div key={`${event.reason}-${index}`} className="border border-line px-3 py-2">
              <div className="flex items-center gap-2">
                <Badge tone={event.type === 'Warning' ? 'warn' : 'info'}>{event.type || 'Normal'}</Badge>
                <span className="font-mono text-[10px] text-ink">{event.reason || '—'}</span>
                {event.count ? <span className="mono ml-auto text-[9px] text-mute">×{event.count}</span> : null}
              </div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{event.message || '—'}</div>
              <div className="mono mt-1 text-[8.5px] tracking-wider text-mute">
                {event.lastTimestamp || event.firstTimestamp || '—'}
              </div>
            </div>
          ))}
          {(eventsQuery.data ?? []).length === 0 && (
            <div className="px-3 py-10 text-center text-[11px] text-mute">
              {eventsQuery.isLoading ? '正在读取事件…' : '暂无事件记录'}
            </div>
          )}
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
