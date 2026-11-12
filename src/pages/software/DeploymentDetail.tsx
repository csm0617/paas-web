import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  Calendar,
  Layers,
  RefreshCw,
  RotateCw,
  Server,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { formatBytes, formatDate, formatNumber } from '@/lib/format'
import type { PodInfoItem, ServiceItem } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import {
  Badge,
  Button,
  CopyText,
  EmptyState,
  Field,
  KV,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  useConfirm,
} from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

const ServiceConsole = lazy(() =>
  import('@/components/console/ServiceConsole').then((module) => ({ default: module.ServiceConsole })),
)

interface K8sEvent {
  type?: string
  reason?: string
  message?: string
  count?: number
  lastTimestamp?: string
  eventTime?: string
  firstTimestamp?: string
  metadata?: { name?: string; creationTimestamp?: string }
  involvedObject?: { kind?: string; name?: string }
  source?: { component?: string; host?: string }
}

function parseImage(raw?: string | null) {
  if (!raw) return { project: 'gaop', image: '', tag: '' }
  const [repo, tag = ''] = raw.split(':')
  const parts = repo.split('/')
  if (parts.length >= 3) return { project: parts[1], image: parts.slice(2).join('/'), tag }
  if (parts.length === 2) return { project: parts[0], image: parts[1], tag }
  return { project: 'gaop', image: repo, tag }
}

function statusOf(service?: ServiceItem | null) {
  const ready = service?.deployment?.status?.readyReplicas ?? 0
  const desired = service?.deployment?.spec?.replicas ?? 0
  if (service?.terminated) return { label: 'STOPPED', tone: 'default' as const, ready, desired }
  if (ready > 0) return { label: 'RUNNING', tone: 'ok' as const, ready, desired }
  if (desired > 0) return { label: 'PENDING', tone: 'warn' as const, ready, desired }
  return { label: 'STOPPED', tone: 'default' as const, ready, desired }
}

export default function DeploymentDetailPage() {
  const { name = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [consoleState, setConsoleState] = useState<{ mode: 'logs' | 'terminal' } | null>(null)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [scaleValue, setScaleValue] = useState(1)
  const [imageOpen, setImageOpen] = useState(false)
  const [imageType, setImageType] = useState(1)
  const [imageVersion, setImageVersion] = useState('')

  const detailQuery = useQuery({
    queryKey: ['deployment-detail', name],
    queryFn: () => api.get<ServiceItem>(`/v1/service/${encodeURIComponent(name)}`),
    enabled: !!name,
    refetchInterval: 30_000,
  })
  const podsQuery = useQuery({
    queryKey: ['deployment-pods', name],
    queryFn: () => api.get<PodInfoItem[]>('/v1/pub/podInfo', { nameList: name }),
    enabled: !!name,
    refetchInterval: 20_000,
  })
  const eventsQuery = useQuery({
    queryKey: ['deployment-events', name],
    queryFn: () => api.get<K8sEvent[]>('/v1/service/event', { name }),
    enabled: !!name,
    refetchInterval: 30_000,
  })

  const service = detailQuery.data
  const pods = podsQuery.data ?? []
  const events = eventsQuery.data ?? []
  const status = statusOf(service)
  const imageRaw = typeof service?.imageInfo === 'string' ? service.imageInfo : ''
  const parsed = useMemo(() => parseImage(imageRaw), [imageRaw])

  const tagsQuery = useQuery({
    queryKey: ['deployment-tags', parsed.project, parsed.image],
    queryFn: () =>
      api.get<{ list: Array<{ name: string }>; total: number }>('/v1/image/tagInfo', {
        imageName: `${parsed.project}/${parsed.image}`,
        page: 1,
        size: 100,
      }),
    enabled: imageOpen && !!parsed.image,
  })

  const containers =
    (service?.deployment?.spec?.template?.spec as { containers?: Array<{ name: string; image?: string }> } | undefined)
      ?.containers ?? []
  const namespace = service?.deployment?.metadata?.namespace || service?.service?.metadata?.namespace || '—'

  const actionMutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.put(path, body),
    onSuccess: () => {
      toast.success('操作已下发至集群')
      queryClient.invalidateQueries({ queryKey: ['deployment-detail', name] })
      queryClient.invalidateQueries({ queryKey: ['deployment-pods', name] })
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  const scaleMutation = useMutation({
    mutationFn: (scale: number) => api.put('/v1/service/scale', undefined, { serviceName: name, scale }),
    onSuccess: () => {
      toast.success('副本数已更新')
      setScaleOpen(false)
      queryClient.invalidateQueries({ queryKey: ['deployment-detail', name] })
    },
    onError: (error) => toast.error('扩缩容失败', errorMessage(error)),
  })

  const imageMutation = useMutation({
    mutationFn: () => api.put('/v1/service/rollingUpdate', { name, type: imageType, version: imageVersion }),
    onSuccess: () => {
      toast.success('镜像更新已下发')
      setImageOpen(false)
      queryClient.invalidateQueries({ queryKey: ['deployment-detail', name] })
    },
    onError: (error) => toast.error('更新失败', errorMessage(error)),
  })

  const deletePodMutation = useMutation({
    mutationFn: (podName: string) => api.del('/v1/pub/pod', undefined, { servicePodName: podName }),
    onSuccess: () => {
      toast.success('Pod 已删除，控制器将自动重建')
      queryClient.invalidateQueries({ queryKey: ['deployment-pods', name] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  async function restart() {
    const ok = await confirm({
      title: `滚动重启「${name}」？`,
      description: '将逐个替换 Pod，期间服务可能出现短暂延迟抖动。',
      confirmText: '开始重启',
    })
    if (ok) actionMutation.mutate({ path: '/v1/service/reStart', body: [name] })
  }

  async function removePod(pod: PodInfoItem) {
    const ok = await confirm({
      title: `删除 Pod「${pod.podName}」？`,
      description: '删除后 Deployment 会自动创建新的 Pod，用于验证调度与镜像拉取。',
      danger: true,
      confirmText: '删除 Pod',
    })
    if (ok) deletePodMutation.mutate(pod.podName)
  }

  const podColumns: Array<Column<PodInfoItem>> = [
    {
      key: 'name',
      header: 'Pod',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <StatusDot tone={(row.status || '').toUpperCase() === 'RUNNING' ? 'ok' : 'warn'} />
          <span className="font-mono text-[11px] text-ink">{row.podName}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => <Badge tone={(row.status || '').toUpperCase() === 'RUNNING' ? 'ok' : 'warn'}>{row.status || '—'}</Badge>,
    },
    {
      key: 'cpu',
      header: 'CPU',
      align: 'right',
      cell: (row) => <span className="mono text-[10.5px] text-ink-3">{formatNumber(row.cpuUsage ?? 0, 3)} CORE</span>,
    },
    {
      key: 'memory',
      header: '内存',
      align: 'right',
      cell: (row) => <span className="mono text-[10.5px] text-ink-3">{formatBytes((row.memory ?? 0) * 1024)}</span>,
    },
    {
      key: 'restart',
      header: '重启',
      align: 'center',
      cell: (row) => (
        <span className={cn('mono text-[10.5px]', (row.restartCount ?? 0) > 0 ? 'text-signal' : 'text-mute')}>
          {row.restartCount ?? 0}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button size="sm" variant="danger" onClick={() => removePod(row)}>
          <Trash2 size={10} /> 删除
        </Button>
      ),
    },
  ]

  const eventColumns: Array<Column<K8sEvent>> = [
    {
      key: 'time',
      header: '时间',
      sortValue: (row) => row.lastTimestamp || row.eventTime || row.metadata?.creationTimestamp || '',
      cell: (row) => (
        <span className="mono text-[10px] text-ink-3">
          {formatDate(row.lastTimestamp || row.eventTime || row.metadata?.creationTimestamp)}
        </span>
      ),
    },
    {
      key: 'type',
      header: '类型',
      cell: (row) => (
        <Badge tone={row.type === 'Warning' ? 'warn' : 'ok'}>{row.type || 'Normal'}</Badge>
      ),
    },
    {
      key: 'reason',
      header: '原因',
      cell: (row) => <span className="mono text-[10.5px] text-ink">{row.reason || '—'}</span>,
    },
    {
      key: 'message',
      header: '消息',
      cell: (row) => <span className="text-[11px] text-ink-3">{row.message || '—'}</span>,
    },
    {
      key: 'count',
      header: '次数',
      align: 'center',
      cell: (row) => <span className="mono text-[10px] text-mute">{row.count ?? 1}</span>,
    },
  ]

  return (
    <div>
      <PageHeader
        index="02 / 03"
        en="SOFTWARE · DEPLOYMENT DETAIL"
        title={name || 'Deployment 详情'}
        description={`${namespace} · Deployment 视角查看副本、Pod、事件与镜像版本，可直接进入容器控制台。`}
        meta={
          <>
            <button
              onClick={() => navigate('/software/workloads')}
              className="mono flex items-center gap-1 text-[9px] tracking-widest text-mute hover:text-ink"
            >
              <ArrowLeft size={10} /> WORKLOADS
            </button>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : 'idle'} />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{status.label}</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">
              {status.ready}/{status.desired} REPLICAS
            </span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              loading={detailQuery.isFetching}
              onClick={() => {
                detailQuery.refetch()
                podsQuery.refetch()
                eventsQuery.refetch()
              }}
            >
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" onClick={() => setConsoleState({ mode: 'logs' })}>
              <SquareTerminal size={11} /> 日志 / 终端
            </Button>
            <Button size="sm" onClick={restart} loading={actionMutation.isPending}>
              <RotateCw size={11} /> 滚动重启
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setImageVersion(parsed.tag)
                setImageOpen(true)
              }}
            >
              <ArrowUpRight size={11} /> 切换镜像
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-8" kicker="WORKLOAD" title="Deployment 概览">
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
            <div>
              <KV k="名称" v={name} />
              <KV k="命名空间" v={namespace} />
              <KV k="镜像" v={<CopyText value={imageRaw || '—'} />} />
              <KV k="副本" v={`${status.ready} / ${status.desired}`} />
              <KV k="策略" v={service?.deployment?.spec ? 'RollingUpdate' : '—'} />
            </div>
            <div>
              <KV k="Cluster IP" v={service?.service?.spec?.clusterIP || '—'} />
              <KV k="服务类型" v={service?.service?.spec?.type || '—'} />
              <KV k="重启次数" v={service?.restartCount ?? 0} />
              <KV k="所属软件" v={service?.softwareNameList?.join(', ') || '—'} />
              <KV
                k="创建时间"
                v={formatDate(service?.deployment?.metadata?.creationTimestamp)}
              />
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="label">端口映射</span>
              <span className="mono text-[8.5px] text-mute">{containers.length} CONTAINERS</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(service?.service?.spec?.ports ?? []).map((port) => (
                <Badge key={`${port.name}-${port.port}`} tone="info">
                  {port.port} → {port.targetPort || '—'}/{port.protocol || 'TCP'}
                  {port.nodePort ? ` · NODE ${port.nodePort}` : ''}
                </Badge>
              ))}
              {(service?.service?.spec?.ports ?? []).length === 0 && <span className="text-[10.5px] text-mute">未声明端口</span>}
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-4" kicker="CAPACITY" title="副本与资源">
          <div className="flex items-end justify-between">
            <div>
              <div className="label">就绪副本</div>
              <div className="num mt-1 text-[40px] leading-none text-ink">
                {status.ready}
                <span className="text-[16px] text-mute">/{status.desired}</span>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setScaleValue(status.desired || 1)
                setScaleOpen(true)
              }}
            >
              <Layers size={11} /> 调整副本
            </Button>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between border-t border-line pt-2">
              <span className="label">可用</span>
              <span className="mono text-[11px] text-ink">{service?.deployment?.status?.availableReplicas ?? 0}</span>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-2">
              <span className="label">已更新</span>
              <span className="mono text-[11px] text-ink">{service?.deployment?.status?.updatedReplicas ?? 0}</span>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-2">
              <span className="label">Pod 数</span>
              <span className="mono text-[11px] text-ink">{pods.length}</span>
            </div>
          </div>
        </Panel>

        <Panel className="xl:col-span-7" kicker="PODS" title="Pod 实例" bodyClassName="p-0">
          <DataTable
            columns={podColumns}
            rows={pods}
            rowKey={(row) => row.podName}
            loading={podsQuery.isLoading}
            pageSize={6}
            emptyTitle="暂无运行中的 Pod"
            emptyDescription="工作负载可能已停止，或正在等待调度。"
          />
        </Panel>

        <Panel className="xl:col-span-5" kicker="CONTAINERS" title="容器" bodyClassName="p-0">
          <div className="divide-y divide-line/70">
            {containers.map((container, index) => (
              <div key={container.name} className="flex items-start gap-3 px-4 py-3">
                <div className="flex h-8 w-8 flex-none items-center justify-center border border-line-strong bg-paper-2">
                  <Box size={13} className="text-ink-3" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mono text-[11px] text-ink">{container.name}</div>
                  <div className="mono mt-1 break-all text-[9px] leading-relaxed text-mute">{container.image || '—'}</div>
                </div>
                <span className="mono text-[8px] text-mute">#{String(index + 1).padStart(2, '0')}</span>
              </div>
            ))}
            {containers.length === 0 && (
              <EmptyState title="容器信息不可用" description="服务可能尚未完成部署，或 Deployment 已被删除。" />
            )}
          </div>
        </Panel>

        <Panel className="xl:col-span-12" kicker="EVENTS" title="事件" actions={<span className="mono text-[9px] tracking-widest text-mute">KUBERNETES EVENTS</span>} bodyClassName="p-0">
          <DataTable
            columns={eventColumns}
            rows={events}
            rowKey={(row, index) => `${row.reason || 'event'}-${index}`}
            loading={eventsQuery.isLoading}
            pageSize={8}
            emptyTitle="暂无事件"
            emptyDescription="近期没有调度、拉取镜像或健康检查相关事件。"
          />
        </Panel>
      </div>

      <Suspense fallback={null}>
        <ServiceConsole
          open={!!consoleState}
          serviceName={name}
          initialMode={consoleState?.mode || 'logs'}
          onClose={() => setConsoleState(null)}
        />
      </Suspense>

      <Modal
        open={scaleOpen}
        onOpenChange={setScaleOpen}
        kicker="DEPLOYMENT / SCALE"
        title="调整副本数"
        description="变更将通过 Deployment 滚动更新下发。"
        width={400}
        footer={
          <>
            <Button size="sm" onClick={() => setScaleOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={scaleMutation.isPending} onClick={() => scaleMutation.mutate(scaleValue)}>
              应用
            </Button>
          </>
        }
      >
        <Field label="目标副本数">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setScaleValue((value) => Math.max(0, value - 1))}>
              −
            </Button>
            <input
              type="number"
              min={0}
              max={50}
              className="field h-11 w-24 text-center text-[18px]"
              value={scaleValue}
              onChange={(event) => setScaleValue(Math.max(0, Number(event.target.value)))}
            />
            <Button size="sm" onClick={() => setScaleValue((value) => Math.min(50, value + 1))}>
              +
            </Button>
          </div>
        </Field>
      </Modal>

      <Modal
        open={imageOpen}
        onOpenChange={setImageOpen}
        kicker="DEPLOYMENT / IMAGE"
        title="切换镜像版本"
        description={`当前镜像 ${parsed.project}/${parsed.image}:${parsed.tag || '—'}`}
        width={460}
        footer={
          <>
            <Button size="sm" onClick={() => setImageOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!imageVersion}
              loading={imageMutation.isPending}
              onClick={() => imageMutation.mutate()}
            >
              下发更新
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="目标版本" required hint="来自镜像仓库的标签列表">
            <select className="field font-mono" value={imageVersion} onChange={(event) => setImageVersion(event.target.value)}>
              <option value="">选择版本</option>
              {(tagsQuery.data?.list ?? []).map((tag) => (
                <option key={tag.name} value={tag.name}>
                  {tag.name}
                </option>
              ))}
              {parsed.tag && !(tagsQuery.data?.list ?? []).some((tag) => tag.name === parsed.tag) && (
                <option value={parsed.tag}>{parsed.tag}（当前）</option>
              )}
            </select>
          </Field>
          <Field label="更新策略">
            <select className="field" value={imageType} onChange={(event) => setImageType(Number(event.target.value))}>
              <option value={1}>先启动新实例，再停止旧实例</option>
              <option value={2}>先停止旧实例，再启动新实例</option>
            </select>
          </Field>
          <div className="flex items-start gap-2 border border-line bg-paper-2/40 px-3 py-2">
            <Server size={12} className="mt-0.5 text-mute" />
            <span className="text-[10.5px] leading-relaxed text-ink-3">
              更新期间会创建新的 ReplicaSet。若新版本启动失败，可回滚到原标签。
            </span>
          </div>
        </div>
      </Modal>
    </div>
  )
}
