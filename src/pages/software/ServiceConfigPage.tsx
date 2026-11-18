import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, X } from 'lucide-react'
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
  value: string
}

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
  'h-[30px] w-full border border-[#2f4f6d] bg-[#16293c] px-2 text-[12px] text-[#c6dbef] outline-none transition-colors disabled:cursor-default disabled:opacity-95 focus:border-[#1890ff]'

const linkCls = 'text-[12px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]'

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
      <span className="w-[110px] flex-none text-[12px] text-[#9db4ca]">{label}</span>
      <div className={wide ? 'w-[420px] flex-none' : 'w-[240px] flex-none'}>{children}</div>
      <div className="flex w-[92px] flex-none items-center gap-3 text-[12px]">{action}</div>
    </div>
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
      <div className="mb-2 flex h-7 items-center justify-between">
        <h3 className="text-[13.5px] font-semibold text-white">{title}</h3>
        <div className="flex items-center gap-3 text-[12px]">
          {extra}
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
      </div>
      {children}
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
  const [envRows, setEnvRows] = useState<EnvRow[]>([{ name: '', value: '' }])

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

  const [healthEditing, setHealthEditing] = useState(false)
  const [readiness, setReadiness] = useState<ProbeForm>(emptyProbe)
  const [liveness, setLiveness] = useState<ProbeForm>(emptyProbe)

  const [nodeEditing, setNodeEditing] = useState(false)
  const [nodeMode, setNodeMode] = useState<'1' | '2' | '3'>('1')
  const [advNode, setAdvNode] = useState('')
  const [advAffinity, setAdvAffinity] = useState('')

  const servicesQuery = useQuery({
    queryKey: ['config-services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
    enabled: !selected,
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

  const configMapQuery = useQuery({
    queryKey: ['config-maps'],
    queryFn: () => api.get<{ items?: ConfigMapItem[]; total?: number }>('/v1/config_map'),
    enabled: !!selected,
  })
  const configMaps = configMapQuery.data?.items ?? []

  const nodesQuery = useQuery({
    queryKey: ['config-nodes'],
    queryFn: () => api.get<{ nodes?: { nodes?: Array<{ name?: string; ip?: string }> } }>('/cloud/nodes'),
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
    const env = (container?.env ?? []).map((item) => ({ name: item.name, value: item.value ?? '' }))
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
    setAdvAffinity(affinity && Object.keys(affinity).length ? JSON.stringify(affinity, null, 2) : '')
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
        env: envRows.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), value: row.value })),
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
      let affinity: Record<string, unknown> = {}
      if (nodeMode === '3' && advAffinity.trim()) {
        let parsed: unknown
        try {
          parsed = JSON.parse(advAffinity)
        } catch {
          throw new Error('亲和性不是合法的 JSON')
        }
        affinity = (parsed ?? {}) as Record<string, unknown>
      }
      const nodeSelector = nodeMode === '2' && advNode ? { 'kubernetes.io/hostname': advNode } : null
      await api.put('/v1/service/patchService', {
        svcName: selected,
        requestBody: { spec: { template: { spec: { affinity, nodeSelector } } } },
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
    if (searchParams.has('service')) {
      const next = new URLSearchParams(searchParams)
      next.delete('service')
      setSearchParams(next, { replace: true })
    }
    navigate('/software/application/service')
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
      节点调度: { nodeMode, advNode, advAffinity },
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
              <tr className="bg-paper-2/50 text-[12px] text-ink-3">
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
                    className="cursor-pointer border-t border-line text-[12px] hover:bg-paper-2/40"
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
                  <td colSpan={4} className="py-10 text-center text-[12px] text-mute">
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
        <span className="text-[12.5px] text-ink">{label}</span>
        <div className="flex border border-[#2f4f6d]">
          {[
            { value: 0, label: '无' },
            { value: 1, label: 'HTTP' },
            { value: 2, label: 'TCP' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={!healthEditing}
              onClick={() => setForm({ ...form, type: option.value })}
              className={cn(
                '-ml-px border border-[#2f4f6d] px-3 py-1 text-[12px] first:ml-0',
                form.type === option.value ? 'bg-[#1670c2] text-white' : 'text-ink-3',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {form.type !== 0 && (
        <>
          <div className="mb-1 text-[11.5px] text-[#ff6b6b]">
            {form.type === 1
              ? '通过 HTTP GET 请求进行健康检查。如果响应状态码小于 400，则认为容器健康'
              : '检测端口是否为打开状态，若端口为关闭或进程停止关闭状态，则健康检查不通过'}
          </div>
          <div className="grid grid-cols-4 gap-2 text-[11.5px] text-ink-3">
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
          <div className={cn('grid gap-2 text-[11.5px] text-ink-3', form.type === 1 ? 'grid-cols-3' : 'grid-cols-4')}>
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
        <nav className="w-[130px] flex-none border-r border-[#1b3550] bg-[#0e2233] py-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                setActiveNav(item.id)
              }}
              className={cn(
                'flex h-[34px] w-full items-center border-l-[3px] px-3 text-left text-[12px] transition-colors',
                activeNav === item.id
                  ? 'border-signal bg-[#15395c] text-white'
                  : 'border-transparent text-ink-3 hover:bg-[#142a3e] hover:text-white',
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto px-6 py-4">
          {detailQuery.isLoading ? (
            <div className="py-20 text-center text-[12px] text-mute">正在读取服务配置…</div>
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
                  <div className="min-h-[30px] w-[420px] border border-[#2f4f6d] bg-[#16293c] px-2 py-1.5 text-[11.5px] leading-[18px] text-[#c6dbef]">
                    {addressText}
                  </div>
                </FieldRow>
                <FieldRow label="资源优先级" action={basicEditLink('priority', () => priorityMutation.mutate())}>
                  <select
                    className={inputCls}
                    disabled={editingField !== 'priority'}
                    value={basic.priority}
                    onChange={(event) => setBasic({ ...basic, priority: event.target.value })}
                  >
                    <option value="">无</option>
                    {priorityClasses.map((item) => {
                      const name = item.metadata?.name || ''
                      if (!name) return null
                      return (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      )
                    })}
                  </select>
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
                            'border px-2 py-0.5 text-[11px]',
                            basic.serverKeys.includes(key)
                              ? 'border-signal bg-signal text-white'
                              : 'border-[#3d5f80] text-ink-3',
                          )}
                        >
                          {key}
                        </button>
                      ))}
                      {serviceKeyOptions.length === 0 && <span className="text-[11px] text-mute">暂无可选服务</span>}
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
                  setEnvRows((container?.env ?? []).map((item) => ({ name: item.name, value: item.value ?? '' })))
                }}
              >
                <div className="mb-1 flex items-center gap-3 text-[12px] text-ink-3">
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
                        <select className={cn(inputCls, 'w-[14%]')} disabled>
                          <option>普通变量</option>
                        </select>
                      ) : (
                        <div className="flex h-[30px] w-[14%] items-center border border-[#2f4f6d] bg-[#16293c] px-2 text-[12px] text-[#c6dbef]">
                          普通变量
                        </div>
                      )}
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
                      <span className="w-[16%]">
                        <button
                          type="button"
                          className="text-[12px] text-[#ff6b6b] hover:text-[#ff9a9a]"
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
                  {envRows.length === 0 && <div className="py-2 text-[12px] text-mute">暂无环境变量</div>}
                  <button
                    type="button"
                    className={linkCls}
                    onClick={() => {
                      setEnvEditing(true)
                      setEnvRows((rows) => [...rows, { name: '', value: '' }])
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
                <div className="mb-3 flex items-center gap-3">
                  <span className="w-[110px] flex-none text-[12px] text-ink-3">选择配置</span>
                  <div className="flex border border-[#2f4f6d]">
                    {[
                      { value: '1' as const, label: 'X86计算' },
                      { value: '2' as const, label: '高性能计算GPU' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={!resourceEditing}
                        onClick={() => setResourceMode(option.value)}
                        className={cn(
                          '-ml-px border border-[#2f4f6d] px-3 py-1 text-[12px] first:ml-0',
                          resourceMode === option.value ? 'bg-[#1670c2] text-white' : 'text-ink-3',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[12px] text-[#ff6b6b]">剩余资源</span>
                </div>
                {resourceMode === '1' ? (
                  <div className="grid grid-cols-3 gap-3">
                    {[
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
                          'border px-3 py-2 text-left text-[12px]',
                          resourcePreset === preset.key
                            ? 'border-signal bg-[#15395c] text-white'
                            : 'border-[#2f4f6d] text-ink-3',
                        )}
                      >
                        <div className="text-[13px] text-white">{preset.title}</div>
                        <div>{preset.ram}</div>
                        <div>{preset.cpu}</div>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="mb-1 text-[11px] text-ink-3">内存（MB）</div>
                    <div className="flex items-center gap-2">
                      <input
                        className={inputCls}
                        disabled={!resourceEditing}
                        value={ramMin}
                        onChange={(event) => {
                          setRamMin(event.target.value)
                          setResourcePreset('5')
                        }}
                      />
                      <span className="text-ink-3">~</span>
                      <input
                        className={inputCls}
                        disabled={!resourceEditing}
                        value={ramMax}
                        onChange={(event) => {
                          setRamMax(event.target.value)
                          setResourcePreset('5')
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] text-ink-3">CPU（核）</div>
                    <div className="flex items-center gap-2">
                      <input
                        className={inputCls}
                        disabled={!resourceEditing}
                        value={cpuMin}
                        onChange={(event) => {
                          setCpuMin(event.target.value)
                          setResourcePreset('5')
                        }}
                      />
                      <span className="text-ink-3">~</span>
                      <input
                        className={inputCls}
                        disabled={!resourceEditing}
                        value={cpuMax}
                        onChange={(event) => {
                          setCpuMax(event.target.value)
                          setResourcePreset('5')
                        }}
                      />
                    </div>
                  </div>
                  {resourceMode === '2' && (
                    <div>
                      <div className="mb-1 text-[11px] text-ink-3">GPU（颗）</div>
                      <input
                        className={inputCls}
                        disabled={!resourceEditing}
                        value={gpuMax}
                        onChange={(event) => setGpuMax(event.target.value)}
                      />
                    </div>
                  )}
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
                <div className="mb-1 flex items-center gap-3 text-[12px] text-ink-3">
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
                      <select
                        className={cn(inputCls, 'w-[40%]')}
                        disabled={!accessEditing}
                        value={row.protocol}
                        onChange={(event) =>
                          setPortRows((rows) =>
                            rows.map((item, i) => (i === index ? { ...item, protocol: event.target.value } : item)),
                          )
                        }
                      >
                        <option value="TCP">TCP</option>
                        <option value="UDP">UDP</option>
                      </select>
                      <span className="w-[20%]">
                        <button
                          type="button"
                          className="text-[12px] text-[#ff6b6b]"
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
                  <span className="w-[110px] flex-none text-[12px] text-ink-3">NodePort</span>
                  <div className="flex border border-[#2f4f6d]">
                    {[
                      { value: true, label: '启用' },
                      { value: false, label: '禁用' },
                    ].map((option) => (
                      <button
                        key={String(option.value)}
                        type="button"
                        disabled={!discoveryEditing}
                        onClick={() => setNodePortEnabled(option.value)}
                        className={cn(
                          '-ml-px border border-[#2f4f6d] px-3 py-1 text-[12px] first:ml-0',
                          nodePortEnabled === option.value ? 'bg-[#1670c2] text-white' : 'text-ink-3',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {nodePortEnabled && (
                  <>
                    <div className="mb-1 flex items-center gap-3 text-[12px] text-ink-3">
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
                              className="text-[12px] text-[#ff6b6b]"
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
                  <span className="w-[110px] flex-none text-[12px] text-ink-3">进入点</span>
                  <div className="flex border border-[#2f4f6d]">
                    {[
                      { value: '1' as const, label: '镜像默认' },
                      { value: '2' as const, label: '自定义' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={!assistEditing}
                        onClick={() => {
                          setEntryMode(option.value)
                          if (option.value === '2') {
                            setCommands((rows) => (rows.length ? rows : ['']))
                            setArgs((rows) => (rows.length ? rows : ['']))
                          }
                        }}
                        className={cn(
                          '-ml-px border border-[#2f4f6d] px-3 py-1 text-[12px] first:ml-0',
                          entryMode === option.value ? 'bg-[#1670c2] text-white' : 'text-ink-3',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-[12px] text-ink-3">启动命令</div>
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
                          className="text-[12px] text-[#ff6b6b]"
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
                  <div className="pt-2 text-[12px] text-ink-3">启动参数</div>
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
                          className="text-[12px] text-[#ff6b6b]"
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
                <div className="mb-1 flex items-center gap-3 text-[12px] text-ink-3">
                  <span className="w-[26%]">挂载目录</span>
                  <span className="w-[26%]">配置组</span>
                  <span className="w-[36%]">配置文件</span>
                  <span className="w-[12%]">操作</span>
                </div>
                <div className="mb-4 space-y-2">
                  {configRows.map((row, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <input className={cn(inputCls, 'w-[26%]')} disabled value={row.dir} />
                      <input className={cn(inputCls, 'w-[26%]')} disabled value={row.configmap} />
                      <input className={cn(inputCls, 'w-[36%]')} disabled value={row.keys.join(', ')} />
                      <span className="w-[12%]">
                        <button
                          type="button"
                          className="text-[12px] text-[#ff6b6b]"
                          onClick={() => {
                            setConfigEditing(true)
                            setConfigRows((rows) => rows.filter((_, i) => i !== index))
                          }}
                        >
                          删除
                        </button>
                      </span>
                    </div>
                  ))}
                  {configRows.length === 0 && <div className="py-1 text-[12px] text-mute">暂无配置组挂载</div>}
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
                            configmap: configMaps[0].metadata?.name || '',
                            keys: Object.keys(configMaps[0].data ?? {}),
                          },
                        ])
                      }}
                    >
                      添加配置目录
                    </button>
                  )}
                </div>
                <div className="mb-1 flex items-center gap-3 text-[12px] text-ink-3">
                  <span className="w-[26%]">宿主目录</span>
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
                      <select
                        className={cn(inputCls, 'w-[36%]')}
                        disabled={!configEditing}
                        value={row.readOnly ? '2' : '1'}
                        onChange={(event) =>
                          setVolumeRows((rows) =>
                            rows.map((item, i) =>
                              i === index ? { ...item, readOnly: event.target.value === '2' } : item,
                            ),
                          )
                        }
                      >
                        <option value="1">可读可写</option>
                        <option value="2">只读</option>
                      </select>
                      <span className="w-[12%]">
                        <button
                          type="button"
                          className="text-[12px] text-[#ff6b6b]"
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
                  setAdvAffinity(affinity && Object.keys(affinity).length ? JSON.stringify(affinity, null, 2) : '')
                }}
              >
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <span className="w-[110px] flex-none text-[12px] text-ink-3">调度方式</span>
                  <div className="flex border border-[#2f4f6d]">
                    {[
                      { value: '1' as const, label: '系统默认调度' },
                      { value: '2' as const, label: '指定主机名及IP上运行' },
                      { value: '3' as const, label: '定义服务与节点亲和性' },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={!nodeEditing}
                        onClick={() => setNodeMode(option.value)}
                        className={cn(
                          '-ml-px border border-[#2f4f6d] px-3 py-1 text-[12px] first:ml-0',
                          nodeMode === option.value ? 'bg-[#1670c2] text-white' : 'text-ink-3',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {nodeMode === '2' && (
                  <FieldRow label="指定节点" wide>
                    <select
                      className={inputCls}
                      disabled={!nodeEditing}
                      value={advNode}
                      onChange={(event) => setAdvNode(event.target.value)}
                    >
                      <option value="">请选择节点</option>
                      {nodeList.map((node) => (
                        <option key={node.name} value={node.name}>
                          {node.name}
                          {node.ip ? ` | ${node.ip}` : ''}
                        </option>
                      ))}
                    </select>
                  </FieldRow>
                )}
                {nodeMode === '3' && (
                  <div className="mt-2">
                    <div className="mb-1 text-[11.5px] text-ink-3">服务与节点亲和性（JSON）</div>
                    <textarea
                      className={cn(inputCls, 'h-[180px] w-full resize-none py-2 font-mono text-[11px] leading-[18px]')}
                      spellCheck={false}
                      disabled={!nodeEditing}
                      value={advAffinity}
                      onChange={(event) => setAdvAffinity(event.target.value)}
                    />
                  </div>
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
