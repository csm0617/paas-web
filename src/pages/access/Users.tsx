import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileDown, Plus, RefreshCw, Search, Trash2, Upload, UserCog, Users } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate, relativeTime } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
import type { RoleItem, UserListItem } from '@/types'
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

interface UserFormState {
  username: string
  nickname: string
  password: string
  email: string
  phone: string
  desc: string
  status: number
  roleListKey: string[]
}

const emptyForm: UserFormState = {
  username: '',
  nickname: '',
  password: '',
  email: '',
  phone: '',
  desc: '',
  status: 1,
  roleListKey: [],
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const currentUser = useAuthStore((state) => state.user)
  const [keyword, setKeyword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<UserListItem | null>(null)
  const [form, setForm] = useState<UserFormState>(emptyForm)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importCover, setImportCover] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement | null>(null)

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ list: UserListItem[]; total: number }>('/v1/user/info', { page: 1, size: 200 }),
  })
  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ list: RoleItem[]; total: number }>('/v1/role', { page: 1, size: 100 }),
  })

  const users = usersQuery.data?.list ?? []
  const roles = rolesQuery.data?.list ?? []

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (user) =>
        user.username.toLowerCase().includes(q) ||
        (user.nickname || '').toLowerCase().includes(q) ||
        (user.email || '').toLowerCase().includes(q),
    )
  }, [users, keyword])

  async function downloadFile(path: string, filename: string, init?: RequestInit) {
    const token = useAuthStore.getState().token
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers: { ...(token ? { token } : {}), ...(init?.headers as Record<string, string> | undefined) },
      })
      if (!response.ok) throw new Error(`下载失败 (${response.status})`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('文件已生成', filename)
    } catch (error) {
      toast.error('下载失败', errorMessage(error))
    }
  }

  function exportUsers() {
    if (filtered.length === 0) {
      toast.error('暂无用户可导出')
      return
    }
    downloadFile('/v1/user/backup', 'users.xls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filtered.map((user) => user.id)),
    })
  }

  function downloadTemplate() {
    downloadFile('/v1/user/import/template', 'user-import-template.xls')
  }

  async function importUsers() {
    if (!importFile) return
    const formData = new FormData()
    formData.append('file', importFile)
    const token = useAuthStore.getState().token
    setImporting(true)
    try {
      const response = await fetch(`${API_BASE}/v1/user/import?isCover=${importCover}`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { token } : undefined,
        body: formData,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `导入失败 (${response.status})`)
      }
      toast.success('用户导入成功')
      setImportOpen(false)
      setImportFile(null)
      setImportCover(false)
      queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (error) {
      toast.error('导入失败', errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form.username.trim()) throw new Error('用户名不能为空')
      if (!editing && !form.password) throw new Error('新建用户必须设置密码')
      const body: Record<string, unknown> = {
        username: form.username.trim(),
        nickname: form.nickname.trim() || null,
        status: form.status,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        desc: form.desc.trim() || null,
        roleListKey: form.roleListKey,
        password: form.password || null,
      }
      if (editing) return api.put(`/v1/user/${editing.id}`, body)
      return api.post('/v1/user', body)
    },
    onSuccess: () => {
      toast.success(editing ? '用户信息已更新' : '用户已创建')
      setModalOpen(false)
      setEditing(null)
      setForm(emptyForm)
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/v1/user/${id}`),
    onSuccess: () => {
      toast.success('用户已删除')
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(user: UserListItem) {
    setEditing(user)
    setForm({
      username: user.username,
      nickname: user.nickname || '',
      password: '',
      email: user.email || '',
      phone: user.phone || '',
      desc: user.desc || '',
      status: user.status ?? 1,
      roleListKey: (user.roles ?? []).map((role) => role.key).filter(Boolean),
    })
    setModalOpen(true)
  }

  async function remove(user: UserListItem) {
    const ok = await confirm({
      title: `删除用户「${user.username}」？`,
      description: '删除后该账户将无法登录，相关审计记录仍会保留。',
      danger: true,
      confirmText: '删除用户',
    })
    if (ok) deleteMutation.mutate(user.id)
  }

  const columns: Array<Column<UserListItem>> = [
    {
      key: 'user',
      header: '用户 / USER',
      sortValue: (row) => row.username,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-8 w-8 flex-none items-center justify-center border border-line-strong bg-paper-2">
            <span className="mono text-[9px] text-ink-3">{(row.nickname || row.username).slice(0, 2).toUpperCase()}</span>
            <span className={cn('absolute -bottom-px -right-px h-1.5 w-1.5', row.status === 1 ? 'bg-ok' : 'bg-line-strong')} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px] text-ink">{row.nickname || row.username}</span>
              {row.id === currentUser?.id && <Badge tone="info">YOU</Badge>}
            </div>
            <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.username}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: '联系方式',
      cell: (row) => (
        <div className="mono text-[10px] text-ink-3">
          <div>{row.email || '—'}</div>
          <div className="mt-0.5 text-[8.5px] text-mute">{row.phone || '—'}</div>
        </div>
      ),
    },
    {
      key: 'roles',
      header: '席位',
      cell: (row) => {
        const names = [
          ...(row.roles ?? []).map((role) => role.name || role.key),
          ...(row.belongUsers ?? []),
        ].filter(Boolean)
        const unique = Array.from(new Set(names))
        return (
          <div className="flex flex-wrap gap-1">
            {unique.slice(0, 3).map((name) => (
              <Badge key={name}>{name}</Badge>
            ))}
            {unique.length === 0 && <span className="text-mute">未分配</span>}
          </div>
        )
      },
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => (
        <div className="flex items-center gap-1.5">
          <StatusDot tone={row.status === 1 ? 'ok' : 'idle'} />
          <span className="mono text-[9px] uppercase tracking-wider text-ink-3">{row.status === 1 ? 'ACTIVE' : 'DISABLED'}</span>
        </div>
      ),
    },
    {
      key: 'login',
      header: '最近登录',
      cell: (row) => (
        <div>
          <div className="mono text-[10px] text-ink-3">{relativeTime(row.updatedAt)}</div>
          <div className="mono mt-0.5 text-[8px] text-mute">{formatDate(row.updatedAt, false)}</div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <ActionMenu
          items={[
            { label: '编辑用户', onSelect: () => openEdit(row), icon: <UserCog size={12} /> },
            { label: '删除用户', danger: true, onSelect: () => remove(row), icon: <Trash2 size={12} /> },
          ]}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="07 / 01"
        en="ACCESS · USER ACCOUNTS"
        title="用户管理"
        description="管理平台账户与席位绑定。用户通过席位获得应用与接口权限，权限变更即时生效。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{users.length} ACCOUNTS</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">
              {users.filter((user) => user.status === 1).length} ACTIVE · {roles.length} SEATS
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={usersQuery.isFetching} onClick={() => usersQuery.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" variant="signal" onClick={openCreate}>
              <Plus size={11} /> 新建用户
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Upload size={11} /> 导入用户
            </Button>
            <Button size="sm" onClick={exportUsers}>
              <Download size={11} /> 导出用户
            </Button>
            <Button size="sm" onClick={downloadTemplate}>
              <FileDown size={11} /> 下载模板
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-9" bodyClassName="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
              <input
                className="field h-8 border-0 bg-transparent pl-8 text-[12px] shadow-none focus:shadow-none"
                placeholder="搜索用户名 / 昵称 / 邮箱"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
            <span className="mono text-[9px] tracking-widest text-mute">{filtered.length} RESULTS</span>
          </div>
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            loading={usersQuery.isLoading}
            pageSize={10}
            emptyTitle="没有匹配的用户"
            emptyDescription="调整搜索条件，或创建新的平台账户。"
          />
        </Panel>

        <div className="flex flex-col gap-4 xl:col-span-3">
          <Panel kicker="ACCESS SNAPSHOT" title="权限概况">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-mute" />
                  <span className="label">平台账户</span>
                </div>
                <span className="num text-[24px] text-ink">{users.length}</span>
              </div>
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="label">启用账户</span>
                <span className="num text-[24px] text-ok">{users.filter((user) => user.status === 1).length}</span>
              </div>
              <div className="flex items-center justify-between border-b border-line pb-3">
                <span className="label">席位数量</span>
                <span className="num text-[24px] text-ink">{roles.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="label">当前席位</span>
                <Badge tone="info">{useAuthStore.getState().role?.name || '—'}</Badge>
              </div>
            </div>
          </Panel>
          <Panel kicker="NOTICE" title="账户策略">
            <ul className="space-y-2 text-[10.5px] leading-relaxed text-ink-3">
              <li className="flex gap-2">
                <span className="mt-1 h-1 w-1 flex-none bg-signal" />
                新建账户必须设置初始密码，建议首次登录后修改。
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1 w-1 flex-none bg-signal" />
                删除账户不会清理其历史审计记录。
              </li>
            </ul>
          </Panel>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open)
          if (!open) {
            setEditing(null)
            setForm(emptyForm)
          }
        }}
        kicker={editing ? 'ACCESS / EDIT USER' : 'ACCESS / NEW USER'}
        title={editing ? `编辑「${editing.username}」` : '新建平台用户'}
        description="席位决定用户可见的应用与可调用的接口。可多选。"
        width={600}
        footer={
          <>
            <Button size="sm" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {editing ? '保存修改' : '创建用户'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="用户名" required>
            <input
              className="field"
              value={form.username}
              disabled={!!editing}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="登录账户名"
            />
          </Field>
          <Field label="昵称">
            <input className="field" value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} placeholder="显示名称" />
          </Field>
          <Field label={editing ? '重置密码（留空不变）' : '初始密码'} required={!editing}>
            <input
              className="field"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder={editing ? '不修改请留空' : '至少 6 位'}
            />
          </Field>
          <Field label="账户状态">
            <select className="field" value={form.status} onChange={(event) => setForm({ ...form, status: Number(event.target.value) })}>
              <option value={1}>启用</option>
              <option value={0}>停用</option>
            </select>
          </Field>
          <Field label="邮箱">
            <input className="field" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@domain.com" />
          </Field>
          <Field label="手机号">
            <input className="field" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="可选" />
          </Field>
          <Field label="席位绑定" className="sm:col-span-2" hint="绑定席位后，用户登录时需选择对应席位。">
            <div className="grid max-h-[168px] grid-cols-1 gap-1.5 overflow-y-auto border border-line p-2 sm:grid-cols-2">
              {roles.map((role) => {
                const checked = form.roleListKey.includes(role.key)
                return (
                  <label key={role.id || role.key} className="flex cursor-pointer items-center gap-2 border border-transparent px-2 py-1.5 hover:border-line">
                    <input
                      type="checkbox"
                      className="check"
                      checked={checked}
                      onChange={() =>
                        setForm((prev) => ({
                          ...prev,
                          roleListKey: checked
                            ? prev.roleListKey.filter((key) => key !== role.key)
                            : [...prev.roleListKey, role.key],
                        }))
                      }
                    />
                    <span className="flex-1 truncate text-[11px] text-ink">{role.name}</span>
                    <span className="mono text-[8.5px] text-mute">{role.key}</span>
                  </label>
                )
              })}
              {roles.length === 0 && <div className="col-span-2 py-2 text-center text-[10.5px] text-mute">暂无可用席位</div>}
            </div>
          </Field>
          <Field label="备注" className="sm:col-span-2">
            <textarea className="field" rows={2} value={form.desc} onChange={(event) => setForm({ ...form, desc: event.target.value })} placeholder="可选" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) {
            setImportFile(null)
            setImportCover(false)
          }
        }}
        kicker="ACCESS / IMPORT USERS"
        title="导入用户"
        description="上传平台用户 Excel 模板。默认跳过同名用户，开启覆盖后同名账户将被模板内容更新。"
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={importing} disabled={!importFile} onClick={importUsers}>
              开始导入
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <input
            ref={importRef}
            type="file"
            accept=".xls,.xlsx"
            className="hidden"
            onChange={(event) => {
              setImportFile(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
          />
          <button
            onClick={() => importRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 border border-dashed border-line-strong px-4 py-8 text-mute hover:border-ink hover:text-ink"
          >
            <Upload size={18} strokeWidth={1.4} />
            <span className="text-[11px]">{importFile ? importFile.name : '点击选择 Excel 文件'}</span>
            <span className="mono text-[8.5px] tracking-widest">XLS / XLSX</span>
          </button>
          <label className="flex items-center gap-2 border border-line px-3 py-2">
            <input type="checkbox" className="check" checked={importCover} onChange={(event) => setImportCover(event.target.checked)} />
            <span className="text-[11px] text-ink-3">覆盖同名用户</span>
          </label>
          <div className="mono border border-line bg-paper-2/40 px-3 py-2 text-[8.5px] leading-relaxed tracking-wider text-mute">
            模板包含用户名、昵称、密码、邮箱、手机号、席位等列。请先下载模板填写后再上传。
          </div>
        </div>
      </Modal>
    </div>
  )
}
