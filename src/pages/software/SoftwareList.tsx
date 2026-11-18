import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppWindow, Check, ChevronDown, Copy, Download, ExternalLink, Filter, Info, KeyRound, LayoutGrid, List, Network, Pin, Plus, RefreshCw, ShieldCheck, SquareChevronDown, SquareChevronRight, Trash2, Upload, Users, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage, API_BASE } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import type { RoleItem, ServiceItem, ServiceList, Software } from '@/types'
import {
  ActionMenu,
  Badge,
  Button,
  Drawer,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  PageToolbar,
  Panel,
  SectionTitle,
} from '@/components/ui'
import { cn } from '@/lib/utils'

const platformHost = (import.meta.env.VITE_PLATFORM_HOST as string | undefined) || '172.16.209.170'

interface SoftwareListResponse {
  softwareList: Software[]
  total: number
}

interface SoftwareAuthInfo {
  id?: string
  softWareName?: string
  softWareKey?: string
  framework?: string
  status?: number
  authCreateTime?: number | null
  authExpireTime?: number | null
}

interface GatewayPort {
  serviceLabel?: string
  serviceId?: string
  softwareName?: string
  softwareId?: string
  softwareKey?: string
  servicePortId?: number
  web?: boolean
  port?: number
  path?: string
  allow?: boolean
  fullPath?: string
}

interface RelationServiceInfo {
  serviceId?: string
  serviceLabel?: string
  serviceName?: string
  serviceType?: string | null
  serviceStatus?: string
  web?: boolean
}

type SoftwareDetail = Software & {
  screenShotList?: string[] | null
  serviceList?: RelationServiceInfo[]
  roleNameList?: string[]
  roleKeyList?: string[]
  status?: string
  nameUs?: string
  nameFr?: string
}

const emptyForm = {
  key: '',
  name: '',
  nameUs: '',
  nameFr: '',
  type: 'BS',
  routerKey: '',
  framework: 'BS',
  desc: '',
  location: 'local',
  icon: '',
}

function iconSrc(icon?: string | null) {
  if (!icon) return ''
  return icon.startsWith('data:') ? icon : `data:image/png;base64,${icon}`
}

function authStatusText(status?: number) {
  if (status === 1) return '已授权'
  if (status === 2) return '已过期'
  if (status === 0 || status === undefined) return '未授权'
  return `状态 ${status}`
}

function serviceNameOf(service: ServiceItem) {
  return service.nameUs || service.nameFr
}

function serviceImageOf(service: ServiceItem) {
  if (typeof service.imageInfo === 'string') return service.imageInfo
  if (service.imageInfo?.image) return service.imageInfo.image
  return service.deployment?.spec?.template?.spec?.containers?.[0]?.image || '—'
}

function serviceStatusOf(service: ServiceItem) {
  const ready = service.deployment?.status?.readyReplicas ?? 0
  const desired = service.deployment?.spec?.replicas ?? 0
  if (service.terminated) return { text: '已停止', tone: 'text-mute', ready, desired }
  if (ready > 0 && desired > 0 && ready < desired) return { text: '滚动发布中', tone: 'text-[#4aa3f0]', ready, desired }
  if (ready > 0) return { text: '运行中', tone: 'text-ok', ready, desired }
  if (desired > 0) return { text: '启动中', tone: 'text-warn', ready, desired }
  return { text: '已停止', tone: 'text-mute', ready, desired }
}

function servicePortsOf(service: ServiceItem) {
  const ports = [
    ...(service.service?.spec?.ports ?? []).map((item) => item.port),
    ...(service.deployment?.spec?.template?.spec?.containers ?? []).flatMap((container) =>
      (container.ports ?? []).map((item) => item.containerPort),
    ),
  ].filter((port): port is number => typeof port === 'number' && port > 0)
  return Array.from(new Set(ports.length ? ports : [80]))
}

function ConfigRow({
  label,
  children,
  onEdit,
}: {
  label: string
  children: ReactNode
  onEdit?: () => void
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-[68px] flex-none pt-[7px] text-right text-[12px] text-ink-3">{label}：</span>
      <div className="min-w-0 flex-1">{children}</div>
      {onEdit ? (
        <button
          onClick={onEdit}
          className="w-8 flex-none pt-[7px] text-left text-[12px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
        >
          修改
        </button>
      ) : (
        <span className="w-8 flex-none" />
      )}
    </div>
  )
}

function MappingPopover({
  mapping,
  text = '入口设置',
  onToggle,
}: {
  mapping?: GatewayPort
  text?: string
  onToggle: () => void
}) {
  const url = mapping ? `http://${platformHost}${mapping.fullPath || ''}` : ''
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="whitespace-nowrap text-[12px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]">
          {text}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-[75] w-[300px] rounded border border-line bg-paper-2 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
        >
          {mapping ? (
            <div className="space-y-2">
              <div className="flex items-start gap-1.5 text-[11.5px] text-ink-3">
                <span>{mapping.port}</span>
                <span>-&gt;</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[#4aa3f0] hover:underline"
                >
                  {url}
                </a>
              </div>
              <DropdownMenu.Item
                onSelect={onToggle}
                className="cursor-pointer text-[11.5px] text-[#4aa3f0] outline-none transition-colors data-[highlighted]:text-[#7cc4ff]"
              >
                {mapping.web ? '取消入口' : '设为入口'}
              </DropdownMenu.Item>
            </div>
          ) : (
            <div className="text-[11.5px] text-mute">暂无映射，请先在网络管理中配置端口</div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export default function SoftwareListPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editField, setEditField] = useState<string | null>(null)
  const [editing, setEditing] = useState<Software | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [seatTarget, setSeatTarget] = useState<Software | null>(null)
  const [seatKeys, setSeatKeys] = useState<string[]>([])
  const [seatSelectOpen, setSeatSelectOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportIds, setExportIds] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [shots, setShots] = useState<string[]>([])
  const [initialShots, setInitialShots] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'card' | 'table'>('table')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [relationOpen, setRelationOpen] = useState(false)
  const [relationSelection, setRelationSelection] = useState<string[]>([])
  const [relatedSelected, setRelatedSelected] = useState<string[]>([])
  const [mappingTarget, setMappingTarget] = useState<{ service: ServiceItem; mapping?: GatewayPort } | null>(null)
  const [mappingPort, setMappingPort] = useState('80')
  const [mappingPath, setMappingPath] = useState('')
  const detailAppliedRef = useRef('')
  const [minSetOpen, setMinSetOpen] = useState(false)
  const [minSetSelected, setMinSetSelected] = useState<string[]>([])
  const [govOpen, setGovOpen] = useState(false)
  const [govTab, setGovTab] = useState<'auth' | 'gateway'>('auth')
  const [authCode, setAuthCode] = useState('')
  const [generatedCode, setGeneratedCode] = useState('')
  const importRef = useRef<HTMLInputElement | null>(null)

  const query = useQuery({
    queryKey: ['software'],
    queryFn: () => api.get<SoftwareListResponse>('/v1/software', { page: 1, size: 100, order: 'orderTop', sort: 'desc' }),
  })

  const authQuery = useQuery({
    queryKey: ['software-auth'],
    queryFn: () => api.get<{ list?: SoftwareAuthInfo[]; total?: number }>('/v1/software/auth', { page: 1, size: 100 }),
    enabled: govOpen,
  })
  const gatewayQuery = useQuery({
    queryKey: ['software-gateway'],
    queryFn: () => api.get<{ list?: GatewayPort[]; total?: number }>('/v1/software/gateway', { page: 1, size: 100 }),
    enabled: govOpen,
  })
  const activateMutation = useMutation({
    mutationFn: () => {
      if (!authCode.trim()) throw new Error('请输入激活码')
      return api.post('/v1/software/software/active', { authToken: authCode.trim() })
    },
    onSuccess: () => {
      toast.success('激活请求已提交')
      setAuthCode('')
      queryClient.invalidateQueries({ queryKey: ['software-auth'] })
    },
    onError: (error) => toast.error('激活失败', errorMessage(error)),
  })
  const cancelAuthMutation = useMutation({
    mutationFn: (key: string) => api.post('/v1/software/cancelAuth', [key]),
    onSuccess: () => {
      toast.success('软件授权已取消')
      queryClient.invalidateQueries({ queryKey: ['software-auth'] })
    },
    onError: (error) => toast.error('取消失败', errorMessage(error)),
  })
  const codeMutation = useMutation({
    mutationFn: (key: string) => api.post<string>('/v1/software/softwareCode', { softwareKeyList: [key] }),
    onSuccess: (data) => setGeneratedCode(String(data ?? '')),
    onError: (error) => toast.error('生成识别码失败', errorMessage(error)),
  })
  const gatewayMutation = useMutation({
    mutationFn: (payload: { servicePortId: number; allow: boolean }) =>
      api.put('/v1/software/gateway', undefined, payload),
    onSuccess: () => {
      toast.success('网关放通状态已更新')
      queryClient.invalidateQueries({ queryKey: ['software-gateway'] })
    },
    onError: (error) => toast.error('更新失败', errorMessage(error)),
  })

  const list = query.data?.softwareList ?? []
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        (item.desc || '').toLowerCase().includes(q),
    )
  }, [list, keyword])

  useEffect(() => {
    setPage(1)
  }, [keyword])

  const pageSize = 10
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, totalPages)
  const pageRows = filtered.slice((current - 1) * pageSize, current * pageSize)

  const relationServicesQuery = useQuery({
    queryKey: ['software-relation-services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
  })
  const services = relationServicesQuery.data?.services ?? []

  const serviceAction = useMutation({
    mutationFn: ({ path, names }: { path: string; names: string[] }) =>
      path === '/v1/service' ? api.del('/v1/service', names) : api.put(path, names),
    onSuccess: () => {
      toast.success('操作已下发', '变更请求已提交至集群')
      queryClient.invalidateQueries({ queryKey: ['software-relation-services'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  function appServiceList(item: Software) {
    const keys = new Set<string>()
    for (const value of [item.relationServiceKey, item.relationServiceName]) {
      if (Array.isArray(value)) value.filter(Boolean).forEach((key) => keys.add(key))
      else if (value) keys.add(value)
    }
    return services.filter(
      (service) =>
        keys.has(service.nameUs) ||
        keys.has(service.nameFr) ||
        (service.softwareNameList ?? []).includes(item.name),
    )
  }

  const relatedServices = editing ? appServiceList(editing) : []
  const relatedNames = relatedServices.map((service) => serviceNameOf(service))

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.key.trim() || !form.name.trim()) throw new Error('软件标识与名称不能为空')
      const body = {
        ...form,
        key: form.key.trim(),
        name: form.name.trim(),
        routerKey: form.routerKey.trim(),
      }
      if (editing) {
        const result = await api.put(`/v1/software/${editing.id}`, body)
        if (form.icon && form.icon !== (editing.icon || '')) {
          iconMutation.mutate({ id: editing.id, icon: form.icon })
        }
        if (shots.join('|') !== initialShots.join('|')) {
          shotMutation.mutate({ id: editing.id, list: shots })
        }
        return result
      }
      return api.post('/v1/software', body)
    },
    onSuccess: () => {
      toast.success(editing ? '软件信息已更新' : '软件已创建')
      setModalOpen(false)
      setEditing(null)
      setForm(emptyForm)
      queryClient.invalidateQueries({ queryKey: ['software'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/v1/software/${id}`),
    onSuccess: () => {
      toast.success('软件已删除')
      queryClient.invalidateQueries({ queryKey: ['software'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const releaseMutation = useMutation({
    mutationFn: ({ id, release }: { id: string; release: boolean }) =>
      api.post('/v1/software/release', { type: release ? 1 : 0, list: [id] }),
    onSuccess: (_data, variables) => {
      toast.success(variables.release ? '已放行该应用' : '已禁止该应用')
      queryClient.invalidateQueries({ queryKey: ['software'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  const rolesQuery = useQuery({
    queryKey: ['roles-for-software'],
    queryFn: () => api.get<{ list: RoleItem[]; total: number }>('/v1/role/switchRole', { type: 1, size: 300 }),
    enabled: !!seatTarget,
    staleTime: 60_000,
  })

  const roleOptions = (rolesQuery.data?.list ?? []).flatMap((role) =>
    role.key ? [{ key: role.key, name: role.name }] : [],
  )

  const detailQuery = useQuery({
    queryKey: ['software-detail', editing?.id],
    queryFn: () => api.get<SoftwareDetail>(`/v1/software/${editing?.id}`),
    enabled: !!editing,
  })

  useEffect(() => {
    if (!detailQuery.data) return
    const list = detailQuery.data.screenShotList ?? []
    setShots(list)
    setInitialShots(list)
    if (detailAppliedRef.current === detailQuery.data.id) return
    detailAppliedRef.current = detailQuery.data.id
    const detail = detailQuery.data
    setForm((prev) => ({
      ...prev,
      name: detail.name || prev.name,
      nameUs: detail.nameUs || prev.nameUs,
      nameFr: detail.nameFr || prev.nameFr,
      desc: detail.desc ?? prev.desc,
      routerKey: detail.routerKey ?? prev.routerKey,
      icon: detail.icon ?? prev.icon,
    }))
  }, [detailQuery.data])

  const appRunning = detailQuery.data?.status
    ? detailQuery.data.status === 'RUNNING'
    : editing?.releaseStatus === 1
  const appStateText = appRunning
    ? relatedServices.length > 0 &&
      relatedServices.every((service) => serviceStatusOf(service).text === '运行中')
      ? '运行中'
      : '部分运行'
    : '已停止'

  const seatMutation = useMutation({
    mutationFn: () => api.put('/v1/software/softwareRelateRole', seatKeys, { softwareId: seatTarget?.id }),
    onSuccess: () => {
      toast.success('席位关联已更新')
      setSeatTarget(null)
      queryClient.invalidateQueries({ queryKey: ['software'] })
    },
    onError: (error) => toast.error('关联失败', errorMessage(error)),
  })

  const relateMutation = useMutation({
    mutationFn: async ({ id, add = [], remove = [] }: { id: string; add?: string[]; remove?: string[] }) => {
      if (add.length) await api.post(`/v1/software/${id}/relate_service`, { list: add })
      if (remove.length) await api.del(`/v1/software/${id}/relate_service`, { list: remove })
    },
    onSuccess: () => {
      toast.success('关联服务已更新')
      setRelationOpen(false)
      setRelationSelection([])
      setRelatedSelected([])
      queryClient.invalidateQueries({ queryKey: ['software-detail', editing?.id] })
      queryClient.invalidateQueries({ queryKey: ['software-relation-services'] })
      queryClient.invalidateQueries({ queryKey: ['software'] })
    },
    onError: (error) => toast.error('关联服务更新失败', errorMessage(error)),
  })

  const mappingQuery = useQuery({
    queryKey: ['software-gateway-map'],
    queryFn: () => api.get<{ list?: GatewayPort[] }>('/v1/software/gateway'),
    enabled: modalOpen,
  })
  const mappings = mappingQuery.data?.list ?? []

  const entryMutation = useMutation({
    mutationFn: ({
      id,
      port,
      serviceId,
      type,
    }: {
      id: string
      port: number
      serviceId: string
      type: number
    }) => api.post(`/v1/software/${id}/service_entry`, {}, { type, port, serviceId }),
    onSuccess: () => {
      toast.success('入口设置已更新')
      queryClient.invalidateQueries({ queryKey: ['software-gateway-map'] })
      queryClient.invalidateQueries({ queryKey: ['software-gateway'] })
    },
    onError: (error) => toast.error('入口设置失败', errorMessage(error)),
  })

  const mappingMutation = useMutation({
    mutationFn: ({
      softwareId,
      serviceName,
      port,
      path,
    }: {
      softwareId: string
      serviceName: string
      port: number
      path: string
    }) => api.put(`/v1/software/${softwareId}/service/${serviceName}`, {}, { path, port }),
    onSuccess: () => {
      toast.success('映射路径已保存')
      setMappingTarget(null)
      queryClient.invalidateQueries({ queryKey: ['software-gateway-map'] })
      queryClient.invalidateQueries({ queryKey: ['software-gateway'] })
    },
    onError: (error) => toast.error('映射路径保存失败', errorMessage(error)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, running }: { id: string; running: boolean }) =>
      api.get(`/v1/software/${id}/${running ? 'start' : 'stop'}`),
    onSuccess: (_data, variables) => {
      toast.success(variables.running ? '应用已启动' : '应用已停止')
      queryClient.invalidateQueries({ queryKey: ['software-detail', editing?.id] })
      queryClient.invalidateQueries({ queryKey: ['software'] })
    },
    onError: (error) => toast.error('启停失败', errorMessage(error)),
  })

  const orderMutation = useMutation({
    mutationFn: ({ id, top }: { id: string; top: boolean }) =>
      api.put(`/v1/software/order/${top ? 1 : 0}`, { softwareIds: [id] }),
    onSuccess: (_data, variables) => {
      toast.success(variables.top ? '应用已置顶' : '已取消置顶')
      queryClient.invalidateQueries({ queryKey: ['software'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  const iconMutation = useMutation({
    mutationFn: ({ id, icon }: { id: string; icon: string }) =>
      api.put('/v1/software/update_icon', { icon }, { softwareId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['software'] }),
    onError: (error) => toast.error('图标上传失败', errorMessage(error)),
  })

  const shotMutation = useMutation({
    mutationFn: ({ id, list }: { id: string; list: string[] }) =>
      api.put('/v1/software/update_screenshot', { screenShotList: list }, { softwareId: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['software'] }),
    onError: (error) => toast.error('截图上传失败', errorMessage(error)),
  })

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
    enabled: minSetOpen,
  })
  const minSetTouched = useRef(false)

  useEffect(() => {
    if (!minSetOpen || !servicesQuery.data || minSetTouched.current) return
    setMinSetSelected((servicesQuery.data.services ?? []).map((item) => item.nameUs || item.nameFr))
  }, [minSetOpen, servicesQuery.data])

  const minSetMutation = useMutation({
    mutationFn: async () => {
      const services = servicesQuery.data?.services ?? []
      const all = services.map((item) => item.nameUs || item.nameFr)
      const stop = all.filter((name) => !minSetSelected.includes(name))
      const start = all.filter((name) => minSetSelected.includes(name))
      if (start.length) await api.put('/v1/service/start', start)
      if (stop.length) await api.put('/v1/service/stop', stop)
      return { start: start.length, stop: stop.length }
    },
    onSuccess: (result) => {
      toast.success('最小运行集已应用', `启动 ${result.start} 个服务，停止 ${result.stop} 个服务`)
      setMinSetOpen(false)
      queryClient.invalidateQueries({ queryKey: ['services'] })
    },
    onError: (error) => toast.error('应用失败', errorMessage(error)),
  })

  function openSeats(item: Software) {
    setSeatTarget(item)
    setSeatSelectOpen(false)
    setSeatKeys((item.roleList ?? []).map((role) => role.key).filter((key): key is string => !!key))
  }

  function toggleSeat(key: string) {
    setSeatKeys((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  function readImage(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '').replace(/^data:[^;]+;base64,/, '')
      setForm((prev) => ({ ...prev, icon: result }))
    }
    reader.readAsDataURL(file)
  }

  function addShots(files: FileList) {
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result || '').replace(/^data:[^;]+;base64,/, '')
        setShots((prev) => [...prev, result])
      }
      reader.readAsDataURL(file)
    })
  }

  async function importFile(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const token = useAuthStore.getState().token
    try {
      const response = await fetch(`${API_BASE}/v1/pub/import`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { token } : undefined,
        body: formData,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `导入失败 (${response.status})`)
      }
      toast.success('应用导入已提交', '平台将在后台完成解包与注册')
      queryClient.invalidateQueries({ queryKey: ['software'] })
    } catch (error) {
      toast.error('导入失败', errorMessage(error))
    }
  }

  async function runExport() {
    if (exportIds.length === 0) return
    setExporting(true)
    try {
      const task = await api.post<{ taskId?: string }>('/v3/software/backup', exportIds)
      const taskId = task?.taskId
      if (!taskId) throw new Error('导出任务创建失败')
      for (let attempt = 0; attempt < 80; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
        const status = await api.get<{ status?: string }>('/v3/software/backup/status', { taskId })
        if (status?.status === 'finished') {
          window.open(`${API_BASE}/v3/software/backup/download?taskId=${taskId}`, '_blank', 'noopener')
          toast.success('导出完成', '压缩包已开始下载')
          setExportOpen(false)
          setExportIds([])
          return
        }
        if (status?.status === 'failed') throw new Error('导出任务执行失败')
      }
      throw new Error('导出超时，请稍后在备份记录中查看')
    } catch (error) {
      toast.error('导出失败', errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setShots([])
    setInitialShots([])
    setModalOpen(true)
  }

  async function downloadApp(item: Software) {
    try {
      const names = Array.isArray(item.relationServiceName)
        ? item.relationServiceName
        : item.relationServiceName
          ? [item.relationServiceName]
          : []
      if (names.length === 0) throw new Error('该应用未关联可下载的服务镜像')
      const service = await api.get<ServiceItem>(`/v1/service/${encodeURIComponent(names[0])}`)
      const image =
        service.deployment?.spec?.template?.spec?.containers?.[0]?.image ||
        (typeof service.imageInfo === 'string' ? service.imageInfo : service.imageInfo?.image) ||
        ''
      const colon = image.lastIndexOf(':')
      const tag = colon > image.lastIndexOf('/') ? image.slice(colon + 1) : 'latest'
      const repo = colon > image.lastIndexOf('/') ? image.slice(0, colon) : image
      const path = repo.split('/').slice(1).join('/')
      if (!path) throw new Error('无法解析镜像地址')
      const token = useAuthStore.getState().token || ''
      const url = `${API_BASE}/v1/image/download?name=${encodeURIComponent(path)}&tag=${encodeURIComponent(tag)}&token=${encodeURIComponent(token)}`
      const frame = document.createElement('iframe')
      frame.style.display = 'none'
      frame.src = url
      document.body.appendChild(frame)
      window.setTimeout(() => frame.remove(), 120_000)
      toast.success('应用镜像开始下载', `${path}:${tag}`)
    } catch (error) {
      toast.error('下载失败', errorMessage(error))
    }
  }

  function openEdit(item: Software) {
    setEditing(item)
    setEditField(null)
    setRelatedSelected([])
    setRelationOpen(false)
    setRelationSelection([])
    detailAppliedRef.current = ''
    setForm({
      key: item.key,
      name: item.name,
      nameUs: (item as Software & { nameUs?: string }).nameUs || '',
      nameFr: (item as Software & { nameFr?: string }).nameFr || '',
      type: item.type || 'BS',
      routerKey: item.routerKey || '',
      framework: item.framework || 'BS',
      desc: item.desc || '',
      location: 'local',
      icon: item.icon || '',
    })
    setModalOpen(true)
  }

  async function remove(item: Software) {
    const ok = await confirm({
      title: `删除软件「${item.name}」？`,
      description: '删除后该软件将从应用门户中移除，关联的席位授权也将失效。此操作不可撤销。',
      confirmText: '删除',
      danger: true,
    })
    if (ok) deleteMutation.mutate(item.id)
  }

  return (
    <div>
      <PageToolbar
        search={{ value: keyword, onChange: setKeyword, placeholder: '请输入应用名称/标识搜索' }}
      >
        <Button size="sm" variant="signal" onClick={openCreate}>
          <Plus size={12} /> 创建应用
        </Button>
        <input
          ref={importRef}
          type="file"
          accept=".zip,.tar,.gz,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) importFile(file)
            event.target.value = ''
          }}
        />
        <Button size="sm" onClick={() => importRef.current?.click()}>
          <Upload size={11} /> 导入应用
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setExportIds([])
            setExportOpen(true)
          }}
        >
          <Download size={11} /> 导出应用
        </Button>
        <Button
          size="sm"
          onClick={() => {
            minSetTouched.current = false
            setMinSetSelected([])
            setMinSetOpen(true)
          }}
        >
          <List size={11} /> 运行最小集
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setViewMode((prev) => (prev === 'table' ? 'card' : 'table'))
            setExpandedId(null)
          }}
        >
          <LayoutGrid size={11} /> 切换显示
        </Button>
      </PageToolbar>

      {query.isLoading ? (
        <Panel>
          <LoadingBlock rows={5} label="正在读取应用清单" />
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            title="没有匹配的应用"
            description="调整筛选条件，或创建新的业务应用。"
            action={
              <Button size="sm" variant="signal" onClick={openCreate}>
                <Plus size={12} /> 新建应用
              </Button>
            }
          />
        </Panel>
      ) : viewMode === 'table' ? (
        <Panel bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-12" />
                  <th className="w-20 text-center">序号</th>
                  <th style={{ width: 200 }}>名称</th>
                  <th style={{ width: 200 }}>标识</th>
                  <th style={{ width: 200 }}>关联席位</th>
                  <th style={{ width: 180 }}>更新时间</th>
                  <th style={{ width: 150 }}>描述</th>
                  <th className="w-20 text-center">置顶</th>
                  <th style={{ width: 180 }}>创建时间</th>
                  <th style={{ width: 220 }} className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item, index) => {
                  const expanded = expandedId === item.id
                  const related = appServiceList(item)
                  const updatedAt = (item as Software & { updatedAt?: number }).updatedAt
                  return (
                    <Fragment key={item.id}>
                      <tr
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                        className={cn('cursor-pointer', expanded && 'bg-[#16395a]')}
                      >
                        <td onClick={(event) => event.stopPropagation()}>
                          <button
                            className="inline-flex h-6 w-6 items-center justify-center text-ink-3 transition-colors hover:text-white"
                            aria-label={expanded ? '收起' : '展开'}
                            onClick={() => setExpandedId(expanded ? null : item.id)}
                          >
                            {expanded ? <SquareChevronDown size={16} /> : <SquareChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="text-center">
                          <span className="mono text-[11.5px] text-ink-3">{(current - 1) * pageSize + index + 1}</span>
                        </td>
                        <td>
                          <span className="text-[12px] text-ink">{item.name}</span>
                        </td>
                        <td>
                          <span className="mono text-[11.5px] text-ink-3">{item.key}</span>
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-1">
                            {(item.roleList ?? []).length === 0 && (
                              <button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openSeats(item)
                                }}
                                className="inline-flex items-center gap-0.5 border border-[#2f6fa8] bg-[#12314c] px-1.5 py-0.5 text-[11px] text-[#4aa3f0] transition-colors hover:border-signal hover:text-[#7cc4ff]"
                              >
                                <Plus size={9} /> 添加席位
                              </button>
                            )}
                            {(item.roleList ?? []).map((role) => (
                              <Badge key={role.key || role.id} tone="info">
                                {role.name || role.key}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td>
                          <span className="mono whitespace-nowrap text-[11.5px] text-ink-3">
                            {updatedAt ? formatDate(updatedAt, true) : ''}
                          </span>
                        </td>
                        <td>
                          <span className="block max-w-[150px] truncate text-[12px] text-ink-3">{item.desc || ''}</span>
                        </td>
                        <td className="text-center">
                          {item.orderTop ? (
                            <span className="inline-flex items-center border border-line-strong bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-3">
                              已置顶
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <span className="mono whitespace-nowrap text-[11.5px] text-ink-3">
                            {formatDate(item.createdAt, true)}
                          </span>
                        </td>
                        <td onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2.5 text-[12px]">
                            <button
                              disabled={item.framework !== 'CS' && (!item.routerKey || item.web !== 1)}
                              className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff] disabled:cursor-not-allowed disabled:text-mute"
                              onClick={() =>
                                window.open(`http://${platformHost}${item.routerKey}`, '_blank', 'noopener')
                              }
                            >
                              访问
                            </button>
                            <button
                              className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
                              onClick={() => openEdit(item)}
                            >
                              配置
                            </button>
                            <ActionMenu
                              triggerText="更多"
                              items={[
                                { label: '配置席位', onSelect: () => openSeats(item), icon: <Users size={12} /> },
                                {
                                  label: item.orderTop ? '取消置顶' : '置顶应用',
                                  onSelect: () => orderMutation.mutate({ id: item.id, top: !item.orderTop }),
                                  icon: <Pin size={12} />,
                                },
                                {
                                  label: '授权与网关',
                                  onSelect: () => {
                                    setGovTab('auth')
                                    setGeneratedCode('')
                                    setGovOpen(true)
                                  },
                                  icon: <ShieldCheck size={12} />,
                                },
                                {
                                  label: item.releaseStatus === 1 ? '禁止访问' : '放行应用',
                                  onSelect: () => releaseMutation.mutate({ id: item.id, release: item.releaseStatus !== 1 }),
                                  icon: <AppWindow size={12} />,
                                },
                                { label: '应用下载', onSelect: () => downloadApp(item), icon: <Download size={12} /> },
                                { label: '删除应用', danger: true, onSelect: () => remove(item), icon: <Trash2 size={12} /> },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={10} className="bg-[#0c1b2a] p-0">
                            <div className="border-y border-line">
                              <table className="data-table">
                                <thead>
                                  <tr>
                                    <th>服务名称</th>
                                    <th>服务标识</th>
                                    <th>状态</th>
                                    <th>镜像</th>
                                    <th>版本更新时间</th>
                                    <th>
                                      <span className="inline-flex items-center gap-1">
                                        授权状态 <Filter size={10} />
                                      </span>
                                    </th>
                                    <th className="text-right">操作</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {related.map((service) => {
                                    const name = serviceNameOf(service)
                                    const status = serviceStatusOf(service)
                                    const auth = service.serviceAuth as { auth?: number } | null | undefined
                                    return (
                                      <tr key={name}>
                                        <td>
                                          <span className="text-[12px] text-ink">{name}</span>
                                        </td>
                                        <td>
                                          <span className="mono text-[11.5px] text-ink-3">{service.nameUs || service.nameFr}</span>
                                        </td>
                                        <td>
                                          <div className="leading-[1.5]">
                                            <div className={cn('flex items-center gap-1 text-[12px]', status.tone)}>
                                              {status.text}
                                              <Info size={10} />
                                            </div>
                                            <div className="text-[11.5px] text-ink-3">
                                              {status.ready}/{status.desired}部分运行
                                            </div>
                                            <div className="flex items-center gap-1 text-[11.5px] text-ink-3">
                                              已重启 {service.restartCount ?? 0} 次
                                              <Info size={10} />
                                            </div>
                                          </div>
                                        </td>
                                        <td>
                                          <span className="block max-w-[200px] truncate font-mono text-[11px] text-ink-3">
                                            {serviceImageOf(service)}
                                          </span>
                                        </td>
                                        <td>
                                          <span className="mono whitespace-nowrap text-[11.5px] text-ink-3">
                                            {formatDate(service.deployment?.metadata?.creationTimestamp, true)}
                                          </span>
                                        </td>
                                        <td>
                                          {auth ? (
                                            <span className={cn('text-[12px]', auth.auth === 1 ? 'text-ok' : 'text-ink-3')}>
                                              {auth.auth === 1 ? '已授权' : '未授权'}
                                            </span>
                                          ) : (
                                            <span className="text-[12px] text-ink-3">—</span>
                                          )}
                                        </td>
                                        <td>
                                          <div className="flex items-center justify-end gap-2.5 text-[12px]">
                                            <button
                                              className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
                                              onClick={() =>
                                                navigate(
                                                  `/software/application/service-params?service=${encodeURIComponent(name)}`,
                                                )
                                              }
                                            >
                                              配置
                                            </button>
                                            <button
                                              className={cn(
                                                'transition-colors',
                                                status.text === '已停止'
                                                  ? 'text-[#4aa3f0] hover:text-[#7cc4ff]'
                                                  : 'text-[#ff7b7b] hover:text-[#ff9a9a]',
                                              )}
                                              onClick={() =>
                                                serviceAction.mutate({
                                                  path:
                                                    status.text === '已停止'
                                                      ? '/v1/service/start'
                                                      : '/v1/service/stop',
                                                  names: [name],
                                                })
                                              }
                                            >
                                              {status.text === '已停止' ? '启动' : '停止'}
                                            </button>
                                            <ActionMenu
                                              triggerText="更多"
                                              items={[
                                                {
                                                  label: '重启服务',
                                                  onSelect: () =>
                                                    serviceAction.mutate({ path: '/v1/service/reStart', names: [name] }),
                                                },
                                                {
                                                  label: '查看服务',
                                                  onSelect: () => navigate('/software/application/service'),
                                                },
                                                {
                                                  label: '删除服务',
                                                  danger: true,
                                                  onSelect: async () => {
                                                    const ok = await confirm({
                                                      title: `删除服务「${name}」？`,
                                                      description: '删除后将从集群移除对应工作负载，此操作不可恢复。',
                                                      confirmText: '删除',
                                                      danger: true,
                                                    })
                                                    if (ok) serviceAction.mutate({ path: '/v1/service', names: [name] })
                                                  },
                                                },
                                              ]}
                                            />
                                          </div>
                                        </td>
                                      </tr>
                                    )
                                  })}
                                  {related.length === 0 && (
                                    <tr>
                                      <td colSpan={7} className="py-6 text-center text-[11.5px] text-mute">
                                        该应用暂未关联服务
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2">
            <button
              className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30"
              disabled={current <= 1}
              onClick={() => setPage(1)}
              aria-label="首页"
            >
              «
            </button>
            <button
              className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
              aria-label="上一页"
            >
              ‹
            </button>
            <span className="text-[11.5px] text-ink-3">
              当前第 {current} / {totalPages} 页
            </span>
            <button
              className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30"
              disabled={current >= totalPages}
              onClick={() => setPage(current + 1)}
              aria-label="下一页"
            >
              ›
            </button>
            <button
              className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30"
              disabled={current >= totalPages}
              onClick={() => setPage(totalPages)}
              aria-label="末页"
            >
              »
            </button>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((item, index) => (
            <article
              key={item.id}
              className="panel corner-marks group relative flex flex-col p-0 transition-transform hover:-translate-y-0.5"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
                <div className="relative flex h-11 w-11 flex-none items-center justify-center border border-line-strong bg-paper-2">
                  {item.icon ? (
                    <img src={iconSrc(item.icon)} alt="" className="h-7 w-7 object-contain" />
                  ) : (
                    <span className="num text-[20px] text-ink">{(item.name || item.key).slice(0, 1).toUpperCase()}</span>
                  )}
                  <span className="absolute -bottom-px -right-px h-2 w-2" style={{ background: item.releaseStatus === 1 ? 'var(--color-ok)' : 'var(--color-line-strong)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[13.5px] font-semibold text-ink">{item.name}</h3>
                    <Badge tone={item.type === 'CS' ? 'warn' : 'info'}>{item.type || item.framework || 'BS'}</Badge>
                  </div>
                  <div className="mono mt-1 truncate text-[9px] tracking-[0.12em] text-mute">KEY / {item.key}</div>
                </div>
                <ActionMenu
                  items={[
                    {
                      label: '应用下载',
                      onSelect: () => downloadApp(item),
                      icon: <Download size={12} />,
                    },
                    {
                      label: '编辑应用',
                      onSelect: () => openEdit(item),
                    },
                    {
                      label: item.releaseStatus === 1 ? '禁止访问' : '放行应用',
                      onSelect: () => releaseMutation.mutate({ id: item.id, release: item.releaseStatus !== 1 }),
                      icon: <ShieldCheck size={12} />,
                    },
                    {
                      label: '配置席位',
                      onSelect: () => openSeats(item),
                      icon: <Users size={12} />,
                    },
                    {
                      label: item.orderTop ? '取消置顶' : '置顶应用',
                      onSelect: () => orderMutation.mutate({ id: item.id, top: !item.orderTop }),
                      icon: <Pin size={12} />,
                    },
                    {
                      label: '打开入口',
                      disabled: !item.routerKey,
                      onSelect: () => window.open(`http://${platformHost}${item.routerKey}`, '_blank', 'noopener'),
                      icon: <ExternalLink size={12} />,
                    },
                    { label: '删除应用', danger: true, onSelect: () => remove(item), icon: <Trash2 size={12} /> },
                  ]}
                />
              </div>

              <div className="flex-1 px-4 py-3">
                <p className="line-clamp-2 min-h-[32px] text-[11.5px] leading-relaxed text-ink-3">
                  {item.desc || '暂无描述。该应用由平台统一注册，可通过席位授权向用户开放。'}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  <div>
                    <div className="label">路由入口</div>
                    <div className="mono mt-0.5 truncate text-[10px] text-ink">{item.routerKey || '—'}</div>
                  </div>
                  <div>
                    <div className="label">软件版本</div>
                    <div className="mono mt-0.5 text-[10px] text-ink">{item.version || '—'}</div>
                  </div>
                  <div>
                    <div className="label">创建时间</div>
                    <div className="mono mt-0.5 text-[10px] text-ink">{formatDate(item.createdAt)}</div>
                  </div>
                  <div>
                    <div className="label">放行状态</div>
                    <div className="mt-0.5">
                      <Badge tone={item.releaseStatus === 1 ? 'ok' : 'default'}>
                        {item.releaseStatus === 1 ? 'RELEASED' : 'RESTRICTED'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 border-t border-line pt-2">
                  <span className="label">关联席位</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {(item.roleList ?? []).length === 0 && (
                      <button
                        onClick={() => openSeats(item)}
                        className="mono text-[8.5px] tracking-widest text-mute hover:text-signal"
                      >
                        添加席位
                      </button>
                    )}
                    {(item.roleList ?? []).map((role) => (
                      <Badge key={role.key || role.id} tone="info">
                        {role.name || role.key || role.id}
                      </Badge>
                    ))}
                  </div>
                  {(item.roleList ?? []).length > 0 && (
                    <button
                      onClick={() => openSeats(item)}
                      className="mono ml-auto text-[8px] tracking-widest text-mute hover:text-signal"
                    >
                      配置
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-line px-4 py-2">
                <span className="mono text-[8px] tracking-[0.16em] text-mute">ID {item.id.slice(0, 8).toUpperCase()}</span>
                <button
                  onClick={() => releaseMutation.mutate({ id: item.id, release: item.releaseStatus !== 1 })}
                  className="mono flex items-center gap-1 text-[8.5px] tracking-widest text-ink-3 transition-colors hover:text-signal"
                >
                  {item.releaseStatus === 1 ? '限制访问' : '放行访问'}
                  <AppWindow size={10} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Drawer
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open)
          if (!open) {
            setEditing(null)
            setForm(emptyForm)
            setEditField(null)
          }
        }}
        title={editing ? `应用配置 ${editing.name}` : '新增应用'}
        width={760}
        footer={
          <>
            <Button size="sm" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {editing ? '保存修改' : '创建应用'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div>
            <SectionTitle>基本信息</SectionTitle>
            <div className="space-y-2.5">
              <ConfigRow label="应用名称" onEdit={() => setEditField('name')}>
                <input
                  className="field h-8 text-[12px]"
                  readOnly={editField !== 'name'}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </ConfigRow>
              <ConfigRow label="英文名称" onEdit={() => setEditField('nameUs')}>
                <input
                  className="field h-8 text-[12px]"
                  readOnly={editField !== 'nameUs'}
                  value={form.nameUs}
                  onChange={(event) => setForm({ ...form, nameUs: event.target.value })}
                />
              </ConfigRow>
              <ConfigRow label="法文名称" onEdit={() => setEditField('nameFr')}>
                <input
                  className="field h-8 text-[12px]"
                  readOnly={editField !== 'nameFr'}
                  value={form.nameFr}
                  onChange={(event) => setForm({ ...form, nameFr: event.target.value })}
                />
              </ConfigRow>
              <ConfigRow label="应用标识" onEdit={() => setEditField('key')}>
                <input
                  className="field h-8 text-[12px]"
                  readOnly={editField !== 'key'}
                  value={form.key}
                  onChange={(event) => setForm({ ...form, key: event.target.value })}
                />
              </ConfigRow>
              <ConfigRow label="应用类型">
                <select
                  className="field h-8 text-[12px]"
                  value={form.type}
                  onChange={(event) =>
                    setForm({ ...form, type: event.target.value, framework: event.target.value })
                  }
                >
                  <option value="BS">容器化应用（B/S）</option>
                  <option value="CS">客户端应用（C/S）</option>
                </select>
              </ConfigRow>
              <ConfigRow label="关联席位" onEdit={() => editing && openSeats(editing)}>
                <input
                  className="field h-8 text-[12px]"
                  readOnly
                  value={
                    (detailQuery.data?.roleNameList ?? []).join('、') ||
                    (editing?.roleList ?? []).map((role) => role.name || role.key).join('、')
                  }
                  placeholder="未关联席位"
                />
              </ConfigRow>
              <ConfigRow label="应用描述" onEdit={() => setEditField('desc')}>
                <textarea
                  className="field text-[12px]"
                  rows={2}
                  readOnly={editField !== 'desc'}
                  value={form.desc}
                  onChange={(event) => setForm({ ...form, desc: event.target.value })}
                />
              </ConfigRow>
              <ConfigRow label="应用截图">
                <div className="flex flex-wrap items-center gap-2">
                  {shots.map((shot, index) => (
                    <div key={index} className="group relative h-[68px] w-[68px] border border-dashed border-line-strong bg-paper-2">
                      <img src={iconSrc(shot)} alt="" className="h-full w-full object-cover" />
                      <button
                        onClick={() => setShots((prev) => prev.filter((_, i) => i !== index))}
                        className="absolute right-0 top-0 bg-black/60 px-1 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <label className="flex h-[68px] w-[68px] cursor-pointer flex-col items-center justify-center gap-1 border border-dashed border-line-strong text-[10px] text-ink-3 hover:border-signal hover:text-signal">
                    <Plus size={12} />
                    修改
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        if (event.target.files?.length) addShots(event.target.files)
                        event.target.value = ''
                      }}
                    />
                  </label>
                </div>
              </ConfigRow>
              <ConfigRow label="应用图标">
                <div className="flex items-center gap-3">
                  <div className="flex h-[68px] w-[68px] flex-none items-center justify-center border border-dashed border-line-strong bg-paper-2">
                    {form.icon ? (
                      <img src={iconSrc(form.icon)} alt="" className="h-10 w-10 object-contain" />
                    ) : (
                      <span className="num text-[16px] text-mute">{(form.name || form.key || 'A').slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>
                  <label className="cursor-pointer text-[12px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]">
                    修改
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) readImage(file)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  {form.icon && (
                    <button
                      onClick={() => setForm({ ...form, icon: '' })}
                      className="text-[12px] text-mute transition-colors hover:text-danger"
                    >
                      移除
                    </button>
                  )}
                </div>
              </ConfigRow>
            </div>
          </div>

          <div>
            <SectionTitle>运行状态</SectionTitle>
            <div className="flex items-center justify-between border border-line bg-paper-2/40 px-3 py-2">
              <span className="text-[12px] text-ink-3">一键启停</span>
              <div className="flex items-center gap-2">
                <button
                  role="switch"
                  aria-checked={appRunning}
                  disabled={!editing || statusMutation.isPending}
                  onClick={() =>
                    editing && statusMutation.mutate({ id: editing.id, running: !appRunning })
                  }
                  className={cn(
                    'relative h-[18px] w-[34px] rounded-full transition-colors disabled:opacity-50',
                    appRunning ? 'bg-[#1670c2]' : 'bg-[#2b4c6d]',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#dfeaf5] transition-all',
                      appRunning ? 'left-[18px]' : 'left-[2px]',
                    )}
                  />
                </button>
                <span
                  className={cn(
                    'flex items-center gap-1 text-[11px]',
                    appRunning ? 'text-ok' : 'text-mute',
                  )}
                >
                  <span
                    className={cn('h-1.5 w-1.5 rounded-full', appRunning ? 'bg-ok' : 'bg-mute')}
                  />
                  {appStateText}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <SectionTitle>访问方式</SectionTitle>
          <div className="flex items-start gap-2">
            <span className="w-[68px] flex-none pt-[7px] text-right text-[12px] text-ink-3">url：</span>
            <input
              className="field h-8 flex-1 text-[12px]"
              readOnly={editField !== 'routerKey'}
              value={form.routerKey}
              onChange={(event) => setForm({ ...form, routerKey: event.target.value })}
            />
            <button
              onClick={() => setEditField('routerKey')}
              className="w-8 flex-none pt-[7px] text-left text-[12px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            >
              修改
            </button>
          </div>
        </div>

        <div className="mt-6">
          <SectionTitle>包含的服务</SectionTitle>
          <div className="mb-2.5 flex items-center gap-2">
            <Button
              size="sm"
              variant="signal"
              onClick={() => {
                setRelationSelection(relatedNames)
                setRelationOpen(true)
              }}
            >
              <Plus size={11} /> 新增关联服务
            </Button>
            <Button
              size="sm"
              disabled={relatedSelected.length === 0 || relateMutation.isPending}
              onClick={async () => {
                if (!editing) return
                const ok = await confirm({
                  title: '删除关联服务',
                  description: `确认删除所选服务: ${relatedSelected.join('、')} ?`,
                  confirmText: '确定',
                  danger: true,
                })
                if (ok) relateMutation.mutate({ id: editing.id, remove: relatedSelected })
              }}
            >
              − 删除关联服务
            </Button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-9" />
                <th style={{ width: 110 }}>服务名称</th>
                <th style={{ width: 90 }}>服务类型</th>
                <th style={{ width: 90 }}>服务状态</th>
                <th style={{ width: 260 }}>映射路径</th>
                <th style={{ width: 110 }} className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {relatedServices.map((service) => {
                const name = serviceNameOf(service)
                const appType = service.service?.metadata?.labels?.['system/appType']
                const status = serviceStatusOf(service)
                const mapping = mappings.find(
                  (item) => item.serviceId === name || item.serviceLabel === name,
                )
                return (
                  <tr key={name}>
                    <td>
                      <input
                        type="checkbox"
                        className="check"
                        checked={relatedSelected.includes(name)}
                        onChange={() =>
                          setRelatedSelected((prev) =>
                            prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
                          )
                        }
                      />
                    </td>
                    <td>
                      <span className="whitespace-nowrap text-[12px] text-ink">{name}</span>
                      {mapping?.web && <span className="ml-1 text-[11px] text-mute">(入口)</span>}
                    </td>
                    <td>
                      <span className="text-[12px] text-ink-3">
                        {appType === 'business' ? '前台服务' : appType ? '后台服务' : '—'}
                      </span>
                    </td>
                    <td>
                      <span className={cn('text-[12px]', status.tone)}>{status.text}</span>
                    </td>
                    <td>
                      <MappingPopover
                        mapping={mapping}
                        onToggle={() => {
                          if (!editing || !mapping) return
                          entryMutation.mutate({
                            id: editing.id,
                            port: Number(mapping.port ?? 80),
                            serviceId: mapping.serviceId || name,
                            type: mapping.web ? 0 : 1,
                          })
                        }}
                      />
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-2.5 whitespace-nowrap text-[12px]">
                        <button
                          className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
                          onClick={() => {
                            const port = String(mapping?.port ?? servicePortsOf(service)[0])
                            setMappingPort(port)
                            setMappingPath(mapping?.path || `${name}-${port}`)
                            setMappingTarget({ service, mapping })
                          }}
                        >
                          映射路径
                        </button>
                        <button
                          className="text-[#ff7b7b] transition-colors hover:text-[#ff9a9a]"
                          onClick={async () => {
                            if (!editing) return
                            const ok = await confirm({
                              title: '删除服务',
                              description: `确认删除所选服务: ${name} ?`,
                              confirmText: '确定',
                              danger: true,
                            })
                            if (ok) relateMutation.mutate({ id: editing.id, remove: [name] })
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {relatedServices.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[11.5px] text-mute">
                    该应用暂未关联服务
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Drawer>

      <Modal
        open={relationOpen}
        onOpenChange={(open) => {
          setRelationOpen(open)
          if (!open) setRelationSelection([])
        }}
        title="选择关联服务"
        width={360}
        footer={
          <>
            <Button size="sm" onClick={() => setRelationOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={relateMutation.isPending}
              onClick={() => {
                if (!editing) return
                const add = relationSelection.filter((name) => !relatedNames.includes(name))
                const remove = relatedNames.filter((name) => !relationSelection.includes(name))
                if (add.length === 0 && remove.length === 0) {
                  setRelationOpen(false)
                  return
                }
                relateMutation.mutate({ id: editing.id, add, remove })
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <div className="border border-line bg-paper-2/40">
          <div className="flex min-h-[36px] flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
            {relationSelection.length === 0 && <span className="text-[11.5px] text-mute">请选择服务</span>}
            {relationSelection.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 border border-line-strong bg-[#132c44] px-1.5 py-0.5 text-[11.5px] text-ink-3"
              >
                {name}
                <button
                  aria-label={`取消 ${name}`}
                  onClick={() => setRelationSelection((prev) => prev.filter((item) => item !== name))}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="max-h-[200px] overflow-y-auto py-1">
            {services.map((service) => {
              const name = serviceNameOf(service)
              const checked = relationSelection.includes(name)
              return (
                <button
                  key={name}
                  onClick={() =>
                    setRelationSelection((prev) =>
                      checked ? prev.filter((item) => item !== name) : [...prev, name],
                    )
                  }
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors',
                    checked ? 'bg-[#16395a] text-white' : 'text-ink-3 hover:bg-[#142a3e]',
                  )}
                >
                  <span className="flex-1 truncate">{name}</span>
                  {checked && <Check size={12} className="text-signal" />}
                </button>
              )
            })}
            {services.length === 0 && (
              <div className="px-2.5 py-4 text-center text-[11.5px] text-mute">暂无服务</div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!mappingTarget}
        onOpenChange={(open) => !open && setMappingTarget(null)}
        title="服务端口映射路径"
        width={300}
        footer={
          <>
            <Button size="sm" onClick={() => setMappingTarget(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={mappingMutation.isPending}
              onClick={() => {
                if (!editing || !mappingTarget) return
                if (!mappingPath.trim()) {
                  toast.error('请填写路径')
                  return
                }
                mappingMutation.mutate({
                  softwareId: editing.id,
                  serviceName: serviceNameOf(mappingTarget.service),
                  port: Number(mappingPort),
                  path: mappingPath.trim(),
                })
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <span className="w-[48px] flex-none pt-[7px] text-right text-[12px] text-ink-3">
              <span className="text-danger">*</span> 端口：
            </span>
            <select
              className="field h-8 flex-1 text-[12px]"
              value={mappingPort}
              onChange={(event) => setMappingPort(event.target.value)}
            >
              {mappingTarget &&
                servicePortsOf(mappingTarget.service).map((port) => (
                  <option key={port} value={String(port)}>
                    {port}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-[48px] flex-none pt-[7px] text-right text-[12px] text-ink-3">
              <span className="text-danger">*</span> 路径：
            </span>
            <input
              className="field h-8 flex-1 text-[12px]"
              value={mappingPath}
              onChange={(event) => setMappingPath(event.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!seatTarget}
        onOpenChange={(open) => {
          if (open) return
          setSeatSelectOpen(false)
          setSeatTarget(null)
        }}
        title="新增关联席位"
        width={600}
        footer={
          <>
            <Button size="sm" onClick={() => setSeatTarget(null)}>
              取消
            </Button>
            <Button size="sm" variant="primary" loading={seatMutation.isPending} onClick={() => seatMutation.mutate()}>
              确定
            </Button>
          </>
        }
      >
        <div className="flex w-[500px] max-w-full items-start gap-2 px-4 py-3">
          <span className="w-[68px] flex-none pt-[7px] text-right text-[12px] text-ink-3">关联席位：</span>
          <div className="min-w-0 flex-1">
            <DropdownMenu.Root open={seatSelectOpen} onOpenChange={setSeatSelectOpen}>
              <DropdownMenu.Trigger asChild>
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'field flex min-h-8 w-full cursor-pointer flex-wrap items-center gap-1 px-1.5 py-1 text-[12px]',
                    seatSelectOpen && 'border-signal',
                  )}
                >
                  {seatKeys.length === 0 && <span className="text-mute">请选择席位</span>}
                  {seatKeys.map((key) => {
                    const role = roleOptions.find((item) => item.key === key)
                    return (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1 rounded-sm border border-[#2f6392] bg-[#123a5b] px-1.5 py-[1px] text-[11px] text-[#cfe6ff]"
                      >
                        {role?.name || key}
                        <span
                          role="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleSeat(key)
                          }}
                          className="text-[#7ea7cc] hover:text-white"
                        >
                          <X size={10} />
                        </span>
                      </span>
                    )
                  })}
                  <ChevronDown size={12} className="ml-auto flex-none text-mute" />
                </div>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="z-[80] max-h-[240px] w-[var(--radix-dropdown-menu-trigger-width)] overflow-auto border border-line bg-paper-2 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
                >
                  {roleOptions.length === 0 && (
                    <div className="px-3 py-2 text-[12px] text-mute">
                      {rolesQuery.isLoading ? '加载中…' : '暂无数据'}
                    </div>
                  )}
                  {roleOptions.map((role) => {
                    const checked = seatKeys.includes(role.key)
                    return (
                      <DropdownMenu.CheckboxItem
                        key={role.key}
                        checked={checked}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => toggleSeat(role.key)}
                        className="flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-[12px] text-ink-3 outline-none transition-colors data-[highlighted]:bg-[#16304a] data-[highlighted]:text-ink data-[state=checked]:text-ink"
                      >
                        <span className="truncate">{role.name}</span>
                        <DropdownMenu.ItemIndicator>
                          <Check size={12} className="flex-none text-signal" />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.CheckboxItem>
                    )
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </Modal>

      <Drawer
        open={exportOpen}
        onOpenChange={setExportOpen}
        kicker="SOFTWARE / EXPORT"
        title="导出应用"
        description="选择需要导出的应用，平台将打包应用信息与关联配置为压缩包。"
        width={560}
        footer={
          <>
            <Button size="sm" onClick={() => setExportOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={exportIds.length === 0}
              loading={exporting}
              onClick={runExport}
            >
              <Download size={11} /> 开始导出
            </Button>
          </>
        }
      >
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto">
          {list.map((item) => {
            const checked = exportIds.includes(item.id)
            return (
              <label
                key={item.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 border px-3 py-2 transition-colors',
                  checked ? 'border-signal bg-signal/[0.04]' : 'border-line hover:border-line-strong',
                )}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--color-signal)]"
                  checked={checked}
                  onChange={() =>
                    setExportIds((prev) =>
                      prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
                    )
                  }
                />
                <div className="flex h-7 w-7 flex-none items-center justify-center border border-line bg-paper-2">
                  {item.icon ? (
                    <img src={iconSrc(item.icon)} alt="" className="h-5 w-5 object-contain" />
                  ) : (
                    <span className="num text-[12px] text-mute">{item.name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-ink">{item.name}</div>
                  <div className="mono mt-0.5 text-[8.5px] tracking-widest text-mute">KEY / {item.key}</div>
                </div>
              </label>
            )
          })}
          {list.length === 0 && <div className="py-6 text-center text-[11px] text-mute">暂无可导出的应用</div>}
        </div>
      </Drawer>

      <Drawer
        open={minSetOpen}
        onOpenChange={setMinSetOpen}
        kicker="SOFTWARE / MINIMAL SET"
        title="运行最小集"
        description="勾选需要保持运行的服务，未勾选的服务将被停止。用于在资源受限时收敛运行范围。"
        width={560}
        footer={
          <>
            <Button size="sm" onClick={() => setMinSetOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={minSetMutation.isPending}
              onClick={() => minSetMutation.mutate()}
            >
              应用最小集
            </Button>
          </>
        }
      >
        <div className="mb-3 border-l-2 border-warn bg-warn/[0.06] px-3 py-2 text-[10.5px] leading-relaxed text-ink-3">
          应用后，未勾选的服务将立即停止，可能导致依赖其的应用不可用。请确认影响范围后再执行。
        </div>
        <div className="max-h-[340px] space-y-1.5 overflow-y-auto">
          {(servicesQuery.data?.services ?? []).map((service) => {
            const name = service.nameUs || service.nameFr
            const checked = minSetSelected.includes(name)
            const running = (service.deployment?.status?.readyReplicas ?? 0) > 0
            return (
              <label
                key={name}
                className={cn(
                  'flex cursor-pointer items-center gap-3 border px-3 py-2 transition-colors',
                  checked ? 'border-signal bg-signal/[0.04]' : 'border-line hover:border-line-strong',
                )}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--color-signal)]"
                  checked={checked}
                  onChange={() => {
                    minSetTouched.current = true
                    setMinSetSelected((prev) =>
                      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
                    )
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-ink">{name}</div>
                  <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">
                    {service.deployment?.status?.readyReplicas ?? 0}/{service.deployment?.spec?.replicas ?? 0} READY
                  </div>
                </div>
                <Badge tone={running ? 'ok' : 'default'}>{running ? 'RUNNING' : 'STOPPED'}</Badge>
              </label>
            )
          })}
          {servicesQuery.isLoading && <div className="py-6 text-center text-[11px] text-mute">正在读取服务…</div>}
        </div>
      </Drawer>

      <Drawer
        open={govOpen}
        onOpenChange={setGovOpen}
        kicker="SOFTWARE / LICENSE & GATEWAY"
        title="应用授权与网关放通"
        description="维护业务软件授权状态，并控制服务端口是否允许经平台网关访问。"
        width={920}
        footer={
          <>
            <Button size="sm" loading={authQuery.isFetching || gatewayQuery.isFetching} onClick={() => {
              authQuery.refetch()
              gatewayQuery.refetch()
            }}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" onClick={() => setGovOpen(false)}>
              关闭
            </Button>
          </>
        }
      >
        <div className="mb-4 flex items-center border border-line-strong">
          <button
            className={cn('px-4 py-1.5 text-[11px]', govTab === 'auth' ? 'bg-signal text-white' : 'text-mute hover:text-ink')}
            onClick={() => setGovTab('auth')}
          >
            <KeyRound size={11} className="mr-1.5 inline" /> 应用授权
          </button>
          <button
            className={cn('px-4 py-1.5 text-[11px]', govTab === 'gateway' ? 'bg-signal text-white' : 'text-mute hover:text-ink')}
            onClick={() => setGovTab('gateway')}
          >
            <Network size={11} className="mr-1.5 inline" /> 网关放通
          </button>
        </div>

        {govTab === 'auth' ? (
          <div className="space-y-3">
            <div className="flex items-end gap-2 border border-line bg-paper-2/40 px-3 py-3">
              <Field label="激活码" className="flex-1">
                <input
                  className="field h-8 font-mono text-[11px]"
                  placeholder="粘贴平台提供的应用激活码"
                  value={authCode}
                  onChange={(event) => setAuthCode(event.target.value)}
                />
              </Field>
              <Button
                size="sm"
                variant="primary"
                loading={activateMutation.isPending}
                onClick={() => activateMutation.mutate()}
              >
                激活应用
              </Button>
            </div>

            {generatedCode && (
              <div className="border border-line px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="label">软件识别码</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard?.writeText(generatedCode)
                      toast.success('识别码已复制')
                    }}
                  >
                    <Copy size={10} /> 复制
                  </Button>
                </div>
                <div className="mono break-all text-[10px] leading-relaxed text-ink-3">{generatedCode}</div>
              </div>
            )}

            <div className="max-h-[380px] overflow-y-auto border border-line">
              <div className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1fr_1fr_170px] gap-2 border-b border-line bg-paper-2/60 px-3 py-2">
                {['应用 / KEY', '框架', '状态', '授权时间', '到期时间', '操作'].map((item) => (
                  <span key={item} className="label">
                    {item}
                  </span>
                ))}
              </div>
              {(authQuery.data?.list ?? []).map((item) => (
                <div
                  key={item.id || item.softWareKey}
                  className="grid grid-cols-[1.4fr_0.8fr_0.7fr_1fr_1fr_170px] items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-ink">{item.softWareName || '—'}</div>
                    <div className="mono mt-0.5 truncate text-[8.5px] tracking-wider text-mute">{item.softWareKey}</div>
                  </div>
                  <Badge>{item.framework || '—'}</Badge>
                  <Badge tone={item.status === 1 ? 'ok' : item.status === 2 ? 'warn' : 'default'}>
                    {authStatusText(item.status)}
                  </Badge>
                  <span className="mono text-[9px] text-ink-3">
                    {item.authCreateTime ? formatDate(item.authCreateTime) : '—'}
                  </span>
                  <span className="mono text-[9px] text-ink-3">
                    {item.authExpireTime ? formatDate(item.authExpireTime) : '—'}
                  </span>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      loading={codeMutation.isPending}
                      onClick={() => codeMutation.mutate(item.softWareKey || '')}
                    >
                      识别码
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!item.softWareKey}
                      loading={cancelAuthMutation.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `取消「${item.softWareName || item.softWareKey}」授权？`,
                          description: '取消后该应用将回到未授权状态，可能影响其功能可用性。',
                          confirmText: '取消授权',
                          danger: true,
                        })
                        if (ok) cancelAuthMutation.mutate(item.softWareKey || '')
                      }}
                    >
                      取消授权
                    </Button>
                  </div>
                </div>
              ))}
              {(authQuery.data?.list ?? []).length === 0 && (
                <div className="px-3 py-10 text-center text-[11px] text-mute">
                  {authQuery.isLoading ? '正在读取授权信息…' : '暂无软件授权记录'}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="max-h-[440px] overflow-y-auto border border-line">
            <div className="grid grid-cols-[1fr_1.1fr_0.6fr_1.4fr_0.8fr_90px] gap-2 border-b border-line bg-paper-2/60 px-3 py-2">
              {['软件', '服务', '端口', '访问路径', '状态', '操作'].map((item) => (
                <span key={item} className="label">
                  {item}
                </span>
              ))}
            </div>
            {(gatewayQuery.data?.list ?? []).map((item) => (
              <div
                key={`${item.softwareKey}-${item.servicePortId}`}
                className="grid grid-cols-[1fr_1.1fr_0.6fr_1.4fr_0.8fr_90px] items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0"
              >
                <span className="truncate text-[11px] text-ink">{item.softwareName || '—'}</span>
                <span className="mono truncate text-[10px] text-ink-3">{item.serviceLabel || item.serviceId || '—'}</span>
                <span className="mono text-[10px] text-ink-3">{item.port ?? '—'}</span>
                <button
                  className="mono flex items-center gap-1 truncate text-left text-[9px] text-info hover:underline"
                  onClick={() => {
                    navigator.clipboard?.writeText(item.fullPath || item.path || '')
                    toast.success('访问路径已复制')
                  }}
                >
                  <Copy size={9} /> {item.fullPath || item.path || '—'}
                </button>
                <Badge tone={item.allow ? 'ok' : 'warn'}>{item.allow ? '已放通' : '已阻断'}</Badge>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant={item.allow ? 'ghost' : 'primary'}
                    loading={gatewayMutation.isPending}
                    disabled={!item.servicePortId}
                    onClick={() =>
                      gatewayMutation.mutate({ servicePortId: Number(item.servicePortId), allow: !item.allow })
                    }
                  >
                    {item.allow ? '阻断' : '放通'}
                  </Button>
                </div>
              </div>
            ))}
            {(gatewayQuery.data?.list ?? []).length === 0 && (
              <div className="px-3 py-10 text-center text-[11px] text-mute">
                {gatewayQuery.isLoading ? '正在读取网关信息…' : '暂无网关端口配置'}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
