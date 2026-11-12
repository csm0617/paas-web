import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, API_BASE, errorMessage } from '@/lib/api'
import type { ProbeConfig, ServiceItem, ServiceList } from '@/types'
import {
  Badge,
  Button,
  Field,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  TabStrip,
  useConfirm,
} from '@/components/ui'
import { toast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'

type ConfigTab = 'env' | 'ports' | 'health' | 'volumes' | 'configmaps' | 'advanced'

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
  const type = probe.httpGet ? 1 : probe.tcpSocket ? 2 : probe.exec ? 4 : 0
  return {
    type,
    path: probe.httpGet?.path || probe.exec?.command?.join(' ') || '',
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

function hasMeaningfulAffinity(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.some(hasMeaningfulAffinity)
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasMeaningfulAffinity)
  }
  return true
}

export default function ServiceConfigPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [searchParams] = useSearchParams()
  const targetService = searchParams.get('service') || ''
  const [selected, setSelected] = useState('')
  const [tab, setTab] = useState<ConfigTab>('env')
  const [envRows, setEnvRows] = useState<EnvRow[]>([{ name: '', value: '' }])
  const [portRows, setPortRows] = useState<PortRow[]>([{ port: '', protocol: 'TCP', nodePort: '' }])
  const [exposeType, setExposeType] = useState('ClusterIP')
  const [readiness, setReadiness] = useState<ProbeForm>(emptyProbe)
  const [liveness, setLiveness] = useState<ProbeForm>(emptyProbe)
  const [volumeRows, setVolumeRows] = useState<VolumeRow[]>([{ hostPath: '', podPath: '', readOnly: false }])
  const [cmOpen, setCmOpen] = useState(false)
  const [cmEditing, setCmEditing] = useState<string | null>(null)
  const [cmName, setCmName] = useState('')
  const [cmRows, setCmRows] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }])
  const cmImportRef = useRef<HTMLInputElement | null>(null)
  const [advNameUs, setAdvNameUs] = useState('')
  const [advNameFr, setAdvNameFr] = useState('')
  const [advHostName, setAdvHostName] = useState('')
  const [advPriority, setAdvPriority] = useState('')
  const [advReplicas, setAdvReplicas] = useState('1')
  const [advNode, setAdvNode] = useState('')
  const [advMode, setAdvMode] = useState<'1' | '2' | '3'>('1')
  const [advAffinity, setAdvAffinity] = useState('')
  const [advMasterTolerance, setAdvMasterTolerance] = useState(false)
  const [advRoleKeys, setAdvRoleKeys] = useState<string[]>([])
  const [advCommand, setAdvCommand] = useState('')
  const [advArgs, setAdvArgs] = useState('')
  const [advCpuRequest, setAdvCpuRequest] = useState('')
  const [advCpuLimit, setAdvCpuLimit] = useState('')
  const [advMemRequest, setAdvMemRequest] = useState('')
  const [advMemLimit, setAdvMemLimit] = useState('')
  const [advGpuLimit, setAdvGpuLimit] = useState('')

  async function exportConfigGroups() {
    const names = configMaps.map((item) => item.metadata?.name).filter((name): name is string => !!name)
    if (names.length === 0) {
      toast.error('暂无配置组可导出')
      return
    }
    const token = useAuthStore.getState().token
    try {
      const response = await fetch(`${API_BASE}/v1/config_map/backup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { token } : {}) },
        body: JSON.stringify(names),
      })
      if (!response.ok) throw new Error(`导出失败 (${response.status})`)
      const text = await response.text()
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'configmap-backup.json'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('配置组已导出', `${names.length} 个配置组已写入 JSON 文件`)
    } catch (error) {
      toast.error('导出失败', errorMessage(error))
    }
  }

  async function importConfigGroups(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const token = useAuthStore.getState().token
    try {
      const response = await fetch(`${API_BASE}/v1/config_map/import`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { token } : undefined,
        body: formData,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `导入失败 (${response.status})`)
      }
      toast.success('配置组导入成功')
      queryClient.invalidateQueries({ queryKey: ['config-maps'] })
    } catch (error) {
      toast.error('导入失败', errorMessage(error))
    }
  }

  const servicesQuery = useQuery({
    queryKey: ['config-services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
  })
  const services = servicesQuery.data?.services ?? []

  const configMapQuery = useQuery({
    queryKey: ['config-maps'],
    queryFn: () => api.get<{ items?: ConfigMapItem[]; total?: number }>('/v1/config_map'),
  })
  const configMaps = configMapQuery.data?.items ?? []

  const nodesQuery = useQuery({
    queryKey: ['config-nodes'],
    queryFn: () => api.get<{ nodes?: { nodes?: Array<{ name?: string; ip?: string }> } }>('/cloud/nodes'),
  })
  const nodeList = nodesQuery.data?.nodes?.nodes ?? []

  const priorityClassesQuery = useQuery({
    queryKey: ['priority-classes'],
    queryFn: () =>
      api.get<{ items?: Array<{ metadata?: { name?: string }; value?: number }> }>(
        '/k8s/apis/scheduling.k8s.io/v1/priorityclasses',
      ),
  })
  const priorityClasses = priorityClassesQuery.data?.items ?? []

  const serviceKeysQuery = useQuery({
    queryKey: ['config-service-keys', selected],
    queryFn: () => api.get<string[]>('/v1/pub/serviceKeyList', { name: selected, serviceName: '' }),
    enabled: !!selected,
  })
  const serviceKeyOptions = serviceKeysQuery.data ?? []

  useEffect(() => {
    if (selected) return
    if (targetService && services.some((item) => serviceNameOf(item) === targetService)) {
      setSelected(targetService)
      return
    }
    if (services[0]) setSelected(serviceNameOf(services[0]))
  }, [services, selected, targetService])

  const detailQuery = useQuery({
    queryKey: ['config-service-detail', selected],
    queryFn: () => api.get<ServiceItem>(`/v1/service/${encodeURIComponent(selected)}`),
    enabled: !!selected,
  })
  const detail = detailQuery.data
  const container = detail?.deployment?.spec?.template?.spec?.containers?.[0]
  const podSpec = detail?.deployment?.spec?.template?.spec

  useEffect(() => {
    if (!detail) return
    const env = (container?.env ?? []).map((item) => ({ name: item.name, value: item.value ?? '' }))
    setEnvRows(env.length ? env : [{ name: '', value: '' }])
    const ports = (detail.service?.spec?.ports ?? []).map((port) => ({
      port: String(port.port ?? ''),
      protocol: port.protocol || 'TCP',
      nodePort: port.nodePort ? String(port.nodePort) : '',
    }))
    setPortRows(ports.length ? ports : [{ port: '', protocol: 'TCP', nodePort: '' }])
    setExposeType(detail.service?.spec?.type || 'ClusterIP')
    setReadiness(probeToForm(container?.readinessProbe))
    setLiveness(probeToForm(container?.livenessProbe))
    const mounts = container?.volumeMounts ?? []
    const volumes = podSpec?.volumes ?? []
    const rows: VolumeRow[] = []
    volumes.forEach((volume) => {
      if (!volume.hostPath?.path) return
      const mount = mounts.find((item) => item.name === volume.name)
      rows.push({
        hostPath: volume.hostPath.path || '',
        podPath: mount?.mountPath || '',
        readOnly: !!mount?.readOnly,
      })
    })
    setVolumeRows(rows.length ? rows : [{ hostPath: '', podPath: '', readOnly: false }])
    setAdvNameUs(detail.nameUs || '')
    setAdvNameFr(detail.nameFr || '')
    setAdvHostName(podSpec?.hostname || '')
    setAdvPriority(podSpec?.priorityClassName || '')
    setAdvReplicas(String(detail.deployment?.spec?.replicas ?? 1))
    const nodeSelector = podSpec?.nodeSelector ?? {}
    const selectedNode = nodeSelector['kubernetes.io/hostname']
    const affinity = podSpec?.affinity ?? null
    const hasAffinity = hasMeaningfulAffinity(affinity)
    setAdvMode(selectedNode ? '2' : hasAffinity ? '3' : '1')
    setAdvNode(selectedNode || '')
    setAdvAffinity(hasAffinity ? JSON.stringify(affinity, null, 2) : '')
    const tolerations = podSpec?.tolerations ?? []
    setAdvMasterTolerance(tolerations.some((item) => item.key === 'node-role.kubernetes.io/master'))
    const role = detail.deployment?.spec?.template?.metadata?.annotations?.['gaop/serviceRole'] || ''
    setAdvRoleKeys(role ? role.split(',').filter(Boolean) : [])
    setAdvCommand((container?.command ?? []).join('\n'))
    setAdvArgs((container?.args ?? []).join('\n'))
    setAdvCpuRequest(container?.resources?.requests?.cpu || '')
    setAdvCpuLimit(container?.resources?.limits?.cpu || '')
    setAdvMemRequest(container?.resources?.requests?.memory || '')
    setAdvMemLimit(container?.resources?.limits?.memory || '')
    setAdvGpuLimit(container?.resources?.limits?.gpu || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, detailQuery.dataUpdatedAt])

  const configMapVolumes = (podSpec?.volumes ?? []).filter((volume) => volume.configMap?.name)

  const envMutation = useMutation({
    mutationFn: () =>
      api.put('/v1/pub/serviceEnv', {
        serviceName: selected,
        env: envRows.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), value: row.value })),
      }),
    onSuccess: () => {
      toast.success('环境变量已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const portMutation = useMutation({
    mutationFn: () =>
      api.post(`/v1/service/${encodeURIComponent(selected)}/nodePort`, {
        type: exposeType,
        nodePorts: portRows
          .filter((row) => row.port)
          .map((row) => ({
            port: Number(row.port),
            protocol: row.protocol,
            nodePort: row.nodePort ? Number(row.nodePort) : null,
          })),
      }),
    onSuccess: () => {
      toast.success('端口配置已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
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
      toast.success('健康检查已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const volumeMutation = useMutation({
    mutationFn: () =>
      api.post(`/v1/service/${encodeURIComponent(selected)}/updateVolumes`, {
        configMapList: [],
        hostPathList: volumeRows
          .filter((row) => row.hostPath.trim() && row.podPath.trim())
          .map((row) => ({
            hostPath: row.hostPath.trim(),
            podPath: row.podPath.trim(),
            readOnly: row.readOnly ? 2 : 1,
          })),
      }),
    onSuccess: () => {
      toast.success('存储挂载已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const renameMutation = useMutation({
    mutationFn: () =>
      api.put('/v1/service/updateName', undefined, {
        name: selected,
        nameUs: advNameUs,
        nameFr: advNameFr,
        serviceKey: selected,
      }),
    onSuccess: () => {
      toast.success('服务名称已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
      queryClient.invalidateQueries({ queryKey: ['config-services'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const hostNameMutation = useMutation({
    mutationFn: () => api.put('/v1/service/hostName', { serviceName: selected, hostName: advHostName }),
    onSuccess: () => {
      toast.success('hostName 已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const priorityMutation = useMutation({
    mutationFn: () => api.post('/v1/service/priority', undefined, { serviceName: selected, level: advPriority }),
    onSuccess: () => {
      toast.success('资源优先级已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const scaleMutation = useMutation({
    mutationFn: () => api.put('/v1/service/scale', undefined, { serviceName: selected, scale: Number(advReplicas) || 0 }),
    onSuccess: () => {
      toast.success('实例数量已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
      queryClient.invalidateQueries({ queryKey: ['config-services'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const resourceMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('未选择服务')
      const limits: Record<string, string> = {}
      if (advCpuLimit.trim()) limits.cpu = advCpuLimit.trim()
      if (advMemLimit.trim()) limits.memory = advMemLimit.trim()
      if (advGpuLimit.trim()) limits.gpu = advGpuLimit.trim()
      const requests: Record<string, string> = {}
      if (advCpuRequest.trim()) requests.cpu = advCpuRequest.trim()
      if (advMemRequest.trim()) requests.memory = advMemRequest.trim()
      if (Object.keys(limits).length === 0 && Object.keys(requests).length === 0) {
        throw new Error('请至少填写一项资源配置')
      }
      return api.post('/v1/pub/patchResource', { name: selected, limits, requests })
    },
    onSuccess: () => {
      toast.success('资源配置已更新', '新的 requests / limits 将在服务滚动更新后生效')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const roleMutation = useMutation({
    mutationFn: () =>
      api.put('/v1/service/updateServiceRole', undefined, { name: selected, serviceKey: advRoleKeys.join(',') }),
    onSuccess: () => {
      toast.success('所属可操作服务已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const commandMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error('未选择服务')
      const command = advCommand.split('\n').map((item) => item.trim()).filter(Boolean)
      const args = advArgs.split('\n').map((item) => item.trim()).filter(Boolean)
      return api.put(`/v1/service/patchCommand/${encodeURIComponent(selected)}`, { command, args })
    },
    onSuccess: () => {
      toast.success('启动命令已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const scheduleMutation = useMutation({
    mutationFn: async () => {
      let affinity: Record<string, unknown> = {}
      if (advMode === '3' && advAffinity.trim()) {
        let parsed: unknown
        try {
          parsed = JSON.parse(advAffinity)
        } catch {
          throw new Error('自定义亲和性不是合法的 JSON')
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('自定义亲和性必须是 JSON 对象')
        }
        affinity = parsed as Record<string, unknown>
      }
      const nodeSelector = advMode === '2' && advNode ? { 'kubernetes.io/hostname': advNode } : null
      const response = await api.put<{ code?: number; msg?: string }>('/v1/service/patchService', {
        svcName: selected,
        requestBody: {
          spec: { template: { spec: { affinity, nodeSelector } } },
        },
      })
      if (response?.code !== undefined && Number(response.code) !== 0) throw new Error(response.msg || '节点调度失败')
      return api.post('/v1/service/tolerance', undefined, {
        serviceName: selected,
        type: advMasterTolerance ? 1 : 0,
      })
    },
    onSuccess: () => {
      toast.success('节点调度已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
      queryClient.invalidateQueries({ queryKey: ['config-services'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const toleranceMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/service/tolerance', undefined, {
        serviceName: selected,
        type: advMasterTolerance ? 1 : 0,
      }),
    onSuccess: () => {
      toast.success('Master 容忍已更新')
      queryClient.invalidateQueries({ queryKey: ['config-service-detail', selected] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  async function saveVolumes() {
    if (configMapVolumes.length > 0) {
      const ok = await confirm({
        title: '当前服务存在 ConfigMap 挂载',
        description: '本页保存仅提交 hostPath 映射，ConfigMap 挂载可能被移除。确认继续？',
        danger: true,
        confirmText: '仍然保存',
      })
      if (!ok) return
    }
    volumeMutation.mutate()
  }

  const configMapMutation = useMutation({
    mutationFn: () => {
      const data: Record<string, string> = {}
      cmRows.filter((row) => row.key.trim()).forEach((row) => {
        data[row.key.trim()] = row.value
      })
      return api.post('/v1/config_map', { name: cmName.trim(), data })
    },
    onSuccess: () => {
      toast.success('ConfigMap 已保存')
      setCmOpen(false)
      setCmEditing(null)
      setCmName('')
      setCmRows([{ key: '', value: '' }])
      queryClient.invalidateQueries({ queryKey: ['config-maps'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const deleteConfigMap = useMutation({
    mutationFn: (name: string) => api.del('/v1/config_map', undefined, { names: name }),
    onSuccess: () => {
      toast.success('ConfigMap 已删除')
      queryClient.invalidateQueries({ queryKey: ['config-maps'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  function openConfigMap(item?: ConfigMapItem) {
    if (item?.metadata?.name) {
      setCmEditing(item.metadata.name)
      setCmName(item.metadata.name)
      const rows = Object.entries(item.data ?? {}).map(([key, value]) => ({ key, value }))
      setCmRows(rows.length ? rows : [{ key: '', value: '' }])
    } else {
      setCmEditing(null)
      setCmName('')
      setCmRows([{ key: '', value: '' }])
    }
    setCmOpen(true)
  }

  async function removeConfigMap(name: string) {
    const ok = await confirm({
      title: `删除 ConfigMap「${name}」？`,
      description: '引用该 ConfigMap 的服务在重新调度后可能挂载失败。',
      danger: true,
      confirmText: '删除配置',
    })
    if (ok) deleteConfigMap.mutate(name)
  }

  const tabs = useMemo(
    () => [
      { value: 'env' as const, label: '环境变量', count: envRows.filter((row) => row.name).length },
      { value: 'ports' as const, label: '端口与 NodePort', count: portRows.filter((row) => row.port).length },
      { value: 'health' as const, label: '健康检查' },
      { value: 'volumes' as const, label: '存储挂载', count: volumeRows.filter((row) => row.hostPath).length },
      { value: 'configmaps' as const, label: '配置字典', count: configMaps.length },
      { value: 'advanced' as const, label: '高级设置' },
    ],
    [envRows, portRows, volumeRows, configMaps],
  )

  const probeEditor = (value: ProbeForm, onChange: (next: ProbeForm) => void, label: string) => (
    <div className="border border-line p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">{label}</span>
        <Badge tone={value.type === 0 ? 'default' : 'ok'}>
          {value.type === 0 ? 'DISABLED' : value.type === 1 ? 'HTTP' : value.type === 2 ? 'TCP' : value.type === 3 ? 'HTTPS' : 'EXEC'}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="检查类型">
          <select className="field h-9" value={value.type} onChange={(event) => onChange({ ...value, type: Number(event.target.value) })}>
            <option value={0}>不启用</option>
            <option value={1}>HTTP GET</option>
            <option value={2}>TCP Socket</option>
            <option value={3}>HTTPS GET</option>
            <option value={4}>执行命令</option>
          </select>
        </Field>
        <Field label={value.type === 4 ? '命令' : '路径'}>
          <input
            className="field h-9 font-mono text-[11px]"
            value={value.path}
            onChange={(event) => onChange({ ...value, path: event.target.value })}
            placeholder={value.type === 4 ? '/bin/sh -c ls' : '/'}
          />
        </Field>
        <Field label="端口">
          <input
            className="field h-9 font-mono text-[11px]"
            value={value.port}
            onChange={(event) => onChange({ ...value, port: event.target.value })}
            placeholder="8080"
          />
        </Field>
        <Field label="首次延迟 (s)">
          <input
            className="field h-9 font-mono text-[11px]"
            value={value.initialDelaySeconds}
            onChange={(event) => onChange({ ...value, initialDelaySeconds: event.target.value })}
          />
        </Field>
        <Field label="检测间隔 (s)">
          <input
            className="field h-9 font-mono text-[11px]"
            value={value.periodSeconds}
            onChange={(event) => onChange({ ...value, periodSeconds: event.target.value })}
          />
        </Field>
        <Field label="超时 (s)">
          <input
            className="field h-9 font-mono text-[11px]"
            value={value.timeoutSeconds}
            onChange={(event) => onChange({ ...value, timeoutSeconds: event.target.value })}
          />
        </Field>
        <Field label="成功阈值">
          <input
            className="field h-9 font-mono text-[11px]"
            value={value.successThreshold}
            onChange={(event) => onChange({ ...value, successThreshold: event.target.value })}
          />
        </Field>
        <Field label="失败阈值">
          <input
            className="field h-9 font-mono text-[11px]"
            value={value.failureThreshold}
            onChange={(event) => onChange({ ...value, failureThreshold: event.target.value })}
          />
        </Field>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        index="02 / 04"
        en="SOFTWARE · SERVICE CONFIGURATION"
        title="服务配置"
        description="集中维护环境变量、端口暴露、健康检查与存储挂载。保存后由平台下发至 Deployment。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{services.length} SERVICES</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">
              {selected ? `TARGET / ${selected}` : 'SELECT A SERVICE'}
            </span>
          </>
        }
        actions={
          <Button
            size="sm"
            loading={servicesQuery.isFetching || detailQuery.isFetching}
            onClick={() => {
              servicesQuery.refetch()
              detailQuery.refetch()
              configMapQuery.refetch()
            }}
          >
            <RefreshCw size={11} /> 刷新
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-3" kicker="SERVICES" title="服务" bodyClassName="p-0">
          <div className="max-h-[70vh] divide-y divide-line/70 overflow-y-auto">
            {services.map((service) => {
              const name = serviceNameOf(service)
              const ready = service.deployment?.status?.readyReplicas ?? 0
              return (
                <button
                  key={name}
                  onClick={() => setSelected(name)}
                  className={cn(
                    'flex w-full items-center gap-2 px-4 py-3 text-left transition-colors',
                    selected === name ? 'bg-ink text-paper' : 'hover:bg-paper-2/60',
                  )}
                >
                  <StatusDot tone={ready > 0 ? 'ok' : 'idle'} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{name}</span>
                  <span className={cn('mono text-[8.5px]', selected === name ? 'text-[#a9b0b3]' : 'text-mute')}>
                    {ready}/{service.deployment?.spec?.replicas ?? 0}
                  </span>
                </button>
              )
            })}
            {services.length === 0 && <div className="px-4 py-8 text-center text-[11px] text-mute">暂无服务</div>}
          </div>
        </Panel>

        <div className="lg:col-span-9">
          <div className="mb-3">
            <TabStrip value={tab} onChange={setTab} tabs={tabs} />
          </div>

          {tab === 'env' && (
            <Panel
              kicker="ENVIRONMENT"
              title={`环境变量 · ${selected || '—'}`}
              actions={
                <Button size="sm" variant="primary" loading={envMutation.isPending} disabled={!detail} onClick={() => envMutation.mutate()}>
                  <Save size={11} /> 保存变量
                </Button>
              }
            >
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
                      className="flex h-9 w-9 items-center justify-center border border-line-strong text-ink-3 hover:border-signal hover:text-signal"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setEnvRows((rows) => [...rows, { name: '', value: '' }])}
                  className="mono flex items-center gap-1 border border-dashed border-line-strong px-3 py-2 text-[9px] tracking-widest text-mute hover:border-ink hover:text-ink"
                >
                  <Plus size={10} /> 添加环境变量
                </button>
              </div>
            </Panel>
          )}

          {tab === 'ports' && (
            <Panel
              kicker="PORTS"
              title={`端口暴露 · ${selected || '—'}`}
              actions={
                <Button size="sm" variant="primary" loading={portMutation.isPending} disabled={!detail} onClick={() => portMutation.mutate()}>
                  <Save size={11} /> 保存端口
                </Button>
              }
            >
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="暴露类型">
                  <select className="field" value={exposeType} onChange={(event) => setExposeType(event.target.value)}>
                    <option value="ClusterIP">ClusterIP</option>
                    <option value="NodePort">NodePort</option>
                  </select>
                </Field>
                <div className="sm:col-span-2 flex items-end">
                  <p className="text-[10.5px] leading-relaxed text-ink-3">
                    NodePort 会占用节点端口。外部端口留空时由集群在 30000–32767 自动分配。
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {portRows.map((row, index) => (
                  <div key={index} className="grid grid-cols-[1fr_1fr_1fr_36px] items-center gap-2">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      placeholder="服务端口"
                      value={row.port}
                      onChange={(event) =>
                        setPortRows((rows) => rows.map((item, i) => (i === index ? { ...item, port: event.target.value } : item)))
                      }
                    />
                    <select
                      className="field h-9 font-mono text-[11px]"
                      value={row.protocol}
                      onChange={(event) =>
                        setPortRows((rows) => rows.map((item, i) => (i === index ? { ...item, protocol: event.target.value } : item)))
                      }
                    >
                      <option value="TCP">TCP</option>
                      <option value="UDP">UDP</option>
                    </select>
                    <input
                      className="field h-9 font-mono text-[11px]"
                      placeholder="NodePort（自动）"
                      value={row.nodePort}
                      onChange={(event) =>
                        setPortRows((rows) => rows.map((item, i) => (i === index ? { ...item, nodePort: event.target.value } : item)))
                      }
                    />
                    <button
                      onClick={() => setPortRows((rows) => rows.filter((_, i) => i !== index))}
                      className="flex h-9 w-9 items-center justify-center border border-line-strong text-ink-3 hover:border-signal hover:text-signal"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setPortRows((rows) => [...rows, { port: '', protocol: 'TCP', nodePort: '' }])}
                  className="mono flex items-center gap-1 border border-dashed border-line-strong px-3 py-2 text-[9px] tracking-widest text-mute hover:border-ink hover:text-ink"
                >
                  <Plus size={10} /> 添加端口
                </button>
              </div>
            </Panel>
          )}

          {tab === 'health' && (
            <Panel
              kicker="PROBES"
              title={`健康检查 · ${selected || '—'}`}
              actions={
                <Button size="sm" variant="primary" loading={healthMutation.isPending} disabled={!detail} onClick={() => healthMutation.mutate()}>
                  <Save size={11} /> 保存探针
                </Button>
              }
            >
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {probeEditor(readiness, setReadiness, 'READINESS / 就绪检查')}
                {probeEditor(liveness, setLiveness, 'LIVENESS / 存活检查')}
              </div>
            </Panel>
          )}

          {tab === 'volumes' && (
            <Panel
              kicker="VOLUMES"
              title={`存储挂载 · ${selected || '—'}`}
              actions={
                <Button size="sm" variant="primary" loading={volumeMutation.isPending} disabled={!detail} onClick={saveVolumes}>
                  <Save size={11} /> 保存挂载
                </Button>
              }
            >
              <div className="space-y-2">
                {volumeRows.map((row, index) => (
                  <div key={index} className="grid grid-cols-1 gap-2 border border-line p-2 sm:grid-cols-[1fr_1fr_auto_36px] sm:items-center">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      placeholder="宿主目录 /data"
                      value={row.hostPath}
                      onChange={(event) =>
                        setVolumeRows((rows) => rows.map((item, i) => (i === index ? { ...item, hostPath: event.target.value } : item)))
                      }
                    />
                    <input
                      className="field h-9 font-mono text-[11px]"
                      placeholder="容器目录 /mnt/data"
                      value={row.podPath}
                      onChange={(event) =>
                        setVolumeRows((rows) => rows.map((item, i) => (i === index ? { ...item, podPath: event.target.value } : item)))
                      }
                    />
                    <label className="flex items-center gap-1.5 px-1">
                      <input
                        type="checkbox"
                        className="check"
                        checked={row.readOnly}
                        onChange={(event) =>
                          setVolumeRows((rows) =>
                            rows.map((item, i) => (i === index ? { ...item, readOnly: event.target.checked } : item)),
                          )
                        }
                      />
                      <span className="text-[10px] text-ink-3">只读</span>
                    </label>
                    <button
                      onClick={() => setVolumeRows((rows) => rows.filter((_, i) => i !== index))}
                      className="flex h-9 w-9 items-center justify-center border border-line-strong text-ink-3 hover:border-signal hover:text-signal"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setVolumeRows((rows) => [...rows, { hostPath: '', podPath: '', readOnly: false }])}
                  className="mono flex items-center gap-1 border border-dashed border-line-strong px-3 py-2 text-[9px] tracking-widest text-mute hover:border-ink hover:text-ink"
                >
                  <Plus size={10} /> 添加 hostPath 挂载
                </button>
              </div>
              <div className="mt-3 border border-line bg-paper-2/40 px-3 py-2">
                <div className="label mb-1">只读信息</div>
                <div className="text-[10px] leading-relaxed text-ink-3">
                  已检测到 {configMapVolumes.length} 个 ConfigMap 挂载。保存本页会以 hostPath 列表覆盖存储配置，请谨慎操作。
                </div>
              </div>
            </Panel>
          )}

          {tab === 'configmaps' && (
            <Panel
              kicker="CONFIG MAPS"
              title="配置字典"
              actions={
                <>
                  <input
                    ref={cmImportRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) importConfigGroups(file)
                      event.target.value = ''
                    }}
                  />
                  <Button size="sm" onClick={() => cmImportRef.current?.click()}>
                    <Upload size={11} /> 导入配置组
                  </Button>
                  <Button size="sm" onClick={exportConfigGroups}>
                    <Download size={11} /> 导出配置组
                  </Button>
                  <Button size="sm" variant="signal" onClick={() => openConfigMap()}>
                    <Plus size={11} /> 新建配置
                  </Button>
                </>
              }
            >
              <div className="space-y-2">
                {configMaps.map((item) => {
                  const name = item.metadata?.name || '—'
                  const entries = Object.entries(item.data ?? {})
                  return (
                    <div key={name} className="border border-line">
                      <div className="flex items-center justify-between gap-2 border-b border-line bg-paper-2/40 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-[11px] text-ink">{name}</span>
                          <Badge>{entries.length} KEYS</Badge>
                          {(podSpec?.volumes ?? []).some((volume) => volume.configMap?.name === name) && (
                            <Badge tone="info">MOUNTED</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" onClick={() => openConfigMap(item)}>
                            编辑
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => removeConfigMap(name)}>
                            <Trash2 size={10} /> 删除
                          </Button>
                        </div>
                      </div>
                      <div className="divide-y divide-line/60">
                        {entries.slice(0, 4).map(([key, value]) => (
                          <div key={key} className="grid grid-cols-[160px_1fr] gap-2 px-3 py-1.5">
                            <span className="mono truncate text-[9.5px] text-ink-3">{key}</span>
                            <span className="mono truncate text-[9.5px] text-mute">{value}</span>
                          </div>
                        ))}
                        {entries.length === 0 && (
                          <div className="px-3 py-2 text-[10px] text-mute">该配置字典暂无键值</div>
                        )}
                        {entries.length > 4 && (
                          <div className="mono px-3 py-1.5 text-[8.5px] tracking-widest text-mute">
                            +{entries.length - 4} MORE KEYS
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {configMaps.length === 0 && (
                  <div className="border border-dashed border-line-strong px-4 py-10 text-center">
                    <div className="text-[11px] text-mute">
                      {configMapQuery.isLoading ? '正在读取配置字典…' : '当前命名空间没有 ConfigMap'}
                    </div>
                    <Button size="sm" variant="signal" className="mt-3" onClick={() => openConfigMap()}>
                      <Plus size={11} /> 新建配置
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {tab === 'advanced' && (
            <div className="space-y-4">
              <Panel
                kicker="IDENTITY"
                title={`基本信息 · ${selected || '—'}`}
                actions={
                  <Button size="sm" variant="primary" loading={renameMutation.isPending} disabled={!detail} onClick={() => renameMutation.mutate()}>
                    <Save size={11} /> 保存名称
                  </Button>
                }
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="英文名称">
                    <input className="field h-9 font-mono text-[11px]" value={advNameUs} onChange={(event) => setAdvNameUs(event.target.value)} />
                  </Field>
                  <Field label="法文名称">
                    <input className="field h-9 font-mono text-[11px]" value={advNameFr} onChange={(event) => setAdvNameFr(event.target.value)} />
                  </Field>
                  <Field label="hostName">
                    <div className="flex gap-2">
                      <input
                        className="field h-9 flex-1 font-mono text-[11px]"
                        value={advHostName}
                        onChange={(event) => setAdvHostName(event.target.value)}
                        placeholder="容器主机名"
                      />
                      <Button size="sm" loading={hostNameMutation.isPending} disabled={!detail} onClick={() => hostNameMutation.mutate()}>
                        保存
                      </Button>
                    </div>
                  </Field>
                </div>
              </Panel>

              <Panel
                kicker="CAPACITY"
                title="资源与副本"
                actions={
                  <Button size="sm" variant="primary" loading={priorityMutation.isPending || scaleMutation.isPending} disabled={!detail} onClick={() => {
                    priorityMutation.mutate()
                    scaleMutation.mutate()
                  }}>
                    <Save size={11} /> 保存资源
                  </Button>
                }
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="资源优先级" hint="对应 Kubernetes PriorityClass 等级">
                    <select className="field h-9" value={advPriority} onChange={(event) => setAdvPriority(event.target.value)}>
                      <option value="">无</option>
                      {priorityClasses.map((item) => {
                        const name = item.metadata?.name || ''
                        if (!name) return null
                        return (
                          <option key={name} value={name}>
                            {name}
                            {typeof item.value === 'number' ? ` · ${item.value}` : ''}
                          </option>
                        )
                      })}
                    </select>
                  </Field>
                  <Field label="实例数量">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      type="number"
                      min={0}
                      max={50}
                      value={advReplicas}
                      onChange={(event) => setAdvReplicas(event.target.value)}
                    />
                  </Field>
                </div>
              </Panel>

              <Panel
                kicker="RESOURCE QUOTA"
                title="资源配额"
                actions={
                  <Button
                    size="sm"
                    variant="primary"
                    loading={resourceMutation.isPending}
                    disabled={!detail}
                    onClick={() => resourceMutation.mutate()}
                  >
                    <Save size={11} /> 保存配额
                  </Button>
                }
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="CPU 请求" hint="支持 500m 或 0.5">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      value={advCpuRequest}
                      onChange={(event) => setAdvCpuRequest(event.target.value)}
                      placeholder="500m"
                    />
                  </Field>
                  <Field label="CPU 上限" hint="支持 1000m 或 1">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      value={advCpuLimit}
                      onChange={(event) => setAdvCpuLimit(event.target.value)}
                      placeholder="1000m"
                    />
                  </Field>
                  <Field label="GPU 上限" hint="无 GPU 资源时留空">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      value={advGpuLimit}
                      onChange={(event) => setAdvGpuLimit(event.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="内存请求" hint="例如 512Mi">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      value={advMemRequest}
                      onChange={(event) => setAdvMemRequest(event.target.value)}
                      placeholder="512Mi"
                    />
                  </Field>
                  <Field label="内存上限" hint="例如 1024Mi">
                    <input
                      className="field h-9 font-mono text-[11px]"
                      value={advMemLimit}
                      onChange={(event) => setAdvMemLimit(event.target.value)}
                      placeholder="1024Mi"
                    />
                  </Field>
                  <div className="flex items-end">
                    <div className="mono pb-2 text-[8.5px] leading-relaxed tracking-wider text-mute">
                      requests 影响调度，limits 为容器上限；保存后需服务滚动更新生效。
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel
                kicker="ENTRYPOINT"
                title="启动命令"
                actions={
                  <Button size="sm" variant="primary" loading={commandMutation.isPending} disabled={!detail} onClick={() => commandMutation.mutate()}>
                    <Save size={11} /> 保存命令
                  </Button>
                }
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Command" hint="每行一个参数，留空使用镜像默认入口">
                    <textarea
                      className="field min-h-[86px] font-mono text-[10.5px]"
                      spellCheck={false}
                      value={advCommand}
                      onChange={(event) => setAdvCommand(event.target.value)}
                      placeholder="/bin/sh"
                    />
                  </Field>
                  <Field label="Args" hint="每行一个参数">
                    <textarea
                      className="field min-h-[86px] font-mono text-[10.5px]"
                      spellCheck={false}
                      value={advArgs}
                      onChange={(event) => setAdvArgs(event.target.value)}
                      placeholder="-c"
                    />
                  </Field>
                </div>
              </Panel>

              <Panel
                kicker="SCHEDULING"
                title="节点调度"
                actions={
                  <Button size="sm" variant="primary" loading={scheduleMutation.isPending} disabled={!detail} onClick={() => scheduleMutation.mutate()}>
                    <Save size={11} /> 保存调度
                  </Button>
                }
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="绑定方式">
                    <select className="field h-9" value={advMode} onChange={(event) => setAdvMode(event.target.value as '1' | '2' | '3')}>
                      <option value="1">系统默认调度</option>
                      <option value="2">指定节点</option>
                      <option value="3">自定义亲和性</option>
                    </select>
                  </Field>
                  <Field label="绑定对象">
                    <select
                      className="field h-9"
                      value={advNode}
                      disabled={advMode !== '2'}
                      onChange={(event) => setAdvNode(event.target.value)}
                    >
                      <option value="">--</option>
                      {nodeList.map((node) => (
                        <option key={node.name} value={node.name}>
                          {node.name}
                          {node.ip ? ` · ${node.ip}` : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {advMode === '3' && (
                  <div className="mt-3">
                    <Field
                      label="亲和性 JSON"
                      hint='写入 Pod 的 affinity 字段，例如 {"nodeAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"gpu","operator":"In","values":["true"]}]}]}}}'
                    >
                      <textarea
                        className="field min-h-[160px] font-mono text-[10.5px] leading-relaxed"
                        spellCheck={false}
                        placeholder='{ "nodeAffinity": { ... } }'
                        value={advAffinity}
                        onChange={(event) => setAdvAffinity(event.target.value)}
                      />
                    </Field>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between border border-line bg-paper-2/40 px-3 py-2">
                  <div>
                    <div className="label">Master 容忍</div>
                    <div className="text-[10px] text-mute">允许当前服务调度到带有 master NoSchedule 污点的节点。</div>
                  </div>
                  <button
                    onClick={() => {
                      setAdvMasterTolerance((value) => !value)
                      toleranceMutation.mutate()
                    }}
                    className={cn(
                      'mono border px-3 py-1.5 text-[9px] tracking-widest',
                      advMasterTolerance ? 'border-signal bg-signal/10 text-signal' : 'border-line-strong text-mute',
                    )}
                    disabled={!detail || toleranceMutation.isPending}
                  >
                    {advMasterTolerance ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>
              </Panel>

              <Panel
                kicker="ROLE BINDING"
                title="所属可操作服务"
                actions={
                  <Button size="sm" variant="primary" loading={roleMutation.isPending} disabled={!detail} onClick={() => roleMutation.mutate()}>
                    <Save size={11} /> 保存授权
                  </Button>
                }
              >
                {serviceKeyOptions.length === 0 ? (
                  <div className="text-[10.5px] text-mute">暂无可绑定的服务标识</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {serviceKeyOptions.map((key) => {
                      const checked = advRoleKeys.includes(key)
                      return (
                        <label
                          key={key}
                          className={cn(
                            'mono flex cursor-pointer items-center gap-1.5 border px-2.5 py-1.5 text-[9.5px] tracking-wider',
                            checked ? 'border-ink bg-ink text-paper' : 'border-line-strong text-ink-3',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={checked}
                            onChange={(event) =>
                              setAdvRoleKeys((keys) => (event.target.checked ? [...keys, key] : keys.filter((item) => item !== key)))
                            }
                          />
                          {key}
                        </label>
                      )
                    })}
                  </div>
                )}
              </Panel>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={cmOpen}
        onOpenChange={(open) => {
          setCmOpen(open)
          if (!open) setCmEditing(null)
        }}
        kicker={cmEditing ? 'CONFIG MAP / EDIT' : 'CONFIG MAP / CREATE'}
        title={cmEditing ? `编辑配置 · ${cmEditing}` : '新建配置字典'}
        description="配置字典以键值对形式保存，可被服务以文件方式挂载到容器目录。"
        width={560}
        footer={
          <>
            <Button size="sm" onClick={() => setCmOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!cmName.trim()}
              loading={configMapMutation.isPending}
              onClick={() => configMapMutation.mutate()}
            >
              保存配置
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="名称" required hint="同一命名空间内唯一，创建后不建议修改">
            <input
              className="field font-mono"
              value={cmName}
              disabled={!!cmEditing}
              onChange={(event) => setCmName(event.target.value)}
              placeholder="app-config"
            />
          </Field>
          <div>
            <div className="label mb-2">键值</div>
            <div className="space-y-2">
              {cmRows.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className="field h-9 flex-1 font-mono text-[11px]"
                    placeholder="KEY"
                    value={row.key}
                    onChange={(event) =>
                      setCmRows((rows) => rows.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)))
                    }
                  />
                  <span className="text-mute">=</span>
                  <input
                    className="field h-9 flex-[2] font-mono text-[11px]"
                    placeholder="value"
                    value={row.value}
                    onChange={(event) =>
                      setCmRows((rows) => rows.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))
                    }
                  />
                  <button
                    onClick={() => setCmRows((rows) => rows.filter((_, i) => i !== index))}
                    className="flex h-9 w-9 items-center justify-center border border-line-strong text-ink-3 hover:border-signal hover:text-signal"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setCmRows((rows) => [...rows, { key: '', value: '' }])}
                className="mono flex items-center gap-1 border border-dashed border-line-strong px-3 py-2 text-[9px] tracking-widest text-mute hover:border-ink hover:text-ink"
              >
                <Plus size={10} /> 添加键值
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
