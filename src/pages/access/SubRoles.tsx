import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileDown, Plus, RefreshCw, Search, Upload, UserRound, Users2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { toast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import type { UserListItem } from '@/types'
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

interface SubRole {
  id: string
  key: string
  name: string
  nameUs?: string | null
  nameFr?: string | null
  desc?: string | null
  userList?: Array<{ userId?: string; id?: string; username?: string; nickname?: string }> | null
  createdAt?: number
  updatedAt?: number
}

interface SubRolePage {
  list: SubRole[]
  total: number
}

const emptyForm = {
  key: '',
  name: '',
  nameUs: '',
  nameFr: '',
  desc: '',
  userIds: [] as string[],
}

function memberName(user: { username?: string | null; nickname?: string | null }) {
  return user.nickname || user.username || '—'
}

export default function SubRolesPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SubRole | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [userKeyword, setUserKeyword] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importCover, setImportCover] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement | null>(null)

  const query = useQuery({
    queryKey: ['sub-roles', page],
    queryFn: () =>
      api.get<SubRolePage>('/v1/sub_role/switchRole', {
        page,
        size: 100,
      }),
    refetchInterval: 60_000,
  })
  const usersQuery = useQuery({
    queryKey: ['sub-role-users'],
    queryFn: () => api.get<{ list: UserListItem[]; total: number }>('/v1/user/info', { page: 1, size: 200 }),
    enabled: formOpen,
  })

  const roles = query.data?.list ?? []
  const users = usersQuery.data?.list ?? []

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    if (!text) return roles
    return roles.filter((role) =>
      [role.name, role.key, role.nameUs, role.nameFr].some((value) => (value || '').toLowerCase().includes(text)),
    )
  }, [roles, keyword])

  const visibleUsers = useMemo(() => {
    const text = userKeyword.trim().toLowerCase()
    if (!text) return users
    return users.filter((user) =>
      [user.username, user.nickname].some((value) => (value || '').toLowerCase().includes(text)),
    )
  }, [users, userKeyword])

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        key: form.key.trim(),
        name: form.name.trim(),
        nameUs: form.nameUs.trim(),
        nameFr: form.nameFr.trim(),
        desc: form.desc.trim(),
        userList: form.userIds,
      }
      if (editing) return api.put('/v1/sub_role/update', { id: editing.id, ...payload })
      return api.post('/v1/sub_role', payload)
    },
    onSuccess: () => {
      toast.success(editing ? '子角色已更新' : '子角色已创建')
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm)
      queryClient.invalidateQueries({ queryKey: ['sub-roles'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.del('/v1/sub_role/delete', { subRoleIdList: [id] }),
    onSuccess: () => {
      toast.success('子角色已删除')
      queryClient.invalidateQueries({ queryKey: ['sub-roles'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setUserKeyword('')
    setFormOpen(true)
  }

  function openEdit(role: SubRole) {
    setEditing(role)
    setForm({
      key: role.key,
      name: role.name,
      nameUs: role.nameUs || '',
      nameFr: role.nameFr || '',
      desc: role.desc || '',
      userIds: (role.userList ?? []).map((user) => user.userId || user.id || '').filter(Boolean),
    })
    setUserKeyword('')
    setFormOpen(true)
  }

  async function remove(role: SubRole) {
    const ok = await confirm({
      title: `删除子角色「${role.name}」？`,
      description: '删除后绑定该子角色的用户将失去对应权限，需重新分配。',
      danger: true,
      confirmText: '删除子角色',
    })
    if (ok) deleteMutation.mutate(role.id)
  }

  function toggleUser(userId: string) {
    setForm((current) => ({
      ...current,
      userIds: current.userIds.includes(userId)
        ? current.userIds.filter((id) => id !== userId)
        : [...current.userIds, userId],
    }))
  }

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

  function exportSubRoles() {
    if (roles.length === 0) {
      toast.error('暂无子角色可导出')
      return
    }
    downloadFile('/v1/sub_role/export', 'subroles.xls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roles.map((role) => role.id)),
    })
  }

  function downloadTemplate() {
    downloadFile('/v1/sub_role/import/template', 'subrole-import-template.xls')
  }

  async function importSubRoles() {
    if (!importFile) return
    const formData = new FormData()
    formData.append('file', importFile)
    const token = useAuthStore.getState().token
    setImporting(true)
    try {
      const response = await fetch(`${API_BASE}/v1/sub_role/import?isCover=${importCover}`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { token } : undefined,
        body: formData,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `导入失败 (${response.status})`)
      }
      toast.success('子角色导入成功')
      setImportOpen(false)
      setImportFile(null)
      setImportCover(false)
      queryClient.invalidateQueries({ queryKey: ['sub-roles'] })
    } catch (error) {
      toast.error('导入失败', errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  const columns: Array<Column<SubRole>> = [
    {
      key: 'name',
      header: '子角色 / SUB ROLE',
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <StatusDot tone="ok" />
          <div>
            <div className="text-[12px] font-medium text-ink">{row.name}</div>
            <div className="mono mt-0.5 text-[8.5px] tracking-widest text-mute">KEY / {row.key}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'i18n',
      header: '英文 / 法文',
      cell: (row) => (
        <div className="space-y-1">
          <div className="mono text-[10px] text-ink-3">{row.nameUs || '—'}</div>
          <div className="mono text-[9px] text-mute">{row.nameFr || '—'}</div>
        </div>
      ),
    },
    {
      key: 'members',
      header: '成员',
      cell: (row) => {
        const members = row.userList ?? []
        if (members.length === 0) return <span className="text-[10.5px] text-mute">—</span>
        return (
          <div className="flex flex-wrap items-center gap-1">
            {members.slice(0, 3).map((user, index) => (
              <Badge key={`${memberName(user)}-${index}`}>{memberName(user)}</Badge>
            ))}
            {members.length > 3 && <span className="mono text-[9px] text-mute">+{members.length - 3}</span>}
          </div>
        )
      },
    },
    {
      key: 'desc',
      header: '描述',
      cell: (row) => <span className="line-clamp-2 block max-w-[280px] text-[10.5px] leading-relaxed text-ink-3">{row.desc || '—'}</span>,
    },
    {
      key: 'updated',
      header: '更新时间',
      sortValue: (row) => row.updatedAt ?? row.createdAt ?? 0,
      cell: (row) => <span className="mono text-[9.5px] text-mute">{formatDate(row.updatedAt ?? row.createdAt, false)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <ActionMenu
          items={[
            { label: '编辑子角色', onSelect: () => openEdit(row) },
            { label: '删除子角色', danger: true, disabled: row.key === 'global-role', onSelect: () => remove(row) },
          ]}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="07 / 03"
        en="ACCESS · SUB ROLES"
        title="子角色"
        description="子角色是可复用的权限集合，可同时分配给多个席位成员。用于在席位内部细粒度划分职责。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {roles.length} SUB ROLES · {query.data?.total ?? 0} TOTAL
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">ROLE CHAIN / USER → SEAT → SUB ROLE</span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" variant="signal" onClick={openCreate}>
              <Plus size={11} /> 新建子角色
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Upload size={11} /> 导入子角色
            </Button>
            <Button size="sm" onClick={exportSubRoles}>
              <Download size={11} /> 导出子角色
            </Button>
            <Button size="sm" onClick={downloadTemplate}>
              <FileDown size={11} /> 下载模板
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ['子角色', roles.length, 'SUB ROLES'],
          ['成员关联', new Set(roles.flatMap((role) => (role.userList ?? []).map(memberName))).size, 'MEMBERS'],
          ['有成员角色', roles.filter((role) => (role.userList ?? []).length > 0).length, 'ASSIGNED'],
          ['空置角色', roles.filter((role) => (role.userList ?? []).length === 0).length, 'UNASSIGNED'],
        ].map(([label, value, hint]) => (
          <Panel key={label} bodyClassName="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[28px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </Panel>
        ))}
      </div>

      <Panel
        kicker="SUB ROLE INVENTORY"
        title="子角色清单"
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-1.5 border border-line-strong bg-paper px-2">
            <Search size={11} className="text-mute" />
            <input
              className="h-7 w-40 bg-transparent font-mono text-[10px] text-ink outline-none placeholder:text-mute"
              placeholder="搜索名称 / 标识"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id || row.key}
          loading={query.isLoading}
          pageSize={12}
          emptyTitle="尚未创建子角色"
          emptyDescription="创建子角色后，可在席位编辑中把子角色分配给用户。"
          emptyAction={
            <Button size="sm" variant="signal" onClick={openCreate}>
              <Plus size={11} /> 新建子角色
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
        kicker={editing ? 'ACCESS / EDIT SUB ROLE' : 'ACCESS / NEW SUB ROLE'}
        title={editing ? `编辑子角色 · ${editing.name}` : '新建子角色'}
        description="唯一标识用于权限校验，创建后不可修改。成员可多选，保存后立即生效。"
        width={620}
        footer={
          <>
            <Button size="sm" onClick={() => setFormOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={saveMutation.isPending}
              disabled={!form.key.trim() || !form.name.trim()}
              onClick={() => saveMutation.mutate()}
            >
              {editing ? '保存修改' : '创建子角色'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="唯一标识" required hint="创建后不可修改">
            <input
              className="field font-mono"
              value={form.key}
              disabled={!!editing}
              onChange={(event) => setForm({ ...form, key: event.target.value })}
              placeholder="field-operator"
            />
          </Field>
          <Field label="名称" required>
            <input
              className="field"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="外业操作员"
            />
          </Field>
          <Field label="英文名称">
            <input
              className="field"
              value={form.nameUs}
              onChange={(event) => setForm({ ...form, nameUs: event.target.value })}
              placeholder="Field Operator"
            />
          </Field>
          <Field label="法文名称">
            <input
              className="field"
              value={form.nameFr}
              onChange={(event) => setForm({ ...form, nameFr: event.target.value })}
              placeholder="Opérateur"
            />
          </Field>
          <Field label="描述" className="sm:col-span-2">
            <textarea
              className="field min-h-[64px] resize-y"
              value={form.desc}
              onChange={(event) => setForm({ ...form, desc: event.target.value })}
              placeholder="该子角色的职责与权限范围"
            />
          </Field>
        </div>

        <div className="mt-4 border border-line">
          <div className="flex items-center justify-between border-b border-line bg-paper-2/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <Users2 size={12} className="text-mute" />
              <span className="label">成员</span>
              <Badge tone="info">{form.userIds.length} SELECTED</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Search size={10} className="text-mute" />
              <input
                className="h-6 w-36 bg-transparent font-mono text-[10px] text-ink outline-none placeholder:text-mute"
                placeholder="搜索用户"
                value={userKeyword}
                onChange={(event) => setUserKeyword(event.target.value)}
              />
            </div>
          </div>
          <div className="grid max-h-[220px] grid-cols-1 overflow-y-auto sm:grid-cols-2">
            {visibleUsers.map((user) => {
              const checked = form.userIds.includes(user.id)
              return (
                <button
                  key={user.id}
                  onClick={() => toggleUser(user.id)}
                  className={cn(
                    'flex items-center gap-2 border-b border-line/60 px-3 py-2 text-left transition-colors',
                    checked ? 'bg-signal text-white' : 'hover:bg-paper-2/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 flex-none items-center justify-center border',
                      checked ? 'border-signal bg-signal' : 'border-line-strong',
                    )}
                  >
                    {checked && <span className="h-1.5 w-1.5 bg-paper" />}
                  </span>
                  <UserRound size={11} className={checked ? 'text-white/70' : 'text-mute'} />
                  <span className="min-w-0 flex-1 truncate text-[11px]">{memberName(user)}</span>
                  <span className={cn('mono text-[8px]', checked ? 'text-white/70' : 'text-mute')}>{user.username}</span>
                </button>
              )
            })}
            {visibleUsers.length === 0 && (
              <div className="col-span-2 px-3 py-6 text-center text-[10.5px] text-mute">
                {usersQuery.isLoading ? '正在读取用户…' : '没有匹配的用户'}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="mono text-[8px] tracking-widest text-mute">USER LIST / V1.USER.INFO</span>
            <button
              className="mono text-[8px] tracking-widest text-ink-3 hover:text-signal"
              onClick={() => setForm((current) => ({ ...current, userIds: [] }))}
            >
              清空选择
            </button>
          </div>
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
        kicker="ACCESS / IMPORT SUB ROLES"
        title="导入子角色"
        description="上传子角色 Excel 模板。默认跳过同名子角色，开启覆盖后同名子角色将被模板内容更新。"
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={importing} disabled={!importFile} onClick={importSubRoles}>
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
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-8 text-mute hover:border-signal hover:text-signal"
          >
            <Upload size={18} strokeWidth={1.4} />
            <span className="text-[11px]">{importFile ? importFile.name : '点击选择 Excel 文件'}</span>
            <span className="mono text-[8.5px] tracking-widest">XLS / XLSX</span>
          </button>
          <label className="flex items-center gap-2 border border-line px-3 py-2">
            <input type="checkbox" className="check" checked={importCover} onChange={(event) => setImportCover(event.target.checked)} />
            <span className="text-[11px] text-ink-3">覆盖同名子角色</span>
          </label>
          <div className="mono border border-line bg-paper-2/40 px-3 py-2 text-[8.5px] leading-relaxed tracking-wider text-mute">
            模板包含子角色名称、唯一标识、描述等列。请先下载模板填写后再上传。
          </div>
        </div>
      </Modal>
    </div>
  )
}
