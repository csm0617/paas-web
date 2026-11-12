import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, RefreshCw, ScrollText, Search, SquareTerminal, Trash2 } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge, Button, PageHeader, Panel, StatusDot, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

const ServiceConsole = lazy(() =>
  import('@/components/console/ServiceConsole').then((module) => ({ default: module.ServiceConsole })),
)

const NAMESPACE = 'gaop-namespace'

interface PodItem {
  metadata?: {
    name?: string
    namespace?: string
    creationTimestamp?: string
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

function ownerOf(pod: PodItem) {
  const labels = pod.metadata?.labels ?? {}
  if (labels.app) return labels.app
  const owner = pod.metadata?.ownerReferences?.[0]?.name
  if (!owner) return '—'
  const parts = owner.split('-')
  if (parts.length > 2) parts.pop()
  return parts.join('-')
}

function readyOf(pod: PodItem) {
  const statuses = pod.status?.containerStatuses ?? []
  const total = pod.spec?.containers?.length ?? statuses.length
  const ready = statuses.filter((item) => item.ready).length
  return { ready, total: total || 1 }
}

function restartsOf(pod: PodItem) {
  return (pod.status?.containerStatuses ?? []).reduce((sum, item) => sum + (item.restartCount ?? 0), 0)
}

export default function PodsPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [keyword, setKeyword] = useState('')
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
    return pods.filter((pod) => {
      const name = pod.metadata?.name?.toLowerCase() || ''
      const owner = ownerOf(pod).toLowerCase()
      const image = (pod.spec?.containers?.[0]?.image || '').toLowerCase()
      return name.includes(q) || owner.includes(q) || image.includes(q)
    })
  }, [pods, keyword])

  const deleteMutation = useMutation({
    mutationFn: (name: string) =>
      api.del(`/k8s/api/v1/namespaces/${NAMESPACE}/pods/${name}`, { gracePeriodSeconds: 0 }),
    onSuccess: () => {
      toast.success('容器已删除', '工作负载将自动重建该容器')
      queryClient.invalidateQueries({ queryKey: ['pods'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  async function remove(pod: PodItem) {
    const name = pod.metadata?.name
    if (!name) return
    const ok = await confirm({
      title: `删除容器 ${name}？`,
      description: '强制删除后，所属 Deployment 会按副本数自动重建容器。请确认该操作不会影响业务。',
      confirmText: '删除',
      danger: true,
    })
    if (ok) deleteMutation.mutate(name)
  }

  const running = pods.filter((pod) => pod.status?.phase === 'Running').length

  const columns: Array<Column<PodItem>> = [
    {
      key: 'index',
      header: '#',
      width: '44px',
      cell: (_row, index) => <span className="mono text-[9.5px] text-mute">{String(index + 1).padStart(2, '0')}</span>,
    },
    {
      key: 'name',
      header: '容器名称 / POD',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Box size={13} className="text-mute" />
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] text-ink">{row.metadata?.name || '—'}</div>
            <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.spec?.nodeName || '—'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => {
        const { ready, total } = readyOf(row)
        const phase = row.status?.phase || 'Unknown'
        return (
          <div className="flex items-center gap-2">
            <StatusDot tone={phase === 'Running' && ready === total ? 'ok' : phase === 'Failed' ? 'bad' : 'warn'} />
            <div>
              <div className="mono text-[9.5px] tracking-widest text-ink-3">{phase.toUpperCase()}</div>
              <div className="mono text-[8px] text-mute">
                {ready}/{total} READY · {restartsOf(row)} RESTARTS
              </div>
            </div>
          </div>
        )
      },
    },
    {
      key: 'owner',
      header: '所属服务',
      cell: (row) => <span className="font-mono text-[10px] text-ink-3">{ownerOf(row)}</span>,
    },
    {
      key: 'image',
      header: '镜像',
      cell: (row) => (
        <span className="mono max-w-[240px] truncate text-[9.5px] text-mute">
          {row.spec?.containers?.[0]?.image || '—'}
        </span>
      ),
    },
    {
      key: 'ip',
      header: '访问地址',
      cell: (row) => <span className="mono text-[10px] text-ink">{row.status?.podIP || '—'}</span>,
    },
    {
      key: 'created',
      header: '创建时间',
      cell: (row) => (
        <span className="mono text-[9.5px] text-mute">
          {row.metadata?.creationTimestamp ? formatDate(row.metadata.creationTimestamp, false) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            onClick={() => setConsoleState({ service: ownerOf(row), mode: 'terminal' })}
          >
            <SquareTerminal size={10} /> 终端登录
          </Button>
          <Button size="sm" onClick={() => setConsoleState({ service: ownerOf(row), mode: 'logs' })}>
            <ScrollText size={10} /> 日志
          </Button>
          <Button size="sm" onClick={() => remove(row)}>
            <Trash2 size={10} /> 删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="03 / 07"
        en="SOFTWARE · CONTAINERS"
        title="容器"
        description="命名空间 gaop-namespace 内的全部容器实例。可查看状态、镜像与 IP，并直接进入终端或日志。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={running === pods.length ? 'ok' : 'warn'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {running}/{pods.length} RUNNING
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">AUTO REFRESH 20S</span>
          </>
        }
        actions={
          <>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
              <input
                className={cn('field h-8 w-[220px] pl-8')}
                placeholder="搜索容器 / 服务 / 镜像"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
          </>
        }
      />

      <Panel kicker="POD INVENTORY" title="容器清单" bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.metadata?.name || ''}
          loading={query.isLoading}
          pageSize={12}
          emptyTitle="暂无容器"
          emptyDescription="命名空间内没有正在运行的容器实例。"
        />
      </Panel>

      <div className="mono mt-3 flex items-center gap-2 text-[8px] tracking-wider text-mute">
        <Badge tone="info">TIP</Badge> 终端与日志基于网关 exec / logs 会话，首次连接失败会自动重试。
      </div>

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
