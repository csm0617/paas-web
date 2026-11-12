import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, Hammer, Plus, RefreshCw, Search, TerminalSquare, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import SockJS from 'sockjs-client'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
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
  useConfirm,
} from '@/components/ui'
import { cn } from '@/lib/utils'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api/gaop'
const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
type SockJsClient = InstanceType<typeof SockJS>

interface BuildTask {
  id: string
  imageStorage?: string
  imageName?: string
  imageTag?: string
  tag?: string
  jobStatus?: number | null
  createAt?: number | string
  updateAt?: number | string
  description?: string
  desc?: string
  dockerfileContent?: string
  dockerfile?: string
  pod?: { podName?: string; namespace?: string; container?: string } | null
}

interface StorageInfo {
  free?: number
  total?: number
}

const emptyForm = {
  imageStorage: '172.16.209.25:1080/gaop',
  imageName: '',
  tag: 'latest',
  desc: '',
  dockerfile: 'FROM nginx:1.22.0\nCOPY dist/ /usr/share/nginx/html/\n',
}

function statusOf(status?: number | null) {
  if (status === 1) return { label: 'SUCCESS', tone: 'ok' as const }
  if (status === 0) return { label: 'FAILED', tone: 'bad' as const }
  if (status === 2) return { label: 'BUILDING', tone: 'warn' as const }
  return { label: 'IDLE', tone: 'default' as const }
}

function formatBytes(value?: number) {
  if (!value) return '—'
  const gb = value / 1024 / 1024 / 1024
  return `${gb.toFixed(1)} GiB`
}

export default function ContinuousIntegrationPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const user = useAuthStore((state) => state.user)
  const [keyword, setKeyword] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<BuildTask | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [logTarget, setLogTarget] = useState<BuildTask | null>(null)
  const [logText, setLogText] = useState('')
  const [logState, setLogState] = useState<'idle' | 'connecting' | 'open' | 'closed'>('idle')
  const logRef = useRef<HTMLPreElement | null>(null)

  const listQuery = useQuery({
    queryKey: ['ci-builds', keyword],
    queryFn: () =>
      api.post<{ list: BuildTask[]; total: number }>('/v1/pub/cicdList', {
        keyword,
        userId: user?.id ?? null,
      }),
    refetchInterval: 5_000,
  })
  const storageQuery = useQuery({
    queryKey: ['ci-storage'],
    queryFn: () => api.get<StorageInfo>('/v1/service/imageStorage'),
    refetchInterval: 60_000,
  })

  const tasks = listQuery.data?.list ?? []
  const storage = storageQuery.data
  const used = (storage?.total ?? 0) - (storage?.free ?? 0)
  const usedPercent = storage?.total ? Math.round((used / storage.total) * 100) : 0

  const running = tasks.filter((task) => task.jobStatus === 2).length

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        imageStorage: form.imageStorage.trim(),
        imageName: form.imageName.trim(),
        tag: form.tag.trim(),
        desc: form.desc.trim(),
        dockerfile: form.dockerfile,
      }
      if (editing) return api.post('/v1/pub/updateTask', { ...payload, id: editing.id })
      return api.post('/v1/pub/task', { ...payload, userId: user?.id ?? null })
    },
    onSuccess: () => {
      toast.success(editing ? '构建任务已更新' : '构建任务已提交')
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm)
      queryClient.invalidateQueries({ queryKey: ['ci-builds'] })
    },
    onError: (error) => toast.error('提交失败', errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del('/v1/pub/delete', { id }),
    onSuccess: () => {
      toast.success('构建任务已删除')
      queryClient.invalidateQueries({ queryKey: ['ci-builds'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  useEffect(() => {
    if (!logTarget) return
    setLogText('')
    setLogState('connecting')
    const pod = logTarget.pod?.podName
    const container = logTarget.pod?.container || logTarget.imageName
    const namespace = logTarget.pod?.namespace
    if (!pod || !container || !namespace) {
      setLogState('closed')
      setLogText('该任务尚未产生构建 Pod，暂无日志。')
      return
    }
    let socket: SockJsClient | null = null
    const timer = window.setTimeout(() => {
      socket = new SockJS(
        `${API_BASE}/logs?pod=${encodeURIComponent(pod)}&container=${encodeURIComponent(container)}&namespace=${encodeURIComponent(namespace)}`,
      )
      socket.onopen = () => setLogState('open')
      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return
        const chunk = event.data.replace(ANSI_RE, '')
        setLogText((prev) => (prev + chunk).slice(-120_000))
      }
      socket.onclose = () => setLogState('closed')
      socket.onerror = () => setLogState('closed')
    }, 200)
    return () => {
      window.clearTimeout(timer)
      socket?.close()
    }
  }, [logTarget])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logText])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  function openEdit(task: BuildTask) {
    setEditing(task)
    setForm({
      imageStorage: task.imageStorage || emptyForm.imageStorage,
      imageName: task.imageName || '',
      tag: task.imageTag || task.tag || 'latest',
      desc: task.description || task.desc || '',
      dockerfile: task.dockerfileContent || task.dockerfile || emptyForm.dockerfile,
    })
    setFormOpen(true)
  }

  async function remove(task: BuildTask) {
    const ok = await confirm({
      title: `删除构建任务「${task.imageName}:${task.imageTag || task.tag || 'latest'}」？`,
      description: '仅删除构建任务记录，不会删除已推送的镜像。',
      danger: true,
      confirmText: '删除任务',
    })
    if (ok) deleteMutation.mutate(task.id)
  }

  const columns: Array<Column<BuildTask>> = [
    {
      key: 'image',
      header: '镜像 / IMAGE',
      cell: (task) => (
        <div className="flex items-center gap-2.5">
          <Boxes size={13} className="text-mute" />
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] text-ink">{task.imageName || '—'}</div>
            <div className="mono mt-0.5 truncate text-[8.5px] tracking-wider text-mute">
              {task.imageStorage || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'tag',
      header: '标签',
      cell: (task) => <Badge tone="info">{task.imageTag || task.tag || 'latest'}</Badge>,
    },
    {
      key: 'status',
      header: '状态',
      cell: (task) => {
        const status = statusOf(task.jobStatus)
        return (
          <span className="flex items-center gap-1.5">
            <StatusDot tone={status.tone === 'bad' ? 'bad' : status.tone === 'warn' ? 'warn' : 'ok'} pulse={status.tone === 'warn'} />
            <span className="mono text-[9px] tracking-widest text-ink-3">{status.label}</span>
          </span>
        )
      },
    },
    {
      key: 'created',
      header: '创建时间',
      sortValue: (task) => Number(task.createAt ?? 0),
      cell: (task) => <span className="mono text-[9.5px] text-ink-3">{formatDate(task.createAt, false)}</span>,
    },
    {
      key: 'updated',
      header: '最近执行',
      sortValue: (task) => Number(task.updateAt ?? 0),
      cell: (task) => <span className="mono text-[9.5px] text-mute">{formatDate(task.updateAt ?? task.createAt, false)}</span>,
    },
    {
      key: 'desc',
      header: '描述',
      cell: (task) => (
        <span className="line-clamp-2 block max-w-[220px] text-[10.5px] leading-relaxed text-ink-3">
          {task.description || task.desc || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (task) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button size="sm" onClick={() => setLogTarget(task)}>
            <TerminalSquare size={10} /> 日志
          </Button>
          <ActionMenu
            items={[
              { label: '编辑任务', onSelect: () => openEdit(task) },
              { label: '删除任务', danger: true, icon: <Trash2 size={12} />, onSelect: () => remove(task) },
            ]}
          />
        </div>
      ),
    },
  ]

  const logTitle = useMemo(() => {
    if (!logTarget) return '构建日志'
    return `构建日志 · ${logTarget.imageName || '—'}:${logTarget.imageTag || logTarget.tag || 'latest'}`
  }, [logTarget])

  return (
    <div>
      <PageHeader
        index="03 / 03"
        en="REGISTRY · CONTINUOUS INTEGRATION"
        title="持续集成"
        description="提交 Dockerfile 构建任务，由平台在集群内完成构建并推送至镜像仓库。构建过程可实时查看日志。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={running ? 'warn' : 'ok'} pulse={running > 0} />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {tasks.length} TASKS · {running} RUNNING
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">
              STORAGE {formatBytes(storage?.free)} FREE
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={listQuery.isFetching} onClick={() => listQuery.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" variant="signal" onClick={openCreate}>
              <Plus size={11} /> 新建构建
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Panel bodyClassName="px-4 py-3.5">
          <div className="label">构建任务</div>
          <div className="num mt-1.5 text-[28px] leading-none text-ink">{tasks.length}</div>
          <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">TOTAL TASKS</div>
        </Panel>
        <Panel bodyClassName="px-4 py-3.5">
          <div className="label">运行中</div>
          <div className="num mt-1.5 text-[28px] leading-none text-ink">{running}</div>
          <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">IN PROGRESS</div>
        </Panel>
        <Panel bodyClassName="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div className="label">镜像仓库容量</div>
            <span className="mono text-[9px] text-ink-3">{usedPercent}% USED</span>
          </div>
          <div className="mt-2 h-[6px] w-full bg-paper-2">
            <div className="h-full bg-signal" style={{ width: `${Math.min(usedPercent, 100)}%` }} />
          </div>
          <div className="mono mt-2 flex justify-between text-[8.5px] tracking-wider text-mute">
            <span>{formatBytes(used)} USED</span>
            <span>{formatBytes(storage?.total)} TOTAL</span>
          </div>
        </Panel>
      </div>

      <Panel
        kicker="BUILD QUEUE"
        title="构建任务"
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-1.5 border border-line-strong bg-paper px-2">
            <Search size={11} className="text-mute" />
            <input
              className="h-7 w-44 bg-transparent font-mono text-[10px] text-ink outline-none placeholder:text-mute"
              placeholder="搜索镜像 / 描述"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={tasks}
          rowKey={(task) => task.id}
          loading={listQuery.isLoading}
          pageSize={10}
          emptyTitle="暂无构建任务"
          emptyDescription="提交 Dockerfile 后，平台将创建构建 Pod 并推送镜像至仓库。"
          emptyAction={
            <Button size="sm" variant="signal" onClick={openCreate}>
              <Plus size={11} /> 新建构建
            </Button>
          }
        />
      </Panel>

      <Modal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setEditing(null)
        }}
        kicker={editing ? 'CI / EDIT BUILD' : 'CI / NEW BUILD'}
        title={editing ? `编辑构建 · ${editing.imageName}` : '新建构建任务'}
        description="构建任务提交后立即进入队列执行。镜像地址需包含仓库主机与项目路径。"
        width={680}
        footer={
          <>
            <Button size="sm" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={saveMutation.isPending}
              disabled={!form.imageName.trim() || !form.tag.trim() || !form.dockerfile.trim()}
              onClick={() => saveMutation.mutate()}
            >
              {editing ? '保存任务' : '提交构建'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="镜像仓库" required>
            <input
              className="field font-mono text-[11px]"
              value={form.imageStorage}
              onChange={(event) => setForm({ ...form, imageStorage: event.target.value })}
              placeholder="172.16.209.25:1080/gaop"
            />
          </Field>
          <Field label="镜像名称" required>
            <input
              className="field font-mono text-[11px]"
              value={form.imageName}
              onChange={(event) => setForm({ ...form, imageName: event.target.value })}
              placeholder="situation-map"
            />
          </Field>
          <Field label="标签" required>
            <input
              className="field font-mono text-[11px]"
              value={form.tag}
              onChange={(event) => setForm({ ...form, tag: event.target.value })}
              placeholder="latest"
            />
          </Field>
          <Field label="描述">
            <input
              className="field"
              value={form.desc}
              onChange={(event) => setForm({ ...form, desc: event.target.value })}
              placeholder="构建用途说明"
            />
          </Field>
          <Field label="Dockerfile" required className="sm:col-span-2" hint="构建上下文由平台提供，可直接 COPY dist/">
            <textarea
              className="field min-h-[220px] resize-y font-mono text-[11px] leading-relaxed"
              value={form.dockerfile}
              onChange={(event) => setForm({ ...form, dockerfile: event.target.value })}
              spellCheck={false}
            />
          </Field>
        </div>
        <div className="mt-3 flex items-start gap-2 border border-line bg-paper-2/40 px-3 py-2">
          <Hammer size={12} className="mt-0.5 text-mute" />
          <p className="mono text-[9px] leading-relaxed tracking-wider text-mute">
            TARGET / {form.imageStorage}/{form.imageName}:{form.tag}
          </p>
        </div>
      </Modal>

      <Modal
        open={!!logTarget}
        onOpenChange={(open) => {
          if (!open) setLogTarget(null)
        }}
        kicker="CI / BUILD LOG"
        title={logTitle}
        description="构建 Pod 的实时输出，关闭后连接断开。"
        width={820}
        footer={
          <Button size="sm" onClick={() => setLogTarget(null)}>
            关闭
          </Button>
        }
      >
        <div className="mb-2 flex items-center gap-2">
          <Badge tone={logState === 'open' ? 'ok' : logState === 'connecting' ? 'warn' : 'default'}>
            {logState === 'open' ? 'STREAMING' : logState === 'connecting' ? 'CONNECTING' : 'CLOSED'}
          </Badge>
          <span className="mono text-[8.5px] tracking-widest text-mute">
            {logTarget?.pod?.podName || 'NO POD'} / {logTarget?.pod?.namespace || '—'}
          </span>
          <button
            className={cn('mono ml-auto text-[8.5px] tracking-widest text-ink-3 hover:text-signal')}
            onClick={() => setLogText('')}
          >
            清空
          </button>
        </div>
        <pre
          ref={logRef}
          className="h-[420px] overflow-auto border border-line bg-[#14171a] p-3 font-mono text-[10.5px] leading-relaxed text-[#d9dcdd]"
        >
          {logText || '等待日志输出…'}
        </pre>
      </Modal>
    </div>
  )
}
