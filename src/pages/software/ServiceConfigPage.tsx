import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Download, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import type { ProbeConfig, ServiceItem, ServiceList } from '@/types'
import { Button, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface ConfigMapItem {
  metadata?: { name?: string; creationTimestamp?: string }
  data?: Record<string, string> | null
}

interface EnvRow {
  name: string
  type: 'text' | 'podType'
  value: string
}

const POD_FIELD_OPTIONS = [
  { value: 'NodeName', label: 'NodeName' },
  { value: 'PodName', label: 'PodName' },
  { value: 'NameSpace', label: 'NameSpace' },
  { value: 'NodeIP', label: 'NodeIP' },
  { value: 'PodIP', label: 'PodIP' },
  { value: 'ServiceAccountName', label: 'ServiceAccountName' },
]

const POD_FIELD_PATHS: Record<string, string> = {
  NodeName: 'spec.nodeName',
  PodName: 'metadata.name',
  NameSpace: 'metadata.namespace',
  NodeIP: 'status.hostIP',
  PodIP: 'status.podIP',
  ServiceAccountName: 'spec.serviceAccountName',
}

const POD_FIELD_BY_PATH: Record<string, string> = Object.fromEntries(
  Object.entries(POD_FIELD_PATHS).map(([label, path]) => [path, label]),
)

interface PortRow {
  port: string
  protocol: string
  nodePort: string
}

interface ProbeForm {
  type: number
  path: string
  port: string
  initialDelaySeconds: string
  timeoutSeconds: string
  periodSeconds: string
  successThreshold: string
  failureThreshold: string
}

interface VolumeRow {
  hostPath: string
  podPath: string
  readOnly: boolean
}

interface ConfigMapRow {
  dir: string
  configmap: string
  keys: string[]
}

interface NodeAffinityRow {
  mode: string
  host: string
  operator: string
  value: string
}

interface ServiceAffinityRow {
  mode: string
  service: string
  operator: string
  value: string
}

const NAV = [
  { id: 'BaseForm', label: '基本信息' },
  { id: 'EnvValue', label: '环境变量' },
  { id: 'ResourceSetting', label: '资源配置' },
  { id: 'AccessMethod', label: '访问方式' },
  { id: 'ServiceSearchSetting', label: '服务发现' },
  { id: 'AssistSetting', label: '辅助设置' },
  { id: 'SerConfigSetting', label: '服务配置' },
  { id: 'HealthCheck', label: '健康检查' },
  { id: 'NodeSelectorSetting', label: '节点调度' },
] as const

const emptyProbe: ProbeForm = {
  type: 0,
  path: '',
  port: '',
  initialDelaySeconds: '0',
  timeoutSeconds: '1',
  periodSeconds: '10',
  successThreshold: '1',
  failureThreshold: '3',
}

function probeToForm(probe?: ProbeConfig | null): ProbeForm {
  if (!probe) return { ...emptyProbe }
  const type = probe.httpGet ? 1 : probe.tcpSocket ? 2 : 0
  return {
    type,
    path: probe.httpGet?.path || '',
    port: String(probe.httpGet?.port ?? probe.tcpSocket?.port ?? ''),
    initialDelaySeconds: String(probe.initialDelaySeconds ?? 0),
    timeoutSeconds: String(probe.timeoutSeconds ?? 1),
    periodSeconds: String(probe.periodSeconds ?? 10),
    successThreshold: String(probe.successThreshold ?? 1),
    failureThreshold: String(probe.failureThreshold ?? 3),
  }
}

function formToProbe(form: ProbeForm) {
  return {
    type: form.type,
    path: form.path,
    port: form.port ? Number(form.port) : undefined,
    initialDelaySeconds: Number(form.initialDelaySeconds) || 0,
    timeoutSeconds: Number(form.timeoutSeconds) || 1,
    periodSeconds: Number(form.periodSeconds) || 10,
    successThreshold: Number(form.successThreshold) || 1,
    failureThreshold: Number(form.failureThreshold) || 3,
  }
}

function serviceNameOf(service: ServiceItem) {
  return service.nameUs || service.nameFr
}

function affinityRowsFrom(affinity: Record<string, unknown> | null | undefined) {
  const aff = (affinity ?? {}) as {
    nodeAffinity?: {
      preferredDuringSchedulingIgnoredDuringExecution?: Array<{ preference?: { matchExpressions?: Array<Record<string, unknown>> } }>
      requiredDuringSchedulingIgnoredDuringExecution?: { nodeSelectorTerms?: Array<{ matchExpressions?: Array<Record<string, unknown>> }> }
    }
    podAffinity?: {
      preferredDuringSchedulingIgnoredDuringExecution?: Array<{ podAffinityTerm?: { labelSelector?: { matchExpressions?: Array<Record<string, unknown>> } } }>
      requiredDuringSchedulingIgnoredDuringExecution?: Array<{ labelSelector?: { matchExpressions?: Array<Record<string, unknown>> } }>
    }
    podAntiAffinity?: {
      preferredDuringSchedulingIgnoredDuringExecution?: Array<{ podAffinityTerm?: { labelSelector?: { matchExpressions?: Array<Record<string, unknown>> } } }>
      requiredDuringSchedulingIgnoredDuringExecution?: Array<{ labelSelector?: { matchExpressions?: Array<Record<string, unknown>> } }>
    }
  }
  const exprRow = (expr: Record<string, unknown>, mode: string) => ({
    mode,
    host: String(expr.key ?? 'kubernetes.io/hostname'),
    operator: String(expr.operator ?? 'In'),
    value: Array.isArray(expr.values) ? String((expr.values as unknown[])[0] ?? '') : String(expr.value ?? ''),
  })
  const nodeRows: NodeAffinityRow[] = []
  ;(aff.nodeAffinity?.preferredDuringSchedulingIgnoredDuringExecution ?? []).forEach((entry) => {
    ;(entry.preference?.matchExpressions ?? []).forEach((expr) => nodeRows.push(exprRow(expr, '1')))
  })
  ;(aff.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution?.nodeSelectorTerms ?? []).forEach((term) => {
    ;(term.matchExpressions ?? []).forEach((expr) => nodeRows.push(exprRow(expr, '0')))
  })
  const serviceRows: ServiceAffinityRow[] = []
  const pushPod = (expr: Record<string, unknown>, mode: string) =>
    serviceRows.push({ ...exprRow(expr, mode), service: String(expr.key ?? '') })
  ;(aff.podAffinity?.preferredDuringSchedulingIgnoredDuringExecution ?? []).forEach((entry) => {
    ;(entry.podAffinityTerm?.labelSelector?.matchExpressions ?? []).forEach((expr) => pushPod(expr, '1'))
  })
  ;(aff.podAffinity?.requiredDuringSchedulingIgnoredDuringExecution ?? []).forEach((entry) => {
    ;(entry.labelSelector?.matchExpressions ?? []).forEach((expr) => pushPod(expr, '0'))
  })
  ;(aff.podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution ?? []).forEach((entry) => {
    ;(entry.podAffinityTerm?.labelSelector?.matchExpressions ?? []).forEach((expr) => pushPod(expr, '2'))
  })
  ;(aff.podAntiAffinity?.requiredDuringSchedulingIgnoredDuringExecution ?? []).forEach((entry) => {
    ;(entry.labelSelector?.matchExpressions ?? []).forEach((expr) => pushPod(expr, '3'))
  })
  return { nodeRows, serviceRows }
}

function cpuValue(value?: string | null) {
  if (!value) return ''
  return value.endsWith('m') ? String(parseFloat(value) / 1000) : value.replace(/[^\d.]/g, '')
}

function memValue(value?: string | null) {
  if (!value) return ''
  const num = parseFloat(value)
  if (Number.isNaN(num)) return ''
  if (value.endsWith('Gi')) return String(num * 1024)
  if (value.endsWith('Mi')) return String(num)
  if (value.endsWith('Ki')) return String(num / 1024)
  return String(num / 1024 / 1024)
}

const inputCls =
  'h-[30px] w-full border border-[#2f4f6d] bg-[#16293c] px-2 text-[14px] text-[#c6dbef] outline-none transition-colors disabled:cursor-default disabled:opacity-95 focus:border-[#1890ff]'

const linkCls = 'text-[14px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]'

interface SelectOption {
  value: string
  label: string
}

function SelectBox({
  value,
  options,
  onChange,
  disabled,
  placeholder = '请选择',
  searchable,
  className,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  searchable?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const current = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const list = keyword
    ? options.filter((option) => option.label.toLowerCase().includes(keyword.toLowerCase()))
    : options

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(inputCls, 'flex items-center justify-between gap-1 text-left', open && 'border-[#1890ff]')}
      >
        <span className={cn('truncate', current ? 'text-[#c6dbef]' : 'text-[#6f8aa5]')}>
          {current?.label || placeholder}
        </span>
        {searchable ? (
          <Search size={11} className="flex-none text-[#6f8aa5]" />
        ) : (
          <ChevronDown size={12} className="flex-none text-[#6f8aa5]" />
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-0.5 max-h-[220px] w-full overflow-auto border border-[#2f4f6d] bg-[#1a2733] py-1 shadow-[0_8px_20px_rgba(0,0,0,0.45)]">
          {searchable && (
            <div className="px-2 pb-1">
              <input
                autoFocus
                className="h-[26px] w-full border border-[#2f4f6d] bg-[#16293c] px-2 text-[14px] text-[#c6dbef] outline-none placeholder:text-[#6f8aa5] focus:border-[#1890ff]"
                placeholder="搜索"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
          )}
          {list.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
                setKeyword('')
              }}
              className={cn(
                'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[14px] transition-colors',
                option.value === value
                  ? 'bg-[#1670c2] text-white'
                  : 'text-[#c6dbef] hover:bg-[#15395c]',
              )}
            >
              <span className="flex w-3 flex-none justify-center">
                {option.value === value && <Check size={11} />}
              </span>
              <span className="truncate">{option.label}</span>
            </button>
          ))}
          {list.length === 0 && <div className="px-2 py-1.5 text-[14px] text-[#6f8aa5]">无匹配项</div>}
        </div>
      )}
    </div>
  )
}

function FieldRow({
  label,
  children,
  action,
  wide,
}: {
  label: string
  children: React.ReactNode
  action?: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="flex min-h-[36px] items-center gap-3">
      <span className="w-[110px] flex-none text-[14px] text-[#9db4ca]">{label}</span>
      <div className={wide ? 'w-[420px] flex-none' : 'w-[240px] flex-none'}>{children}</div>
      <div className="flex w-[92px] flex-none items-center gap-3 text-[14px]">{action}</div>
    </div>
  )
}

function Radio({
  checked,
  label,
  onClick,
  disabled,
}: {
  checked: boolean
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 text-[14px] disabled:cursor-default"
    >
      <span
        className={cn(
          'flex h-[14px] w-[14px] items-center justify-center rounded-full border',
          checked ? 'border-[#1890ff]' : 'border-[#5b7a99]',
        )}
      >
        {checked && <span className="h-[6px] w-[6px] rounded-full bg-[#1890ff]" />}
      </span>
      <span className={checked ? 'text-white' : 'text-[#c6dbef]'}>{label}</span>
    </button>
  )
}

function Section({
  id,
  title,
  editing,
  onEdit,
  onSave,
  onCancel,
  children,
  extra,
}: {
  id: string
  title: string
  editing?: boolean
  onEdit?: () => void
  onSave?: () => void
  onCancel?: () => void
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <section id={id} className="mb-7 scroll-mt-2">
      <div className="mb-2.5 flex h-8 items-center border-b border-[#1b3550]">
        <h3 className="flex h-8 items-center border-l-[5px] border-[#2db7f5] pl-2.5 text-[16px] leading-8 text-white">
          {title}
        </h3>
        <div className="ml-4 flex items-center gap-3 text-[14px]">
          {onEdit ? (
            editing ? (
              <>
                <button type="button" className={linkCls} onClick={() => onSave?.()}>
                  保存
                </button>
                <button type="button" className={linkCls} onClick={() => onCancel?.()}>
                  取消
                </button>
              </>
            ) : (
              <button type="button" className={linkCls} onClick={() => onEdit()}>
                编辑
              </button>
            )
          ) : null}
        </div>
        {extra && <div className="ml-auto flex items-center gap-3 text-[14px]">{extra}</div>}
      </div>
      <div className="px-6 py-2.5">{children}</div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ServiceConfigPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const selected = searchParams.get('service') || ''

  const [keyword, setKeyword] = useState('')
  const [activeNav, setActiveNav] = useState<string>('BaseForm')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const [editingField, setEditingField] = useState<string | null>(null)
  const [basic, setBasic] = useState({
    name: '',
    nameUs: '',
    nameFr: '',
    hostName: '',
    replicas: '1',
    priority: '',
    serverKeys: [] as string[],
  })

  const [envEditing, setEnvEditing] = useState(false)
  const [envRows, setEnvRows] = useState<EnvRow[]>([{ name: '', type: 'text', value: '' }])

  const [resourceEditing, setResourceEditing] = useState(false)
  const [resourceMode, setResourceMode] = useState<'1' | '2'>('1')
  const [resourcePreset, setResourcePreset] = useState('5')
  const [ramMin, setRamMin] = useState('100')
  const [ramMax, setRamMax] = useState('100')
  const [cpuMin, setCpuMin] = useState('0.1')
  const [cpuMax, setCpuMax] = useState('0.5')
  const [gpuMax, setGpuMax] = useState('1')

  const [accessEditing, setAccessEditing] = useState(false)
  const [portRows, setPortRows] = useState<PortRow[]>([{ port: '', protocol: 'TCP', nodePort: '' }])

  const [discoveryEditing, setDiscoveryEditing] = useState(false)
  const [nodePortEnabled, setNodePortEnabled] = useState(false)
  const [nodeRows, setNodeRows] = useState<PortRow[]>([])

  const [assistEditing, setAssistEditing] = useState(false)
  const [entryMode, setEntryMode] = useState<'1' | '2'>('1')
  const [commands, setCommands] = useState<string[]>([])
  const [args, setArgs] = useState<string[]>([])

  const [configEditing, setConfigEditing] = useState(false)
  const [volumeRows, setVolumeRows] = useState<VolumeRow[]>([{ hostPath: '', podPath: '', readOnly: false }])
  const [configRows, setConfigRows] = useState<ConfigMapRow[]>([])
  const [fileSearch, setFileSearch] = useState<{ row: number; value: string } | null>(null)

  const [healthEditing, setHealthEditing] = useState(false)
  const [readiness, setReadiness] = useState<ProbeForm>(emptyProbe)
  const [liveness, setLiveness] = useState<ProbeForm>(emptyProbe)

  const [nodeEditing, setNodeEditing] = useState(false)
  const [nodeMode, setNodeMode] = useState<'1' | '2' | '3'>('1')
  const [advNode, setAdvNode] = useState('')
  const [nodeAffinityRows, setNodeAffinityRows] = useState<NodeAffinityRow[]>([
    { mode: '1', host: 'kubernetes.io/hostname', operator: 'In', value: '' },
  ])
  const [serviceAffinityRows, setServiceAffinityRows] = useState<ServiceAffinityRow[]>([
    { mode: '1', service: '', operator: 'In', value: '' },
  ])

  const servicesQuery = useQuery({
    queryKey: ['config-services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
  })
  const services = servicesQuery.data?.services ?? []

  const detailQuery = useQuery({
    queryKey: ['config-service-detail', selected],
    queryFn: () => api.get<ServiceItem>(`/v1/service/${encodeURIComponent(selected)}`),
    enabled: !!selected,
  })
  const detail = detailQuery.data
  const container = detail?.deployment?.spec?.template?.spec?.containers?.[0]
  const podSpec = detail?.deployment?.spec?.template?.spec

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync = () => {
      const elTop = el.getBoundingClientRect().top
      let current: string = NAV[0].id
      for (const item of NAV) {
        const section = document.getElementById(item.id)
        if (section && section.getBoundingClientRect().top - elTop <= 72) current = item.id
      }
      setActiveNav(current)
    }
    el.addEventListener('scroll', sync, { passive: true })
    sync()
    return () => el.removeEventListener('scroll', sync)
  }, [detailQuery.data])

  const configMapQuery = useQuery({
    queryKey: ['config-maps'],
    queryFn: () => api.get<{ items?: ConfigMapItem[]; total?: number }>('/v1/config_map'),
    enabled: !!selected,
  })
  const configMaps = configMapQuery.data?.items ?? []

  const nodesQuery = useQuery({
    queryKey: ['config-nodes'],
    queryFn: () =>
      api.get<{
        nodes?: {
          nodes?: Array<{ name?: string; ip?: string; cpu?: string | number; memory?: string | number }>
        }
      }>('/cloud/nodes'),
    enabled: !!selected,
  })
  const nodeList = nodesQuery.data?.nodes?.nodes ?? []

  const priorityClassesQuery = useQuery({
    queryKey: ['priority-classes'],
    queryFn: () =>
      api.get<{ items?: Array<{ metadata?: { name?: string }; value?: number }> }>(
        '/k8s/apis/scheduling.k8s.io/v1/priorityclasses',
      ),
    enabled: !!selected,
  })
  const priorityClasses = priorityClassesQuery.data?.items ?? []

  const serviceKeysQuery = useQuery({
    queryKey: ['config-service-keys', selected],
    queryFn: () => api.get<string[]>('/v1/pub/serviceKeyList', { name: selected, serviceName: '' }),
    enabled: !!selected,
  })
  const serviceKeyOptions = serviceKeysQuery.data ?? []

  const serviceLabel =
    detail?.deployment?.spec?.template?.metadata?.annotations?.['gaop/serviceLabel'] ||
    detail?.nameUs ||
    ''

  /* init from detail */
  useEffect(() => {
    if (!detail) return
    const podTemplate = detail.deployment?.spec?.template
    const role = podTemplate?.metadata?.annotations?.['gaop/serviceRole'] || ''
    setBasic({
      name: podTemplate?.metadata?.annotations?.['gaop/serviceLabel'] || detail.nameUs || '',
      nameUs: detail.nameUs || '',
      nameFr: detail.nameFr || '',
      hostName: podTemplate?.spec?.hostname || '',
      replicas: String(detail.deployment?.spec?.replicas ?? 1),
      priority: podTemplate?.spec?.priorityClassName || '',
      serverKeys: role ? role.split(',').filter(Boolean) : [],
    })
    const env = (container?.env ?? []).map((item) => {
      const fieldPath = item.valueFrom?.fieldRef?.fieldPath
      return fieldPath
        ? { name: item.name, type: 'podType' as const, value: POD_FIELD_BY_PATH[fieldPath] || fieldPath }
        : { name: item.name, type: 'text' as const, value: item.value ?? '' }
    })
    setEnvRows(env.length ? env : [])
    const ports = (detail.service?.spec?.ports ?? []).map((port) => ({
      port: String(port.port ?? ''),
      protocol: port.protocol || 'TCP',
      nodePort: port.nodePort ? String(port.nodePort) : '',
    }))
    const fallbackPorts = (container?.ports ?? []).map((port) => ({
      port: String(port.containerPort ?? ''),
      protocol: port.protocol || 'TCP',
      nodePort: '',
    }))
    setPortRows(ports.length ? ports : fallbackPorts)
    setNodePortEnabled((detail.service?.spec?.type || 'ClusterIP') === 'NodePort')
    setNodeRows(ports.filter((port) => port.nodePort))
    const res = container?.resources
    setRamMin(res?.requests?.memory ? memValue(res.requests.memory) : '')
    setRamMax(res?.limits?.memory ? memValue(res.limits.memory) : '')
    setCpuMin(cpuValue(res?.requests?.cpu))
    setCpuMax(cpuValue(res?.limits?.cpu))
    setGpuMax(res?.limits?.gpu?.replace(/[^\d.]/g, '') || '')
    const cmd = container?.command ?? []
    const cmdArgs = container?.args ?? []
    setEntryMode(cmd.length ? '2' : '1')
    setCommands(cmd.length ? cmd : [])
    setArgs(cmdArgs.length ? cmdArgs : [])
    setReadiness(probeToForm(container?.readinessProbe))
    setLiveness(probeToForm(container?.livenessProbe))
    const mounts = container?.volumeMounts ?? []
    const volumes = podSpec?.volumes ?? []
    const hostRows: VolumeRow[] = []
    const cmRows: ConfigMapRow[] = []
    volumes.forEach((volume) => {
      const mount = mounts.find((item) => item.name === volume.name)
      if (volume.hostPath?.path) {
        hostRows.push({
          hostPath: volume.hostPath.path || '',
          podPath: mount?.mountPath || '',
          readOnly: !!mount?.readOnly,
        })
      }
      if (volume.configMap?.name) {
        const group = volume.configMap.name
        const cm = configMaps.find((item) => item.metadata?.name === group)
        cmRows.push({
          dir: mount?.mountPath || '',
          configmap: group,
          keys: Object.keys(cm?.data ?? {}),
        })
      }
    })
    setVolumeRows(hostRows.length ? hostRows : [])
    setConfigRows(cmRows)
    const nodeSelector = podSpec?.nodeSelector ?? {}
    const affinity = podSpec?.affinity ?? null
    const selectedNode = nodeSelector['kubernetes.io/hostname']
    setNodeMode(selectedNode ? '2' : affinity && Object.keys(affinity).length ? '3' : '1')
    setAdvNode(selectedNode || '')
    const parsed = affinityRowsFrom(affinity)
    setNodeAffinityRows(
      parsed.nodeRows.length ? parsed.nodeRows : [{ mode: '1', host: 'kubernetes.io/hostname', operator: 'In', value: '' }],
    )
    setServiceAffinityRows(
      parsed.serviceRows.length ? parsed.serviceRows : [{ mode: '1', service: '', operator: 'In', value: '' }],
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, detailQuery.dataUpdatedAt, configMaps.length])

  /* nav scroll spy */
  useEffect(() => {
    if (!selected) return
    const scroller = scrollRef.current
    if (!scroller) return
    const onScroll = () => {
      let current = NAV[0].id as string
      const scrollerRect = scroller.getBoundingClientRect()
      NAV.forEach((item) => {
        const el = document.getElementById(item.id)
        if (!el) return
        if (el.getBoundingClientRect().top - scrollerRect.top <= 60) current = item.id
      })
      setActiveNav(current)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [selected])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    queryClient.invalidateQueries({ queryKey: ['config-services'] })
  }

  /* ---------------------------- mutations ---------------------------- */

  const renameMutation = useMutation({
    mutationFn: () =>
      api.put('/v1/service/updateName', undefined, {
        name: basic.name,
        nameUs: basic.nameUs,
        nameFr: basic.nameFr,
        serviceKey: selected,
      }),
    onSuccess: () => {
      toast.success('修改成功')
      setEditingField(null)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  const hostNameMutation = useMutation({
    mutationFn: () => api.put('/v1/service/hostName', { serviceName: selected, hostName: basic.hostName }),
    onSuccess: () => {
      toast.success('修改成功')
      setEditingField(null)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  const scaleMutation = useMutation({
    mutationFn: () => api.put('/v1/service/scale', undefined, { serviceName: selected, scale: Number(basic.replicas) || 0 }),
    onSuccess: () => {
      toast.success('修改成功')
      setEditingField(null)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  const priorityMutation = useMutation({
    mutationFn: () => api.post('/v1/service/priority', undefined, { serviceName: selected, level: basic.priority }),
    onSuccess: () => {
      toast.success('修改成功')
      setEditingField(null)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  const roleMutation = useMutation({
    mutationFn: () =>
      api.put('/v1/service/updateServiceRole', undefined, {
        name: selected,
        serviceKey: basic.serverKeys.join(','),
      }),
    onSuccess: () => {
      toast.success('修改成功')
      setEditingField(null)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  const envMutation = useMutation({
    mutationFn: () =>
      api.put('/v1/pub/serviceEnv', {
        serviceName: selected,
        env: envRows
          .filter((row) => row.name.trim())
          .map((row) =>
            row.type === 'podType'
              ? {
                  name: row.name.trim(),
                  value: null,
                  valueFrom: {
                    fieldRef: { apiVersion: 'v1', fieldPath: POD_FIELD_PATHS[row.value] || row.value },
                  },
                }
              : { name: row.name.trim(), value: row.value },
          ),
      }),
    onSuccess: () => {
      toast.success('保存成功')
      setEnvEditing(false)
      invalidate()
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const resourceMutation = useMutation({
    mutationFn: () => {
      const limits: Record<string, string> = {}
      const requests: Record<string, string> = {}
      if (cpuMax) limits.cpu = cpuMax
      if (ramMax) limits.memory = `${ramMax}Mi`
      if (resourceMode === '2' && gpuMax) limits.gpu = gpuMax
      if (cpuMin) requests.cpu = cpuMin
      if (ramMin) requests.memory = `${ramMin}Mi`
      if (Object.keys(limits).length === 0 && Object.keys(requests).length === 0) {
        throw new Error('请填写资源配置')
      }
      return api.post('/v1/pub/patchResource', { name: selected, limits, requests })
    },
    onSuccess: () => {
      toast.success('修改成功')
      setResourceEditing(false)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  const portMutation = useMutation({
    mutationFn: (payload: { type: string; rows: PortRow[] }) =>
      api.post(`/v1/service/${encodeURIComponent(selected)}/nodePort`, {
        type: payload.type,
        nodePorts: payload.rows
          .filter((row) => row.port)
          .map((row) => ({
            port: Number(row.port),
            protocol: row.protocol,
            nodePort: row.nodePort ? Number(row.nodePort) : null,
          })),
      }),
    onSuccess: () => {
      toast.success('修改成功')
      setAccessEditing(false)
      setDiscoveryEditing(false)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  const volumeMutation = useMutation({
    mutationFn: () =>
      api.post(`/v1/service/${encodeURIComponent(selected)}/updateVolumes`, {
        configMapList: configRows
          .filter((row) => row.dir && row.configmap)
          .map((row) => ({ dir: row.dir, keys: row.keys, configmap: row.configmap })),
        hostPathList: volumeRows
          .filter((row) => row.hostPath.trim() && row.podPath.trim())
          .map((row) => ({
            hostPath: row.hostPath.trim(),
            podPath: row.podPath.trim(),
            readOnly: row.readOnly ? 2 : 1,
          })),
      }),
    onSuccess: () => {
      toast.success('保存成功')
      setConfigEditing(false)
      invalidate()
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const commandMutation = useMutation({
    mutationFn: () =>
      api.put(`/v1/service/patchCommand/${encodeURIComponent(selected)}`, {
        command: entryMode === '2' ? commands.map((item) => item.trim()).filter(Boolean) : [],
        args: entryMode === '2' ? args.map((item) => item.trim()).filter(Boolean) : [],
      }),
    onSuccess: () => {
      toast.success('保存成功')
      setAssistEditing(false)
      invalidate()
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const healthMutation = useMutation({
    mutationFn: () =>
      api.put('/v1/service/healthCheck', {
        name: selected,
        readiness: formToProbe(readiness),
        liveness: formToProbe(liveness),
      }),
    onSuccess: () => {
      toast.success('修改成功')
      setHealthEditing(false)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      const expr = (row: { host?: string; service?: string; operator: string; value: string }) => ({
        key: row.host || row.service || 'kubernetes.io/hostname',
        operator: row.operator,
        ...(row.operator === 'Exists' || row.operator === 'DoesNotExist'
          ? {}
          : { values: row.value ? [row.value] : [] }),
      })
      const nodePreferred: Array<Record<string, unknown>> = []
      const nodeRequired: Array<Record<string, unknown>> = []
      nodeAffinityRows.forEach((row) => {
        if (!row.host) return
        const item = { weight: 1, preference: { matchExpressions: [expr(row)] } }
        if (row.mode === '0') nodeRequired.push(expr(row))
        else nodePreferred.push(item)
      })
      const podAffinity: { preferred: Array<Record<string, unknown>>; required: Array<Record<string, unknown>> } = {
        preferred: [],
        required: [],
      }
      const podAnti: { preferred: Array<Record<string, unknown>>; required: Array<Record<string, unknown>> } = {
        preferred: [],
        required: [],
      }
      serviceAffinityRows.forEach((row) => {
        if (!row.service) return
        const selector = { labelSelector: { matchExpressions: [expr(row)] } }
        const preferred = {
          weight: 1,
          podAffinityTerm: { topologyKey: 'kubernetes.io/hostname', ...selector },
        }
        if (row.mode === '2') podAnti.preferred.push(preferred)
        else if (row.mode === '3') podAnti.required.push(selector)
        else if (row.mode === '0') podAffinity.required.push(selector)
        else podAffinity.preferred.push(preferred)
      })
      const affinity: Record<string, unknown> = {}
      if (nodePreferred.length || nodeRequired.length) {
        affinity.nodeAffinity = {
          ...(nodePreferred.length
            ? { preferredDuringSchedulingIgnoredDuringExecution: nodePreferred }
            : {}),
          ...(nodeRequired.length
            ? {
                requiredDuringSchedulingIgnoredDuringExecution: {
                  nodeSelectorTerms: [{ matchExpressions: nodeRequired }],
                },
              }
            : {}),
        }
      }
      if (podAffinity.preferred.length || podAffinity.required.length) {
        affinity.podAffinity = {
          ...(podAffinity.preferred.length
            ? { preferredDuringSchedulingIgnoredDuringExecution: podAffinity.preferred }
            : {}),
          ...(podAffinity.required.length
            ? { requiredDuringSchedulingIgnoredDuringExecution: podAffinity.required }
            : {}),
        }
      }
      if (podAnti.preferred.length || podAnti.required.length) {
        affinity.podAntiAffinity = {
          ...(podAnti.preferred.length
            ? { preferredDuringSchedulingIgnoredDuringExecution: podAnti.preferred }
            : {}),
          ...(podAnti.required.length
            ? { requiredDuringSchedulingIgnoredDuringExecution: podAnti.required }
            : {}),
        }
      }
      const nodeSelector = nodeMode === '2' && advNode ? { 'kubernetes.io/hostname': advNode } : null
      await api.put('/v1/service/patchService', {
        svcName: selected,
        requestBody: { spec: { template: { spec: { affinity: nodeMode === '3' ? affinity : {}, nodeSelector } } } },
      })
      return api.post('/v1/service/tolerance', undefined, { serviceName: selected, type: 0 })
    },
    onSuccess: () => {
      toast.success('修改成功')
      setNodeEditing(false)
      invalidate()
    },
    onError: (error) => toast.error('修改失败', errorMessage(error)),
  })

  /* ---------------------------- actions ---------------------------- */

  function closePanel() {
    const from = searchParams.get('from')
    if (searchParams.has('service') || from) {
      const next = new URLSearchParams(searchParams)
      next.delete('service')
      next.delete('from')
      setSearchParams(next, { replace: true })
    }
    navigate(from === 'base-service' ? '/software/application/base-service' : '/software/application/service')
  }

  function exportConfig() {
    if (!detail) return
    const payload = {
      serviceName: selected,
      基本信息: basic,
      环境变量: envRows.filter((row) => row.name),
      资源配置: { ramMin, ramMax, cpuMin, cpuMax, gpuMax },
      访问方式: portRows,
      服务发现: { nodePortEnabled, nodeRows },
      辅助设置: { entryMode, commands, args },
      服务配置: { configMapList: configRows, hostPathList: volumeRows },
      健康检查: { readiness, liveness },
      节点调度: { nodeMode, advNode, nodeAffinityRows, serviceAffinityRows },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `service-config-${selected}-${Date.now()}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success('配置已导出')
  }

  async function saveVolumes() {
    const ok = await confirm({
      title: '保存服务配置？',
      description: '保存后将以当前文件映射与主机路径覆盖服务存储配置。',
      confirmText: '保存',
    })
    if (ok) volumeMutation.mutate()
  }

  function toggleServerKey(key: string) {
    setBasic((prev) => ({
      ...prev,
      serverKeys: prev.serverKeys.includes(key)
        ? prev.serverKeys.filter((item) => item !== key)
        : [...prev.serverKeys, key],
    }))
  }

  const basicEditLink = (field: string, save: () => void) => {
    if (editingField === field) {
      return (
        <>
          <button type="button" className={linkCls} onClick={save}>
            保存
          </button>
          <button
            type="button"
            className={linkCls}
            onClick={() => {
              setEditingField(null)
              const podTemplate = detail?.deployment?.spec?.template
              setBasic((prev) => ({
                ...prev,
                name: podTemplate?.metadata?.annotations?.['gaop/serviceLabel'] || detail?.nameUs || '',
                nameUs: detail?.nameUs || '',
                nameFr: detail?.nameFr || '',
                hostName: podTemplate?.spec?.hostname || '',
                replicas: String(detail?.deployment?.spec?.replicas ?? 1),
                priority: podTemplate?.spec?.priorityClassName || '',
                serverKeys: (podTemplate?.metadata?.annotations?.['gaop/serviceRole'] || '')
                  .split(',')
                  .filter(Boolean),
              }))
            }}
          >
            取消
          </button>
        </>
      )
    }
    return (
      <button type="button" className={linkCls} onClick={() => setEditingField(field)}>
        修改
      </button>
    )
  }

  const visibleServices = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return services
    return services.filter((service) => serviceNameOf(service).toLowerCase().includes(q))
  }, [services, keyword])

  const addressText = useMemo(() => {
    const ports = detail?.service?.spec?.ports ?? []
    if (ports.length > 0) {
      return ports
        .map((port) => `容器端口：${port.targetPort || port.port}  集群内：${selected}:${port.port}`)
        .join('；')
    }
    const containerPorts = container?.ports ?? []
    if (containerPorts.length > 0) {
      return containerPorts
        .map((port) => `容器端口：${port.containerPort}  集群内：${selected}:${port.containerPort}`)
        .join('；')
    }
    return '—'
  }, [detail, container, selected])

  /* ---------------------------- fallback list ---------------------------- */

  if (!selected) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <input
            className="field h-8 w-[240px]"
            placeholder="请输入服务名/服务标识搜索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <div className="border border-line">
          <table className="w-full">
            <thead>
              <tr className="bg-paper-2/50 text-[14px] text-ink-3">
                <th className="h-9 w-16 text-center font-normal">序号</th>
                <th className="h-9 text-left font-normal">服务名称</th>
                <th className="h-9 text-left font-normal">服务标识</th>
                <th className="h-9 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleServices.map((service, index) => {
                const name = serviceNameOf(service)
                return (
                  <tr
                    key={name}
                    className="cursor-pointer border-t border-line text-[14px] hover:bg-paper-2/40"
                    onClick={() => setSearchParams({ service: name }, { replace: true })}
                  >
                    <td className="h-10 text-center text-ink-3">{index + 1}</td>
                    <td>{name}</td>
                    <td className="text-ink-3">{service.nameUs || service.nameFr || '—'}</td>
                    <td className="text-right text-[#4aa3f0]">配置</td>
                  </tr>
                )
              })}
              {visibleServices.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-[14px] text-mute">
                    {servicesQuery.isLoading ? '正在加载…' : '暂无服务'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  /* ---------------------------- config panel ---------------------------- */

  const probeEditor = (
    form: ProbeForm,
    setForm: (next: ProbeForm) => void,
    label: string,
  ) => (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[14px] text-ink">{label}</span>
        <div className="flex items-center gap-5">
          {[
            { value: 0, label: '无' },
            { value: 1, label: 'HTTP' },
            { value: 2, label: 'TCP' },
          ].map((option) => (
            <Radio
              key={option.value}
              checked={form.type === option.value}
              label={option.label}
              disabled={!healthEditing}
              onClick={() => setForm({ ...form, type: option.value })}
            />
          ))}
        </div>
      </div>
      {form.type !== 0 && (
        <>
          <div className="mb-1 text-[12px] text-[#ff6b6b]">
            {form.type === 1
              ? '通过 HTTP GET 请求进行健康检查。如果响应状态码小于 400，则认为容器健康'
              : '检测端口是否为打开状态，若端口为关闭或进程停止关闭状态，则健康检查不通过'}
          </div>
          <div className="grid grid-cols-4 gap-2 text-[12px] text-ink-3">
            <span>端口</span>
            <span>首次检测延时（秒）</span>
            <span>检测超时（秒）</span>
            <span>检测间隔（秒）</span>
          </div>
          <div className="mb-2 grid grid-cols-4 gap-2">
            <input
              className={inputCls}
              disabled={!healthEditing}
              value={form.port}
              onChange={(event) => setForm({ ...form, port: event.target.value })}
            />
            <input
              className={inputCls}
              disabled={!healthEditing}
              value={form.initialDelaySeconds}
              onChange={(event) => setForm({ ...form, initialDelaySeconds: event.target.value })}
            />
            <input
              className={inputCls}
              disabled={!healthEditing}
              value={form.timeoutSeconds}
              onChange={(event) => setForm({ ...form, timeoutSeconds: event.target.value })}
            />
            <input
              className={inputCls}
              disabled={!healthEditing}
              value={form.periodSeconds}
              onChange={(event) => setForm({ ...form, periodSeconds: event.target.value })}
            />
          </div>
          <div className={cn('grid gap-2 text-[12px] text-ink-3', form.type === 1 ? 'grid-cols-3' : 'grid-cols-4')}>
            {form.type === 1 && <span>路径</span>}
            <span>健康阈值（成功次数）</span>
            <span>异常阈值（失败次数）</span>
            {form.type === 1 ? <span /> : null}
          </div>
          <div className={cn('grid gap-2', form.type === 1 ? 'grid-cols-3' : 'grid-cols-4')}>
            {form.type === 1 && (
              <input
                className={inputCls}
                disabled={!healthEditing}
                value={form.path}
                onChange={(event) => setForm({ ...form, path: event.target.value })}
              />
            )}
            <input
              className={inputCls}
              disabled={!healthEditing}
              value={form.successThreshold}
              onChange={(event) => setForm({ ...form, successThreshold: event.target.value })}
            />
            <input
              className={inputCls}
              disabled={!healthEditing}
              value={form.failureThreshold}
              onChange={(event) => setForm({ ...form, failureThreshold: event.target.value })}
            />
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-[#04090f]/50" onClick={closePanel}>
      <div className="flex h-full w-full max-w-[1100px] flex-col bg-[#0b1a2a]" onClick={(event) => event.stopPropagation()}>
      <header className="flex h-[46px] flex-none items-center gap-3 bg-[#1f4a75] px-4">
        <button
          type="button"
          onClick={closePanel}
          className="flex h-7 w-7 items-center justify-center text-white/85 transition-colors hover:text-white"
          title="关闭"
        >
          <X size={17} />
        </button>
        <span className="text-[14px] text-white">服务配置: {serviceLabel || selected}</span>
        <div className="ml-auto">
          <Button size="sm" variant="signal" onClick={exportConfig}>
            <Download size={11} /> 配置导出
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="relative w-[130px] flex-none border-r border-[#1b3550] bg-[#0e2233] py-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                setActiveNav(item.id)
              }}
              className={cn(
                'flex h-[46px] w-full items-center px-4 text-left text-[14px] transition-colors',
                activeNav === item.id ? 'text-[#2db7f5]' : 'text-ink-3 hover:text-white',
              )}
            >
              {item.label}
            </button>
          ))}
          <span
            className="pointer-events-none absolute right-0 h-[46px] w-[2px] bg-[#2db7f5] transition-[top] duration-300"
            style={{ top: 8 + NAV.findIndex((item) => item.id === activeNav) * 46 }}
          />
        </nav>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto px-2 py-4">
          {detailQuery.isLoading ? (
            <div className="py-20 text-center text-[14px] text-mute">正在读取服务配置…</div>
          ) : (
            <>
              {/* 基本信息 */}
              <Section id="BaseForm" title="基本信息">
                <FieldRow label="服务名称" action={basicEditLink('name', () => renameMutation.mutate())}>
                  <input
                    className={inputCls}
                    disabled={editingField !== 'name'}
                    value={basic.name}
                    onChange={(event) => setBasic({ ...basic, name: event.target.value })}
                  />
                </FieldRow>
                <FieldRow label="英文名称" action={basicEditLink('nameUs', () => renameMutation.mutate())}>
                  <input
                    className={inputCls}
                    disabled={editingField !== 'nameUs'}
                    value={basic.nameUs}
                    onChange={(event) => setBasic({ ...basic, nameUs: event.target.value })}
                  />
                </FieldRow>
                <FieldRow label="法文名称" action={basicEditLink('nameFr', () => renameMutation.mutate())}>
                  <input
                    className={inputCls}
                    disabled={editingField !== 'nameFr'}
                    value={basic.nameFr}
                    onChange={(event) => setBasic({ ...basic, nameFr: event.target.value })}
                  />
                </FieldRow>
                <FieldRow label="服务上次状态">
                  <input className={inputCls} disabled value={detail?.terminated ? 'Terminated' : '暂无记录'} />
                </FieldRow>
                <FieldRow label="所属节点">
                  <input
                    className={inputCls}
                    disabled
                    value={detail?.belongNodeList?.join(', ') || detail?.hostIP || '—'}
                  />
                </FieldRow>
                <FieldRow label="服务地址" wide>
                  <div className="min-h-[30px] w-[420px] border border-[#2f4f6d] bg-[#16293c] px-2 py-1.5 text-[12px] leading-[18px] text-[#c6dbef]">
                    {addressText}
                  </div>
                </FieldRow>
                <FieldRow label="资源优先级" action={basicEditLink('priority', () => priorityMutation.mutate())}>
                  <SelectBox
                    value={basic.priority}
                    disabled={editingField !== 'priority'}
                    placeholder="无"
                    options={[
                      { value: '', label: '无' },
                      ...priorityClasses
                        .map((item) => item.metadata?.name || '')
                        .filter(Boolean)
                        .map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={(value) => setBasic({ ...basic, priority: value })}
                  />
                </FieldRow>
                <FieldRow label="实例数量" action={basicEditLink('replicas', () => scaleMutation.mutate())}>
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    max={5}
                    disabled={editingField !== 'replicas'}
                    value={basic.replicas}
                    onChange={(event) => setBasic({ ...basic, replicas: event.target.value })}
                  />
                </FieldRow>
                <FieldRow label="hostName" action={basicEditLink('hostName', () => hostNameMutation.mutate())}>
                  <input
                    className={inputCls}
                    disabled={editingField !== 'hostName'}
                    value={basic.hostName}
                    onChange={(event) => setBasic({ ...basic, hostName: event.target.value })}
                  />
                </FieldRow>
                <FieldRow label="所属可操作服务" action={basicEditLink('serverKeys', () => roleMutation.mutate())}>
                  {editingField === 'serverKeys' ? (
                    <div className="flex max-h-[90px] flex-wrap gap-1.5 overflow-auto border border-[#2f4f6d] bg-[#16293c] p-1.5">
                      {serviceKeyOptions.map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleServerKey(key)}
                          className={cn(
                            'border px-2 py-0.5 text-[12px]',
                            basic.serverKeys.includes(key)
                              ? 'border-signal bg-signal text-white'
                              : 'border-[#3d5f80] text-ink-3',
                          )}
                        >
                          {key}
                        </button>
                      ))}
                      {serviceKeyOptions.length === 0 && <span className="text-[12px] text-mute">暂无可选服务</span>}
                    </div>
                  ) : (
                    <input className={inputCls} disabled value={basic.serverKeys.join(', ')} />
                  )}
                </FieldRow>
              </Section>

              {/* 环境变量 */}
              <Section
                id="EnvValue"
                title="环境变量"
                editing={envEditing}
                onEdit={() => setEnvEditing(true)}
                onSave={() => envMutation.mutate()}
                onCancel={() => {
                  setEnvEditing(false)
                  setEnvRows(
                    (container?.env ?? []).map((item) => {
                      const fieldPath = item.valueFrom?.fieldRef?.fieldPath
                      return fieldPath
                        ? { name: item.name, type: 'podType' as const, value: POD_FIELD_BY_PATH[fieldPath] || fieldPath }
                        : { name: item.name, type: 'text' as const, value: item.value ?? '' }
                    }),
                  )
                }}
              >
                <div className="mb-1 flex items-center gap-3 text-[14px] text-ink-3">
                  <span className="w-[30%]">变量名</span>
                  <span className="w-[14%]">类型</span>
                  <span className="w-[40%]">变量值</span>
                  <span className="w-[16%]">操作</span>
                </div>
                <div className="space-y-2">
                  {envRows.map((row, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <input
                        className={cn(inputCls, 'w-[30%]')}
                        disabled={!envEditing}
                        value={row.name}
                        onChange={(event) =>
                          setEnvRows((rows) =>
                            rows.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)),
                          )
                        }
                      />
                      {envEditing ? (
                        <SelectBox
                          className="w-[14%]"
                          value={row.type}
                          options={[
                            { value: 'text', label: '普通变量' },
                            { value: 'podType', label: 'Pod类型' },
                          ]}
                          onChange={(value) =>
                            setEnvRows((rows) =>
                              rows.map((item, i) =>
                                i === index ? { ...item, type: value as EnvRow['type'], value: '' } : item,
                              ),
                            )
                          }
                        />
                      ) : (
                        <div className="flex h-[30px] w-[14%] items-center border border-[#2f4f6d] bg-[#16293c] px-2 text-[14px] text-[#c6dbef]">
                          {row.type === 'podType' ? 'Pod类型' : '普通变量'}
                        </div>
                      )}
                      {envEditing && row.type === 'podType' ? (
                        <SelectBox
                          className="w-[40%]"
                          value={row.value}
                          placeholder="请选择"
                          options={POD_FIELD_OPTIONS}
                          onChange={(value) =>
                            setEnvRows((rows) =>
                              rows.map((item, i) => (i === index ? { ...item, value } : item)),
                            )
                          }
                        />
                      ) : (
                        <input
                          className={cn(inputCls, 'w-[40%]')}
                          disabled={!envEditing}
                          value={row.value}
                          onChange={(event) =>
                            setEnvRows((rows) =>
                              rows.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)),
                            )
                          }
                        />
                      )}
                      <span className="w-[16%]">
                        <button
                          type="button"
                          className="text-[14px] text-[#ff6b6b] hover:text-[#ff9a9a]"
                          onClick={() => {
                            setEnvEditing(true)
                            setEnvRows((rows) => rows.filter((_, i) => i !== index))
                          }}
                        >
                          删除
                        </button>
                      </span>
                    </div>
                  ))}
                  {envRows.length === 0 && <div className="py-2 text-[14px] text-mute">暂无环境变量</div>}
                  <button
                    type="button"
                    className={linkCls}
                    onClick={() => {
                      setEnvEditing(true)
                      setEnvRows((rows) => [...rows, { name: '', type: 'text', value: '' }])
                    }}
                  >
                    添加环境变量
                  </button>
                </div>
              </Section>

              {/* 资源配置 */}
              <Section
                id="ResourceSetting"
                title="资源分配"
                editing={resourceEditing}
                onEdit={() => setResourceEditing(true)}
                onSave={() => resourceMutation.mutate()}
                onCancel={() => {
                  setResourceEditing(false)
                  const res = container?.resources
                  setRamMin(res?.requests?.memory ? memValue(res.requests.memory) : '')
                  setRamMax(res?.limits?.memory ? memValue(res.limits.memory) : '')
                  setCpuMin(cpuValue(res?.requests?.cpu))
                  setCpuMax(cpuValue(res?.limits?.cpu))
                  setGpuMax(res?.limits?.gpu?.replace(/[^\d.]/g, '') || '')
                }}
              >
                <div className="mb-4 flex items-center gap-4">
                  <span className="w-[90px] flex-none text-[14px] text-[#c6dbef]">选择配置：</span>
                  <div className="flex items-center gap-5">
                    <Radio
                      checked={resourceMode === '1'}
                      label="X86计算"
                      disabled={!resourceEditing}
                      onClick={() => setResourceMode('1')}
                    />
                    <Radio
                      checked={resourceMode === '2'}
                      label="高性能计算GPU"
                      disabled={!resourceEditing}
                      onClick={() => setResourceMode('2')}
                    />
                  </div>
                  <div className="group relative">
                    <span className="cursor-default text-[14px] text-[#ff6b6b]">ⓘ 剩余资源</span>
                    <div className="pointer-events-none absolute left-0 top-6 z-20 hidden min-w-[260px] border border-[#33506e] bg-[#0e2233] px-3 py-2 text-[12px] leading-[20px] text-[#c6dbef] shadow-lg group-hover:block">
                      {nodeList.length === 0 && <div>暂无节点资源信息</div>}
                      {nodeList.map((node) => (
                        <div key={node.name}>
                          节点：{node.name} cpu: {node.cpu !== undefined ? `${node.cpu} m` : '—'} 内存:{' '}
                          {node.memory !== undefined ? `${node.memory} GB` : '—'}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-stretch gap-3">
                  {resourceMode === '1' &&
                    [
                      { key: '0', title: '1X', ram: '128M 内存', cpu: '0.1~0.5CPU', min: '0.1', max: '0.5', ramMin: '100', ramMax: '128' },
                      { key: '1', title: '4X', ram: '1GB 内存', cpu: '0.4~1CPU', min: '0.4', max: '1', ramMin: '400', ramMax: '1024' },
                      { key: '2', title: '8X', ram: '2GB 内存', cpu: '0.8~1CPU', min: '0.8', max: '1', ramMin: '800', ramMax: '2048' },
                      { key: '3', title: '16X', ram: '4GB 内存', cpu: '1CPU', min: '1', max: '1', ramMin: '1024', ramMax: '4096' },
                      { key: '4', title: '32X', ram: '8GB 内存', cpu: '2CPU', min: '2', max: '2', ramMin: '2048', ramMax: '8192' },
                    ].map((preset) => (
                      <button
                        key={preset.key}
                        type="button"
                        disabled={!resourceEditing}
                        onClick={() => {
                          setResourcePreset(preset.key)
                          setCpuMin(preset.min)
                          setCpuMax(preset.max)
                          setRamMin(preset.ramMin)
                          setRamMax(preset.ramMax)
                        }}
                        className={cn(
                          'h-[92px] w-[88px] flex-none border px-2 py-[10px] text-left text-[14px] leading-[22px] transition-colors',
                          resourcePreset === preset.key
                            ? 'border-[#1890ff] text-[#c6dbef]'
                            : 'border-[#33506e] text-[#c6dbef]',
                        )}
                      >
                        <div className="text-[14px] text-white">{preset.title}</div>
                        <div>{preset.ram}</div>
                        <div>{preset.cpu}</div>
                      </button>
                    ))}
                  <div className="w-[270px] flex-none border border-[#33506e] px-3 py-2">
                    <div className="mb-1 text-[14px] text-white">自定义</div>
                    <div className="flex items-center gap-1.5">
                      <input
                        className="h-[28px] w-[64px] border border-[#2f4f6d] bg-[#16293c] px-1.5 text-[14px] text-[#c6dbef] outline-none focus:border-[#1890ff]"
                        disabled={!resourceEditing}
                        value={ramMin}
                        onChange={(event) => {
                          setRamMin(event.target.value)
                          setResourcePreset('5')
                        }}
                      />
                      <span className="text-[#c6dbef]">~</span>
                      <input
                        className="h-[28px] w-[64px] border border-[#2f4f6d] bg-[#16293c] px-1.5 text-[14px] text-[#c6dbef] outline-none focus:border-[#1890ff]"
                        disabled={!resourceEditing}
                        value={ramMax}
                        onChange={(event) => {
                          setRamMax(event.target.value)
                          setResourcePreset('5')
                        }}
                      />
                      <span className="text-[14px] text-[#c6dbef]">MB内存</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        className="h-[28px] w-[64px] border border-[#2f4f6d] bg-[#16293c] px-1.5 text-[14px] text-[#c6dbef] outline-none focus:border-[#1890ff]"
                        disabled={!resourceEditing}
                        value={cpuMin}
                        onChange={(event) => {
                          setCpuMin(event.target.value)
                          setResourcePreset('5')
                        }}
                      />
                      <span className="text-[#c6dbef]">~</span>
                      <input
                        className="h-[28px] w-[64px] border border-[#2f4f6d] bg-[#16293c] px-1.5 text-[14px] text-[#c6dbef] outline-none focus:border-[#1890ff]"
                        disabled={!resourceEditing}
                        value={cpuMax}
                        onChange={(event) => {
                          setCpuMax(event.target.value)
                          setResourcePreset('5')
                        }}
                      />
                      <span className="text-[14px] text-[#c6dbef]">核CPU</span>
                    </div>
                    {resourceMode === '2' && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <input
                          className="h-[28px] w-[64px] border border-[#2f4f6d] bg-[#16293c] px-1.5 text-[14px] text-[#c6dbef] outline-none focus:border-[#1890ff]"
                          disabled={!resourceEditing}
                          value={gpuMax}
                          onChange={(event) => setGpuMax(event.target.value)}
                        />
                        <span className="text-[14px] text-[#c6dbef]">颗GPU</span>
                      </div>
                    )}
                  </div>
                </div>
              </Section>

              {/* 访问方式 */}
              <Section
                id="AccessMethod"
                title="访问方式"
                editing={accessEditing}
                onEdit={() => setAccessEditing(true)}
                onSave={() =>
                  portMutation.mutate({ type: detail?.service?.spec?.type || 'ClusterIP', rows: portRows })
                }
                onCancel={() => {
                  setAccessEditing(false)
                  const ports = (detail?.service?.spec?.ports ?? []).map((port) => ({
                    port: String(port.port ?? ''),
                    protocol: port.protocol || 'TCP',
                    nodePort: port.nodePort ? String(port.nodePort) : '',
                  }))
                  setPortRows(
                    ports.length
                      ? ports
                      : (container?.ports ?? []).map((port) => ({
                          port: String(port.containerPort ?? ''),
                          protocol: port.protocol || 'TCP',
                          nodePort: '',
                        })),
                  )
                }}
              >
                <div className="mb-1 flex items-center gap-3 text-[14px] text-ink-3">
                  <span className="w-[40%]">映射端口</span>
                  <span className="w-[40%]">协议</span>
                  <span className="w-[20%]">操作</span>
                </div>
                <div className="space-y-2">
                  {portRows.map((row, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <input
                        className={cn(inputCls, 'w-[40%]')}
                        disabled={!accessEditing}
                        value={row.port}
                        onChange={(event) =>
                          setPortRows((rows) =>
                            rows.map((item, i) => (i === index ? { ...item, port: event.target.value } : item)),
                          )
                        }
                      />
                      <SelectBox
                        className="w-[40%]"
                        disabled={!accessEditing}
                        value={row.protocol}
                        options={[
                          { value: 'TCP', label: 'TCP' },
                          { value: 'UDP', label: 'UDP' },
                        ]}
                        onChange={(value) =>
                          setPortRows((rows) =>
                            rows.map((item, i) => (i === index ? { ...item, protocol: value } : item)),
                          )
                        }
                      />
                      <span className="w-[20%]">
                        <button
                          type="button"
                          className="text-[14px] text-[#ff6b6b]"
                          onClick={() => {
                            setAccessEditing(true)
                            setPortRows((rows) => rows.filter((_, i) => i !== index))
                          }}
                        >
                          删除
                        </button>
                      </span>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={linkCls}
                    onClick={() => {
                      setAccessEditing(true)
                      setPortRows((rows) => [...rows, { port: '', protocol: 'TCP', nodePort: '' }])
                    }}
                  >
                    添加映射端口
                  </button>
                </div>
              </Section>

              {/* 服务发现 */}
              <Section
                id="ServiceSearchSetting"
                title="服务发现"
                editing={discoveryEditing}
                onEdit={() => setDiscoveryEditing(true)}
                onSave={() =>
                  portMutation.mutate({
                    type: nodePortEnabled ? 'NodePort' : 'ClusterIP',
                    rows: nodePortEnabled ? nodeRows : portRows,
                  })
                }
                onCancel={() => {
                  setDiscoveryEditing(false)
                  setNodePortEnabled((detail?.service?.spec?.type || 'ClusterIP') === 'NodePort')
                  setNodeRows(
                    (detail?.service?.spec?.ports ?? [])
                      .filter((port) => port.nodePort)
                      .map((port) => ({
                        port: String(port.port ?? ''),
                        protocol: port.protocol || 'TCP',
                        nodePort: String(port.nodePort ?? ''),
                      })),
                  )
                }}
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="w-[110px] flex-none text-[14px] text-ink-3">NodePort</span>
                  <div className="flex items-center gap-5">
                    <Radio
                      checked={nodePortEnabled}
                      label="启用"
                      disabled={!discoveryEditing}
                      onClick={() => setNodePortEnabled(true)}
                    />
                    <Radio
                      checked={!nodePortEnabled}
                      label="禁用"
                      disabled={!discoveryEditing}
                      onClick={() => setNodePortEnabled(false)}
                    />
                  </div>
                </div>
                {nodePortEnabled && (
                  <>
                    <div className="mb-1 flex items-center gap-3 text-[14px] text-ink-3">
                      <span className="w-[40%]">端口</span>
                      <span className="w-[40%]">协议</span>
                      <span className="w-[20%]">操作</span>
                    </div>
                    <div className="space-y-2">
                      {nodeRows.map((row, index) => (
                        <div key={index} className="flex items-center gap-3">
                          <div className="flex w-[40%] items-center gap-2">
                            <input className={inputCls} disabled value={row.port} placeholder="端口" />
                            <input
                              className={inputCls}
                              disabled={!discoveryEditing}
                              value={row.nodePort}
                              placeholder="不填则自动分配端口号"
                              onChange={(event) =>
                                setNodeRows((rows) =>
                                  rows.map((item, i) =>
                                    i === index ? { ...item, nodePort: event.target.value } : item,
                                  ),
                                )
                              }
                            />
                          </div>
                          <input className={cn(inputCls, 'w-[40%]')} disabled value={row.protocol} />
                          <span className="w-[20%]">
                            <button
                              type="button"
                              className="text-[14px] text-[#ff6b6b]"
                              onClick={() => {
                                setDiscoveryEditing(true)
                                setNodeRows((rows) => rows.filter((_, i) => i !== index))
                              }}
                            >
                              删除
                            </button>
                          </span>
                        </div>
                      ))}
                      <button
                        type="button"
                        className={linkCls}
                        onClick={() => {
                          setDiscoveryEditing(true)
                          setNodeRows((rows) => [...rows, { port: '', protocol: 'TCP', nodePort: '' }])
                        }}
                      >
                        添加NodePort
                      </button>
                    </div>
                  </>
                )}
              </Section>

              {/* 辅助设置 */}
              <Section
                id="AssistSetting"
                title="辅助设置"
                editing={assistEditing}
                onEdit={() => setAssistEditing(true)}
                onSave={() => commandMutation.mutate()}
                onCancel={() => {
                  setAssistEditing(false)
                  const cmd = container?.command ?? []
                  const cmdArgs = container?.args ?? []
                  setEntryMode(cmd.length ? '2' : '1')
                  setCommands(cmd)
                  setArgs(cmdArgs)
                }}
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="w-[110px] flex-none text-[14px] text-ink-3">进入点</span>
                  <div className="flex items-center gap-5">
                    <Radio
                      checked={entryMode === '1'}
                      label="镜像默认"
                      disabled={!assistEditing}
                      onClick={() => setEntryMode('1')}
                    />
                    <Radio
                      checked={entryMode === '2'}
                      label="自定义"
                      disabled={!assistEditing}
                      onClick={() => {
                        setEntryMode('2')
                        setCommands((rows) => (rows.length ? rows : ['']))
                        setArgs((rows) => (rows.length ? rows : ['']))
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[14px] text-ink-3">启动命令</div>
                  {commands.map((value, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        className={inputCls}
                        disabled={!assistEditing || entryMode === '1'}
                        placeholder={entryMode === '1' ? '镜像默认' : ''}
                        value={value}
                        onChange={(event) =>
                          setCommands((rows) => rows.map((item, i) => (i === index ? event.target.value : item)))
                        }
                      />
                      {assistEditing && commands.length > 1 && (
                        <button
                          type="button"
                          className="text-[14px] text-[#ff6b6b]"
                          onClick={() => setCommands((rows) => rows.filter((_, i) => i !== index))}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  ))}
                  {commands.length === 0 && (
                    <input className={inputCls} disabled placeholder="镜像默认" value="" readOnly />
                  )}
                  {assistEditing && entryMode === '2' && (
                    <button type="button" className={linkCls} onClick={() => setCommands((rows) => [...rows, ''])}>
                      添加一个命令
                    </button>
                  )}
                  <div className="pt-2 text-[14px] text-ink-3">启动参数</div>
                  {args.map((value, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        className={inputCls}
                        disabled={!assistEditing || entryMode === '1'}
                        value={value}
                        onChange={(event) =>
                          setArgs((rows) => rows.map((item, i) => (i === index ? event.target.value : item)))
                        }
                      />
                      {assistEditing && args.length > 1 && (
                        <button
                          type="button"
                          className="text-[14px] text-[#ff6b6b]"
                          onClick={() => setArgs((rows) => rows.filter((_, i) => i !== index))}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  ))}
                  {args.length === 0 && <input className={inputCls} disabled placeholder="镜像默认" value="" readOnly />}
                  {assistEditing && entryMode === '2' && (
                    <button type="button" className={linkCls} onClick={() => setArgs((rows) => [...rows, ''])}>
                      添加一个参数
                    </button>
                  )}
                </div>
              </Section>

              {/* 服务配置 */}
              <Section
                id="SerConfigSetting"
                title="配置管理"
                editing={configEditing}
                onEdit={() => setConfigEditing(true)}
                onSave={saveVolumes}
                onCancel={() => {
                  setConfigEditing(false)
                  const mounts = container?.volumeMounts ?? []
                  const volumes = podSpec?.volumes ?? []
                  setVolumeRows(
                    volumes
                      .filter((volume) => volume.hostPath?.path)
                      .map((volume) => ({
                        hostPath: volume.hostPath?.path || '',
                        podPath: mounts.find((item) => item.name === volume.name)?.mountPath || '',
                        readOnly: !!mounts.find((item) => item.name === volume.name)?.readOnly,
                      })),
                  )
                }}
              >
                <div className="mb-1.5 flex items-center gap-3 text-[14px] text-[#c6dbef]">
                  <span className="w-[26%]">文件映射：挂载目录</span>
                  <span className="w-[26%]">配置组</span>
                  <span className="w-[36%]">配置文件</span>
                  <span className="w-[12%]">操作</span>
                </div>
                <div className="mb-4 space-y-2">
                  {configRows.map((row, index) => {
                    const group = configMaps.find((item) => item.metadata?.name === row.configmap)
                    const availableKeys = Object.keys(group?.data ?? {})
                      .filter((key) => !row.keys.includes(key))
                      .filter((key) =>
                        fileSearch && fileSearch.row === index
                          ? key.toLowerCase().includes(fileSearch.value.toLowerCase())
                          : true,
                      )
                    return (
                      <div key={index} className="flex items-center gap-3">
                        <input
                          className={cn(inputCls, 'w-[26%]')}
                          disabled={!configEditing}
                          placeholder="挂载目录"
                          value={row.dir}
                          onChange={(event) =>
                            setConfigRows((rows) =>
                              rows.map((item, i) => (i === index ? { ...item, dir: event.target.value } : item)),
                            )
                          }
                        />
                        <SelectBox
                          className="w-[26%]"
                          searchable
                          placeholder="请选择配置组"
                          disabled={!configEditing}
                          value={row.configmap}
                          options={configMaps
                            .map((item) => item.metadata?.name || '')
                            .filter(Boolean)
                            .map((name) => ({ value: name, label: name }))}
                          onChange={(value) =>
                            setConfigRows((rows) =>
                              rows.map((item, i) => (i === index ? { ...item, configmap: value, keys: [] } : item)),
                            )
                          }
                        />
                        <div className="relative w-[36%]">
                          <div className="flex min-h-[30px] flex-wrap items-center gap-1 border border-[#2f4f6d] bg-[#16293c] px-1.5 py-0.5">
                            {row.keys.map((key) => (
                              <span
                                key={key}
                                className="flex items-center gap-1 bg-[#23405c] px-1.5 py-[1px] text-[12px] text-[#c6dbef]"
                              >
                                {key}
                                {configEditing && (
                                  <button
                                    type="button"
                                    className="text-[#9db4ca] hover:text-white"
                                    onClick={() =>
                                      setConfigRows((rows) =>
                                        rows.map((item, i) =>
                                          i === index
                                            ? { ...item, keys: item.keys.filter((value) => value !== key) }
                                            : item,
                                        ),
                                      )
                                    }
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                            {configEditing && (
                              <input
                                className="min-w-[60px] flex-1 bg-transparent px-1 text-[14px] text-[#c6dbef] outline-none placeholder:text-[#6f8aa5]"
                                value={fileSearch?.row === index ? fileSearch.value : ''}
                                placeholder={row.keys.length ? '' : '请选择配置文件'}
                                onFocus={() => setFileSearch({ row: index, value: '' })}
                                onChange={(event) => setFileSearch({ row: index, value: event.target.value })}
                                onBlur={() =>
                                  window.setTimeout(
                                    () => setFileSearch((prev) => (prev?.row === index ? null : prev)),
                                    150,
                                  )
                                }
                              />
                            )}
                          </div>
                          {configEditing && fileSearch?.row === index && availableKeys.length > 0 && (
                            <div className="absolute left-0 top-full z-30 mt-0.5 max-h-[180px] w-full overflow-auto border border-[#2f4f6d] bg-[#0e2233]">
                              {availableKeys.map((key) => (
                                <button
                                  key={key}
                                  type="button"
                                  className="block w-full px-2 py-1.5 text-left text-[14px] text-[#c6dbef] hover:bg-[#15395c]"
                                  onMouseDown={(event) => {
                                    event.preventDefault()
                                    setConfigRows((rows) =>
                                      rows.map((item, i) =>
                                        i === index ? { ...item, keys: [...item.keys, key] } : item,
                                      ),
                                    )
                                    setFileSearch({ row: index, value: '' })
                                  }}
                                >
                                  {key}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="w-[12%]">
                          <button
                            type="button"
                            className="text-[14px] text-[#ff6b6b]"
                            onClick={() => {
                              setConfigEditing(true)
                              setConfigRows((rows) => rows.filter((_, i) => i !== index))
                            }}
                          >
                            删除
                          </button>
                        </span>
                      </div>
                    )
                  })}
                  {configRows.length === 0 && <div className="py-1 text-[14px] text-mute">暂无配置组挂载</div>}
                  {configMaps.length > 0 && (
                    <button
                      type="button"
                      className={linkCls}
                      onClick={() => {
                        setConfigEditing(true)
                        setConfigRows((rows) => [
                          ...rows,
                          {
                            dir: '',
                            configmap: '',
                            keys: [],
                          },
                        ])
                      }}
                    >
                      添加配置目录
                    </button>
                  )}
                </div>
                <div className="mb-1.5 flex items-center gap-3 text-[14px] text-[#c6dbef]">
                  <span className="w-[26%]">主机路径：宿主目录</span>
                  <span className="w-[26%]">容器目录</span>
                  <span className="w-[36%]">读写权限</span>
                  <span className="w-[12%]">操作</span>
                </div>
                <div className="space-y-2">
                  {volumeRows.map((row, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <input
                        className={cn(inputCls, 'w-[26%]')}
                        disabled={!configEditing}
                        value={row.hostPath}
                        onChange={(event) =>
                          setVolumeRows((rows) =>
                            rows.map((item, i) => (i === index ? { ...item, hostPath: event.target.value } : item)),
                          )
                        }
                      />
                      <input
                        className={cn(inputCls, 'w-[26%]')}
                        disabled={!configEditing}
                        value={row.podPath}
                        onChange={(event) =>
                          setVolumeRows((rows) =>
                            rows.map((item, i) => (i === index ? { ...item, podPath: event.target.value } : item)),
                          )
                        }
                      />
                      <SelectBox
                        className="w-[36%]"
                        disabled={!configEditing}
                        value={row.readOnly ? '2' : '1'}
                        options={[
                          { value: '1', label: '可读可写' },
                          { value: '2', label: '只读' },
                        ]}
                        onChange={(value) =>
                          setVolumeRows((rows) =>
                            rows.map((item, i) => (i === index ? { ...item, readOnly: value === '2' } : item)),
                          )
                        }
                      />
                      <span className="w-[12%]">
                        <button
                          type="button"
                          className="text-[14px] text-[#ff6b6b]"
                          onClick={() => {
                            setConfigEditing(true)
                            setVolumeRows((rows) => rows.filter((_, i) => i !== index))
                          }}
                        >
                          删除
                        </button>
                      </span>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={linkCls}
                    onClick={() => {
                      setConfigEditing(true)
                      setVolumeRows((rows) => [...rows, { hostPath: '', podPath: '', readOnly: false }])
                    }}
                  >
                    添加主机路径
                  </button>
                </div>
              </Section>

              {/* 健康检查 */}
              <Section
                id="HealthCheck"
                title="健康检查"
                editing={healthEditing}
                onEdit={() => setHealthEditing(true)}
                onSave={() => healthMutation.mutate()}
                onCancel={() => {
                  setHealthEditing(false)
                  setReadiness(probeToForm(container?.readinessProbe))
                  setLiveness(probeToForm(container?.livenessProbe))
                }}
              >
                {probeEditor(readiness, setReadiness, '就绪状态检测')}
                {probeEditor(liveness, setLiveness, '存活状态检测')}
              </Section>

              {/* 节点调度 */}
              <Section
                id="NodeSelectorSetting"
                title="节点调度"
                editing={nodeEditing}
                onEdit={() => setNodeEditing(true)}
                onSave={() => scheduleMutation.mutate()}
                onCancel={() => {
                  setNodeEditing(false)
                  const nodeSelector = podSpec?.nodeSelector ?? {}
                  const affinity = podSpec?.affinity ?? null
                  const selectedNode = nodeSelector['kubernetes.io/hostname']
                  setNodeMode(selectedNode ? '2' : affinity && Object.keys(affinity).length ? '3' : '1')
                  setAdvNode(selectedNode || '')
                  const parsed = affinityRowsFrom(affinity)
                  setNodeAffinityRows(
                    parsed.nodeRows.length
                      ? parsed.nodeRows
                      : [{ mode: '1', host: 'kubernetes.io/hostname', operator: 'In', value: '' }],
                  )
                  setServiceAffinityRows(
                    parsed.serviceRows.length
                      ? parsed.serviceRows
                      : [{ mode: '1', service: '', operator: 'In', value: '' }],
                  )
                }}
              >
                <div className="mb-3 flex flex-wrap items-center gap-6">
                  <Radio
                    checked={nodeMode === '1'}
                    label="系统默认调度"
                    disabled={!nodeEditing}
                    onClick={() => setNodeMode('1')}
                  />
                  <Radio
                    checked={nodeMode === '2'}
                    label="指定主机名及IP上运行"
                    disabled={!nodeEditing}
                    onClick={() => setNodeMode('2')}
                  />
                  <Radio
                    checked={nodeMode === '3'}
                    label="定义服务与节点亲和性 & 服务与服务的亲和性"
                    disabled={!nodeEditing}
                    onClick={() => setNodeMode('3')}
                  />
                </div>
                {nodeMode === '2' && (
                  <FieldRow label="指定节点" wide>
                    <SelectBox
                      disabled={!nodeEditing}
                      placeholder="请选择节点"
                      value={advNode}
                      options={nodeList.map((node) => ({
                        value: node.name || '',
                        label: `${node.name || ''}${node.ip ? ` | ${node.ip}` : ''}`,
                      }))}
                      onChange={(value) => setAdvNode(value)}
                    />
                  </FieldRow>
                )}
                {nodeMode === '3' && (
                  <>
                    <div className="mb-1 text-[14px] text-[#c6dbef]">服务与节点亲和性</div>
                    <div className="mb-1 grid grid-cols-[110px_1fr_160px_1fr_80px] gap-3 text-[12px] text-ink-3">
                      <span>方式</span>
                      <span>主机</span>
                      <span>操作符</span>
                      <span>主机标签值</span>
                      <span className="text-right">操作</span>
                    </div>
                    <div className="space-y-2">
                      {nodeAffinityRows.map((row, index) => (
                        <div key={index} className="grid grid-cols-[110px_1fr_160px_1fr_80px] items-center gap-3">
                          <SelectBox
                            disabled={!nodeEditing}
                            value={row.mode}
                            options={[
                              { value: '1', label: '最好' },
                              { value: '0', label: '必须' },
                              { value: '2', label: '最好不' },
                              { value: '3', label: '必须不' },
                            ]}
                            onChange={(value) =>
                              setNodeAffinityRows((rows) =>
                                rows.map((item, i) => (i === index ? { ...item, mode: value } : item)),
                              )
                            }
                          />
                          <SelectBox
                            disabled={!nodeEditing}
                            placeholder="请选择"
                            value={row.host}
                            options={[
                              { value: 'kubernetes.io/hostname', label: '主机名及IP' },
                              { value: 'kubernetes.io/os', label: '系统默认选择器' },
                            ]}
                            onChange={(value) =>
                              setNodeAffinityRows((rows) =>
                                rows.map((item, i) => (i === index ? { ...item, host: value } : item)),
                              )
                            }
                          />
                          <SelectBox
                            disabled={!nodeEditing}
                            value={row.operator}
                            options={[
                              { value: 'In', label: 'In' },
                              { value: 'NotIn', label: 'NotIn' },
                              { value: 'Exists', label: 'Exists' },
                              { value: 'DoesNotExist', label: 'DoesNotExist' },
                            ]}
                            onChange={(value) =>
                              setNodeAffinityRows((rows) =>
                                rows.map((item, i) => (i === index ? { ...item, operator: value } : item)),
                              )
                            }
                          />
                          <input
                            className={inputCls}
                            disabled={!nodeEditing}
                            placeholder="主机标签值"
                            value={row.value}
                            onChange={(event) =>
                              setNodeAffinityRows((rows) =>
                                rows.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)),
                              )
                            }
                          />
                          <span className="text-right">
                            <button
                              type="button"
                              className="text-[14px] text-[#ff6b6b]"
                              onClick={() => {
                                setNodeEditing(true)
                                setNodeAffinityRows((rows) => rows.filter((_, i) => i !== index))
                              }}
                            >
                              删除
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="mt-2 h-[30px] bg-[#1670c2] px-4 text-[14px] text-white"
                      onClick={() => {
                        setNodeEditing(true)
                        setNodeAffinityRows((rows) => [
                          ...rows,
                          { mode: '1', host: 'kubernetes.io/hostname', operator: 'In', value: '' },
                        ])
                      }}
                    >
                      添加
                    </button>

                    <div className="mb-1 mt-6 text-[14px] text-[#c6dbef]">服务与服务亲和性</div>
                    <div className="mb-1 grid grid-cols-[110px_1fr_160px_1fr_80px] gap-3 text-[12px] text-ink-3">
                      <span>方式</span>
                      <span>服务</span>
                      <span>操作符</span>
                      <span>服务标签值</span>
                      <span className="text-right">操作</span>
                    </div>
                    <div className="space-y-2">
                      {serviceAffinityRows.map((row, index) => (
                        <div key={index} className="grid grid-cols-[110px_1fr_160px_1fr_80px] items-center gap-3">
                          <SelectBox
                            disabled={!nodeEditing}
                            value={row.mode}
                            options={[
                              { value: '1', label: '最好' },
                              { value: '0', label: '必须' },
                              { value: '2', label: '最好不' },
                              { value: '3', label: '必须不' },
                            ]}
                            onChange={(value) =>
                              setServiceAffinityRows((rows) =>
                                rows.map((item, i) => (i === index ? { ...item, mode: value } : item)),
                              )
                            }
                          />
                          <SelectBox
                            disabled={!nodeEditing}
                            placeholder="请选择"
                            value={row.service}
                            options={services
                              .map((service) => serviceNameOf(service))
                              .filter(Boolean)
                              .map((name) => ({ value: name, label: name }))}
                            onChange={(value) =>
                              setServiceAffinityRows((rows) =>
                                rows.map((item, i) => (i === index ? { ...item, service: value } : item)),
                              )
                            }
                          />
                          <SelectBox
                            disabled={!nodeEditing}
                            value={row.operator}
                            options={[
                              { value: 'In', label: 'In' },
                              { value: 'NotIn', label: 'NotIn' },
                              { value: 'Exists', label: 'Exists' },
                              { value: 'DoesNotExist', label: 'DoesNotExist' },
                            ]}
                            onChange={(value) =>
                              setServiceAffinityRows((rows) =>
                                rows.map((item, i) => (i === index ? { ...item, operator: value } : item)),
                              )
                            }
                          />
                          <input
                            className={inputCls}
                            disabled={!nodeEditing}
                            placeholder="服务标签值"
                            value={row.value}
                            onChange={(event) =>
                              setServiceAffinityRows((rows) =>
                                rows.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)),
                              )
                            }
                          />
                          <span className="text-right">
                            <button
                              type="button"
                              className="text-[14px] text-[#ff6b6b]"
                              onClick={() => {
                                setNodeEditing(true)
                                setServiceAffinityRows((rows) => rows.filter((_, i) => i !== index))
                              }}
                            >
                              删除
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="mt-2 h-[30px] bg-[#1670c2] px-4 text-[14px] text-white"
                      onClick={() => {
                        setNodeEditing(true)
                        setServiceAffinityRows((rows) => [
                          ...rows,
                          { mode: '1', service: '', operator: 'In', value: '' },
                        ])
                      }}
                    >
                      添加
                    </button>
                  </>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
