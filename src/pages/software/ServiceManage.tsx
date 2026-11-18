import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Box, Filter, History, Info, Layers, Plus, RefreshCw, SquareTerminal, Trash2, Upload, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { ImageProject, NodesResponse, ServiceItem, ServiceList } from '@/types'
import { AreaTrend } from '@/components/charts'
import { DataTable, type Column } from '@/components/DataTable'
import {
  ActionMenu,
  Badge,
  Button,
  CopyText,
  Drawer,
  Field,
  KV,
  Modal,
  PageToolbar,
  Panel,
  Select,
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

function authOf(service: ServiceItem) {
  const auth = service.serviceAuth as { auth?: number } | null | undefined
  return auth?.auth === 1
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
        const value = Number(point.floatValue) * factor
        const date = point.timestamp ? new Date(point.timestamp) : null
        if (!date || Number.isNaN(date.getTime())) return { label: '', value, tip: '' }
        const pad = (n: number) => String(n).padStart(2, '0')
        const label = `${pad(date.getHours())}:${pad(date.getMinutes())}`
        const tip = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
        return { label, value, tip }
      }),
  }))
}

const CREATE_INPUT = 'field h-[32px] rounded-none border-[#3a6288] bg-[#182445] text-[14px]'
const CREATE_SELECT = 'h-[32px] rounded-none border-[#3a6288] bg-[#182445] text-[14px]'

const RESOURCE_PRESETS = [
  { key: '1X', memory: '128M 内存', cpu: '0.1-0.5CPU', memoryMin: '100', memoryMax: '128', cpuMin: '0.1', cpuMax: '0.5' },
  { key: '4X', memory: '1GB 内存', cpu: '0.4-1CPU', memoryMin: '800', memoryMax: '1024', cpuMin: '0.4', cpuMax: '1' },
  { key: '8X', memory: '2GB 内存', cpu: '0.8-1CPU', memoryMin: '1600', memoryMax: '2048', cpuMin: '0.8', cpuMax: '1' },
  { key: '16X', memory: '4GB 内存', cpu: '1CPU', memoryMin: '3200', memoryMax: '4096', cpuMin: '1', cpuMax: '1' },
  { key: '32X', memory: '8GB 内存', cpu: '2CPU', memoryMin: '6400', memoryMax: '8192', cpuMin: '2', cpuMax: '2' },
]

interface CreateFormState {
  serviceName: string
  nameUs: string
  nameFr: string
  serviceKey: string
  serviceType: '后台服务' | '前台服务'
  serverKeys: string[]
  projectName: string
  imageName: string
  imageTagName: string
  priority: string
  arch: '1' | '2'
  gpuCount: string
  preset: string
  memoryMin: string
  memoryMax: string
  cpuMin: string
  cpuMax: string
  ports: Array<{ port: string; protocol: string }>
  files: Array<{ mountPath: string; configMap: string; files: string }>
  entryMode: 'default' | 'custom'
  entryPoint: string
  commandMode: 'default' | 'custom'
  command: string
  nodePort: '0' | '1'
  scheduleMode: 'default' | 'host'
  hostName: string
}

const emptyCreateForm: CreateFormState = {
  serviceName: '',
  nameUs: '',
  nameFr: '',
  serviceKey: '',
  serviceType: '后台服务',
  serverKeys: [],
  projectName: 'gaop',
  imageName: '',
  imageTagName: '',
  priority: '',
  arch: '1',
  gpuCount: '1',
  preset: '1X',
  memoryMin: '100',
  memoryMax: '100',
  cpuMin: '0.5',
  cpuMax: '0.5',
  ports: [],
  files: [],
  entryMode: 'default',
  entryPoint: '',
  commandMode: 'default',
  command: '',
  nodePort: '0',
  scheduleMode: 'default',
  hostName: '',
}

function CreateField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-[112px] flex-none pt-[7px] text-[14px] leading-4 text-white">
        {required && <span className="mr-1 text-[#ff5c5c]">*</span>}
        {label}：
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function RadioDot({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onChange} className="inline-flex items-center gap-1.5 text-[14px] text-white">
      <span
        className={cn(
          'flex h-[14px] w-[14px] flex-none items-center justify-center rounded-full border transition-colors',
          checked ? 'border-signal' : 'border-[#5b7a99]',
        )}
      >
        {checked && <span className="h-[6px] w-[6px] rounded-full bg-signal" />}
      </span>
      {children}
    </button>
  )
}

function MultiSelectBox({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string[]
  options: string[]
  onChange: (value: string[]) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const list = options.filter(
    (option) => !value.includes(option) && option.toLowerCase().includes(keyword.toLowerCase()),
  )

  return (
    <div ref={ref} className="relative">
      <div className={cn(CREATE_INPUT, 'flex min-h-[32px] flex-wrap items-center gap-1 py-[2px]')}>
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 border border-[#3a6288] bg-[#223a5e] px-1.5 py-[1px] text-[11px] text-white"
          >
            {item}
            <button
              type="button"
              onClick={() => onChange(value.filter((entry) => entry !== item))}
              className="text-white/70 transition-colors hover:text-white"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={value.length === 0 ? placeholder : ''}
          className="h-5 min-w-[80px] flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#5d7892]"
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-0.5 max-h-[180px] overflow-auto border border-[#3a6288] bg-[#16293c] py-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
          {list.length > 0 ? (
            list.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange([...value, option])
                  setKeyword('')
                }}
                className="block w-full px-2 py-1.5 text-left text-[12px] text-ink-3 transition-colors hover:bg-line/40 hover:text-ink"
              >
                {option}
              </button>
            ))
          ) : (
            <div className="px-2 py-1.5 text-[12px] text-mute">无匹配项</div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ServiceManagePage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
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
  const [consoleState, setConsoleState] = useState<{
    service: string
    mode: 'logs' | 'terminal'
    history?: boolean
  } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm)
  const [envRows, setEnvRows] = useState<Array<{ name: string; type: string; value: string }>>([])

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
  const priorityQuery = useQuery({
    queryKey: ['service-create-priority'],
    queryFn: () =>
      api.get<{ items?: Array<{ metadata?: { name?: string } }> }>('/k8s/apis/scheduling.k8s.io/v1/priorityclasses'),
    enabled: createOpen,
  })
  const serviceKeysQuery = useQuery({
    queryKey: ['service-create-keys'],
    queryFn: () => api.get<string[]>('/v1/pub/serviceKeyList', { name: '', serviceName: '' }),
    enabled: createOpen,
  })
  const configMapsQuery = useQuery({
    queryKey: ['service-create-configmaps'],
    queryFn: () => api.get<{ items?: Array<{ metadata?: { name?: string } }> }>('/v1/config_map'),
    enabled: createOpen,
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
  const priorityOptions = useMemo(() => {
    const names = (priorityQuery.data?.items ?? [])
      .map((item) => item.metadata?.name || '')
      .filter(Boolean)
    return [{ value: '', label: '无' }, ...names.map((name) => ({ value: name, label: name }))]
  }, [priorityQuery.data])
  const serviceKeyOptions = useMemo(() => serviceKeysQuery.data ?? [], [serviceKeysQuery.data])
  const configMapOptions = useMemo(
    () =>
      (configMapsQuery.data?.items ?? [])
        .map((item) => item.metadata?.name || '')
        .filter(Boolean)
        .map((name) => ({ value: name, label: name })),
    [configMapsQuery.data],
  )

  useEffect(() => {
    if (!createOpen) return
    if (!projectOptions.includes(createForm.projectName)) {
      setCreateForm((prev) => ({ ...prev, projectName: projectOptions[0] }))
    }
  }, [createOpen, projectOptions, createForm.projectName])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return services
    return services.filter((service) => {
      const name = serviceName(service).toLowerCase()
      return (
        name.includes(q) ||
        imageOf(service).toLowerCase().includes(q) ||
        (service.softwareNameList ?? []).some((item) => item.toLowerCase().includes(q))
      )
    })
  }, [services, keyword])

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
      if (!createForm.serviceKey.trim()) throw new Error('服务标识不能为空')
      if (!/^[a-z][a-z0-9-]{1,43}[a-z0-9]$/.test(createForm.serviceKey.trim())) {
        throw new Error('服务标识只能包含小写字母、数字、中划线，且以小写字母开头、字母或数字结尾（3~45 位）')
      }
      if (!createForm.imageName || !createForm.imageTagName) throw new Error('请选择镜像与版本')
      const args = createForm.commandMode === 'custom' && createForm.command.trim() ? [{ arg: createForm.command.trim() }] : undefined
      const env = envRows
        .filter((item) => item.name.trim())
        .map((item) => ({ name: item.name.trim(), value: item.value }))
      return api.post('/v1/pub/createService', {
        serviceName: createForm.serviceKey.trim(),
        serviceLabel: createForm.serviceName.trim(),
        nameUs: createForm.nameUs.trim() || undefined,
        nameFr: createForm.nameFr.trim() || undefined,
        serviceType: createForm.serviceType === '前台服务' ? 'business' : 'normal',
        projectName: createForm.projectName,
        imageName: createForm.imageName,
        imageTagName: createForm.imageTagName,
        memory: createForm.memoryMax || '100',
        cpuSize: String(Math.round(Number(createForm.cpuMin || '0.5') * 1000)),
        bindNodeName: createForm.scheduleMode === 'host' ? createForm.hostName || undefined : undefined,
        args,
        env: env.length ? env : undefined,
      })
    },
    onSuccess: () => {
      toast.success('服务创建任务已下发', '可在列表中查看启动进度')
      setCreateOpen(false)
      setCreateForm({ ...emptyCreateForm })
      setEnvRows([])
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

  const columns: Array<Column<ServiceItem>> = [
    {
      key: 'index',
      header: '序号',
      width: 56,
      align: 'center',
      cell: (_row, index) => <span className="mono text-[11.5px] text-ink-3">{index + 1}</span>,
    },
    {
      key: 'name',
      header: '服务名称',
      sortValue: (row) => serviceName(row),
      cell: (row) => (
        <button
          onClick={() => setDetail(row)}
          className="block max-w-[180px] truncate text-left text-[12px] text-ink hover:text-signal hover:underline"
        >
          {serviceName(row)}
        </button>
      ),
    },
    {
      key: 'key',
      header: '服务标识',
      cell: (row) => <span className="mono text-[11.5px] text-ink-3">{row.nameUs || row.nameFr || '—'}</span>,
    },
    {
      key: 'serviceType',
      header: '服务类型',
      cell: (row) => {
        const appType = row.service?.metadata?.labels?.['system/appType']
        return (
          <span className="text-[12px] text-ink-3">
            {appType === 'business' ? '前台服务' : appType ? '后台服务' : '—'}
          </span>
        )
      },
    },
    {
      key: 'software',
      header: '所属应用',
      cell: (row) => {
        const apps = (row.softwareNameList ?? []).filter(Boolean)
        return apps.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {apps.map((app) => (
              <Badge key={app} tone="ok">
                {app}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-[12px] text-mute">暂无关联应用</span>
        )
      },
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => {
        const status = statusOf(row)
        const partial = status.label === 'RUNNING' && status.ready < status.desired
        const text =
          status.label === 'PENDING'
            ? '启动中'
            : partial
              ? '滚动发布中'
              : status.label === 'RUNNING'
                ? '运行中'
                : '已停止'
        const tone =
          status.label === 'PENDING'
            ? 'text-warn'
            : partial
              ? 'text-[#4aa3f0]'
              : status.label === 'RUNNING'
                ? 'text-ok'
                : 'text-mute'
        return (
          <div className="leading-[1.5]">
            <div className={cn('flex items-center gap-1 text-[12px]', tone)}>
              {text}
              <Info size={10} />
            </div>
            <div className="text-[11.5px] text-ink-3">
              {status.ready}/{status.desired}部分运行
            </div>
            <div className="flex items-center gap-1 text-[11.5px] text-ink-3">
              已重启 {row.restartCount ?? 0} 次
              <Info size={10} />
            </div>
          </div>
        )
      },
    },
    {
      key: 'image',
      header: '镜像',
      cell: (row) => (
        <span className="block max-w-[200px] truncate font-mono text-[11px] text-ink-3" title={imageOf(row)}>
          {imageOf(row)}
        </span>
      ),
    },
    {
      key: 'auth',
      header: (
        <span className="inline-flex items-center gap-1">
          授权状态 <Filter size={10} />
        </span>
      ),
      sortValue: (row) => (authOf(row) ? 1 : 0),
      cell: (row) => {
        const auth = row.serviceAuth as { auth?: number } | null | undefined
        if (!auth) return <span className="text-[12px] text-ink-3">—</span>
        return (
          <span className={cn('text-[12px]', auth.auth === 1 ? 'text-ok' : 'text-ink-3')}>
            {auth.auth === 1 ? '已授权' : '未授权'}
          </span>
        )
      },
    },
    {
      key: 'updatedAt',
      header: '版本更新时间',
      sortValue: (row) => row.deployment?.metadata?.creationTimestamp || '',
      cell: (row) => (
        <span className="mono whitespace-nowrap text-[11px] text-ink-3">
          {formatDate(row.deployment?.metadata?.creationTimestamp, true)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: '创建时间',
      sortValue: (row) => row.service?.metadata?.creationTimestamp || '',
      cell: (row) => (
        <span className="mono whitespace-nowrap text-[11px] text-ink-3">
          {formatDate(row.service?.metadata?.creationTimestamp, true)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      headerAlign: 'center',
      fixed: 'right',
      cell: (row) => {
        const status = statusOf(row)
        const running = status.label === 'RUNNING' || status.label === 'PENDING'
        return (
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
              className={cn(
                'transition-colors',
                running ? 'text-[#ff7b7b] hover:text-[#ff9a9a]' : 'text-[#4aa3f0] hover:text-[#7cc4ff]',
              )}
              onClick={() =>
                actionMutation.mutate({
                  path: running ? '/v1/service/stop' : '/v1/service/start',
                  names: [serviceName(row)],
                })
              }
            >
              {running ? '停止' : '启动'}
            </button>
            <button
              className="text-[#ff7b7b] transition-colors hover:text-[#ff9a9a]"
              onClick={() => batch('/v1/service', [serviceName(row)], '删除', true)}
            >
              删除
            </button>
            <ActionMenu
              triggerText="更多"
              items={[
                { label: '版本切换', onSelect: () => openVersion(row) },
                {
                  label: '历史日志',
                  onSelect: () => setConsoleState({ service: serviceName(row), mode: 'logs', history: true }),
                },
                { label: '实时日志', onSelect: () => setConsoleState({ service: serviceName(row), mode: 'logs' }) },
                { label: '终端登录', onSelect: () => setConsoleState({ service: serviceName(row), mode: 'terminal' }) },
                { label: '监控', onSelect: () => setMonitorTarget(row) },
                {
                  label: '重启',
                  danger: true,
                  onSelect: () => actionMutation.mutate({ path: '/v1/service/reStart', names: [serviceName(row)] }),
                },
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
        search={{
          value: keyword,
          onChange: setKeyword,
          placeholder: '请输入服务名/服务标识搜索',
          width: 240,
          onSubmit: () => query.refetch(),
        }}
      >
        <Button size="sm" variant="signal" onClick={() => setCreateOpen(true)}>
          <Plus size={11} /> 创建服务
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
        <Button
          size="sm"
          disabled={selected.length === 0}
          onClick={() => batch('/v1/service', selected, '删除服务', true)}
        >
          <Trash2 size={11} /> 删除服务
        </Button>
        <div className="flex h-[30px] items-center border border-line-strong">
          <ActionMenu
            items={[
              {
                label: '批量启动',
                disabled: selected.length === 0,
                onSelect: () => batch('/v1/service/start', selected, '批量启动'),
              },
              {
                label: '批量停止',
                disabled: selected.length === 0,
                onSelect: () => batch('/v1/service/stop', selected, '批量停止'),
              },
              {
                label: '批量重启',
                disabled: selected.length === 0,
                onSelect: () => batch('/v1/service/reStart', selected, '批量重启'),
              },
            ]}
          />
        </div>
      </PageToolbar>

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

      <Drawer
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
      </Drawer>

      <Drawer
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
      </Drawer>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="创建服务"
        width={1000}
        titleAlign="center"
        headerClassName="h-[30px] border-b-0 bg-[#28538f] px-2.5 py-0"
        bodyClassName="space-y-[10px] px-5 py-5"
      >
        <CreateField label="服务名称" required>
          <input
            className={CREATE_INPUT}
            value={createForm.serviceName}
            onChange={(event) => setCreateForm({ ...createForm, serviceName: event.target.value })}
          />
        </CreateField>
        <CreateField label="英文名称">
          <input
            className={CREATE_INPUT}
            value={createForm.nameUs}
            onChange={(event) => setCreateForm({ ...createForm, nameUs: event.target.value })}
          />
        </CreateField>
        <CreateField label="法文名称">
          <input
            className={CREATE_INPUT}
            value={createForm.nameFr}
            onChange={(event) => setCreateForm({ ...createForm, nameFr: event.target.value })}
          />
        </CreateField>
        <CreateField label="服务标识" required>
          <input
            className={cn(CREATE_INPUT, 'font-mono')}
            value={createForm.serviceKey}
            onChange={(event) => setCreateForm({ ...createForm, serviceKey: event.target.value })}
            placeholder="小写字母、数字、中划线，字母开头"
          />
        </CreateField>
        <CreateField label="服务类型">
          <div className="flex h-[32px] items-center gap-5">
            <RadioDot
              checked={createForm.serviceType === '后台服务'}
              onChange={() => setCreateForm({ ...createForm, serviceType: '后台服务' })}
            >
              后台服务
            </RadioDot>
            <RadioDot
              checked={createForm.serviceType === '前台服务'}
              onChange={() => setCreateForm({ ...createForm, serviceType: '前台服务' })}
            >
              前台服务
            </RadioDot>
          </div>
        </CreateField>
        <CreateField label="所属可操作服务">
          <MultiSelectBox
            value={createForm.serverKeys}
            options={serviceKeyOptions}
            onChange={(serverKeys) => setCreateForm({ ...createForm, serverKeys })}
          />
        </CreateField>
        <CreateField label="镜像选择" required>
          <div className="flex items-center gap-2">
            <Select
              className={cn(CREATE_SELECT, 'min-w-0 flex-1 font-mono')}
              placeholder={imagesQuery.isLoading ? '读取中…' : '请选择包'}
              value={createForm.imageName}
              options={imageOptions.map((image) => ({ value: image, label: image }))}
              onChange={(value) => setCreateForm({ ...createForm, imageName: value, imageTagName: '' })}
            />
            <Select
              className={cn(CREATE_SELECT, 'w-[160px] flex-none font-mono')}
              placeholder={tagsQuery.isLoading ? '读取中…' : '请选择镜像版本'}
              value={createForm.imageTagName}
              options={tagOptions.map((tag) => ({ value: tag, label: tag }))}
              onChange={(value) => setCreateForm({ ...createForm, imageTagName: value })}
            />
          </div>
        </CreateField>
        <CreateField label="资源优先级">
          <Select
            className={CREATE_SELECT}
            value={createForm.priority}
            options={priorityOptions}
            onChange={(value) => setCreateForm({ ...createForm, priority: value })}
          />
        </CreateField>

        <CreateField label="环境变量">
          <div className="flex h-8 items-center px-2 text-[14px] text-[#c6dbef]">
            <span className="w-[25%]">变量名</span>
            <span className="w-[25%]">类型</span>
            <span className="flex-1">变量值</span>
            <span className="w-[48px]">操作</span>
          </div>
          {envRows.map((row, index) => (
            <div key={index} className="mb-1 flex items-center gap-1.5">
              <input
                className={cn(CREATE_INPUT, 'h-[30px] w-[25%] flex-none')}
                placeholder="变量名"
                value={row.name}
                onChange={(event) =>
                  setEnvRows((rows) => rows.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))
                }
              />
              <Select
                className={cn(CREATE_SELECT, 'h-[30px] w-[25%] flex-none')}
                value={row.type}
                options={[
                  { value: '普通变量', label: '普通变量' },
                  { value: 'Pod类型', label: 'Pod类型' },
                ]}
                onChange={(value) =>
                  setEnvRows((rows) => rows.map((item, i) => (i === index ? { ...item, type: value } : item)))
                }
              />
              <input
                className={cn(CREATE_INPUT, 'h-[30px] min-w-0 flex-1')}
                placeholder="变量值"
                value={row.value}
                onChange={(event) =>
                  setEnvRows((rows) => rows.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))
                }
              />
              <button
                type="button"
                title="删除"
                onClick={() => setEnvRows((rows) => rows.filter((_, i) => i !== index))}
                className="flex h-[30px] w-[48px] flex-none items-center justify-center text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setEnvRows((rows) => [...rows, { name: '', type: '普通变量', value: '' }])}
            className="mt-0.5 text-[14px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
          >
            添加环境变量
          </button>
        </CreateField>

        <CreateField label="资源分配">
          <div className="flex h-[30px] items-center gap-5">
            <RadioDot checked={createForm.arch === '1'} onChange={() => setCreateForm({ ...createForm, arch: '1' })}>
              X86计算
            </RadioDot>
            <RadioDot checked={createForm.arch === '2'} onChange={() => setCreateForm({ ...createForm, arch: '2' })}>
              高性能计算GPU
            </RadioDot>
          </div>
          {createForm.arch === '2' && (
            <div className="mb-2 flex items-center gap-2 text-[12px] text-[#c6dbef]">
              <span>GPU数量</span>
              <input
                className={cn(CREATE_INPUT, 'h-[26px] w-[70px] px-1 text-center')}
                value={createForm.gpuCount}
                onChange={(event) => setCreateForm({ ...createForm, gpuCount: event.target.value })}
              />
              <span>颗GPU</span>
            </div>
          )}
          <div className="flex flex-wrap items-stretch gap-2 py-1">
            {RESOURCE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() =>
                  setCreateForm({
                    ...createForm,
                    preset: preset.key,
                    memoryMin: preset.memoryMin,
                    memoryMax: preset.memoryMax,
                    cpuMin: preset.cpuMin,
                    cpuMax: preset.cpuMax,
                  })
                }
                className={cn(
                  'flex w-[62px] flex-col items-start gap-0.5 border px-1 py-1 text-left transition-colors',
                  createForm.preset === preset.key ? 'border-signal' : 'border-[#3a6288] hover:border-[#5b8ab8]',
                )}
              >
                <span className="text-[12px] font-semibold leading-4 text-white">{preset.key}</span>
                <span className="whitespace-nowrap text-[10px] leading-4 text-[#4aa3f0]">{preset.memory}</span>
                <span className="whitespace-nowrap text-[9px] leading-4 text-[#9fb8ce]">{preset.cpu}</span>
              </button>
            ))}
            <div
              className={cn(
                'flex w-[156px] flex-col gap-1 border px-2 py-1.5',
                createForm.preset === 'custom' ? 'border-signal' : 'border-[#3a6288]',
              )}
            >
              <span className="text-[12px] leading-4 text-white">自定义</span>
              <div className="flex items-center gap-1">
                <input
                  className={cn(CREATE_INPUT, 'h-[22px] w-[38px] px-1 text-center text-[11px]')}
                  value={createForm.memoryMin}
                  onFocus={() => setCreateForm({ ...createForm, preset: 'custom' })}
                  onChange={(event) => setCreateForm({ ...createForm, preset: 'custom', memoryMin: event.target.value })}
                />
                <span className="text-[11px] text-[#9fb8ce]">~</span>
                <input
                  className={cn(CREATE_INPUT, 'h-[22px] w-[38px] px-1 text-center text-[11px]')}
                  value={createForm.memoryMax}
                  onFocus={() => setCreateForm({ ...createForm, preset: 'custom' })}
                  onChange={(event) => setCreateForm({ ...createForm, preset: 'custom', memoryMax: event.target.value })}
                />
                <span className="text-[10px] text-[#c6dbef]">MB内存</span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  className={cn(CREATE_INPUT, 'h-[22px] w-[38px] px-1 text-center text-[11px]')}
                  value={createForm.cpuMin}
                  onFocus={() => setCreateForm({ ...createForm, preset: 'custom' })}
                  onChange={(event) => setCreateForm({ ...createForm, preset: 'custom', cpuMin: event.target.value })}
                />
                <span className="text-[11px] text-[#9fb8ce]">~</span>
                <input
                  className={cn(CREATE_INPUT, 'h-[22px] w-[38px] px-1 text-center text-[11px]')}
                  value={createForm.cpuMax}
                  onFocus={() => setCreateForm({ ...createForm, preset: 'custom' })}
                  onChange={(event) => setCreateForm({ ...createForm, preset: 'custom', cpuMax: event.target.value })}
                />
                <span className="text-[10px] text-[#c6dbef]">核CPU</span>
              </div>
            </div>
          </div>
        </CreateField>

        <CreateField label="访问方式">
          <div className="flex h-8 items-center px-2 text-[14px] text-[#c6dbef]">
            <span className="flex-1">容器端口</span>
            <span className="flex-1">协议</span>
            <span className="w-[48px]">操作</span>
          </div>
          {createForm.ports.map((row, index) => (
            <div key={index} className="mb-1 flex items-center gap-1.5">
              <input
                className={cn(CREATE_INPUT, 'h-[30px] min-w-0 flex-1')}
                placeholder="请输入端口号"
                value={row.port}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    ports: prev.ports.map((item, i) => (i === index ? { ...item, port: event.target.value } : item)),
                  }))
                }
              />
              <Select
                className={cn(CREATE_SELECT, 'h-[30px] min-w-0 flex-1')}
                value={row.protocol}
                options={[
                  { value: 'TCP', label: 'TCP' },
                  { value: 'UDP', label: 'UDP' },
                ]}
                onChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    ports: prev.ports.map((item, i) => (i === index ? { ...item, protocol: value } : item)),
                  }))
                }
              />
              <button
                type="button"
                title="删除"
                onClick={() => setCreateForm((prev) => ({ ...prev, ports: prev.ports.filter((_, i) => i !== index) }))}
                className="flex h-[30px] w-[48px] flex-none items-center justify-center text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setCreateForm((prev) => ({ ...prev, ports: [...prev.ports, { port: '', protocol: 'TCP' }] }))
            }
            className="mt-0.5 text-[14px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
          >
            添加映射端口
          </button>
        </CreateField>

        <CreateField label="进入点">
          <div className="flex h-[32px] items-center gap-5">
            <RadioDot
              checked={createForm.entryMode === 'default'}
              onChange={() => setCreateForm({ ...createForm, entryMode: 'default' })}
            >
              镜像默认
            </RadioDot>
            <RadioDot
              checked={createForm.entryMode === 'custom'}
              onChange={() => setCreateForm({ ...createForm, entryMode: 'custom' })}
            >
              自定义
            </RadioDot>
          </div>
          <Select
            className={cn(CREATE_SELECT, 'mt-2 w-[260px]')}
            value="镜像默认"
            options={[{ value: '镜像默认', label: '镜像默认' }]}
            onChange={() => undefined}
          />
        </CreateField>

        <CreateField label="启动命令">
          <div className="flex h-[32px] items-center gap-5">
            <RadioDot
              checked={createForm.commandMode === 'default'}
              onChange={() => setCreateForm({ ...createForm, commandMode: 'default' })}
            >
              镜像默认
            </RadioDot>
            <RadioDot
              checked={createForm.commandMode === 'custom'}
              onChange={() => setCreateForm({ ...createForm, commandMode: 'custom' })}
            >
              自定义
            </RadioDot>
          </div>
          {createForm.commandMode === 'custom' ? (
            <input
              className={cn(CREATE_INPUT, 'mt-2 w-[360px] font-mono')}
              placeholder="请输入启动命令"
              value={createForm.command}
              onChange={(event) => setCreateForm({ ...createForm, command: event.target.value })}
            />
          ) : (
            <Select
              className={cn(CREATE_SELECT, 'mt-2 w-[260px]')}
              value="镜像默认"
              options={[{ value: '镜像默认', label: '镜像默认' }]}
              onChange={() => undefined}
            />
          )}
        </CreateField>

        <CreateField label="文件映射">
          <div className="flex h-8 items-center px-2 text-[14px] text-[#c6dbef]">
            <span className="flex-1">挂载目录</span>
            <span className="w-[25%]">配置组</span>
            <span className="w-[25%]">配置文件</span>
            <span className="w-[48px]">操作</span>
          </div>
          {createForm.files.map((row, index) => (
            <div key={index} className="mb-1 flex items-center gap-1.5">
              <input
                className={cn(CREATE_INPUT, 'h-[30px] min-w-0 flex-1')}
                placeholder="挂载目录"
                value={row.mountPath}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    files: prev.files.map((item, i) =>
                      i === index ? { ...item, mountPath: event.target.value } : item,
                    ),
                  }))
                }
              />
              <Select
                className={cn(CREATE_SELECT, 'h-[30px] w-[25%] flex-none')}
                value={row.configMap}
                options={configMapOptions}
                placeholder="请选择配置组"
                searchable
                onChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    files: prev.files.map((item, i) => (i === index ? { ...item, configMap: value } : item)),
                  }))
                }
              />
              <input
                className={cn(CREATE_INPUT, 'h-[30px] w-[25%] flex-none')}
                placeholder="配置文件"
                value={row.files}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    files: prev.files.map((item, i) => (i === index ? { ...item, files: event.target.value } : item)),
                  }))
                }
              />
              <button
                type="button"
                title="删除"
                onClick={() => setCreateForm((prev) => ({ ...prev, files: prev.files.filter((_, i) => i !== index) }))}
                className="flex h-[30px] w-[48px] flex-none items-center justify-center text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setCreateForm((prev) => ({
                ...prev,
                files: [...prev.files, { mountPath: '', configMap: '', files: '' }],
              }))
            }
            className="mt-0.5 text-[14px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
          >
            添加配置目录
          </button>
        </CreateField>

        <CreateField label="NodePort">
          <div className="flex h-[32px] items-center gap-5">
            <RadioDot checked={createForm.nodePort === '0'} onChange={() => setCreateForm({ ...createForm, nodePort: '0' })}>
              禁用
            </RadioDot>
            <RadioDot checked={createForm.nodePort === '1'} onChange={() => setCreateForm({ ...createForm, nodePort: '1' })}>
              启用
            </RadioDot>
          </div>
        </CreateField>

        <CreateField label="节点调度">
          <div className="flex h-[32px] items-center gap-5">
            <RadioDot
              checked={createForm.scheduleMode === 'default'}
              onChange={() => setCreateForm({ ...createForm, scheduleMode: 'default' })}
            >
              系统默认调度
            </RadioDot>
            <RadioDot
              checked={createForm.scheduleMode === 'host'}
              onChange={() => setCreateForm({ ...createForm, scheduleMode: 'host' })}
            >
              指定主机名及IP上运行
            </RadioDot>
          </div>
          {createForm.scheduleMode === 'host' && (
            <Select
              className={cn(CREATE_SELECT, 'mt-2 w-[320px]')}
              placeholder="请选择主机"
              value={createForm.hostName}
              options={nodeOptions.map((node) => ({ value: node.objectMeta.name, label: node.objectMeta.name }))}
              onChange={(value) => setCreateForm({ ...createForm, hostName: value })}
            />
          )}
        </CreateField>

        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="mt-4 h-[30px] w-full bg-[#1670c2] text-[13px] text-white transition-colors hover:bg-[#1a82dd] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {createMutation.isPending ? '提交中…' : '提交'}
        </button>
      </Modal>

      <Drawer
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
      </Drawer>

      <Drawer
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
              <Select
                className="w-[180px]"
                placeholder="选择已有版本"
                value=""
                options={(versionTagsQuery.data?.list ?? []).map((tag) => ({
                  value: tag.name,
                  label: tag.name,
                }))}
                onChange={(value) => {
                  if (value) setVersionTag(value)
                }}
              />
            </div>
          </Field>
          <Field label="滚动策略" required hint="先启动：新实例就绪后再停止旧实例；先停止：先停旧实例再启动新实例">
            <Select
              value={versionStrategy}
              options={[
                { value: '2', label: '先停止（FIRST STOP）' },
                { value: '1', label: '先启动（FIRST START）' },
              ]}
              onChange={(value) => setVersionStrategy(value as '1' | '2')}
            />
          </Field>
          <div className="mono border border-line bg-paper-2/40 px-3 py-2 text-[8.5px] leading-relaxed tracking-wider text-mute">
            切换后 Kubernetes 将按滚动更新策略替换容器实例；若镜像拉取失败，旧实例会保留。
          </div>
        </div>
      </Drawer>

      <Drawer
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
                    name: `${series.name}-入站`,
                  })),
                  ...monitorTrend(monitorQuery.data?.outboundNetwork, 1 / 1024).map((series) => ({
                    ...series,
                    name: `${series.name}-出站`,
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
                    name: `${series.name}-读`,
                  })),
                  ...monitorTrend(monitorQuery.data?.diskWriteIo, 1 / 1024).map((series) => ({
                    ...series,
                    name: `${series.name}-写`,
                  })),
                ]}
                height={170}
                unit=" KB/s"
              />
            </div>
          </div>
        )}
      </Drawer>

      <Suspense fallback={null}>
        <ServiceConsole
          open={!!consoleState}
          serviceName={consoleState?.service || ''}
          initialMode={consoleState?.mode || 'logs'}
          initialPaused={!!consoleState?.history}
          onClose={() => setConsoleState(null)}
        />
      </Suspense>
    </div>
  )
}
