import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FilePlus2, Files, FolderPlus, Link2, RefreshCw, Save, Search, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  useConfirm,
} from '@/components/ui'
import { toast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import { cn } from '@/lib/utils'

interface ConfigMapItem {
  metadata?: {
    name?: string
    namespace?: string
    creationTimestamp?: string
  }
  data?: Record<string, string> | null
}

interface ConfigMapList {
  total: number
  items: ConfigMapItem[]
}

interface GroupRow {
  name: string
  namespace: string
  createdAt?: string
  data: Record<string, string>
}

interface RelationService {
  serviceName?: string
  mountPath?: string
}

interface RelationEntry {
  configMapName?: string
  config?: RelationService[]
}

export default function ConfigGroupPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const importRef = useRef<HTMLInputElement | null>(null)
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [groupOpen, setGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [active, setActive] = useState<GroupRow | null>(null)
  const [fileOpen, setFileOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [fileValue, setFileValue] = useState('')
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null)
  const [relationFile, setRelationFile] = useState<string | null>(null)

  const relationQuery = useQuery({
    queryKey: ['config-map-relations', active?.name],
    queryFn: () => api.get<RelationEntry[]>('/v1/config_map/relationService', { name: active?.name }),
    enabled: !!active,
  })
  const relations = useMemo(() => {
    const map = new Map<string, RelationService[]>()
    ;(relationQuery.data ?? []).forEach((entry) => {
      if (entry.configMapName) map.set(entry.configMapName, entry.config ?? [])
    })
    return map
  }, [relationQuery.data])

  const query = useQuery({
    queryKey: ['config-maps', keyword],
    queryFn: () =>
      api.get<ConfigMapList>('/v1/config_map', { page: 1, size: 200, keyword: keyword.trim() }),
    refetchInterval: 60_000,
  })

  const groups = useMemo<GroupRow[]>(
    () =>
      (query.data?.items ?? []).map((item) => ({
        name: item.metadata?.name || '—',
        namespace: item.metadata?.namespace || 'gaop-namespace',
        createdAt: item.metadata?.creationTimestamp,
        data: item.data ?? {},
      })),
    [query.data],
  )

  const createGroup = useMutation({
    mutationFn: () => {
      const name = groupName.trim()
      if (!name) throw new Error('请填写配置组名称')
      return api.post('/v1/config_map', { name, namespace: 'gaop-namespace' })
    },
    onSuccess: () => {
      toast.success('配置组已创建')
      setGroupOpen(false)
      setGroupName('')
      queryClient.invalidateQueries({ queryKey: ['config-maps'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  const createFile = useMutation({
    mutationFn: (payload: { name: string; value: string }) => {
      if (!active) throw new Error('未选择配置组')
      const name = payload.name.trim()
      if (!name) throw new Error('请填写配置文件名称')
      return api.post(`/v1/config_map/${active.name}/config`, { name, value: payload.value })
    },
    onSuccess: async () => {
      toast.success('配置文件已保存')
      setFileOpen(false)
      setEditing(null)
      setFileName('')
      setFileValue('')
      await queryClient.invalidateQueries({ queryKey: ['config-maps'] })
      const refreshed = await query.refetch()
      const next = (refreshed.data?.items ?? []).find((item) => item.metadata?.name === active?.name)
      if (next) {
        setActive({
          name: next.metadata?.name || '—',
          namespace: next.metadata?.namespace || 'gaop-namespace',
          createdAt: next.metadata?.creationTimestamp,
          data: next.data ?? {},
        })
      }
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const deleteFile = useMutation({
    mutationFn: (payload: { group: string; file: string }) =>
      api.del(`/v1/config_map/${payload.group}/config/${encodeURIComponent(payload.file)}`),
    onSuccess: async () => {
      toast.success('配置文件已删除')
      setEditing(null)
      const refreshed = await query.refetch()
      const next = (refreshed.data?.items ?? []).find((item) => item.metadata?.name === active?.name)
      if (next) {
        setActive({
          name: next.metadata?.name || '—',
          namespace: next.metadata?.namespace || 'gaop-namespace',
          createdAt: next.metadata?.creationTimestamp,
          data: next.data ?? {},
        })
      }
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const deleteGroups = useMutation({
    mutationFn: (names: string[]) => api.del('/v1/config_map', undefined, { names: names.join(',') }),
    onSuccess: () => {
      toast.success('配置组已删除')
      setSelected([])
      queryClient.invalidateQueries({ queryKey: ['config-maps'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  async function removeGroup(group: GroupRow) {
    const ok = await confirm({
      title: `删除配置组「${group.name}」？`,
      description: `该配置组包含 ${Object.keys(group.data).length} 个配置文件，删除后挂载它的服务将失去配置。`,
      danger: true,
      confirmText: '删除配置组',
    })
    if (ok) deleteGroups.mutate([group.name])
  }

  async function removeSelected() {
    if (selected.length === 0) return
    const ok = await confirm({
      title: `删除 ${selected.length} 个配置组？`,
      description: '删除后不可恢复，请确认已导出备份。',
      danger: true,
      confirmText: '批量删除',
    })
    if (ok) deleteGroups.mutate(selected)
  }

  function toggle(name: string) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]))
  }

  function exportGroups() {
    const targets = selected.length > 0 ? selected : groups.map((group) => group.name)
    if (targets.length === 0) {
      toast.info('没有可导出的配置组')
      return
    }
    exportMutation.mutate(targets)
  }

  const exportMutation = useMutation({
    mutationFn: (names: string[]) => api.post<unknown>('/v1/config_map/backup', names),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `config-groups-${Date.now()}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('配置组已导出')
    },
    onError: (error) => toast.error('导出失败', errorMessage(error)),
  })

  const importGroups = useMutation({
    mutationFn: async (file: File) => {
      const token = useAuthStore.getState().token
      const formData = new FormData()
      formData.append('json', file)
      const response = await fetch(`${API_BASE}/v1/config_map/import`, {
        method: 'POST',
        headers: token ? { token } : undefined,
        body: formData,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `导入失败 (${response.status})`)
      }
    },
    onSuccess: () => {
      toast.success('配置组已导入')
      queryClient.invalidateQueries({ queryKey: ['config-maps'] })
    },
    onError: (error) => toast.error('导入失败', errorMessage(error)),
  })

  const totalFiles = groups.reduce((sum, group) => sum + Object.keys(group.data).length, 0)

  return (
    <div>
      <PageHeader
        index="03 / 08"
        en="SOFTWARE · CONFIG GROUPS"
        title="服务配置"
        description="以 ConfigMap 配置组管理服务的配置文件。配置组创建后可被多个服务挂载，修改内容后需重启服务生效。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {groups.length} GROUPS · {totalFiles} FILES
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">KUBE / CONFIGMAP</span>
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
                if (file) importGroups.mutate(file)
                event.target.value = ''
              }}
            />
            <Button size="sm" loading={importGroups.isPending} onClick={() => importRef.current?.click()}>
              <Upload size={11} /> 导入配置组
            </Button>
            <Button size="sm" loading={exportMutation.isPending} onClick={exportGroups}>
              <Download size={11} /> 导出配置组
            </Button>
            <Button size="sm" variant="signal" onClick={() => setGroupOpen(true)}>
              <FolderPlus size={11} /> 创建配置组
            </Button>
          </>
        }
      />

      <Panel kicker="CONFIG MAPS" title="配置组清单" bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative flex-1 sm:max-w-[320px]">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              className="field h-8 pl-7 font-mono text-[11px]"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索配置组"
            />
          </div>
          <span className="mono text-[8.5px] tracking-widest text-mute">
            {selected.length > 0 ? `已选 ${selected.length} 项` : '勾选后可批量导出或删除'}
          </span>
          {selected.length > 0 && (
            <Button size="sm" variant="danger" className="ml-auto" loading={deleteGroups.isPending} onClick={removeSelected}>
              <Trash2 size={10} /> 删除所选
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const fileCount = Object.keys(group.data).length
            const checked = selected.includes(group.name)
            return (
              <div
                key={group.name}
                className={cn(
                  'border bg-paper transition-colors',
                  checked ? 'border-signal' : 'border-line hover:border-line-strong',
                )}
              >
                <div className="flex items-start gap-2.5 px-3.5 py-3">
                  <input
                    type="checkbox"
                    className="check mt-0.5"
                    checked={checked}
                    onChange={() => toggle(group.name)}
                    aria-label={`选择 ${group.name}`}
                  />
                  <div className="flex h-9 w-9 flex-none items-center justify-center border border-line-strong bg-paper-2">
                    <Files size={15} className="text-ink-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11.5px] text-ink">{group.name}</div>
                    <div className="mono mt-1 text-[8.5px] tracking-wider text-mute">
                      {fileCount} FILES · {formatDate(group.createdAt, false)}
                    </div>
                  </div>
                  <Badge tone={fileCount > 0 ? 'ok' : 'default'}>{fileCount}</Badge>
                </div>
                <div className="flex items-center justify-between border-t border-line px-3.5 py-2">
                  <button
                    className="mono text-[8.5px] tracking-widest text-ink-3 hover:text-signal"
                    onClick={() => {
                      setActive(group)
                      setEditing(null)
                    }}
                  >
                    查看 / 编辑文件
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      className="text-mute transition-colors hover:text-ink"
                      title="创建配置文件"
                      onClick={() => {
                        setActive(group)
                        setFileOpen(true)
                        setFileName('')
                        setFileValue('')
                      }}
                    >
                      <FilePlus2 size={12} />
                    </button>
                    <button
                      className="text-mute transition-colors hover:text-signal"
                      title="删除配置组"
                      onClick={() => removeGroup(group)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {groups.length === 0 && !query.isLoading && (
          <div className="p-4">
            <EmptyState
              title="暂无配置组"
              description="创建配置组后，可在其中维护多个配置文件，并挂载到服务。"
              action={
                <Button size="sm" variant="signal" onClick={() => setGroupOpen(true)}>
                  <FolderPlus size={11} /> 创建配置组
                </Button>
              }
            />
          </div>
        )}
        {query.isLoading && <div className="px-4 py-10 text-center text-[11px] text-mute">正在读取配置组…</div>}
      </Panel>

      <Modal
        open={groupOpen}
        onOpenChange={setGroupOpen}
        kicker="CONFIG / GROUP"
        title="创建配置组"
        description="配置组对应一个 Kubernetes ConfigMap，名称创建后不可修改。"
        width={430}
        footer={
          <>
            <Button size="sm" onClick={() => setGroupOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!groupName.trim()}
              loading={createGroup.isPending}
              onClick={() => createGroup.mutate()}
            >
              创建
            </Button>
          </>
        }
      >
        <Field label="配置组名称" required hint="小写字母、数字与短横线">
          <input
            className="field font-mono text-[11px]"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="service-config"
            autoFocus
          />
        </Field>
      </Modal>

      <Modal
        open={fileOpen}
        onOpenChange={setFileOpen}
        kicker="CONFIG / FILE"
        title={`新增配置文件${active ? ` · ${active.name}` : ''}`}
        description="配置文件名称将作为 ConfigMap 的键，内容支持任意文本。"
        width={640}
        footer={
          <>
            <Button size="sm" onClick={() => setFileOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!fileName.trim()}
              loading={createFile.isPending}
              onClick={() => createFile.mutate({ name: fileName, value: fileValue })}
            >
              保存文件
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="文件名称" required>
            <input
              className="field font-mono text-[11px]"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="application.properties"
              autoFocus
            />
          </Field>
          <Field label="文件内容">
            <textarea
              className="field min-h-[240px] font-mono text-[10.5px] leading-relaxed"
              spellCheck={false}
              value={fileValue}
              onChange={(event) => setFileValue(event.target.value)}
              placeholder="key=value"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!active && !fileOpen}
        onOpenChange={(open) => {
          if (!open) {
            setActive(null)
            setEditing(null)
          }
        }}
        kicker="CONFIG / CONTENT"
        title={active ? `${active.name} · 配置文件` : '配置文件'}
        description="编辑文件内容后保存会覆盖配置组内的同名键，挂载该配置组的服务重启后生效。"
        width={760}
        footer={
          <>
            <Button size="sm" onClick={() => setActive(null)}>
              关闭
            </Button>
            <Button size="sm" variant="signal" onClick={() => setFileOpen(true)}>
              <FilePlus2 size={11} /> 新增文件
            </Button>
          </>
        }
      >
        {active && (
          <div className="space-y-2">
            {Object.entries(active.data).map(([name, value]) => {
              const isEditing = editing?.name === name
              const related = relations.get(name) ?? []
              return (
                <div key={name} className="border border-line">
                  <div className="flex items-center justify-between gap-2 border-b border-line bg-paper-2/50 px-3 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="mono truncate text-[10px] text-ink">{name}</span>
                      <Badge tone={related.length ? 'ok' : 'default'}>{related.length} 关联</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <Button size="sm" variant="signal" loading={createFile.isPending} onClick={() => createFile.mutate({ name, value: editing.value })}>
                          <Save size={10} /> 保存
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => setEditing({ name, value })}>
                          编辑
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        loading={deleteFile.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `删除配置文件「${name}」？`,
                            description: '挂载该配置组的服务将无法读取此文件。',
                            danger: true,
                            confirmText: '删除文件',
                          })
                          if (ok) deleteFile.mutate({ group: active.name, file: name })
                        }}
                      >
                        <Trash2 size={10} />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
                    <Link2 size={11} className="flex-none text-mute" />
                    {related.length > 0 ? (
                      <>
                        <span className="mono min-w-0 truncate text-[9.5px] text-ink-3">
                          {related[0].serviceName || '—'}
                        </span>
                        <span className="mono min-w-0 truncate text-[9px] text-mute">
                          {related[0].mountPath || '—'}
                        </span>
                        {related.length > 1 && (
                          <button
                            className="mono ml-auto flex-none text-[8.5px] tracking-widest text-signal hover:underline"
                            onClick={() => setRelationFile(name)}
                          >
                            查看全部 {related.length}
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="mono text-[9px] tracking-wider text-mute">未被服务挂载</span>
                    )}
                  </div>
                  {isEditing ? (
                    <textarea
                      className="field min-h-[140px] border-0 font-mono text-[10.5px] leading-relaxed"
                      spellCheck={false}
                      value={editing.value}
                      onChange={(event) => setEditing({ name, value: event.target.value })}
                    />
                  ) : (
                    <pre className="max-h-[180px] overflow-auto px-3 py-2 font-mono text-[10px] leading-relaxed text-ink-3">
                      {value || '（空）'}
                    </pre>
                  )}
                </div>
              )
            })}
            {Object.keys(active.data).length === 0 && (
              <EmptyState title="配置组为空" description="该配置组还没有配置文件，可点击「新增文件」创建。" />
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!relationFile}
        onOpenChange={(open) => {
          if (!open) setRelationFile(null)
        }}
        kicker="CONFIG / MOUNT"
        title={`关联服务 · ${relationFile ?? ''}`}
        description="挂载该配置文件的全部服务及其挂载路径，修改配置后需重启对应服务生效。"
        width={520}
        footer={
          <Button size="sm" onClick={() => setRelationFile(null)}>
            关闭
          </Button>
        }
      >
        <div className="divide-y divide-line border border-line">
          {(relationFile ? relations.get(relationFile) ?? [] : []).map((item, index) => (
            <div key={`${item.serviceName}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="mono min-w-0 truncate text-[10.5px] text-ink">{item.serviceName || '—'}</span>
              <span className="mono min-w-0 truncate text-[9.5px] text-mute">{item.mountPath || '—'}</span>
            </div>
          ))}
          {(!relationFile || (relations.get(relationFile) ?? []).length === 0) && (
            <div className="px-3 py-6 text-center text-[10.5px] text-mute">暂无服务挂载该文件</div>
          )}
        </div>
      </Modal>
    </div>
  )
}
