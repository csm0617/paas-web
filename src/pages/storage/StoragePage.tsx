import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FolderPlus, HardDrive, Layers, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { formatBytes, formatDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import type { VolumeItem } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  TabStrip,
  useConfirm,
} from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

interface FileProject {
  id: string
  name: string
  createdAt: number
  updatedAt?: number
  deleted?: boolean
}

interface FileItem {
  fileId?: string
  id?: string
  name?: string
  fileName?: string
  size?: number
  folder?: boolean
  isFolder?: boolean
  updateTime?: string
  modifiedTime?: string
  createdAt?: number
}

const FILE_BASE = 'http://172.16.209.170:19527'

interface PvItem {
  metadata?: { name?: string; creationTimestamp?: string; labels?: Record<string, string> }
  spec?: {
    capacity?: { storage?: string }
    accessModes?: string[]
    persistentVolumeReclaimPolicy?: string
    storageClassName?: string
    volumeMode?: string
    hostPath?: { path?: string }
    local?: { path?: string }
    nfs?: { server?: string; path?: string }
    csi?: { driver?: string; volumeHandle?: string }
    claimRef?: { name?: string; namespace?: string }
  }
  status?: { phase?: string; claimRef?: { name?: string; namespace?: string } }
}

interface PvcItem {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: string }
  spec?: {
    accessModes?: string[]
    storageClassName?: string
    volumeName?: string
    resources?: { requests?: { storage?: string } }
    volumeMode?: string
  }
  status?: { phase?: string; capacity?: { storage?: string } }
}

type Tab = 'volumes' | 'persistent' | 'claims' | 'files'

function tabOf(pathname: string): Tab {
  if (pathname.includes('persistent-volume-claim')) return 'claims'
  if (pathname.includes('persistent-volume')) return 'persistent'
  if (pathname.includes('file-project')) return 'files'
  return 'volumes'
}

function phaseTone(phase?: string) {
  if (phase === 'Bound') return 'ok' as const
  if (phase === 'Available' || phase === 'Pending') return 'info' as const
  if (phase === 'Released') return 'warn' as const
  if (phase === 'Failed' || phase === 'Lost') return 'bad' as const
  return 'default' as const
}

function pvSource(item: PvItem) {
  const spec = item.spec
  if (spec?.local?.path) return `local · ${spec.local.path}`
  if (spec?.hostPath?.path) return `hostPath · ${spec.hostPath.path}`
  if (spec?.nfs) return `nfs · ${spec.nfs.server || '—'}:${spec.nfs.path || ''}`
  if (spec?.csi?.driver) return `csi · ${spec.csi.driver}`
  return '—'
}

function pvClaim(item: PvItem) {
  return item.spec?.claimRef ?? item.status?.claimRef
}

export default function StoragePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const tab = tabOf(location.pathname)
  const [projectOpen, setProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [fileProject, setFileProject] = useState<FileProject | null>(null)
  const [fileKeyword, setFileKeyword] = useState('')
  const [filePage, setFilePage] = useState(1)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const volumesQuery = useQuery({
    queryKey: ['volumes'],
    queryFn: () => api.get<VolumeItem[]>('/cloud/volumes'),
    enabled: tab === 'volumes',
    refetchInterval: 60_000,
  })
  const projectsQuery = useQuery({
    queryKey: ['file-projects'],
    queryFn: () => api.get<{ list: FileProject[]; total: number }>('/v1/pub/file_project', { page: 1, size: 100 }),
    enabled: tab === 'files',
  })
  const fileListQuery = useQuery({
    queryKey: ['file-items', fileProject?.id, fileKeyword, filePage],
    queryFn: async () => {
      const params = new URLSearchParams({
        projectId: fileProject?.id || '',
        page: String(filePage),
        size: '50',
        keyword: fileKeyword.trim(),
      })
      const response = await fetch(`${FILE_BASE}/v1/pub/file/list?${params.toString()}`)
      const payload = await response.json()
      return (payload?.data ?? { fileItems: [], total: 0 }) as { fileItems: FileItem[]; total: number }
    },
    enabled: !!fileProject,
  })
  const fileStorageQuery = useQuery({
    queryKey: ['file-storage'],
    queryFn: async () => {
      const response = await fetch(`${FILE_BASE}/v1/pub/file/storage`)
      const payload = await response.json()
      return payload?.data as { free?: number; total?: number } | null
    },
    enabled: !!fileProject,
  })

  async function uploadFiles(files: FileList) {
    if (!fileProject) return
    const list = Array.from(files)
    setUploading(true)
    try {
      for (const file of list) {
        const formData = new FormData()
        formData.append('file', file)
        const response = await fetch(`${FILE_BASE}/v1/pub/file/upload/${fileProject.id}`, {
          method: 'POST',
          body: formData,
        })
        if (!response.ok) throw new Error(`上传失败 (${response.status})`)
      }
      toast.success('文件上传完成', `已上传 ${list.length} 个文件`)
      fileListQuery.refetch()
    } catch (error) {
      toast.error('上传失败', errorMessage(error))
    } finally {
      setUploading(false)
    }
  }

  async function deleteFile(item: FileItem) {
    const id = item.fileId || item.id
    if (!id) return
    const ok = await confirm({
      title: `删除「${item.name || item.fileName || id}」？`,
      description: '文件删除后不可恢复，引用该文件的业务可能受到影响。',
      danger: true,
      confirmText: '删除文件',
    })
    if (!ok) return
    try {
      const response = await fetch(`${FILE_BASE}/v1/pub/file/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`删除失败 (${response.status})`)
      toast.success('文件已删除')
      fileListQuery.refetch()
    } catch (error) {
      toast.error('删除失败', errorMessage(error))
    }
  }

  async function downloadFile(item: FileItem) {
    const id = item.fileId || item.id
    if (!id) return
    const token = useAuthStore.getState().token
    const url = `${FILE_BASE}/v1/pub/file/download/${encodeURIComponent(id)}${
      token ? `?token=${encodeURIComponent(token)}` : ''
    }`
    const link = document.createElement('a')
    link.href = url
    link.download = item.name || item.fileName || id
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  async function deleteSelectedFiles() {
    if (!fileProject || selectedFiles.length === 0) return
    const ok = await confirm({
      title: `删除 ${selectedFiles.length} 个文件？`,
      description: '文件删除后不可恢复，引用这些文件的业务可能受到影响。',
      danger: true,
      confirmText: '批量删除',
    })
    if (!ok) return
    try {
      const response = await fetch(`${FILE_BASE}/v1/pub/file/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedFiles),
      })
      if (!response.ok) throw new Error(`删除失败 (${response.status})`)
      toast.success('文件已删除')
      setSelectedFiles([])
      fileListQuery.refetch()
    } catch (error) {
      toast.error('删除失败', errorMessage(error))
    }
  }

  const pvQuery = useQuery({
    queryKey: ['persistent-volumes'],
    queryFn: () => api.get<{ items: PvItem[] }>('/k8s/api/v1/persistentvolumes', { pretty: 'true' }),
    enabled: tab === 'persistent',
    refetchInterval: 60_000,
  })
  const pvcQuery = useQuery({
    queryKey: ['persistent-volume-claims'],
    queryFn: () =>
      api.get<{ items: PvcItem[] }>('/k8s/api/v1/namespaces/gaop-namespace/persistentvolumeclaims', {
        pretty: 'true',
      }),
    enabled: tab === 'claims',
    refetchInterval: 60_000,
  })

  const volumes = volumesQuery.data ?? []
  const projects = projectsQuery.data?.list ?? []
  const pvs = pvQuery.data?.items ?? []
  const pvcs = pvcQuery.data?.items ?? []

  const createProject = useMutation({
    mutationFn: () => api.post('/v1/pub/file_project', { name: projectName.trim() }),
    onSuccess: () => {
      toast.success('文件项目已创建')
      setProjectOpen(false)
      setProjectName('')
      queryClient.invalidateQueries({ queryKey: ['file-projects'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  const deleteProject = useMutation({
    mutationFn: (project: FileProject) => api.del(`/v1/pub/file_project/${project.id}`),
    onSuccess: () => {
      toast.success('文件项目已删除')
      queryClient.invalidateQueries({ queryKey: ['file-projects'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  async function removeProject(project: FileProject) {
    const ok = await confirm({
      title: `删除文件项目「${project.name}」？`,
      description: '项目下的文件将无法再通过平台访问，请先确认已备份重要数据。',
      danger: true,
      confirmText: '删除项目',
    })
    if (ok) deleteProject.mutate(project)
  }

  const meta = {
    volumes: {
      index: '06 / 01',
      en: 'STORAGE · LOCAL VOLUMES',
      title: '本地存储',
      description: '查看集群内已挂载的存储卷及其宿主路径。hostPath 卷直接写入节点磁盘，请关注容量与权限。',
      count: `${volumes.length} VOLUMES`,
    },
    persistent: {
      index: '06 / 02',
      en: 'STORAGE · PERSISTENT VOLUMES',
      title: '持久卷',
      description: '集群级持久卷（PV）清单。PV 由存储类动态供给或管理员静态创建，生命周期独立于工作负载。',
      count: `${pvs.length} PERSISTENT VOLUMES`,
    },
    claims: {
      index: '06 / 03',
      en: 'STORAGE · PERSISTENT VOLUME CLAIMS',
      title: '持久卷申领',
      description: '命名空间 gaop-namespace 内的持久卷申领（PVC）。申领绑定后由工作负载作为数据卷挂载。',
      count: `${pvcs.length} CLAIMS`,
    },
    files: {
      index: '06 / 04',
      en: 'STORAGE · FILE PROJECTS',
      title: '文件资源',
      description: '按业务软件划分文件存储空间，用于上传模型、影像、附件与构建产物。',
      count: `${projects.length} PROJECTS`,
    },
  }[tab]

  const volumeColumns: Array<Column<VolumeItem>> = [
    {
      key: 'name',
      header: '存储卷 / VOLUME',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <HardDrive size={13} className="text-mute" />
          <div>
            <div className="font-mono text-[11px] text-ink">{row.name}</div>
            <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.createTime?.slice(0, 10) || '—'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: '类型',
      cell: (row) => <Badge tone="info">{row.storageType || 'hostPath'}</Badge>,
    },
    {
      key: 'path',
      header: '宿主路径',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.hostPath || '—'}</span>,
    },
    {
      key: 'mount',
      header: '挂载点',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.mountPath || '—'}</span>,
    },
    {
      key: 'service',
      header: '使用服务',
      cell: (row) => <span className="mono text-[10.5px] text-ink">{row.serviceName || '—'}</span>,
    },
    {
      key: 'ip',
      header: '节点',
      cell: (row) => <span className="mono text-[9.5px] text-mute">{row.storageIP?.join(', ') || '—'}</span>,
    },
  ]

  const pvColumns: Array<Column<PvItem>> = [
    {
      key: 'name',
      header: '卷名称 / VOLUME',
      cell: (row) => (
        <div>
          <div className="font-mono text-[10.5px] text-ink">{row.metadata?.name || '—'}</div>
          <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.spec?.storageClassName || 'NO CLASS'}</div>
        </div>
      ),
    },
    {
      key: 'claim',
      header: '申领卷',
      cell: (row) => {
        const claim = pvClaim(row)
        return claim?.name ? (
          <span className="mono text-[10px] text-ink-3">
            {claim.namespace ? `${claim.namespace}/` : ''}
            {claim.name}
          </span>
        ) : (
          <span className="text-[10.5px] text-mute">未绑定</span>
        )
      },
    },
    {
      key: 'source',
      header: '存储路径 / 驱动',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{pvSource(row)}</span>,
    },
    {
      key: 'capacity',
      header: '容量',
      cell: (row) => <span className="num text-[13px] text-ink">{row.spec?.capacity?.storage || '—'}</span>,
    },
    {
      key: 'access',
      header: '访问模式',
      cell: (row) => <span className="mono text-[9.5px] text-mute">{(row.spec?.accessModes ?? []).join(' / ') || '—'}</span>,
    },
    {
      key: 'phase',
      header: '状态',
      cell: (row) => <Badge tone={phaseTone(row.status?.phase)}>{row.status?.phase || 'UNKNOWN'}</Badge>,
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
  ]

  const pvcColumns: Array<Column<PvcItem>> = [
    {
      key: 'name',
      header: '申领名称 / CLAIM',
      cell: (row) => (
        <div>
          <div className="font-mono text-[10.5px] text-ink">{row.metadata?.name || '—'}</div>
          <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.metadata?.namespace || '—'}</div>
        </div>
      ),
    },
    {
      key: 'phase',
      header: '状态',
      cell: (row) => <Badge tone={phaseTone(row.status?.phase)}>{row.status?.phase || 'UNKNOWN'}</Badge>,
    },
    {
      key: 'capacity',
      header: '容量',
      cell: (row) => (
        <span className="num text-[13px] text-ink">
          {row.status?.capacity?.storage || row.spec?.resources?.requests?.storage || '—'}
        </span>
      ),
    },
    {
      key: 'access',
      header: '访问模式',
      cell: (row) => <span className="mono text-[9.5px] text-mute">{(row.spec?.accessModes ?? []).join(' / ') || '—'}</span>,
    },
    {
      key: 'class',
      header: '存储类',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.spec?.storageClassName || '—'}</span>,
    },
    {
      key: 'volume',
      header: '绑定卷',
      cell: (row) => <span className="mono text-[9.5px] text-mute">{row.spec?.volumeName || '—'}</span>,
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
  ]

  const refreshing =
    tab === 'volumes'
      ? volumesQuery.isFetching
      : tab === 'persistent'
        ? pvQuery.isFetching
        : tab === 'claims'
          ? pvcQuery.isFetching
          : projectsQuery.isFetching

  function refresh() {
    if (tab === 'volumes') volumesQuery.refetch()
    else if (tab === 'persistent') pvQuery.refetch()
    else if (tab === 'claims') pvcQuery.refetch()
    else projectsQuery.refetch()
  }

  return (
    <div>
      <PageHeader
        index={meta.index}
        en={meta.en}
        title={meta.title}
        description={meta.description}
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{meta.count}</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">OPENERS / CSI / NFS</span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={refreshing} onClick={refresh}>
              <RefreshCw size={11} /> 刷新
            </Button>
            {tab === 'files' && (
              <Button size="sm" variant="signal" onClick={() => setProjectOpen(true)}>
                <FolderPlus size={11} /> 新建文件项目
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <TabStrip
          value={tab}
          onChange={(value) =>
            navigate(
              value === 'volumes'
                ? '/storage/localstorage'
                : value === 'persistent'
                  ? '/storage/persistent-volume'
                  : value === 'claims'
                    ? '/storage/persistent-volume-claim'
                    : '/storage/file-project',
            )
          }
          tabs={[
            { value: 'volumes', label: '本地存储', count: volumes.length },
            { value: 'persistent', label: '持久卷', count: pvs.length },
            { value: 'claims', label: '持久卷申领', count: pvcs.length },
            { value: 'files', label: '文件资源', count: projects.length },
          ]}
        />
      </div>

      {tab === 'volumes' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-9" kicker="VOLUME INVENTORY" title="卷清单" bodyClassName="p-0">
            <DataTable
              columns={volumeColumns}
              rows={volumes}
              rowKey={(row) => `${row.name}-${row.mountPath}`}
              loading={volumesQuery.isLoading}
              pageSize={12}
              emptyTitle="暂无存储卷"
              emptyDescription="集群内尚未检测到已挂载的存储卷。"
            />
          </Panel>
          <div className="flex flex-col gap-4 xl:col-span-3">
            <Panel kicker="SUMMARY" title="存储概览">
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="label">存储卷</span>
                  <span className="num text-[22px] text-ink">{volumes.length}</span>
                </div>
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="label">hostPath</span>
                  <span className="num text-[22px] text-ink">{volumes.filter((v) => v.storageType === 'hostPath').length}</span>
                </div>
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="label">关联服务</span>
                  <span className="num text-[22px] text-ink">{new Set(volumes.map((v) => v.serviceName).filter(Boolean)).size}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="label">挂载点</span>
                  <span className="num text-[22px] text-ink">{new Set(volumes.map((v) => v.mountPath)).size}</span>
                </div>
              </div>
            </Panel>
            <Panel kicker="NOTICE" title="容量提示">
              <p className="text-[10.5px] leading-relaxed text-ink-3">
                存储卷容量由节点磁盘决定。写入前请确认宿主目录剩余空间，避免影响系统服务。
              </p>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'persistent' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-9" kicker="PERSISTENT VOLUMES" title="集群持久卷" bodyClassName="p-0">
            <DataTable
              columns={pvColumns}
              rows={pvs}
              rowKey={(row) => row.metadata?.name || ''}
              loading={pvQuery.isLoading}
              pageSize={12}
              emptyTitle="暂无持久卷"
              emptyDescription="集群内尚未创建任何持久卷，或存储驱动未就绪。"
            />
          </Panel>
          <div className="flex flex-col gap-4 xl:col-span-3">
            <Panel kicker="SUMMARY" title="持久卷概览">
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="label">持久卷</span>
                  <span className="num text-[22px] text-ink">{pvs.length}</span>
                </div>
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="label">已绑定</span>
                  <span className="num text-[22px] text-ink">{pvs.filter((p) => p.status?.phase === 'Bound').length}</span>
                </div>
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="label">可用</span>
                  <span className="num text-[22px] text-ink">{pvs.filter((p) => p.status?.phase === 'Available').length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="label">存储类</span>
                  <span className="num text-[22px] text-ink">{new Set(pvs.map((p) => p.spec?.storageClassName).filter(Boolean)).size}</span>
                </div>
              </div>
            </Panel>
            <Panel kicker="NOTICE" title="生命周期">
              <p className="text-[10.5px] leading-relaxed text-ink-3">
                回收策略 Delete 的持久卷在申领删除后会被自动清理；Retain 则保留数据，需人工回收。
              </p>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'claims' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-9" kicker="PERSISTENT VOLUME CLAIMS" title="持久卷申领" bodyClassName="p-0">
            <DataTable
              columns={pvcColumns}
              rows={pvcs}
              rowKey={(row) => `${row.metadata?.namespace}-${row.metadata?.name}`}
              loading={pvcQuery.isLoading}
              pageSize={12}
              emptyTitle="暂无持久卷申领"
              emptyDescription="命名空间 gaop-namespace 内暂未创建持久卷申领。"
            />
          </Panel>
          <div className="flex flex-col gap-4 xl:col-span-3">
            <Panel kicker="SUMMARY" title="申领概览">
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="label">申领总数</span>
                  <span className="num text-[22px] text-ink">{pvcs.length}</span>
                </div>
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <span className="label">已绑定</span>
                  <span className="num text-[22px] text-ink">{pvcs.filter((p) => p.status?.phase === 'Bound').length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="label">命名空间</span>
                  <span className="mono text-[10px] text-ink">gaop-namespace</span>
                </div>
              </div>
            </Panel>
            <Panel kicker="NOTICE" title="容量扩展">
              <p className="text-[10.5px] leading-relaxed text-ink-3">
                仅当存储类允许卷扩展时可在线扩容；缩容不被 Kubernetes 支持。
              </p>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'files' && (
        <div>
          <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ['文件项目', projects.length, 'PROJECTS'],
              ['最近创建', projects[0]?.name || '—', 'LATEST'],
              ['存储类型', '本地 / FDFS', 'BACKEND'],
              ['访问方式', 'HTTP / API', 'PROTOCOL'],
            ].map(([label, value, hint]) => (
              <Panel key={label} bodyClassName="px-4 py-3.5">
                <div className="label">{label === '最近创建' ? '最近创建的' : label}</div>
                <div className="mt-1.5 truncate text-[18px] font-medium text-ink">
                  {label === '文件项目' ? <span className="num text-[28px]">{value}</span> : value}
                </div>
                <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
              </Panel>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Panel key={project.id} corner className="p-0">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex h-10 w-10 items-center justify-center border border-line-strong bg-paper-2">
                    <Layers size={16} className="text-ink-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">{project.name}</div>
                    <div className="mono mt-1 text-[8.5px] tracking-wider text-mute">CREATED {formatDate(project.createdAt, false)}</div>
                  </div>
                  <Badge tone={project.deleted ? 'bad' : 'ok'}>{project.deleted ? 'DELETED' : 'ACTIVE'}</Badge>
                </div>
                <div className="flex items-center justify-between border-t border-line px-4 py-2">
                  <div className="mono flex items-center gap-2 text-[8.5px] tracking-widest text-mute">
                    <span>PROJECT ID</span>
                    <span>{project.id.slice(0, 8).toUpperCase()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setFileKeyword('')
                        setFilePage(1)
                        setSelectedFiles([])
                        setFileProject(project)
                      }}
                      className="mono text-[8.5px] tracking-widest text-ink-3 hover:text-signal"
                    >
                      浏览文件
                    </button>
                    <button
                      onClick={() => removeProject(project)}
                      className="text-mute transition-colors hover:text-signal"
                      title="删除项目"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </Panel>
            ))}
            {projects.length === 0 && !projectsQuery.isLoading && (
              <div className="sm:col-span-2 xl:col-span-3">
                <Panel>
                  <EmptyState
                    title="暂无文件项目"
                    description="按业务软件创建文件空间后，可上传模型、影像与附件。"
                    action={
                      <Button size="sm" variant="signal" onClick={() => setProjectOpen(true)}>
                        <FolderPlus size={11} /> 新建文件项目
                      </Button>
                    }
                  />
                </Panel>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={!!fileProject}
        onOpenChange={(open) => !open && setFileProject(null)}
        kicker="STORAGE / FILES"
        title={fileProject ? `${fileProject.name} · 文件` : '文件'}
        description="浏览该文件项目的目录与文件，支持上传与删除。文件服务独立于 Kubernetes 存储卷。"
        width={760}
        footer={
          <Button size="sm" onClick={() => setFileProject(null)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="field h-8 flex-1 font-mono text-[11px]"
              placeholder="搜索文件或文件夹"
              value={fileKeyword}
              onChange={(event) => {
                setFileKeyword(event.target.value)
                setFilePage(1)
                setSelectedFiles([])
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) uploadFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <Button size="sm" variant="signal" loading={uploading} onClick={() => fileInputRef.current?.click()}>
              <Upload size={11} /> 上传文件
            </Button>
            {selectedFiles.length > 0 && (
              <Button size="sm" variant="danger" onClick={deleteSelectedFiles}>
                <Trash2 size={11} /> 删除所选 {selectedFiles.length}
              </Button>
            )}
          </div>
          {fileStorageQuery.data && (
            <div className="mono flex items-center justify-between border border-line bg-paper-2/40 px-3 py-1.5 text-[8.5px] tracking-wider text-mute">
              <span>STORAGE</span>
              <span>
                FREE {formatBytes(fileStorageQuery.data.free ?? 0)} / TOTAL {formatBytes(fileStorageQuery.data.total ?? 0)}
              </span>
            </div>
          )}
          <div className="max-h-[420px] overflow-y-auto border border-line">
            {(fileListQuery.data?.fileItems ?? []).map((item) => {
              const name = item.name || item.fileName || '—'
              const isFolder = item.folder || item.isFolder
              const id = item.fileId || item.id || name
              const checked = selectedFiles.includes(id)
              return (
                <div
                  key={id}
                  className={cn(
                    'grid grid-cols-[24px_1fr_120px_150px_92px] items-center gap-2 border-b border-line/60 px-3 py-2 last:border-b-0',
                    checked && 'bg-signal/[0.04]',
                  )}
                >
                  {!isFolder ? (
                    <input
                      type="checkbox"
                      className="check"
                      checked={checked}
                      onChange={() =>
                        setSelectedFiles((prev) =>
                          prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id],
                        )
                      }
                      aria-label={`选择 ${name}`}
                    />
                  ) : (
                    <span />
                  )}
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('h-1.5 w-1.5 flex-none', isFolder ? 'bg-signal' : 'bg-ink-3')} />
                    <span className="truncate font-mono text-[10.5px] text-ink">{name}</span>
                  </div>
                  <span className="mono text-[9.5px] text-mute">{isFolder ? 'FOLDER' : formatBytes(item.size ?? 0)}</span>
                  <span className="mono text-[9px] text-mute">
                    {item.updateTime || item.modifiedTime || (item.createdAt ? formatDate(item.createdAt) : '—')}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    {!isFolder && (
                      <button
                        onClick={() => downloadFile(item)}
                        className="flex h-7 w-7 items-center justify-center border border-line-strong text-ink-3 hover:border-ink hover:text-ink"
                        title="下载"
                      >
                        <Download size={10} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteFile(item)}
                      className="flex h-7 w-7 items-center justify-center border border-line-strong text-ink-3 hover:border-signal hover:text-signal"
                      title="删除"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              )
            })}
            {(fileListQuery.data?.fileItems ?? []).length === 0 && (
              <div className="px-3 py-10 text-center text-[11px] text-mute">
                {fileListQuery.isLoading ? '正在读取文件…' : '当前目录为空'}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border border-t-0 border-line px-3 py-1.5">
            <span className="mono text-[8.5px] tracking-wider text-mute">
              PAGE {filePage} / {Math.max(1, Math.ceil((fileListQuery.data?.total ?? 0) / 50))} ·{' '}
              {fileListQuery.data?.total ?? 0} FILES
            </span>
            <div className="flex gap-1">
              <Button
                size="sm"
                disabled={filePage <= 1}
                onClick={() => {
                  setFilePage((page) => Math.max(1, page - 1))
                  setSelectedFiles([])
                }}
              >
                上一页
              </Button>
              <Button
                size="sm"
                disabled={filePage >= Math.max(1, Math.ceil((fileListQuery.data?.total ?? 0) / 50))}
                onClick={() => {
                  setFilePage((page) => page + 1)
                  setSelectedFiles([])
                }}
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={projectOpen}
        onOpenChange={setProjectOpen}
        kicker="STORAGE / PROJECT"
        title="新建文件项目"
        description="每个项目对应一个独立的文件命名空间。名称创建后不可修改。"
        width={430}
        footer={
          <>
            <Button size="sm" onClick={() => setProjectOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!projectName.trim()}
              loading={createProject.isPending}
              onClick={() => createProject.mutate()}
            >
              创建项目
            </Button>
          </>
        }
      >
        <Field label="项目名称" required hint="建议与业务软件标识保持一致">
          <input className="field" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="如：situation-map" autoFocus />
        </Field>
      </Modal>
    </div>
  )
}
