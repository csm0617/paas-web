import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppWindow, Copy, Download, ExternalLink, KeyRound, LayoutGrid, List, Network, Pin, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
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

const emptyForm = {
  key: '',
  name: '',
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

export default function SoftwareListPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState('ALL')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Software | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [seatTarget, setSeatTarget] = useState<Software | null>(null)
  const [seatKeys, setSeatKeys] = useState<string[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const [exportIds, setExportIds] = useState<string[]>([])
  const [exporting, setExporting] = useState(false)
  const [shots, setShots] = useState<string[]>([])
  const [initialShots, setInitialShots] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card')
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
    return list.filter((item) => {
      const matchType = type === 'ALL' || item.type === type || item.framework === type
      const q = keyword.trim().toLowerCase()
      const matchKeyword =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        (item.desc || '').toLowerCase().includes(q)
      return matchType && matchKeyword
    })
  }, [list, type, keyword])

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
    queryFn: () => api.get<{ list: RoleItem[]; total: number }>('/v1/role', { page: 1, size: 300 }),
    enabled: !!seatTarget,
    staleTime: 60_000,
  })

  const detailQuery = useQuery({
    queryKey: ['software-detail', editing?.id],
    queryFn: () =>
      api.get<Software & { screenShotList?: string[] | null }>(`/v1/software/${editing?.id}`),
    enabled: !!editing,
  })

  useEffect(() => {
    if (!detailQuery.data) return
    const list = detailQuery.data.screenShotList ?? []
    setShots(list)
    setInitialShots(list)
  }, [detailQuery.data])

  const seatMutation = useMutation({
    mutationFn: () => api.put('/v1/software/softwareRelateRole', seatKeys, { softwareId: seatTarget?.id }),
    onSuccess: () => {
      toast.success('席位关联已更新')
      setSeatTarget(null)
      queryClient.invalidateQueries({ queryKey: ['software'] })
    },
    onError: (error) => toast.error('关联失败', errorMessage(error)),
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
    setForm({
      key: item.key,
      name: item.name,
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

  const stats = [
    ['应用总数', list.length, 'REGISTERED'],
    ['BS 架构', list.filter((item) => (item.framework || item.type) === 'BS').length, 'BROWSER / SERVER'],
    ['CS 架构', list.filter((item) => (item.framework || item.type) === 'CS').length, 'CLIENT / SERVER'],
    ['已放行', list.filter((item) => item.releaseStatus === 1).length, 'RELEASED'],
  ] as const

  return (
    <div>
      <PageHeader
        index="02 / 01"
        en="SOFTWARE · APPLICATIONS"
        title="应用管理"
        description="登记与编排平台内的业务软件。控制应用放行状态、路由入口与席位可见性。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{list.length} APPLICATIONS</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">GATEWAY {platformHost}</span>
          </>
        }
        actions={
          <>
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
                setGovTab('auth')
                setGeneratedCode('')
                setGovOpen(true)
              }}
            >
              <ShieldCheck size={11} /> 授权与网关
            </Button>
            <Button
              size="sm"
              onClick={() => {
                minSetTouched.current = false
                setMinSetSelected([])
                setMinSetOpen(true)
              }}
            >
              运行最小集
            </Button>
            <div className="flex items-center border border-line">
              <button
                onClick={() => setViewMode('card')}
                className={cn('px-2 py-1.5', viewMode === 'card' ? 'bg-ink text-paper' : 'text-mute hover:text-ink')}
                title="卡片视图"
              >
                <LayoutGrid size={12} />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={cn('px-2 py-1.5', viewMode === 'table' ? 'bg-ink text-paper' : 'text-mute hover:text-ink')}
                title="列表视图"
              >
                <List size={12} />
              </button>
            </div>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" variant="signal" onClick={openCreate}>
              <Plus size={12} /> 新建应用
            </Button>
          </>
        }
      />

      <section className="panel mb-4 grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        {stats.map(([label, value, hint]) => (
          <div key={label} className="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[30px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </div>
        ))}
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="field h-9 w-[240px] pl-8 text-[12px]"
            placeholder="搜索名称 / 标识 / 描述"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <div className="flex border border-line-strong">
          {['ALL', 'BS', 'CS'].map((item) => (
            <button
              key={item}
              onClick={() => setType(item)}
              className={cn(
                'mono h-9 px-4 text-[9.5px] tracking-[0.14em] transition-colors',
                type === item ? 'bg-ink text-paper' : 'text-ink-3 hover:bg-paper-2',
              )}
            >
              {item === 'ALL' ? '全部' : item}
            </button>
          ))}
        </div>
        <span className="mono ml-auto text-[9px] tracking-widest text-mute">
          {filtered.length} / {list.length} 条记录
        </span>
      </div>

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
                  <th>#</th>
                  <th>应用 / APPLICATION</th>
                  <th>标识</th>
                  <th>架构</th>
                  <th>路由入口</th>
                  <th>关联席位</th>
                  <th>创建时间</th>
                  <th>状态</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, index) => (
                  <tr key={item.id}>
                    <td>
                      <span className="mono text-[9.5px] text-mute">{String(index + 1).padStart(2, '0')}</span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 flex-none items-center justify-center border border-line bg-paper-2">
                          {item.icon ? (
                            <img src={iconSrc(item.icon)} alt="" className="h-5 w-5 object-contain" />
                          ) : (
                            <span className="num text-[12px] text-mute">{item.name.slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                        <span className="text-[12px] font-medium text-ink">{item.name}</span>
                        {item.orderTop ? <Pin size={10} className="text-signal" /> : null}
                      </div>
                    </td>
                    <td>
                      <span className="mono text-[10px] text-ink-3">{item.key}</span>
                    </td>
                    <td>
                      <Badge tone={item.type === 'CS' ? 'warn' : 'info'}>{item.type || item.framework || 'BS'}</Badge>
                    </td>
                    <td>
                      <span className="mono max-w-[180px] truncate text-[9.5px] text-mute">{item.routerKey || '—'}</span>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(item.roleList ?? []).length === 0 && <span className="text-[10px] text-mute">—</span>}
                        {(item.roleList ?? []).map((role) => (
                          <Badge key={role.key || role.id} tone="info">
                            {role.name || role.key}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="mono text-[9.5px] text-mute">{formatDate(item.createdAt, false)}</span>
                    </td>
                    <td>
                      <Badge tone={item.releaseStatus === 1 ? 'ok' : 'default'}>
                        {item.releaseStatus === 1 ? 'RELEASED' : 'RESTRICTED'}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => openSeats(item)}>
                          席位
                        </Button>
                        <Button size="sm" onClick={() => openEdit(item)}>
                          编辑
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      <Modal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open)
          if (!open) {
            setEditing(null)
            setForm(emptyForm)
          }
        }}
        kicker={editing ? 'SOFTWARE / EDIT' : 'SOFTWARE / REGISTER'}
        title={editing ? `编辑「${editing.name}」` : '登记新应用'}
        description="应用登记后将出现在平台应用门户。路由标识用于网关转发，请与后端服务保持一致。"
        width={600}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="应用名称" required>
            <input
              className="field"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="如：态势标绘系统"
            />
          </Field>
          <Field label="唯一标识" required hint="小写字母、数字与短横线">
            <input
              className="field"
              value={form.key}
              onChange={(event) => setForm({ ...form, key: event.target.value })}
              placeholder="如：situation-map"
            />
          </Field>
          <Field label="架构类型" required>
            <select className="field" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value, framework: event.target.value })}>
              <option value="BS">BS · 浏览器应用</option>
              <option value="CS">CS · 桌面客户端</option>
            </select>
          </Field>
          <Field label="路由入口">
            <input
              className="field"
              value={form.routerKey}
              onChange={(event) => setForm({ ...form, routerKey: event.target.value })}
              placeholder="/app/your-app/"
            />
          </Field>
          <Field label="应用描述" className="sm:col-span-2">
            <textarea
              className="field"
              rows={3}
              value={form.desc}
              onChange={(event) => setForm({ ...form, desc: event.target.value })}
              placeholder="简述应用用途与使用范围"
            />
          </Field>
          <Field label="部署位置">
            <select className="field" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })}>
              <option value="local">本地 / LOCAL</option>
              <option value="remote">远程 / REMOTE</option>
            </select>
          </Field>
          <Field label="应用图标" hint="PNG / JPG，将转换为 Base64 存储">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center border border-line-strong bg-paper-2">
                {form.icon ? (
                  <img src={iconSrc(form.icon)} alt="" className="h-7 w-7 object-contain" />
                ) : (
                  <span className="num text-[16px] text-mute">{(form.name || form.key || 'A').slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <label className="mono cursor-pointer border border-line px-2.5 py-1.5 text-[9px] tracking-widest text-ink-3 hover:border-ink hover:text-ink">
                选择图片
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
                  className="mono text-[9px] tracking-widest text-mute hover:text-signal"
                >
                  移除
                </button>
              )}
            </div>
          </Field>
          {editing && (
            <Field label="应用截图" className="sm:col-span-2" hint="最多展示 5 张，用于应用门户预览">
              <div className="flex flex-wrap items-center gap-2">
                {shots.map((shot, index) => (
                  <div key={index} className="group relative h-16 w-24 border border-line bg-paper-2">
                    <img src={iconSrc(shot)} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() => setShots((prev) => prev.filter((_, i) => i !== index))}
                      className="absolute right-0 top-0 bg-ink/80 px-1 text-[9px] text-paper opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <label className="mono flex h-16 w-24 cursor-pointer flex-col items-center justify-center gap-1 border border-dashed border-line-strong text-[8.5px] tracking-widest text-mute hover:border-ink hover:text-ink">
                  <Plus size={12} />
                  添加截图
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
            </Field>
          )}
          <div className="flex items-end">
            <div className="w-full border border-line bg-paper-2/40 px-3 py-2">
              <div className="label">提示</div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
                创建后需在席位中心关联，用户才能在应用门户看到该软件。
              </p>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!seatTarget}
        onOpenChange={(open) => !open && setSeatTarget(null)}
        kicker="SOFTWARE / SEATS"
        title={seatTarget ? `${seatTarget.name} · 关联席位` : '关联席位'}
        description="勾选后，该席位下的用户可在应用门户看到此应用。管理员席位默认可见全部应用。"
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setSeatTarget(null)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={seatMutation.isPending} onClick={() => seatMutation.mutate()}>
              保存关联
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {(rolesQuery.data?.list ?? [])
            .filter((role) => role.key !== 'user')
            .map((role) => {
              const checked = role.key ? seatKeys.includes(role.key) : false
              return (
                <label
                  key={role.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 border px-3 py-2.5 transition-colors',
                    checked ? 'border-signal bg-signal/[0.04]' : 'border-line hover:border-line-strong',
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-[var(--color-signal)]"
                    checked={checked}
                    onChange={() => role.key && toggleSeat(role.key)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-ink">{role.name}</div>
                    <div className="mono mt-0.5 text-[8.5px] tracking-widest text-mute">KEY / {role.key}</div>
                  </div>
                  {role.type === 2 && <Badge tone="info">ADMIN</Badge>}
                </label>
              )
            })}
          {rolesQuery.isLoading && <div className="py-6 text-center text-[11px] text-mute">正在读取席位…</div>}
          {!rolesQuery.isLoading && (rolesQuery.data?.list ?? []).length === 0 && (
            <div className="py-6 text-center text-[11px] text-mute">暂无可关联的席位</div>
          )}
        </div>
      </Modal>

      <Modal
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
      </Modal>

      <Modal
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
      </Modal>

      <Modal
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
            className={cn('px-4 py-1.5 text-[11px]', govTab === 'auth' ? 'bg-ink text-paper' : 'text-mute hover:text-ink')}
            onClick={() => setGovTab('auth')}
          >
            <KeyRound size={11} className="mr-1.5 inline" /> 应用授权
          </button>
          <button
            className={cn('px-4 py-1.5 text-[11px]', govTab === 'gateway' ? 'bg-ink text-paper' : 'text-mute hover:text-ink')}
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
      </Modal>
    </div>
  )
}
