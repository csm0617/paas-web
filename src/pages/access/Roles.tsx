import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileDown, KeyRound, Plus, RefreshCw, Shield, Trash2, Upload, Users2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { toast } from '@/stores/toast'
import { useAuthStore } from '@/stores/auth'
import type { RoleItem, Software, UserListItem } from '@/types'
import {
  ActionMenu,
  Badge,
  Button,
  Field,
  KV,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  useConfirm,
} from '@/components/ui'
import { cn } from '@/lib/utils'

export default function RolesPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const currentRole = useAuthStore((state) => state.role)
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<RoleItem | null>(null)
  const [form, setForm] = useState({ key: '', name: '', desc: '' })
  const [editRole, setEditRole] = useState<RoleItem | null>(null)
  const [editForm, setEditForm] = useState({ name: '', desc: '', softwareIds: [] as string[], userIds: [] as string[] })
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importCover, setImportCover] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement | null>(null)

  const query = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ list: RoleItem[]; total: number }>('/v1/role', { page: 1, size: 100 }),
  })
  const softwareQuery = useQuery({
    queryKey: ['role-edit-software'],
    queryFn: () =>
      api.get<{ softwareList: Software[]; total: number }>('/v1/software', { page: 1, size: 200 }),
    enabled: !!editRole,
  })
  const usersQuery = useQuery({
    queryKey: ['role-edit-users'],
    queryFn: () => api.get<{ list: UserListItem[]; total: number }>('/v1/user/info', { page: 1, size: 200 }),
    enabled: !!editRole,
  })

  const roles = query.data?.list ?? []

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/role', {
        key: form.key.trim(),
        name: form.name.trim(),
        desc: form.desc.trim(),
        type: 2,
        softwareList: [],
        userList: [],
        subRoleIdList: [],
      }),
    onSuccess: () => {
      toast.success('席位已创建')
      setCreateOpen(false)
      setForm({ key: '', name: '', desc: '' })
      queryClient.invalidateQueries({ queryKey: ['roles'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => api.del('/v1/role', undefined, { roleId }),
    onSuccess: () => {
      toast.success('席位已删除')
      queryClient.invalidateQueries({ queryKey: ['roles'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editRole) throw new Error('未选择席位')
      if (!editForm.name.trim()) throw new Error('席位名称不能为空')
      return api.put(`/v1/role/${editRole.id}`, {
        key: editRole.key,
        name: editForm.name.trim(),
        desc: editForm.desc.trim(),
        type: editRole.type ?? 2,
        softwareList: editForm.softwareIds,
        userList: editForm.userIds,
        subRoleIdList: (editRole.subRoleList ?? []).map((item) => item.id).filter(Boolean),
      })
    },
    onSuccess: () => {
      toast.success('席位权限已更新')
      setEditRole(null)
      queryClient.invalidateQueries({ queryKey: ['roles'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  function openEdit(role: RoleItem) {
    setEditRole(role)
    setEditForm({
      name: role.name,
      desc: role.desc || '',
      softwareIds: (role.softwareList ?? [])
        .map((item) => item.appId || (typeof item.id === 'string' ? item.id : ''))
        .filter(Boolean) as string[],
      userIds: (role.userList ?? []).map((user) => user.id).filter(Boolean),
    })
  }

  async function remove(role: RoleItem) {
    if (role.admin) {
      toast.warn('内置席位不可删除')
      return
    }
    const ok = await confirm({
      title: `删除席位「${role.name}」？`,
      description: '删除后绑定该席位的用户将失去对应权限，需重新分配席位。',
      danger: true,
      confirmText: '删除席位',
    })
    if (ok) deleteMutation.mutate(role.id)
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

  function exportRoles() {
    if (roles.length === 0) {
      toast.error('暂无席位可导出')
      return
    }
    downloadFile('/v1/role/backup', 'roles.xls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roles.map((role) => role.id)),
    })
  }

  function downloadTemplate() {
    downloadFile('/v1/role/import/template', 'role-import-template.xls')
  }

  async function importRoles() {
    if (!importFile) return
    const formData = new FormData()
    formData.append('file', importFile)
    const token = useAuthStore.getState().token
    setImporting(true)
    try {
      const response = await fetch(`${API_BASE}/v1/role/import?isCover=${importCover}`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { token } : undefined,
        body: formData,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `导入失败 (${response.status})`)
      }
      toast.success('席位导入成功')
      setImportOpen(false)
      setImportFile(null)
      setImportCover(false)
      queryClient.invalidateQueries({ queryKey: ['roles'] })
    } catch (error) {
      toast.error('导入失败', errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        index="07 / 02"
        en="ACCESS · SEATS & ROLES"
        title="席位与角色"
        description="席位是平台权限的载体，绑定应用、用户与子角色。一个账户可关联多个席位，登录时选择当前席位。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{roles.length} SEATS DEFINED</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">CURRENT / {currentRole?.name || '—'}</span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" variant="signal" onClick={() => setCreateOpen(true)}>
              <Plus size={11} /> 新建席位
            </Button>
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Upload size={11} /> 导入席位
            </Button>
            <Button size="sm" onClick={exportRoles}>
              <Download size={11} /> 导出席位
            </Button>
            <Button size="sm" onClick={downloadTemplate}>
              <FileDown size={11} /> 下载模板
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ['席位数', roles.length, 'TOTAL SEATS'],
          ['内置席位', roles.filter((role) => role.admin).length, 'BUILT-IN'],
          ['用户', new Set(roles.flatMap((role) => (role.userList ?? []).map((user) => user.username))).size, 'MEMBERS'],
          ['应用', new Set(roles.flatMap((role) => (role.softwareList ?? []).map((item) => item.appName))).size, 'APPLICATIONS'],
        ].map(([label, value, hint]) => (
          <Panel key={label} bodyClassName="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[28px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </Panel>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role, index) => {
          const isCurrent = role.key === currentRole?.key
          return (
            <article
              key={role.id || role.key}
              className={cn(
                'panel corner-marks group p-0 transition-transform hover:-translate-y-0.5',
                isCurrent && 'border-ink',
              )}
            >
              <div className="flex items-start gap-3 px-4 pt-3.5">
                <div className="flex h-9 w-9 flex-none items-center justify-center border border-line-strong bg-paper-2">
                  <Shield size={15} className={role.admin ? 'text-signal' : 'text-ink-3'} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[13px] font-semibold text-ink">{role.name}</h3>
                    {isCurrent && <Badge tone="info">CURRENT</Badge>}
                    {role.admin && <Badge tone="bad">ADMIN</Badge>}
                  </div>
                  <div className="mono mt-1 text-[8.5px] tracking-[0.14em] text-mute">KEY / {role.key}</div>
                </div>
                <ActionMenu
                  items={[
                    { label: '编辑席位权限', onSelect: () => openEdit(role) },
                    { label: '查看席位详情', onSelect: () => setDetail(role) },
                    { label: '删除席位', danger: true, disabled: role.admin, onSelect: () => remove(role) },
                  ]}
                />
              </div>
              <p className="mt-3 line-clamp-2 min-h-[32px] px-4 text-[11px] leading-relaxed text-ink-3">
                {role.desc || '该席位未填写描述。席位权限由关联应用与子角色共同决定。'}
              </p>
              <div className="mt-2 grid grid-cols-3 divide-x divide-line border-t border-line">
                <div className="px-4 py-2.5">
                  <div className="label">用户</div>
                  <div className="num mt-0.5 text-[16px] text-ink">{role.userList?.length ?? 0}</div>
                </div>
                <div className="px-4 py-2.5">
                  <div className="label">应用</div>
                  <div className="num mt-0.5 text-[16px] text-ink">{role.softwareList?.length ?? 0}</div>
                </div>
                <div className="px-4 py-2.5">
                  <div className="label">序号</div>
                  <div className="num mt-0.5 text-[16px] text-ink">{String(index + 1).padStart(2, '0')}</div>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line px-4 py-2">
                <span className="mono text-[8px] tracking-[0.14em] text-mute">
                  {role.type === 2 ? 'OPERATION SEAT' : role.type === 1 ? 'SYSTEM' : 'CUSTOM'}
                </span>
                <button
                  onClick={() => setDetail(role)}
                  className="mono flex items-center gap-1 text-[8.5px] tracking-widest text-ink-3 transition-colors hover:text-signal"
                >
                  权限明细 <KeyRound size={10} />
                </button>
              </div>
            </article>
          )
        })}
        {roles.length === 0 && !query.isLoading && (
          <Panel className="md:col-span-2 xl:col-span-3">
            <div className="flex flex-col items-center gap-2 py-12 text-mute">
              <Users2 size={26} strokeWidth={1.2} />
              <span className="text-[11.5px]">尚未创建席位</span>
            </div>
          </Panel>
        )}
      </div>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        kicker="ACCESS / NEW SEAT"
        title="新建席位"
        description="席位创建后需分配应用与用户。唯一标识用于权限校验，创建后不可修改。"
        width={480}
        footer={
          <>
            <Button size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!form.key.trim() || !form.name.trim()}
              loading={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              创建席位
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="席位名称" required>
            <input className="field" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="如：作战值班席" />
          </Field>
          <Field label="唯一标识" required hint="小写字母或数字，例如 duty-officer">
            <input
              className="field font-mono"
              value={form.key}
              onChange={(event) => setForm({ ...form, key: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              placeholder="duty-officer"
            />
          </Field>
          <Field label="席位描述">
            <textarea className="field" rows={3} value={form.desc} onChange={(event) => setForm({ ...form, desc: event.target.value })} placeholder="描述该席位的职责与权限范围" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!editRole}
        onOpenChange={(open) => !open && setEditRole(null)}
        kicker="ACCESS / EDIT SEAT"
        title={editRole ? `编辑「${editRole.name}」` : '编辑席位'}
        description="调整席位名称、描述及关联的应用与用户。保存后权限立即生效。"
        width={720}
        footer={
          <>
            <Button size="sm" onClick={() => setEditRole(null)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={editMutation.isPending} onClick={() => editMutation.mutate()}>
              保存权限
            </Button>
          </>
        }
      >
        {editRole && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="席位名称" required>
                <input
                  className="field"
                  value={editForm.name}
                  onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                />
              </Field>
              <Field label="唯一标识" hint="创建后不可修改">
                <input className="field font-mono" value={editRole.key} disabled />
              </Field>
              <Field label="描述" className="sm:col-span-2">
                <textarea
                  className="field"
                  rows={2}
                  value={editForm.desc}
                  onChange={(event) => setEditForm({ ...editForm, desc: event.target.value })}
                />
              </Field>
            </div>

            <div className="border-t border-line pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="label">关联应用</span>
                <span className="mono text-[8.5px] text-mute">{editForm.softwareIds.length} SELECTED</span>
              </div>
              <div className="grid max-h-[150px] grid-cols-1 gap-1 overflow-y-auto border border-line p-2 sm:grid-cols-2">
                {(softwareQuery.data?.softwareList ?? []).map((software) => {
                  const checked = editForm.softwareIds.includes(software.id)
                  return (
                    <label key={software.id} className="flex cursor-pointer items-center gap-2 px-1.5 py-1 hover:bg-paper-2/60">
                      <input
                        type="checkbox"
                        className="check"
                        checked={checked}
                        onChange={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            softwareIds: checked
                              ? prev.softwareIds.filter((id) => id !== software.id)
                              : [...prev.softwareIds, software.id],
                          }))
                        }
                      />
                      <span className="flex-1 truncate text-[11px] text-ink">{software.name}</span>
                      <span className="mono text-[8px] text-mute">{software.key}</span>
                    </label>
                  )
                })}
                {softwareQuery.isLoading && <div className="col-span-2 py-2 text-center text-[10px] text-mute">读取应用…</div>}
              </div>
            </div>

            <div className="border-t border-line pt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="label">席位用户</span>
                <span className="mono text-[8.5px] text-mute">{editForm.userIds.length} SELECTED</span>
              </div>
              <div className="grid max-h-[150px] grid-cols-1 gap-1 overflow-y-auto border border-line p-2 sm:grid-cols-2">
                {(usersQuery.data?.list ?? []).map((user) => {
                  const checked = editForm.userIds.includes(user.id)
                  return (
                    <label key={user.id} className="flex cursor-pointer items-center gap-2 px-1.5 py-1 hover:bg-paper-2/60">
                      <input
                        type="checkbox"
                        className="check"
                        checked={checked}
                        onChange={() =>
                          setEditForm((prev) => ({
                            ...prev,
                            userIds: checked
                              ? prev.userIds.filter((id) => id !== user.id)
                              : [...prev.userIds, user.id],
                          }))
                        }
                      />
                      <span className="flex-1 truncate text-[11px] text-ink">{user.nickname || user.username}</span>
                      <span className="mono text-[8px] text-mute">{user.username}</span>
                    </label>
                  )
                })}
                {usersQuery.isLoading && <div className="col-span-2 py-2 text-center text-[10px] text-mute">读取用户…</div>}
              </div>
            </div>

            <div className="border border-line bg-paper-2/40 px-3 py-2">
              <div className="label mb-1">权限提示</div>
              <p className="text-[10.5px] leading-relaxed text-ink-3">
                移除应用后，该席位下的用户将立即失去对应入口。子角色关联保持不变。
              </p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!detail}
        onOpenChange={(open) => !open && setDetail(null)}
        kicker="ACCESS / SEAT DETAIL"
        title={detail?.name || '席位详情'}
        description={detail ? `KEY / ${detail.key}` : undefined}
        width={600}
        footer={
          <Button size="sm" onClick={() => setDetail(null)}>
            关闭
          </Button>
        }
      >
        {detail && (
          <div className="space-y-4">
            <div>
              <div className="label mb-2">基本信息</div>
              <KV k="席位名称" v={detail.name} />
              <KV k="唯一标识" v={detail.key} />
              <KV k="类型" v={detail.admin ? '内置管理席' : '业务席位'} />
              <KV k="创建时间" v={formatDate(detail.createdAt)} />
              <KV k="描述" v={detail.desc || '—'} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="label mb-2">关联应用</div>
                <div className="flex flex-wrap gap-1.5">
                  {(detail.softwareList ?? []).map((software, index) => (
                    <Badge key={index} tone="info">
                      {software.appName || software.name || '—'}
                    </Badge>
                  ))}
                  {(detail.softwareList ?? []).length === 0 && <span className="text-[10.5px] text-mute">未关联应用</span>}
                </div>
              </div>
              <div>
                <div className="label mb-2">席内用户</div>
                <div className="flex flex-wrap gap-1.5">
                  {(detail.userList ?? []).map((user) => (
                    <Badge key={user.id}>{user.nickname || user.username}</Badge>
                  ))}
                  {(detail.userList ?? []).length === 0 && <span className="text-[10.5px] text-mute">暂无绑定用户</span>}
                </div>
              </div>
            </div>
          </div>
        )}
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
        kicker="ACCESS / IMPORT SEATS"
        title="导入席位"
        description="上传席位 Excel 模板。默认跳过同名席位，开启覆盖后同名席位将被模板内容更新。"
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={importing} disabled={!importFile} onClick={importRoles}>
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
            <span className="text-[11px] text-ink-3">覆盖同名席位</span>
          </label>
          <div className="mono border border-line bg-paper-2/40 px-3 py-2 text-[8.5px] leading-relaxed tracking-wider text-mute">
            模板包含席位名称、唯一标识、描述等列。请先下载模板填写后再上传。
          </div>
        </div>
      </Modal>
    </div>
  )
}
