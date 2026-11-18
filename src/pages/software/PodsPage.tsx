import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { DataTable, type Column } from '@/components/DataTable'
import { ActionMenu, Button, KV, Modal, PageToolbar, Panel, useConfirm } from '@/components/ui'
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
  const images = (pod.spec?.containers ?? []).map((container) => {
    const parts = (container.image || '').split('/')
    return parts[1] || parts[2] ? `${parts[1] || '--'}/${parts[2] || '--'}` : '--'
  })
  return images.join(',') || '--'
}

function runningOf(pod: PodItem) {
  const statuses = pod.status?.containerStatuses ?? []
  const running = statuses.filter((item) => (item.state as { running?: unknown } | undefined)?.running).length
  const terminated = statuses.filter((item) => (item.state as { terminated?: unknown } | undefined)?.terminated).length
  return { running, total: statuses.length, partial: running > 0 && terminated > 0 }
}

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

  async function remove(pod: PodItem, force: boolean) {
    const name = pod.metadata?.name
    if (!name) return
    const ok = await confirm({
      title: `${force ? '强制删除' : '重新分配'}容器 ${name}？`,
      description: force
        ? '强制删除后，所属 Deployment 会按副本数自动重建容器。'
        : '重新分配将删除当前容器并由调度器重新创建。',
      confirmText: force ? '强制删除' : '重新分配',
      danger: force,
    })
    if (ok) deleteMutation.mutate({ name, force })
  }

  async function batch(force: boolean) {
    if (selected.length === 0) return
    const ok = await confirm({
      title: `${force ? '强制删除' : '重新分配'} ${selected.length} 个容器？`,
      description: '操作将对所选容器逐一执行，所属工作负载会自动重建。',
      confirmText: force ? '强制删除' : '重新分配',
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
      cell: (_row, index) => <span className="mono text-[11.5px] text-ink-3">{index + 1}</span>,
    },
    {
      key: 'name',
      header: '容器名称',
      width: 180,
      align: 'center',
      cell: (row) => (
        <button
          onClick={() => setDetail(row)}
          className="max-w-[260px] truncate text-[12px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
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
          <div className="leading-[1.5]">
            <div className={cn('text-[12px]', phase.tone)}>{phase.text}</div>
            {total > 0 && row.status?.phase === 'Running' && (
              <div className="text-[11.5px] text-ink-3">
                {running}/{total}
                {partial ? '部分运行' : '全部运行'}
              </div>
            )}
            <div className="text-[11.5px] text-ink-3">已重启 {restartsOf(row)} 次</div>
          </div>
        )
      },
    },
    {
      key: 'service',
      header: '镜像所属',
      width: 160,
      align: 'center',
      cell: (row) => <span className="mono text-[11.5px] text-ink-3">{serviceOf(row) || '--'}</span>,
    },
    {
      key: 'image',
      header: '镜像',
      width: 200,
      align: 'center',
      cell: (row) => <span className="mono text-[11.5px] text-ink-3">{imageOf(row)}</span>,
    },
    {
      key: 'ip',
      header: '访问地址',
      width: 180,
      align: 'center',
      cell: (row) => <span className="mono text-[11.5px] text-ink-3">{row.status?.podIP || '—'}</span>,
    },
    {
      key: 'created',
      header: '创建时间',
      width: 180,
      align: 'center',
      cell: (row) => (
        <span className="mono whitespace-nowrap text-[11.5px] text-ink-3">
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
          <div className="flex items-center justify-center gap-2.5 text-[12px]">
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
                { label: '强制删除', danger: true, onSelect: () => remove(row, true) },
                { label: '重新分配', onSelect: () => remove(row, false) },
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
          disabled={selected.length === 0 || deleteMutation.isPending}
          onClick={() => batch(false)}
        >
          批量重新分配
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={selected.length === 0 || deleteMutation.isPending}
          onClick={() => batch(true)}
        >
          强制删除
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
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail ? `${detail.metadata?.name || ''} 容器详情` : '容器详情'}
        width={680}
        footer={
          <Button size="sm" onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail && (
          <div>
            <KV k="容器名称" v={detail.metadata?.name || '—'} />
            <KV k="命名空间" v={detail.metadata?.namespace || NAMESPACE} />
            <KV k="运行节点" v={detail.spec?.nodeName || '—'} />
            <KV k="镜像所属" v={serviceOf(detail) || '--'} />
            <KV k="镜像" v={detail.spec?.containers?.[0]?.image || '—'} />
            <KV k="访问地址" v={detail.status?.podIP || '—'} />
            <KV k="状态" v={phaseText(detail.status?.phase).text} />
            <KV
              k="创建时间"
              v={detail.metadata?.creationTimestamp ? formatDate(detail.metadata.creationTimestamp, true) : '—'}
            />
          </div>
        )}
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
