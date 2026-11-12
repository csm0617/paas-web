import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FileCode2, FolderPlus, Hammer, RefreshCw, Tag, Trash2, Upload } from 'lucide-react'
import { useMemo, useState, useEffect, useRef } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate, relativeTime } from '@/lib/format'
import type { ImageLogItem, ImageProject } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import {
  ActionMenu,
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

interface RepoItem {
  id: number
  name: string
  tags_count?: number
  lastVersion?: string
  update_time?: string
  relateSoftwareList?: Array<{ serviceName?: string; serviceKey?: string }>
}

const registryHost = '172.16.209.25:1080'

export default function MirrorPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const location = useLocation()
  const params = useParams()
  const [tab, setTab] = useState<'repos' | 'builds'>(
    location.pathname.includes('/build') || location.pathname.includes('/record') ? 'builds' : 'repos',
  )

  useEffect(() => {
    if (location.pathname.includes('/build') || location.pathname.includes('/record')) setTab('builds')
  }, [location.pathname])
  const [projectFilter, setProjectFilter] = useState(() => params.name || 'ALL')

  useEffect(() => {
    if (params.name) setProjectFilter(params.name)
  }, [params.name])

  const [projectModal, setProjectModal] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [logItem, setLogItem] = useState<ImageLogItem | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [detailImage, setDetailImage] = useState<RepoItem | null>(null)
  const [detailTag, setDetailTag] = useState('')

  async function uploadImages(files: FileList) {
    const storage = projectFilter === 'ALL' ? 'gaop' : projectFilter
    const username = useAuthStore.getState().user?.username || 'admin'
    const token = useAuthStore.getState().token
    setUploading(true)
    let failed = 0
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      try {
        const response = await fetch(
          `${API_BASE}/v1/image/upload?storage=${encodeURIComponent(storage)}&username=${encodeURIComponent(username)}&type=1`,
          {
            method: 'POST',
            credentials: 'include',
            headers: token ? { token } : undefined,
            body: formData,
          },
        )
        const payload = await response.json().catch(() => null)
        if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
          failed += 1
        }
        setUploadProgress((value) => Math.min(100, value + Math.round(100 / files.length)))
      } catch {
        failed += 1
      }
    }
    setUploading(false)
    setUploadProgress(0)
    if (failed > 0) toast.error('部分镜像上传失败', `${failed} 个文件未导入`)
    else toast.success('镜像包上传完成', `已提交 ${files.length} 个文件，构建记录将随后更新`)
    queryClient.invalidateQueries({ queryKey: ['images'] })
    queryClient.invalidateQueries({ queryKey: ['image-builds'] })
  }

  const projectsQuery = useQuery({
    queryKey: ['image-projects'],
    queryFn: () => api.get<{ list: ImageProject[]; total: number }>('/v1/image/projectList', { page: 1, size: 100 }),
  })
  const imagesQuery = useQuery({
    queryKey: ['images'],
    queryFn: () => api.get<{ list: RepoItem[]; total: number }>('/v1/image/imageList', { page: 1, size: 200 }),
    refetchInterval: 60_000,
  })
  const buildsQuery = useQuery({
    queryKey: ['image-builds'],
    queryFn: () => api.get<{ list: ImageLogItem[]; total: number }>('/v1/image/imageLog', { page: 1, size: 200 }),
    refetchInterval: 60_000,
  })
  const detailTagsQuery = useQuery({
    queryKey: ['image-tags', detailImage?.name],
    queryFn: () =>
      api.get<Array<{ name: string; push_time?: string; pull_time?: string }>>('/v1/image/tags', {
        name: detailImage?.name,
      }),
    enabled: !!detailImage,
  })
  const detailEnvQuery = useQuery({
    queryKey: ['image-env', detailImage?.name, detailTag],
    queryFn: () =>
      api.get<Array<{ name: string; value: string }>>('/v1/image/image_env', {
        name: detailImage?.name,
        tag: detailTag,
      }),
    enabled: !!detailImage && !!detailTag,
  })
  const detailPortsQuery = useQuery({
    queryKey: ['image-ports', detailImage?.name, detailTag],
    queryFn: () =>
      api.get<{ list?: Array<{ port: number; protocol: string }> }>('/v1/image/expose', {
        name: detailImage?.name,
        tag: detailTag,
      }),
    enabled: !!detailImage && !!detailTag,
  })

  useEffect(() => {
    if (!detailImage) return
    const tags = detailTagsQuery.data ?? []
    if (detailTag && tags.some((tag) => tag.name === detailTag)) return
    if (tags.length > 0) setDetailTag(tags[0].name)
    else if (detailImage.lastVersion) setDetailTag(detailImage.lastVersion)
  }, [detailImage, detailTagsQuery.data, detailTag])

  const projects = projectsQuery.data?.list ?? []
  const images = imagesQuery.data?.list ?? []
  const builds = buildsQuery.data?.list ?? []

  const filteredImages = useMemo(() => {
    if (projectFilter === 'ALL') return images
    return images.filter((image) => image.name.startsWith(`${projectFilter}/`))
  }, [images, projectFilter])

  const createProject = useMutation({
    mutationFn: () => api.post('/v1/image/project', undefined, { name: projectName.trim() }),
    onSuccess: () => {
      toast.success('仓库组已创建')
      setProjectModal(false)
      setProjectName('')
      queryClient.invalidateQueries({ queryKey: ['image-projects'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  const deleteProject = useMutation({
    mutationFn: (projectId: number) => api.del('/v1/image/project', undefined, { projectId }),
    onSuccess: () => {
      toast.success('仓库组已删除')
      queryClient.invalidateQueries({ queryKey: ['image-projects'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const deleteImage = useMutation({
    mutationFn: (image: RepoItem) =>
      api.del('/v1/image', undefined, { name: image.name, tag: image.lastVersion || '' }),
    onSuccess: () => {
      toast.success('镜像标签已删除')
      queryClient.invalidateQueries({ queryKey: ['images'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  async function removeProject(project: ImageProject) {
    const ok = await confirm({
      title: `删除仓库组「${project.name}」？`,
      description: '删除前请确认组内镜像已迁移或不再使用。该操作不可恢复。',
      danger: true,
      confirmText: '删除仓库组',
    })
    if (ok) deleteProject.mutate(project.project_id)
  }

  async function removeImage(image: RepoItem) {
    const ok = await confirm({
      title: `删除镜像 ${image.name}:${image.lastVersion || 'latest'}？`,
      description: '将删除该镜像的当前标签，使用该镜像的服务将无法再次拉取。',
      danger: true,
      confirmText: '删除标签',
    })
    if (ok) deleteImage.mutate(image)
  }

  const buildColumns: Array<Column<ImageLogItem>> = [
    {
      key: 'name',
      header: '镜像 / IMAGE',
      cell: (row) => (
        <div>
          <div className="font-mono text-[11.5px] text-ink">{row.name}</div>
          <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.fileName}</div>
        </div>
      ),
    },
    {
      key: 'version',
      header: '版本',
      cell: (row) => <Badge>{row.version}</Badge>,
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => (
        <Badge tone={row.status === 1 ? 'ok' : row.status === 0 ? 'bad' : 'warn'}>
          {row.status === 1 ? 'SUCCESS' : row.status === 0 ? 'FAILED' : 'PROCESSING'}
        </Badge>
      ),
    },
    {
      key: 'user',
      header: '操作人',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.username || '—'}</span>,
    },
    {
      key: 'time',
      header: '完成时间',
      sortValue: (row) => row.updatedAt ?? 0,
      cell: (row) => <span className="mono text-[10px] text-ink-3">{relativeTime(row.updatedAt ?? row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <ActionMenu
          items={[
            { label: '查看构建日志', onSelect: () => setLogItem(row), icon: <FileCode2 size={12} /> },
            {
              label: '复制镜像地址',
              icon: <Copy size={12} />,
              onSelect: async () => {
                await navigator.clipboard.writeText(`${registryHost}/${row.name}:${row.version}`)
                toast.success('镜像地址已复制')
              },
            },
          ]}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="03 / 01"
        en="REGISTRY · IMAGE REPOSITORY"
        title="镜像仓库"
        description="统一管理 Harbor 镜像仓库组、镜像标签与构建记录。镜像由 CI/CD 流水线推送，可在服务编排中直接引用。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">REGISTRY ONLINE · {registryHost}</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">
              {projects.length} PROJECTS · {images.length} IMAGES
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={imagesQuery.isFetching} onClick={() => {
              imagesQuery.refetch()
              buildsQuery.refetch()
            }}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" variant="signal" onClick={() => setProjectModal(true)}>
              <FolderPlus size={11} /> 新建仓库组
            </Button>
            <input
              ref={uploadRef}
              type="file"
              accept=".tar.gz,.tar,.gz"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) uploadImages(event.target.files)
                event.target.value = ''
              }}
            />
            <Button size="sm" loading={uploading} onClick={() => uploadRef.current?.click()}>
              <Upload size={11} /> {uploading ? `上传中 ${uploadProgress}%` : '上传镜像包'}
            </Button>
          </>
        }
      />

      <section className="panel mb-4 grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        {[
          ['仓库组', projects.length, 'PROJECTS'],
          ['镜像总数', images.length, 'REPOSITORIES'],
          ['构建记录', builds.length, 'BUILD JOBS'],
          [
            '最近构建',
            builds[0] ? relativeTime(builds[0].updatedAt ?? builds[0].createdAt) : '—',
            builds[0]?.name?.toUpperCase() || 'NO BUILD',
          ],
        ].map(([label, value, hint]) => (
          <div key={label} className="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 truncate text-[28px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 truncate text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </div>
        ))}
      </section>

      <div className="mb-4">
        <TabStrip
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'repos', label: '镜像仓库', count: images.length },
            { value: 'builds', label: '构建记录', count: builds.length },
          ]}
        />
      </div>

      {tab === 'repos' ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
          <Panel kicker="PROJECTS" title="仓库组" bodyClassName="p-0">
            <button
              onClick={() => setProjectFilter('ALL')}
              className={`flex w-full items-center justify-between border-b border-line px-3.5 py-2.5 text-left transition-colors ${
                projectFilter === 'ALL' ? 'bg-ink text-paper' : 'hover:bg-paper-2'
              }`}
            >
              <span className="text-[11.5px]">全部镜像</span>
              <span className="mono text-[9px] opacity-70">{images.length}</span>
            </button>
            {projects.map((project) => (
              <div
                key={project.project_id}
                className={`flex items-center gap-1 border-b border-line/70 pr-2 transition-colors ${
                  projectFilter === project.name ? 'bg-ink text-paper' : 'hover:bg-paper-2'
                }`}
              >
                <button
                  onClick={() => setProjectFilter(project.name)}
                  className="flex flex-1 items-center justify-between px-3.5 py-2.5 text-left"
                >
                  <span className="truncate text-[11.5px]">{project.name}</span>
                  <span className="mono text-[9px] opacity-70">
                    {images.filter((image) => image.name.startsWith(`${project.name}/`)).length}
                  </span>
                </button>
                <button
                  onClick={() => removeProject(project)}
                  className="flex h-6 w-6 flex-none items-center justify-center text-mute transition-colors hover:text-signal"
                  aria-label="删除仓库组"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            <div className="px-3 py-2">
              <button
                onClick={() => setProjectModal(true)}
                className="mono flex w-full items-center justify-center gap-1 border border-dashed border-line-strong py-2 text-[9px] tracking-widest text-mute transition-colors hover:border-ink hover:text-ink"
              >
                <FolderPlus size={10} /> NEW PROJECT
              </button>
            </div>
          </Panel>

          <Panel kicker="IMAGES" title="镜像清单" bodyClassName="p-0">
            <div className="divide-y divide-line/70">
              {filteredImages.map((image) => (
                <div key={image.id} className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-white/40 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-8 w-8 flex-none items-center justify-center border border-line-strong bg-paper-2">
                      <Tag size={13} className="text-ink-3" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11.5px] text-ink">{image.name}</div>
                      <div className="mono mt-0.5 flex flex-wrap items-center gap-2 text-[8.5px] tracking-wider text-mute">
                        <span>UPDATED {formatDate(image.update_time)}</span>
                        {image.relateSoftwareList && image.relateSoftwareList.length > 0 && (
                          <span className="text-info">
                            USED BY {image.relateSoftwareList.map((item) => item.serviceName).filter(Boolean).join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {image.lastVersion && <Badge tone="info">{image.lastVersion}</Badge>}
                    <Badge>{image.tags_count ?? 0} TAGS</Badge>
                    <button
                      onClick={() => {
                        setDetailImage(image)
                        setDetailTag(image.lastVersion || '')
                      }}
                      className="flex h-6 w-6 items-center justify-center border border-line-strong text-ink-3 transition-colors hover:border-ink hover:bg-ink hover:text-paper"
                      title="镜像详情"
                    >
                      <FileCode2 size={10} />
                    </button>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(`${registryHost}/${image.name}:${image.lastVersion || 'latest'}`)
                        toast.success('镜像地址已复制')
                      }}
                      className="flex h-6 w-6 items-center justify-center border border-line-strong text-ink-3 transition-colors hover:border-ink hover:bg-ink hover:text-paper"
                      title="复制镜像地址"
                    >
                      <Copy size={10} />
                    </button>
                    <button
                      onClick={() => removeImage(image)}
                      className="flex h-6 w-6 items-center justify-center border border-line-strong text-ink-3 transition-colors hover:border-signal hover:bg-signal hover:text-paper"
                      title="删除镜像标签"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}
              {filteredImages.length === 0 && (
                <div className="px-4 py-12 text-center text-[11px] text-mute">该仓库组下暂无镜像</div>
              )}
            </div>
          </Panel>
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <DataTable
            columns={buildColumns}
            rows={builds}
            rowKey={(row) => String(row.id)}
            loading={buildsQuery.isLoading}
            pageSize={12}
            emptyTitle="暂无构建记录"
            emptyDescription="通过 CI/CD 流水线推送镜像后，构建记录会出现在这里。"
          />
        </Panel>
      )}

      <Modal
        open={projectModal}
        onOpenChange={setProjectModal}
        kicker="REGISTRY / PROJECT"
        title="新建镜像仓库组"
        description="仓库组用于隔离不同业务域的镜像。名称创建后不可修改。"
        width={430}
        footer={
          <>
            <Button size="sm" onClick={() => setProjectModal(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={createProject.isPending}
              disabled={!projectName.trim()}
              onClick={() => createProject.mutate()}
            >
              创建仓库组
            </Button>
          </>
        }
      >
        <Field label="仓库组名称" required hint="仅支持小写字母、数字和短横线，例如：situation-map">
          <input
            className="field"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="project-name"
            autoFocus
          />
        </Field>
      </Modal>

      <Modal
        open={!!logItem}
        onOpenChange={(open) => !open && setLogItem(null)}
        kicker="BUILD / LOG"
        title={logItem ? `${logItem.name}:${logItem.version}` : '构建日志'}
        description={logItem ? `${logItem.fileName} · ${logItem.username || 'system'}` : undefined}
        width={760}
        footer={
          <Button size="sm" onClick={() => setLogItem(null)}>
            关闭
          </Button>
        }
      >
        <div className="mb-3 flex items-center gap-2">
          <Hammer size={12} className="text-mute" />
          <Badge tone={logItem?.status === 1 ? 'ok' : 'bad'}>
            {logItem?.status === 1 ? 'BUILD SUCCESS' : 'BUILD FAILED'}
          </Badge>
          <span className="mono text-[9px] tracking-widest text-mute">
            {formatDate(logItem?.updatedAt ?? logItem?.createdAt)}
          </span>
        </div>
        <pre className="max-h-[52vh] overflow-auto border border-line bg-deck p-4 font-mono text-[10px] leading-relaxed text-[#b9c0c2]">
          {logItem?.log || '无日志输出'}
        </pre>
      </Modal>

      <Modal
        open={!!detailImage}
        onOpenChange={(open) => {
          if (!open) {
            setDetailImage(null)
            setDetailTag('')
          }
        }}
        kicker="REGISTRY / IMAGE DETAIL"
        title={detailImage?.name || '镜像详情'}
        description="查看镜像标签、环境变量与声明端口，并复制可直接使用的拉取地址。"
        width={760}
        footer={
          <Button size="sm" onClick={() => setDetailImage(null)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="border border-line px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="label">拉取地址</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(`${registryHost}/${detailImage?.name}:${detailTag || 'latest'}`)
                  toast.success('拉取地址已复制')
                }}
              >
                <Copy size={10} /> 复制
              </Button>
            </div>
            <div className="mono break-all text-[10px] text-ink-3">
              {registryHost}/{detailImage?.name}:{detailTag || 'latest'}
            </div>
          </div>

          <div>
            <div className="label mb-1.5">
              标签 / TAGS
              {detailTagsQuery.isLoading && <span className="ml-2 text-mute">加载中…</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(detailTagsQuery.data ?? []).map((tag) => (
                <button
                  key={tag.name}
                  onClick={() => setDetailTag(tag.name)}
                  className={`mono border px-2 py-1 text-[9px] tracking-wider transition-colors ${
                    detailTag === tag.name
                      ? 'border-ink bg-ink text-paper'
                      : 'border-line-strong text-ink-3 hover:border-ink hover:text-ink'
                  }`}
                >
                  {tag.name}
                </button>
              ))}
              {(detailTagsQuery.data ?? []).length === 0 && !detailTagsQuery.isLoading && (
                <span className="text-[10.5px] text-mute">暂无标签信息</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="border border-line">
              <div className="border-b border-line bg-paper-2/50 px-3 py-1.5">
                <span className="label">环境变量 / ENV</span>
              </div>
              <div className="max-h-[180px] overflow-y-auto">
                {(detailEnvQuery.data ?? []).map((env) => (
                  <div key={env.name} className="grid grid-cols-[1fr_1fr] gap-2 border-b border-line/50 px-3 py-1.5 last:border-b-0">
                    <span className="mono truncate text-[9.5px] text-ink">{env.name}</span>
                    <span className="mono truncate text-[9.5px] text-mute">{env.value || '—'}</span>
                  </div>
                ))}
                {(detailEnvQuery.data ?? []).length === 0 && (
                  <div className="px-3 py-6 text-center text-[10.5px] text-mute">
                    {detailEnvQuery.isLoading ? '正在读取…' : '未声明环境变量'}
                  </div>
                )}
              </div>
            </div>

            <div className="border border-line">
              <div className="border-b border-line bg-paper-2/50 px-3 py-1.5">
                <span className="label">声明端口 / EXPOSE</span>
              </div>
              <div className="max-h-[180px] overflow-y-auto">
                {(detailPortsQuery.data?.list ?? []).map((port) => (
                  <div key={`${port.port}-${port.protocol}`} className="flex items-center justify-between border-b border-line/50 px-3 py-1.5 last:border-b-0">
                    <span className="mono text-[10px] text-ink">{port.port}</span>
                    <Badge>{port.protocol || 'TCP'}</Badge>
                  </div>
                ))}
                {(detailPortsQuery.data?.list ?? []).length === 0 && (
                  <div className="px-3 py-6 text-center text-[10.5px] text-mute">
                    {detailPortsQuery.isLoading ? '正在读取…' : '未声明端口'}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="border border-line px-3 py-2">
            <div className="label mb-1">关联服务</div>
            <div className="flex flex-wrap gap-1.5">
              {(detailImage?.relateSoftwareList ?? []).map((item, index) => (
                <Badge key={`${item.serviceName}-${index}`} tone="info">
                  {item.serviceName || item.serviceKey || '—'}
                </Badge>
              ))}
              {(detailImage?.relateSoftwareList ?? []).length === 0 && (
                <span className="text-[10.5px] text-mute">暂无服务引用该镜像</span>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
