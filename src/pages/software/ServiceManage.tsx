import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Box, History, Layers, Play, Plus, RefreshCw, Search, Square, SquareTerminal, Trash2, Upload } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { ImageProject, NodesResponse, ServiceItem, ServiceList } from '@/types'
import { AreaTrend } from '@/components/charts'
import { DataTable, type Column } from '@/components/DataTable'
import {
  Badge,
  Button,
  CopyText,
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

function serviceName(service: ServiceItem) {
  return service.nameUs || service.nameFr
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

interface MonitorPoint {
  timestamp?: string
  floatValue?: string | null
  value?: string | null
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

function repoPath(image: string) {
  const slash = image.indexOf('/')
  if (slash < 0) return image
  const first = image.slice(0, slash)
  return first.includes('.') || first.includes(':') ? image.slice(slash + 1) : image
}

function monitorTrend(list: MonitorSeries[] | undefined, factor = 1) {
  return (list ?? []).slice(0, 4).map((series, index) => ({
    name: series.podName || `SERIES ${index + 1}`,
    points: (series.metrics ?? [])
      .filter((point) => point.floatValue !== null && point.floatValue !== undefined && Number.isFinite(Number(point.floatValue)))
      .map((point) => {
        const date = point.timestamp ? new Date(point.timestamp) : null
        const label =
          date && !Number.isNaN(date.getTime())
            ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
            : ''
        return { label, value: Number(point.floatValue) * factor }
      }),
  }))
}

export default function ServiceManagePage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'STOPPED'>('ALL')
  const [selected, setSelected] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement | null>(null)
  const [detail, setDetail] = useState<ServiceItem | null>(null)
  const [scaleTarget, setScaleTarget] = useState<ServiceItem | null>(null)
  const [restartTarget, setRestartTarget] = useState<ServiceItem | null>(null)
  const [monitorTarget, setMonitorTarget] = useState<ServiceItem | null>(null)
  const [monitorRange, setMonitorRange] = useState<'ONE_HOURS' | 'SIX_HOURS'>('ONE_HOURS')
  const [versionTarget, setVersionTarget] = useState<ServiceItem | null>(null)
  const [versionImage, setVersionImage] = useState('')
  const [versionTag, setVersionTag] = useState('')
  const [versionStrategy, setVersionStrategy] = useState<'1' | '2'>('2')
  const [scaleValue, setScaleValue] = useState(1)
  const [consoleState, setConsoleState] = useState<{ service: string; mode: 'logs' | 'terminal' } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    serviceName: '',
    projectName: 'gaop',
    imageName: '',
    imageTagName: '',
    cpuSize: '200',
    memory: '200',
    inBound: '',
    outBound: '',
    bindNodeName: '',
    args: '',
  })
  const [envRows, setEnvRows] = useState<Array<{ name: string; value: string }>>([{ name: '', value: '' }])

  const query = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
    refetchInterval: 30_000,
  })

  const services = query.data?.services ?? []

  const restartQuery = useQuery({
    queryKey: ['restart-info', restartTarget ? serviceName(restartTarget) : ''],
    queryFn: () =>
      api.get<Array<{ podName?: string; createTime?: number; restartCount?: number }>>('/v1/service/restartInfo', {
        serviceName: restartTarget ? serviceName(restartTarget) : '',
      }),
    enabled: !!restartTarget,
  })

  const monitorQuery = useQuery({
    queryKey: ['service-monitor', monitorTarget ? serviceName(monitorTarget) : '', monitorRange],
    queryFn: () =>
      api.get<MonitorData>('/v1/pub/serviceMonitor', {
        namespace: monitorTarget?.service?.metadata?.namespace || 'gaop-namespace',
        name: monitorTarget ? serviceName(monitorTarget) : '',
        queryTimeType: true,
        timeType: monitorRange,
      }),
    enabled: !!monitorTarget,
  })

  const versionTagsQuery = useQuery({
    queryKey: ['version-tags', versionImage],
    queryFn: () =>
      api.get<{ list: Array<{ name: string }> }>('/v1/image/tagInfo', {
        imageName: repoPath(versionImage),
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
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('版本切换失败', errorMessage(error)),
  })

  function openVersion(service: ServiceItem) {
    const image =
      service.deployment?.spec?.template?.spec?.containers?.[0]?.image ||
      (typeof service.imageInfo === 'string' ? service.imageInfo : service.imageInfo?.image) ||
      ''
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

  const projectsQuery = useQuery({
    queryKey: ['service-create-projects'],
    queryFn: () => api.get<{ list: ImageProject[]; total: number }>('/v1/image/projectList', { page: 1, size: 100 }),
    enabled: createOpen,
  })
  const imagesQuery = useQuery({
    queryKey: ['service-create-images'],
    queryFn: () =>
      api.get<{ list: Array<{ name: string; lastVersion?: string }>; total: number }>('/v1/image/imageList', {
        page: 1,
        size: 300,
      }),
    enabled: createOpen,
  })
  const nodesQuery = useQuery({
    queryKey: ['service-create-nodes'],
    queryFn: () => api.get<NodesResponse>('/cloud/nodes'),
    enabled: createOpen,
  })
  const tagsQuery = useQuery({
    queryKey: ['service-create-tags', createForm.projectName, createForm.imageName],
    queryFn: () =>
      api.get<{ list: Array<{ name: string }>; total: number }>('/v1/image/tagInfo', {
        imageName: `${createForm.projectName}/${createForm.imageName}`,
        page: 1,
        size: 100,
      }),
    enabled: createOpen && !!createForm.projectName && !!createForm.imageName,
  })

  const projectOptions = useMemo(() => {
    const list = (projectsQuery.data?.list ?? []).map((item) => item.name)
    return list.length ? list : ['gaop']
  }, [projectsQuery.data])

  const imageOptions = useMemo(() => {
    const prefix = `${createForm.projectName}/`
    return (imagesQuery.data?.list ?? [])
      .map((item) => item.name)
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
  }, [imagesQuery.data, createForm.projectName])

  const tagOptions = useMemo(() => (tagsQuery.data?.list ?? []).map((item) => item.name), [tagsQuery.data])
  const nodeOptions = nodesQuery.data?.nodes?.nodes ?? []

  useEffect(() => {
    if (!createOpen) return
    if (!projectOptions.includes(createForm.projectName)) {
      setCreateForm((prev) => ({ ...prev, projectName: projectOptions[0] }))
    }
  }, [createOpen, projectOptions, createForm.projectName])

  useEffect(() => {
    if (!createOpen) return
    if (!imageOptions.includes(createForm.imageName)) {
      setCreateForm((prev) => ({ ...prev, imageName: imageOptions[0] || '', imageTagName: '' }))
    }
  }, [createOpen, imageOptions, createForm.imageName])

  useEffect(() => {
    if (!createOpen) return
    if (!tagOptions.includes(createForm.imageTagName)) {
      setCreateForm((prev) => ({ ...prev, imageTagName: tagOptions[0] || '' }))
    }
  }, [createOpen, tagOptions, createForm.imageTagName])

  const filtered = useMemo(() => {
    return services.filter((service) => {
      const name = serviceName(service).toLowerCase()
      const q = keyword.trim().toLowerCase()
      const matchKeyword =
        !q ||
        name.includes(q) ||
        imageOf(service).toLowerCase().includes(q) ||
        (service.softwareNameList ?? []).some((item) => item.toLowerCase().includes(q))
      const status = statusOf(service)
      const matchStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'RUNNING' && status.label === 'RUNNING') ||
        (statusFilter === 'STOPPED' && status.label !== 'RUNNING')
      return matchKeyword && matchStatus
    })
  }, [services, keyword, statusFilter])

  const actionMutation = useMutation({
    mutationFn: async ({ path, names, body }: { path: string; names: string[]; body?: unknown }) => {
      if (path === '/v1/service') return api.del('/v1/service', body ?? names)
      return api.put(path, body ?? names)
    },
    onSuccess: (_data, variables) => {
      toast.success('操作已下发', `${variables.names.length} 个服务的变更请求已提交至集群`)
      setSelected([])
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  const scaleMutation = useMutation({
    mutationFn: ({ name, scale }: { name: string; scale: number }) =>
      api.put('/v1/service/scale', undefined, { serviceName: name, scale }),
    onSuccess: () => {
      toast.success('副本数已更新')
      setScaleTarget(null)
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('扩缩容失败', errorMessage(error)),
  })

  const createMutation = useMutation({
    mutationFn: () => {
      if (!createForm.serviceName.trim()) throw new Error('服务名称不能为空')
      if (!createForm.imageName || !createForm.imageTagName) throw new Error('请选择镜像与版本')
      const args = createForm.args
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((arg) => ({ arg }))
      const env = envRows
        .filter((item) => item.name.trim())
        .map((item) => ({ name: item.name.trim(), value: item.value }))
      return api.post('/v1/pub/createService', {
        serviceName: createForm.serviceName.trim(),
        projectName: createForm.projectName,
        imageName: createForm.imageName,
        imageTagName: createForm.imageTagName,
        memory: createForm.memory || '200',
        cpuSize: createForm.cpuSize || '200',
        inBound: createForm.inBound ? Number(createForm.inBound) : undefined,
        outBound: createForm.outBound ? Number(createForm.outBound) : undefined,
        bindNodeName: createForm.bindNodeName || undefined,
        args: args.length ? args : undefined,
        env: env.length ? env : undefined,
      })
    },
    onSuccess: () => {
      toast.success('服务创建任务已下发', '可在列表中查看启动进度')
      setCreateOpen(false)
      setCreateForm({
        serviceName: '',
        projectName: 'gaop',
        imageName: '',
        imageTagName: '',
        cpuSize: '200',
        memory: '200',
        inBound: '',
        outBound: '',
        bindNodeName: '',
        args: '',
      })
      setEnvRows([{ name: '', value: '' }])
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  async function importConfig(file: File) {
    setImporting(true)
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      await api.put('/v1/service/patch', payload)
      toast.success('配置导入成功', '服务配置已按导入文件更新')
      queryClient.invalidateQueries({ queryKey: ['services'] })
    } catch (error) {
      toast.error('配置导入失败', error instanceof SyntaxError ? '文件不是合法的 JSON' : errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  async function batch(path: string, names: string[], label: string, danger?: boolean) {
    if (names.length === 0) return
    const ok = await confirm({
      title: `${label} ${names.length} 个服务？`,
      description:
        path === '/v1/service'
          ? '删除服务将从集群移除对应的工作负载与 Service 对象，此操作不可恢复。'
          : '操作将立即下发至 Kubernetes 集群，请确认当前业务可接受短暂波动。',
      confirmText: label,
      danger,
    })
    if (ok) actionMutation.mutate({ path, names })
  }

  const running = services.filter((item) => statusOf(item).label === 'RUNNING').length
  const pods = services.reduce((sum, item) => sum + (item.deployment?.status?.readyReplicas ?? 0), 0)
  const restarts = services.reduce((sum, item) => sum + (item.restartCount ?? 0), 0)

  const columns: Array<Column<ServiceItem>> = [
    {
      key: 'name',
      header: '服务 / SERVICE',
      sortValue: (row) => serviceName(row),
      cell: (row) => {
        const status = statusOf(row)
        return (
          <div className="flex items-center gap-2.5">
            <StatusDot tone={status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : 'idle'} />
            <div className="min-w-0">
              <button
                onClick={() => setDetail(row)}
                className="block max-w-[220px] truncate text-left font-mono text-[11.5px] text-ink hover:text-signal hover:underline"
              >
                {serviceName(row)}
              </button>
              <div className="mono mt-0.5 max-w-[220px] truncate text-[8.5px] tracking-wider text-mute">
                {imageOf(row).split('/').pop()}
              </div>
            </div>
          </div>
        )
      },
    },
    {
      key: 'namespace',
      header: '命名空间',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.service?.metadata?.namespace || '—'}</span>,
    },
    {
      key: 'replicas',
      header: '副本 READY/DESIRED',
      align: 'center',
      sortValue: (row) => row.deployment?.status?.readyReplicas ?? 0,
      cell: (row) => {
        const status = statusOf(row)
        return (
          <span className={cn('num text-[13px]', status.ready < status.desired ? 'text-warn' : 'text-ink')}>
            {status.ready}
            <span className="text-[10px] text-mute"> / {status.desired}</span>
          </span>
        )
      },
    },
    {
      key: 'ports',
      header: '端口',
      cell: (row) => {
        const ports = row.service?.spec?.ports ?? []
        return (
          <div className="flex flex-wrap gap-1">
            {ports.length === 0 && <span className="text-mute">—</span>}
            {ports.slice(0, 2).map((port) => (
              <Badge key={`${port.name}-${port.port}`}>
                {port.port}
                {port.nodePort ? `:${port.nodePort}` : ''}
              </Badge>
            ))}
          </div>
        )
      },
    },
    {
      key: 'type',
      header: '类型',
      cell: (row) => <span className="mono text-[9.5px] text-ink-3">{row.service?.spec?.type || '—'}</span>,
    },
    {
      key: 'restart',
      header: '重启',
      align: 'center',
      sortValue: (row) => row.restartCount ?? 0,
      cell: (row) => (
        <span className={cn('mono text-[10.5px]', (row.restartCount ?? 0) > 0 ? 'text-signal' : 'text-mute')}>
          {row.restartCount ?? 0}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => {
        const status = statusOf(row)
        return <Badge tone={status.tone}>{status.label}</Badge>
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-2.5 text-[12px]">
          <button
            className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            onClick={() =>
              navigate(`/software/application/service-params?service=${encodeURIComponent(serviceName(row))}`)
            }
          >
            配置
          </button>
          <button
            className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            onClick={() => setConsoleState({ service: serviceName(row), mode: 'logs' })}
          >
            日志
          </button>
          <button
            className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            onClick={() => actionMutation.mutate({ path: '/v1/service/start', names: [serviceName(row)] })}
          >
            启动
          </button>
          <button
            className="text-[#ff7b7b] transition-colors hover:text-[#ff9a9a]"
            onClick={() => actionMutation.mutate({ path: '/v1/service/stop', names: [serviceName(row)] })}
          >
            停止
          </button>
          <button
            className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            onClick={() => {
              setScaleTarget(row)
              setScaleValue(row.deployment?.spec?.replicas ?? 1)
            }}
          >
            扩容
          </button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="02 / 02"
        en="SOFTWARE · SERVICE ORCHESTRATION"
        title="服务管理"
        description="管理平台内注册的微服务实例：启停、重启、副本编排与镜像版本切换。所有变更实时下发至 Kubernetes。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{running} RUNNING</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">{services.length} SERVICES · {pods} READY REPLICAS</span>
            <span className="mono text-[9.5px] tracking-widest text-mute">{restarts} RESTARTS</span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) importConfig(file)
                event.target.value = ''
              }}
            />
            <Button size="sm" loading={importing} onClick={() => importRef.current?.click()}>
              <Upload size={11} /> 配置导入
            </Button>
            <Button size="sm" variant="signal" onClick={() => setCreateOpen(true)}>
              <Plus size={11} /> 新建服务
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="field h-9 w-[240px] pl-8 text-[12px]"
            placeholder="搜索服务名 / 镜像"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <div className="flex border border-line-strong">
          {(['ALL', 'RUNNING', 'STOPPED'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setStatusFilter(item)}
              className={cn(
                'mono h-9 px-4 text-[9.5px] tracking-[0.14em] transition-colors',
                statusFilter === item ? 'bg-signal text-white' : 'text-ink-3 hover:bg-paper-2',
              )}
            >
              {item === 'ALL' ? '全部' : item === 'RUNNING' ? '运行中' : '未运行'}
            </button>
          ))}
        </div>
        <span className="mono ml-auto text-[9px] tracking-widest text-mute">{filtered.length} 条记录</span>
      </div>

      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-[#2f6fa8] bg-[#12314c] px-3 py-2 text-ink">
          <span className="mono ml-1 text-[9.5px] tracking-[0.16em] text-signal">已选 {selected.length} 项</span>
          <span className="h-4 w-px bg-[#91caff]" />
          <Button size="sm" onClick={() => batch('/v1/service/start', selected, '批量启动')}>
            <Play size={11} /> 启动
          </Button>
          <Button size="sm" onClick={() => batch('/v1/service/stop', selected, '批量停止')}>
            <Square size={11} /> 停止
          </Button>
          <Button size="sm" onClick={() => batch('/v1/service/reStart', selected, '批量重启')}>
            <RefreshCw size={11} /> 重启
          </Button>
          <Button size="sm" variant="danger" className="ml-auto" onClick={() => batch('/v1/service', selected, '批量删除', true)}>
            <Trash2 size={11} /> 删除
          </Button>
        </div>
      )}

      <Panel bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => serviceName(row)}
          loading={query.isLoading}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          emptyTitle="没有匹配的服务"
          emptyDescription="调整筛选条件，或新建微服务。"
        />
      </Panel>

      <Modal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        kicker="SERVICE / INSPECT"
        title={detail ? serviceName(detail) : '服务详情'}
        description={
          detail
            ? `${detail.service?.metadata?.namespace || 'default'} · ${detail.service?.spec?.type || 'ClusterIP'}`
            : undefined
        }
        width={720}
        footer={
          <>
            <Button size="sm" onClick={() => setDetail(null)}>
              关闭
            </Button>
            {detail && (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setConsoleState({ service: serviceName(detail), mode: 'logs' })
                    setDetail(null)
                  }}
                >
                  <SquareTerminal size={11} /> 实时日志
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setConsoleState({ service: serviceName(detail), mode: 'terminal' })
                    setDetail(null)
                  }}
                >
                  <SquareTerminal size={11} /> 容器终端
                </Button>
                <Button
                  size="sm"
                  onClick={() => actionMutation.mutate({ path: '/v1/service/reStart', names: [serviceName(detail)] })}
                >
                  <RefreshCw size={11} /> 重启服务
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setRestartTarget(detail)
                    setDetail(null)
                  }}
                >
                  <History size={11} /> 重启记录
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setMonitorTarget(detail)
                    setDetail(null)
                  }}
                >
                  <Activity size={11} /> 监控
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    openVersion(detail)
                    setDetail(null)
                  }}
                >
                  <RefreshCw size={11} /> 版本切换
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setScaleTarget(detail)
                    setScaleValue(detail.deployment?.spec?.replicas ?? 1)
                    setDetail(null)
                  }}
                >
                  <Layers size={11} /> 调整副本
                </Button>
              </>
            )}
          </>
        }
      >
        {detail && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <div className="label mb-2">服务信息</div>
              <KV k="服务名称" v={serviceName(detail)} />
              <KV k="镜像" v={<CopyText value={imageOf(detail)} />} />
              <KV k="Cluster IP" v={detail.service?.spec?.clusterIP || '—'} />
              <KV k="副本" v={`${detail.deployment?.status?.readyReplicas ?? 0} / ${detail.deployment?.spec?.replicas ?? 0}`} />
              <KV k="重启次数" v={detail.restartCount ?? 0} />
              <KV k="所属软件" v={detail.softwareNameList?.join(', ') || '—'} />
              <KV k="关联服务" v={Array.isArray(detail.relationServiceName) ? detail.relationServiceName.join(', ') || '—' : detail.relationServiceName || '—'} />
            </div>
            <div>
              <div className="label mb-2">端口映射</div>
              {(detail.service?.spec?.ports ?? []).length === 0 && <div className="py-2 text-[11px] text-mute">未声明端口</div>}
              {(detail.service?.spec?.ports ?? []).map((port) => (
                <KV key={`${port.name}-${port.port}`} k={port.name || port.protocol || 'PORT'} v={`${port.port} → ${port.targetPort || '—'}${port.nodePort ? ` (NodePort ${port.nodePort})` : ''}`} />
              ))}
              <div className="label mb-2 mt-4">Deployment 状态</div>
              <KV k="可用副本" v={detail.deployment?.status?.availableReplicas ?? 0} />
              <KV k="更新副本" v={detail.deployment?.status?.updatedReplicas ?? 0} />
              <KV k="就绪副本" v={detail.deployment?.status?.readyReplicas ?? 0} />
            </div>
            <div className="sm:col-span-2">
              <div className="label mb-2">容器与标签</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(detail.deployment?.metadata?.labels ?? {}).map(([key, value]) => (
                  <Badge key={key}>
                    {key}={value}
                  </Badge>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 border border-line bg-paper-2/30 px-3 py-2">
                <Box size={13} className="text-mute" />
                <span className="mono text-[9.5px] text-mute">
                  K8S OBJECT / {detail.deployment?.metadata?.name || serviceName(detail)}
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!scaleTarget}
        onOpenChange={(open) => !open && setScaleTarget(null)}
        kicker="SERVICE / SCALE"
        title={`调整「${scaleTarget ? serviceName(scaleTarget) : ''}」副本数`}
        description="副本变更将通过滚动更新下发，受集群资源配额限制。"
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setScaleTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={scaleMutation.isPending}
              onClick={() => {
                if (scaleTarget) scaleMutation.mutate({ name: serviceName(scaleTarget), scale: scaleValue })
              }}
            >
              应用变更
            </Button>
          </>
        }
      >
        <Field label="目标副本数" hint="建议副本数不超过节点可用 CPU 与内存配额。">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setScaleValue((value) => Math.max(0, value - 1))}>
              −
            </Button>
            <input
              type="number"
              min={0}
              max={50}
              className="field h-10 w-24 text-center text-[16px]"
              value={scaleValue}
              onChange={(event) => setScaleValue(Math.max(0, Number(event.target.value)))}
            />
            <Button size="sm" onClick={() => setScaleValue((value) => Math.min(50, value + 1))}>
              +
            </Button>
            <span className="mono ml-1 text-[9px] text-mute">
              当前 {scaleTarget?.deployment?.spec?.replicas ?? 1}
            </span>
          </div>
        </Field>
        <div className="mt-3 border border-line bg-paper-2/40 px-3 py-2">
          <div className="label mb-1">资源提示</div>
          <div className="mono text-[9.5px] leading-relaxed text-ink-3">
            CPU {formatNumber(scaleTarget?.cpuOrder ?? 0, 2)} CORE · MEM {formatNumber(scaleTarget?.memoryOrder ?? 0, 0)} MiB
          </div>
        </div>
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        kicker="SERVICE / CREATE"
        title="新建微服务"
        description="从镜像仓库选择镜像并声明资源。平台将创建 Deployment 与 Service 对象。"
        width={720}
        footer={
          <>
            <Button size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!createForm.serviceName.trim() || !createForm.imageName || !createForm.imageTagName}
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              创建服务
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <section>
            <div className="label mb-2">基本信息</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="服务名称" required hint="集群内唯一，建议使用小写字母与短横线">
                <input
                  className="field font-mono"
                  value={createForm.serviceName}
                  onChange={(event) => setCreateForm({ ...createForm, serviceName: event.target.value })}
                  placeholder="my-service"
                />
              </Field>
              <Field label="镜像仓库组" required>
                <select
                  className="field"
                  value={createForm.projectName}
                  onChange={(event) =>
                    setCreateForm({ ...createForm, projectName: event.target.value, imageName: '', imageTagName: '' })
                  }
                >
                  {projectOptions.map((project) => (
                    <option key={project} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="镜像" required>
                <select
                  className="field font-mono"
                  value={createForm.imageName}
                  onChange={(event) => setCreateForm({ ...createForm, imageName: event.target.value, imageTagName: '' })}
                >
                  <option value="">{imagesQuery.isLoading ? '读取中…' : '选择镜像'}</option>
                  {imageOptions.map((image) => (
                    <option key={image} value={image}>
                      {image}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="镜像版本" required>
                <select
                  className="field font-mono"
                  value={createForm.imageTagName}
                  onChange={(event) => setCreateForm({ ...createForm, imageTagName: event.target.value })}
                >
                  <option value="">{tagsQuery.isLoading ? '读取中…' : '选择版本'}</option>
                  {tagOptions.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <section className="border-t border-line pt-3">
            <div className="label mb-2">资源与调度</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="CPU (m)" required hint="1000m = 1 核">
                <input
                  className="field font-mono"
                  value={createForm.cpuSize}
                  onChange={(event) => setCreateForm({ ...createForm, cpuSize: event.target.value })}
                />
              </Field>
              <Field label="内存 (MiB)" required>
                <input
                  className="field font-mono"
                  value={createForm.memory}
                  onChange={(event) => setCreateForm({ ...createForm, memory: event.target.value })}
                />
              </Field>
              <Field label="入站带宽" hint="Mbps">
                <input
                  className="field font-mono"
                  value={createForm.inBound}
                  onChange={(event) => setCreateForm({ ...createForm, inBound: event.target.value })}
                  placeholder="不限"
                />
              </Field>
              <Field label="出站带宽" hint="Mbps">
                <input
                  className="field font-mono"
                  value={createForm.outBound}
                  onChange={(event) => setCreateForm({ ...createForm, outBound: event.target.value })}
                  placeholder="不限"
                />
              </Field>
              <Field label="指定节点" className="col-span-2">
                <select
                  className="field"
                  value={createForm.bindNodeName}
                  onChange={(event) => setCreateForm({ ...createForm, bindNodeName: event.target.value })}
                >
                  <option value="">由调度器自动选择</option>
                  {nodeOptions.map((node) => (
                    <option key={node.objectMeta.name} value={node.objectMeta.name}>
                      {node.objectMeta.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <section className="border-t border-line pt-3">
            <div className="label mb-2">启动命令</div>
            <Field label="命令参数" hint="每行一个参数，对应容器 args；留空使用镜像默认启动命令">
              <textarea
                className="field font-mono text-[11px]"
                rows={3}
                value={createForm.args}
                onChange={(event) => setCreateForm({ ...createForm, args: event.target.value })}
                placeholder={'--port=8080\n--profile=prod'}
              />
            </Field>
          </section>

          <section className="border-t border-line pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="label">环境变量</span>
              <button
                onClick={() => setEnvRows((rows) => [...rows, { name: '', value: '' }])}
                className="mono flex items-center gap-1 text-[9px] tracking-widest text-mute transition-colors hover:text-signal"
              >
                <Plus size={10} /> 添加变量
              </button>
            </div>
            <div className="space-y-2">
              {envRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className="field h-9 flex-1 font-mono text-[11px]"
                    placeholder="KEY"
                    value={row.name}
                    onChange={(event) =>
                      setEnvRows((rows) => rows.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))
                    }
                  />
                  <span className="text-mute">=</span>
                  <input
                    className="field h-9 flex-[2] font-mono text-[11px]"
                    placeholder="value"
                    value={row.value}
                    onChange={(event) =>
                      setEnvRows((rows) => rows.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))
                    }
                  />
                  <button
                    onClick={() => setEnvRows((rows) => rows.filter((_, i) => i !== index))}
                    className="flex h-9 w-9 flex-none items-center justify-center border border-line-strong text-ink-3 transition-colors hover:border-signal hover:text-signal"
                    title="删除变量"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <div className="border border-line bg-paper-2/40 px-3 py-2">
            <div className="label mb-1">调度提示</div>
            <p className="text-[10.5px] leading-relaxed text-ink-3">
              创建后服务默认以 ClusterIP 暴露。端口映射、存储挂载与 HealthCheck 可在 Deployment 详情中继续调整。
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!restartTarget}
        onOpenChange={(open) => !open && setRestartTarget(null)}
        kicker="SERVICE / RESTART HISTORY"
        title={restartTarget ? `${serviceName(restartTarget)} 重启记录` : '重启记录'}
        description="平台记录容器重启次数与时间，用于判断服务是否处于反复崩溃状态。"
        width={560}
        footer={
          <Button size="sm" onClick={() => setRestartTarget(null)}>
            关闭
          </Button>
        }
      >
        <div className="max-h-[360px] divide-y divide-line/60 overflow-y-auto border border-line">
          {(restartQuery.data ?? []).map((item, index) => (
            <div key={`${item.podName}-${item.createTime}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate font-mono text-[10.5px] text-ink">{item.podName || '—'}</div>
                <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{formatDate(item.createTime)}</div>
              </div>
              <Badge tone={Number(item.restartCount) > 5 ? 'bad' : Number(item.restartCount) > 0 ? 'warn' : 'default'}>
                ×{item.restartCount ?? 0}
              </Badge>
            </div>
          ))}
          {(restartQuery.data ?? []).length === 0 && (
            <div className="px-3 py-10 text-center text-[11px] text-mute">
              {restartQuery.isLoading ? '正在读取重启记录…' : '暂无重启记录'}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!versionTarget}
        onOpenChange={(open) => !open && setVersionTarget(null)}
        kicker="SERVICE / IMAGE VERSION"
        title={versionTarget ? `${serviceName(versionTarget)} 版本切换` : '版本切换'}
        description="选择目标镜像与版本，平台将更新 Deployment 镜像并触发滚动更新。"
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setVersionTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={versionMutation.isPending}
              disabled={!versionImage.trim() || !versionTag.trim()}
              onClick={() => versionMutation.mutate()}
            >
              切换版本
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="镜像仓库" required hint="不含标签的镜像地址">
            <input
              className="field"
              value={versionImage}
              onChange={(event) => setVersionImage(event.target.value)}
              placeholder="如：gaop/nginx"
            />
          </Field>
          <Field label="镜像版本" required hint="从镜像仓库版本列表中选择，或手动输入">
            <div className="flex gap-2">
              <input
                className="field flex-1"
                value={versionTag}
                onChange={(event) => setVersionTag(event.target.value)}
                placeholder="如：alpine-arm64"
              />
              <select
                className="field w-[180px]"
                value=""
                onChange={(event) => {
                  if (event.target.value) setVersionTag(event.target.value)
                }}
              >
                <option value="">选择已有版本</option>
                {(versionTagsQuery.data?.list ?? []).map((tag) => (
                  <option key={tag.name} value={tag.name}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="滚动策略" required hint="先启动：新实例就绪后再停止旧实例；先停止：先停旧实例再启动新实例">
            <select className="field" value={versionStrategy} onChange={(event) => setVersionStrategy(event.target.value as '1' | '2')}>
              <option value="2">先停止（FIRST STOP）</option>
              <option value="1">先启动（FIRST START）</option>
            </select>
          </Field>
          <div className="mono border border-line bg-paper-2/40 px-3 py-2 text-[8.5px] leading-relaxed tracking-wider text-mute">
            切换后 Kubernetes 将按滚动更新策略替换容器实例；若镜像拉取失败，旧实例会保留。
          </div>
        </div>
      </Modal>

      <Modal
        open={!!monitorTarget}
        onOpenChange={(open) => !open && setMonitorTarget(null)}
        kicker="SERVICE / MONITORING"
        title={monitorTarget ? `${serviceName(monitorTarget)} 资源监控` : '服务监控'}
        description="按 Pod 展示 CPU、内存、网络与磁盘 IO 趋势。指标来自 Prometheus，采样间隔约 1 分钟。"
        width={920}
        footer={
          <Button size="sm" onClick={() => setMonitorTarget(null)}>
            关闭
          </Button>
        }
      >
        <div className="mb-4 flex w-fit border border-line">
          {[
            { key: 'ONE_HOURS' as const, label: '最近1小时' },
            { key: 'SIX_HOURS' as const, label: '最近6小时' },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => setMonitorRange(item.key)}
              className={cn(
                'mono px-3 py-1.5 text-[9px] tracking-widest transition-colors',
                monitorRange === item.key ? 'bg-signal text-white' : 'text-mute hover:text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {monitorQuery.isLoading ? (
          <div className="py-10 text-center text-[11px] text-mute">正在采集服务指标…</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <div className="label mb-2">CPU 使用量（m）</div>
              <AreaTrend series={monitorTrend(monitorQuery.data?.cpu, 1000)} height={170} unit=" m" />
            </div>
            <div>
              <div className="label mb-2">内存使用量（MB）</div>
              <AreaTrend series={monitorTrend(monitorQuery.data?.memory, 1 / 1024 / 1024)} height={170} unit=" MB" />
            </div>
            <div>
              <div className="label mb-2">网络吞吐（KB/s）</div>
              <AreaTrend
                series={[
                  ...monitorTrend(monitorQuery.data?.inboundNetwork, 1 / 1024).map((series) => ({
                    ...series,
                    name: `${series.name} IN`,
                  })),
                  ...monitorTrend(monitorQuery.data?.outboundNetwork, 1 / 1024).map((series) => ({
                    ...series,
                    name: `${series.name} OUT`,
                  })),
                ]}
                height={170}
                unit=" KB/s"
              />
            </div>
            <div>
              <div className="label mb-2">磁盘 IO（KB/s）</div>
              <AreaTrend
                series={[
                  ...monitorTrend(monitorQuery.data?.diskReadIo, 1 / 1024).map((series) => ({
                    ...series,
                    name: `${series.name} READ`,
                  })),
                  ...monitorTrend(monitorQuery.data?.diskWriteIo, 1 / 1024).map((series) => ({
                    ...series,
                    name: `${series.name} WRITE`,
                  })),
                ]}
                height={170}
                unit=" KB/s"
              />
            </div>
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
