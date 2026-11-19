import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Download, FileText, Folder, FolderPlus, Pencil, Plus, Trash2, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { Button, EmptyState, Field, Modal, PageToolbar, Panel, Select, useConfirm } from '@/components/ui'
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

function CodeEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const lines = Math.max(value.split('\n').length, 1)
  return (
    <div className="flex h-[360px] overflow-hidden border border-[#33506e] bg-[#0e2233]">
      <div
        ref={gutterRef}
        className="w-[42px] flex-none overflow-hidden bg-[#19476f] py-2 text-right font-mono text-[12px] leading-[18px] text-[#d7e6f5]"
      >
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="pr-2">
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        className="h-full flex-1 resize-none bg-transparent px-2 py-2 font-mono text-[12px] leading-[18px] text-ink outline-none"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop
        }}
      />
    </div>
  )
}

export default function ConfigGroupPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const importRef = useRef<HTMLInputElement | null>(null)
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [expandedName, setExpandedName] = useState<string | null>(null)
  const [groupOpen, setGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [active, setActive] = useState<GroupRow | null>(null)
  const [fileOpen, setFileOpen] = useState(false)
  const [fileMode, setFileMode] = useState<'create' | 'edit'>('create')
  const [fileEncoding, setFileEncoding] = useState('UTF-8')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileValue, setFileValue] = useState('')
  const [relationFile, setRelationFile] = useState<string | null>(null)

  const relationQuery = useQuery({
    queryKey: ['config-map-relations', expandedName],
    queryFn: () => api.get<RelationEntry[]>('/v1/config_map/relationService', { name: expandedName }),
    enabled: !!expandedName,
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

  return (
    <div>
      <PageToolbar search={{ value: keyword, onChange: setKeyword, placeholder: '请输入配置名称搜索' }}>
        <Button size="sm" variant="signal" onClick={() => setGroupOpen(true)}>
          <FolderPlus size={11} /> 新增配置
        </Button>
        <Button size="sm" variant="signal" loading={exportMutation.isPending} onClick={exportGroups}>
          <Download size={11} /> 导出配置
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
        <Button size="sm" variant="signal" loading={importGroups.isPending} onClick={() => importRef.current?.click()}>
          <Upload size={11} /> 导入配置
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={selected.length === 0}
          loading={deleteGroups.isPending}
          onClick={removeSelected}
        >
          <Trash2 size={11} /> 删除配置
        </Button>
      </PageToolbar>

      <Panel bodyClassName="p-0">
        {groups.map((group) => {
          const files = Object.entries(group.data)
          const checked = selected.includes(group.name)
          const expanded = expandedName === group.name
          return (
            <div key={group.name} className="border-b border-line last:border-b-0">
              <div className="flex items-center gap-2.5 px-4 py-2.5">
                <input
                  type="checkbox"
                  className="check"
                  checked={checked}
                  onChange={() => toggle(group.name)}
                  aria-label={`选择 ${group.name}`}
                />
                <Folder size={13} className="flex-none text-[#4aa3f0]" />
                <button
                  className="min-w-0 truncate text-[14px] text-ink transition-colors hover:text-signal"
                  onClick={() => setExpandedName(expanded ? null : group.name)}
                >
                  {group.name}
                </button>
                <span className="flex-none text-[14px] text-ink-3">配置文件 {files.length}个</span>
                <span className="mono ml-auto flex-none text-[12px] text-ink-3">
                  {group.createdAt ? formatDate(group.createdAt, true) : '--'}
                </span>
                <div className="flex flex-none items-center">
                  <button
                    className="inline-flex h-[26px] items-center gap-1 border border-[#2f6fa8] bg-transparent px-2.5 text-[14px] text-[#4aa3f0] transition-colors hover:border-signal hover:text-[#7cc4ff]"
                    onClick={() => {
                      setActive(group)
                      setFileMode('create')
                      setFileOpen(true)
                      setFileName('')
                      setFileValue('')
                    }}
                  >
                    <Plus size={10} /> 创建配置文件
                  </button>
                  <button
                    className="inline-flex h-[26px] items-center border border-l-0 border-[#2f6fa8] px-1 text-[#4aa3f0] transition-colors hover:border-signal hover:text-[#7cc4ff]"
                    title="更多"
                    onClick={() => {
                      setActive(group)
                      setFileMode('create')
                      setFileOpen(true)
                      setFileName('')
                      setFileValue('')
                    }}
                  >
                    <ChevronDown size={11} />
                  </button>
                </div>
                <button
                  className="flex h-6 w-6 flex-none items-center justify-center text-mute transition-colors hover:text-ink"
                  onClick={() => setExpandedName(expanded ? null : group.name)}
                  aria-label={expanded ? '收起' : '展开'}
                >
                  <ChevronDown
                    size={14}
                    className={cn('transition-transform', expanded && 'rotate-180')}
                  />
                </button>
              </div>
              {expanded && (
                <div className="border-t border-line bg-[#0c1b2a] px-6 py-2">
                  {files.length === 0 ? (
                    <div className="py-6 text-center text-[14px] text-mute">暂无配置文件</div>
                  ) : (
                    files.map(([name, value], index) => {
                      const related = relations.get(name) ?? []
                      return (
                        <div
                          key={name}
                          className={cn(
                            'flex items-center gap-5 py-3',
                            index < files.length - 1 && 'border-b border-line/70',
                          )}
                        >
                          <div className="flex w-[240px] flex-none items-center gap-2">
                            <FileText size={13} className="flex-none text-[#4aa3f0]" />
                            <span className="mono truncate text-[14px] text-ink">{name}</span>
                          </div>
                          <div className="flex flex-none items-center gap-1.5">
                            <button
                              className="flex h-6 w-6 items-center justify-center bg-[#1670c2] text-white transition-colors hover:bg-[#1a82dd]"
                              title="编辑"
                              onClick={() => {
                                setActive(group)
                                setFileMode('edit')
                                setFileName(name)
                                setFileValue(value)
                                setFileOpen(true)
                              }}
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              className="flex h-6 w-6 items-center justify-center bg-[#25384a] text-ink-3 transition-colors hover:text-white"
                              title="删除"
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `删除配置文件「${name}」？`,
                                  description: '挂载该配置组的服务将无法读取此文件。',
                                  danger: true,
                                  confirmText: '删除文件',
                                })
                                if (ok) deleteFile.mutate({ group: group.name, file: name })
                              }}
                            >
                              <X size={11} />
                            </button>
                          </div>
                          <div className="flex min-w-0 flex-1 items-center gap-4 border-l border-[#1f3b55] pl-5">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[14px] text-ink-3">
                                关联服务
                                {related.length > 0 && (
                                  <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#3fbf7f] px-1 text-[12px] text-[#0a1622]">
                                    {related.length}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 truncate text-[14px] text-ink-3">
                                {related.length > 0
                                  ? related.map((item) => item.serviceName || '—').join('、')
                                  : '暂无挂载'}
                              </div>
                            </div>
                          </div>
                          <div className="min-w-0 flex-1 border-l border-[#1f3b55] pl-5">
                            <div className="text-[14px] text-ink-3">挂载路径</div>
                            <div className="mono mt-1 truncate text-[14px] text-ink-3">
                              {related.length > 0
                                ? related.map((item) => item.mountPath || '—').join('、')
                                : '--'}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
        {groups.length === 0 && !query.isLoading && (
          <div className="p-4">
            <EmptyState
              title="暂无配置"
              description="创建配置后，可在其中维护多个配置文件，并挂载到服务。"
              action={
                <Button size="sm" variant="signal" onClick={() => setGroupOpen(true)}>
                  <FolderPlus size={11} /> 新增配置
                </Button>
              }
            />
          </div>
        )}
        {query.isLoading && <div className="px-4 py-10 text-center text-[12px] text-mute">正在读取配置…</div>}
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
            className="field font-mono text-[12px]"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="service-config"
            autoFocus
          />
        </Field>
      </Modal>

      <Modal
        open={fileOpen}
        onOpenChange={(open) => {
          setFileOpen(open)
          if (!open) {
            setActive(null)
            setFileName('')
            setFileValue('')
            setFileEncoding('UTF-8')
          }
        }}
        title={fileMode === 'edit' ? '编辑配置文件' : '创建配置文件'}
        width={1000}
        footer={
          <div className="flex w-full items-center justify-center gap-3">
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
              确定
            </Button>
          </div>
        }
      >
        <div className="space-y-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="w-[56px] flex-none text-right text-[14px] text-ink-3">
              <span className="text-danger">* </span>名称：
            </span>
            <input
              className="field h-8 flex-1 font-mono text-[14px]"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="init.sql"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-[56px] flex-none text-right text-[14px] text-ink-3">内容：</span>
            <span className="text-[14px] text-ink-3">导入或直接输入配置文件</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-[56px] flex-none" />
            <Select
              className="h-8 text-[14px]"
              value={fileEncoding}
              options={[
                { value: 'UTF-8', label: 'UTF-8' },
                { value: 'GBK', label: 'GBK' },
                { value: 'Big5', label: 'Big5' },
                { value: 'EUC-JP', label: 'EUC-JP' },
                { value: 'KOI8-R', label: 'KOI8-R' },
              ]}
              onChange={(value) => setFileEncoding(value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-[56px] flex-none" />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (file) setFileValue(await file.text())
                event.target.value = ''
              }}
            />
            <button
              className="inline-flex h-8 items-center gap-1.5 border border-[#2f6fa8] px-3 text-[14px] text-[#4aa3f0] transition-colors hover:border-signal hover:text-[#7cc4ff]"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={12} /> 读取文件内容
            </button>
          </div>
          <div className="pl-[64px] text-[14px] text-mute">请上传文件或直接输入内容</div>
          <CodeEditor value={fileValue} onChange={setFileValue} />
        </div>
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
              <span className="mono min-w-0 truncate text-[12px] text-ink">{item.serviceName || '—'}</span>
              <span className="mono min-w-0 truncate text-[12px] text-mute">{item.mountPath || '—'}</span>
            </div>
          ))}
          {(!relationFile || (relations.get(relationFile) ?? []).length === 0) && (
            <div className="px-3 py-6 text-center text-[12px] text-mute">暂无服务挂载该文件</div>
          )}
        </div>
      </Modal>
    </div>
  )
}
