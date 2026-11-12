import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Database, Download, FileUp, KeyRound, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
import type { DatabaseItem } from '@/types'
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

interface DbUser {
  id?: number
  username: string
  desc?: string | null
  updatedAt?: number
  createdAt?: number
}

interface SqlLog {
  id?: number
  userName?: string
  username?: string
  sql?: string
  statement?: string
  databaseName?: string
  executeTime?: number
  createdAt?: number
  time?: number
}

interface TableSizeItem {
  name: string
  size?: number
  children?: Array<{ name: string; size?: number }>
}

function toList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object' && Array.isArray((data as { list?: T[] }).list)) {
    return (data as { list: T[] }).list
  }
  return []
}

export default function DatabasePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const tab = location.pathname.includes('user-info')
    ? 'users'
    : location.pathname.includes('sql-log')
      ? 'sql'
      : location.pathname.includes('table-size')
        ? 'tables'
        : 'databases'

  const [dbOpen, setDbOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [dbForm, setDbForm] = useState({ dataBaseName: '', service: '', desc: '', userName: '' })
  const [userForm, setUserForm] = useState({ username: '', password: '', desc: '' })
  const [grantDb, setGrantDb] = useState('')
  const [grantUser, setGrantUser] = useState('')
  const [maintOpen, setMaintOpen] = useState(false)
  const [maintDb, setMaintDb] = useState('')
  const [maintFile, setMaintFile] = useState<File | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  const [backupSel, setBackupSel] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)
  const maintFileRef = useRef<HTMLInputElement | null>(null)

  const dbQuery = useQuery({
    queryKey: ['databases'],
    queryFn: async () => {
      const data = await api.get<{ databaseItemList?: DatabaseItem[]; total?: number }>('/v1/database', {
        page: 1,
        size: 100,
      })
      if (Array.isArray(data)) return data as DatabaseItem[]
      return data?.databaseItemList ?? []
    },
  })
  const dbUserQuery = useQuery({
    queryKey: ['db-users'],
    queryFn: async () => {
      const data = await api.get<{ databaseUsers?: DbUser[]; total?: number }>('/v1/database/user', {
        page: 1,
        size: 200,
      })
      if (Array.isArray(data)) return data as DbUser[]
      return data?.databaseUsers ?? []
    },
  })
  const sqlQuery = useQuery({
    queryKey: ['sql-logs'],
    queryFn: async () => toList<SqlLog>(await api.get('/v1/database_record', { page: 1, size: 100 })),
  })
  const tableSizeQuery = useQuery({
    queryKey: ['database-table-size'],
    queryFn: () => api.get<TableSizeItem[]>('/v1/database/table_size'),
    enabled: tab === 'tables',
  })
  const dbAuthQuery = useQuery({
    queryKey: ['db-auth-users', grantDb],
    queryFn: () => api.get<string[]>('/v1/database/users', { databaseName: grantDb }),
    enabled: !!grantDb,
  })

  const databases = dbQuery.data ?? []
  const dbUsers = dbUserQuery.data ?? []
  const sqlLogs = sqlQuery.data ?? []
  const authorizedUsers = Array.isArray(dbAuthQuery.data) ? dbAuthQuery.data : []

  const backupTableQuery = useQuery({
    queryKey: ['database-table-size', 'backup'],
    queryFn: () => api.get<TableSizeItem[]>('/v1/database/table_size'),
    enabled: backupOpen,
  })

  async function downloadFrom(path: string, params: Record<string, string> | undefined, filename: string) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : ''
    const response = await fetch(`${API_BASE}${path}${query}`, {
      headers: token ? { token } : undefined,
      credentials: 'include',
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
    toast.success('下载已开始', filename)
  }

  const snapshotMutation = useMutation({
    mutationFn: () => api.post('/v1/database/snapshot'),
    onSuccess: () => toast.success('数据库快照任务已提交', '快照完成后可在备份记录中查看'),
    onError: (error) => toast.error('快照失败', errorMessage(error)),
  })

  const backupDataMutation = useMutation({
    mutationFn: () => {
      if (backupSel.length === 0) throw new Error('请选择需要备份的数据库')
      const body = backupSel.map((name) => ({
        databaseName: name,
        tableNames: (backupTableQuery.data ?? []).find((item) => item.name === name)?.children?.map((child) => child.name) ?? [],
      }))
      return api.post('/v1/database/backup_db_data_sync', body)
    },
    onSuccess: () => {
      toast.success('业务数据备份已提交')
      setBackupOpen(false)
      setBackupSel([])
    },
    onError: (error) => toast.error('备份失败', errorMessage(error)),
  })

  const sqlFileMutation = useMutation({
    mutationFn: async (action: 'import' | 'update') => {
      if (!maintDb) throw new Error('未选择数据库')
      if (!maintFile) throw new Error('请选择 SQL 文件')
      const form = new FormData()
      form.append('file', maintFile)
      if (action === 'import') {
        form.append('userName', user?.username || 'admin')
      } else {
        form.append('databaseName', maintDb)
        form.append('userName', user?.username || 'admin')
      }
      const path =
        action === 'import'
          ? `/v1/database/${encodeURIComponent(maintDb)}/import`
          : '/v1/database/update'
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: token ? { token } : undefined,
        body: form,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
        throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `提交失败 (${response.status})`)
      }
      return action
    },
    onSuccess: (action) => {
      toast.success(action === 'import' ? 'SQL 文件已提交执行' : '初始化 SQL 文件已更新')
      setMaintFile(null)
      queryClient.invalidateQueries({ queryKey: ['databases'] })
      queryClient.invalidateQueries({ queryKey: ['sql-logs'] })
    },
    onError: (error) => toast.error('提交失败', errorMessage(error)),
  })

  const grantMutation = useMutation({
    mutationFn: (username: string) =>
      api.post('/v1/database/access_control', undefined, {
        accessUser: username,
        databaseName: grantDb,
      }),
    onSuccess: () => {
      toast.success('授权已生效')
      setGrantUser('')
      queryClient.invalidateQueries({ queryKey: ['db-auth-users', grantDb] })
    },
    onError: (error) => toast.error('授权失败', errorMessage(error)),
  })

  const revokeMutation = useMutation({
    mutationFn: (username: string) =>
      api.put('/v1/database/user/revoke_authorization', undefined, {
        databaseUser: username,
        databaseName: grantDb,
      }),
    onSuccess: () => {
      toast.success('授权已撤销')
      queryClient.invalidateQueries({ queryKey: ['db-auth-users', grantDb] })
    },
    onError: (error) => toast.error('撤销失败', errorMessage(error)),
  })

  const createDb = useMutation({
    mutationFn: async () => {
      const form = new FormData()
      form.append('dataBaseName', dbForm.dataBaseName.trim())
      form.append('service', dbForm.service.trim())
      form.append('desc', dbForm.desc.trim())
      form.append('userName', dbForm.userName.trim())
      const file = fileRef.current?.files?.[0]
      if (file) form.append('file', file)
      const base = (import.meta.env.VITE_API_BASE as string | undefined) || '/api/gaop'
      const response = await fetch(`${base}/v1/database`, {
        method: 'POST',
        headers: token ? { token } : undefined,
        body: form,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && payload.code !== 0)) {
        throw new Error(payload?.msg || '创建数据库失败')
      }
      return payload
    },
    onSuccess: () => {
      toast.success('数据库创建任务已提交')
      setDbOpen(false)
      setDbForm({ dataBaseName: '', service: '', desc: '', userName: '' })
      queryClient.invalidateQueries({ queryKey: ['databases'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  const deleteDb = useMutation({
    mutationFn: (name: string) => api.del('/v1/database', undefined, { dataBaseName: name }),
    onSuccess: () => {
      toast.success('数据库已删除')
      queryClient.invalidateQueries({ queryKey: ['databases'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const createUser = useMutation({
    mutationFn: () =>
      api.post('/v1/database/user', {
        username: userForm.username.trim(),
        password: userForm.password,
        desc: userForm.desc.trim(),
        updatedAt: Date.now(),
      }),
    onSuccess: () => {
      toast.success('数据库用户已创建')
      setUserOpen(false)
      setUserForm({ username: '', password: '', desc: '' })
      queryClient.invalidateQueries({ queryKey: ['db-users'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  const deleteUser = useMutation({
    mutationFn: (name: string) => api.del('/v1/database/user', undefined, { dataBaseUser: name }),
    onSuccess: () => {
      toast.success('数据库用户已删除')
      queryClient.invalidateQueries({ queryKey: ['db-users'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const dbColumns: Array<Column<DatabaseItem>> = [
    {
      key: 'name',
      header: '数据库 / DATABASE',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Database size={13} className="text-mute" />
          <div>
            <div className="font-mono text-[11.5px] text-ink">{row.name || row.dataBaseName || '—'}</div>
            <div className="mono mt-0.5 max-w-[240px] truncate text-[8.5px] tracking-wider text-mute">
              SERVICE / {row.service || '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'desc',
      header: '描述',
      cell: (row) => <span className="text-[11px] text-ink-3">{row.desc || '—'}</span>,
    },
    {
      key: 'tables',
      header: '表总数',
      align: 'right',
      cell: (row) => (
        <span className="mono text-[10px] text-ink-3">
          {row.tableCount ?? row.tableSize ?? '—'}
        </span>
      ),
    },
    {
      key: 'sql',
      header: '初始化 SQL',
      cell: (row) => (
        <span className="mono block max-w-[180px] truncate text-[9.5px] text-ink-3">{row.sqlName || '—'}</span>
      ),
    },
    {
      key: 'user',
      header: '最后操作人',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.userName || '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => {
        const name = row.name || row.dataBaseName || ''
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                setMaintDb(name)
                setMaintFile(null)
                setMaintOpen(true)
              }}
            >
              <Settings2 size={10} /> 维护
            </Button>
            <Button size="sm" onClick={() => setGrantDb(name)}>
              <KeyRound size={10} /> 授权
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                const ok = await confirm({
                  title: `删除数据库「${name}」？`,
                  description: '数据库删除后无法恢复，请提前完成数据备份。',
                  danger: true,
                  confirmText: '删除数据库',
                })
                if (ok) deleteDb.mutate(name)
              }}
            >
              <Trash2 size={10} /> 删除
            </Button>
          </div>
        )
      },
    },
  ]

  const userColumns: Array<Column<DbUser>> = [
    {
      key: 'username',
      header: '数据库用户',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <KeyRound size={12} className="text-mute" />
          <span className="font-mono text-[11px] text-ink">{row.username}</span>
        </div>
      ),
    },
    {
      key: 'desc',
      header: '描述',
      cell: (row) => <span className="text-[11px] text-ink-3">{row.desc || '—'}</span>,
    },
    {
      key: 'time',
      header: '更新时间',
      sortValue: (row) => row.updatedAt ?? 0,
      cell: (row) => <span className="mono text-[10px] text-ink-3">{formatDate(row.updatedAt ?? row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            const ok = await confirm({
              title: `删除数据库用户「${row.username}」？`,
              description: '删除后使用该账户的数据库连接将失效。',
              danger: true,
              confirmText: '删除用户',
            })
            if (ok) deleteUser.mutate(row.username)
          }}
        >
          <Trash2 size={10} /> 删除
        </Button>
      ),
    },
  ]

  const sqlColumns: Array<Column<SqlLog>> = [
    {
      key: 'time',
      header: '执行时间',
      sortValue: (row) => row.createdAt ?? row.time ?? 0,
      cell: (row) => <span className="mono text-[10px] text-ink-3">{formatDate(row.createdAt ?? row.time)}</span>,
    },
    {
      key: 'user',
      header: '用户',
      cell: (row) => <span className="mono text-[10px] text-ink">{row.userName || row.username || '—'}</span>,
    },
    {
      key: 'db',
      header: '数据库',
      cell: (row) => <Badge tone="info">{row.databaseName || '—'}</Badge>,
    },
    {
      key: 'sql',
      header: '语句',
      cell: (row) => (
        <span className="mono block max-w-[560px] truncate text-[10px] text-ink-3">{row.sql || row.statement || '—'}</span>
      ),
    },
    {
      key: 'cost',
      header: '耗时',
      align: 'right',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.executeTime ? `${row.executeTime} ms` : '—'}</span>,
    },
  ]

  const tabs = [
    { value: 'databases' as const, label: '数据库', count: databases.length },
    { value: 'users' as const, label: '数据库用户', count: dbUsers.length },
    { value: 'sql' as const, label: 'SQL 日志', count: sqlLogs.length },
    { value: 'tables' as const, label: '表容量', count: tableSizeQuery.data?.length },
  ]

  const tableSizes = tableSizeQuery.data ?? []
  const totalTableSize = tableSizes.reduce((acc, item) => acc + (item.size ?? 0), 0)

  return (
    <div>
      <PageHeader
        index={tab === 'databases' ? '08 / 01' : tab === 'users' ? '08 / 02' : tab === 'sql' ? '08 / 03' : '08 / 04'}
        en={
          tab === 'databases'
            ? 'DATABASE · INSTANCES'
            : tab === 'users'
              ? 'DATABASE · USERS'
              : tab === 'sql'
                ? 'DATABASE · SQL LOG'
                : 'DATABASE · TABLE SIZE'
        }
        title={tab === 'databases' ? '数据库' : tab === 'users' ? '数据库用户' : tab === 'sql' ? 'SQL 日志' : '表容量'}
        description={
          tab === 'databases'
            ? '管理平台内注册的业务数据库。支持从 SQL 文件初始化数据库，并查看表级容量信息。'
            : tab === 'users'
              ? '维护数据库连接账户。账户用于业务服务访问数据库，与平台登录账户相互独立。'
              : tab === 'sql'
                ? '查看数据库执行日志，用于慢查询排查与数据变更复核。'
                : '按数据库与数据表统计占用空间，用于容量规划与历史数据清理。'
        }
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {tab === 'databases'
                  ? `${databases.length} DATABASES`
                  : tab === 'users'
                    ? `${dbUsers.length} DB USERS`
                    : tab === 'sql'
                      ? `${sqlLogs.length} SQL EVENTS`
                      : `${tableSizes.length} DATABASES · ${totalTableSize.toFixed(2)} MB`}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">MYSQL / PLATFORM</span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              loading={
                tab === 'databases'
                  ? dbQuery.isFetching
                  : tab === 'users'
                    ? dbUserQuery.isFetching
                    : tab === 'sql'
                      ? sqlQuery.isFetching
                      : tableSizeQuery.isFetching
              }
              onClick={() =>
                tab === 'databases'
                  ? dbQuery.refetch()
                  : tab === 'users'
                    ? dbUserQuery.refetch()
                    : tab === 'sql'
                      ? sqlQuery.refetch()
                      : tableSizeQuery.refetch()
              }
            >
              <RefreshCw size={11} /> 刷新
            </Button>
            {tab === 'databases' && (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    setBackupSel([])
                    setBackupOpen(true)
                  }}
                >
                  <Archive size={11} /> 业务数据备份
                </Button>
                <Button size="sm" loading={snapshotMutation.isPending} onClick={() => snapshotMutation.mutate()}>
                  保存快照
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await downloadFrom('/v1/database/export_framework', undefined, 'framework-backup.sql')
                    } catch (error) {
                      toast.error('下载失败', errorMessage(error))
                    }
                  }}
                >
                  <Download size={11} /> 框架备份
                </Button>
                <Button size="sm" variant="signal" onClick={() => setDbOpen(true)}>
                  <Plus size={11} /> 创建数据库
                </Button>
              </>
            )}
            {tab === 'users' && (
              <Button size="sm" variant="signal" onClick={() => setUserOpen(true)}>
                <Plus size={11} /> 新建数据库用户
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
              value === 'databases'
                ? '/database-setting/database-info'
                : value === 'users'
                  ? '/database-setting/user-info'
                  : value === 'sql'
                    ? '/database-setting/sql-log'
                    : '/database-setting/table-size',
            )
          }
          tabs={tabs}
        />
      </div>

      <Panel bodyClassName="p-0">
        {tab === 'databases' && (
          <DataTable
            columns={dbColumns}
            rows={databases}
            rowKey={(row) => String(row.id ?? row.dataBaseName ?? row.name)}
            loading={dbQuery.isLoading}
            emptyTitle="暂无业务数据库"
            emptyDescription="创建数据库并上传初始化 SQL 文件，平台将自动完成建库与账号授权。"
            emptyAction={
              <Button size="sm" variant="signal" onClick={() => setDbOpen(true)}>
                <Plus size={11} /> 创建数据库
              </Button>
            }
          />
        )}
        {tab === 'users' && (
          <DataTable
            columns={userColumns}
            rows={dbUsers}
            rowKey={(row) => String(row.id ?? row.username)}
            loading={dbUserQuery.isLoading}
            emptyTitle="暂无数据库用户"
            emptyDescription="创建数据库账户后，业务服务可使用该账户连接数据库。"
            emptyAction={
              <Button size="sm" variant="signal" onClick={() => setUserOpen(true)}>
                <Plus size={11} /> 新建用户
              </Button>
            }
          />
        )}
        {tab === 'sql' && (
          <DataTable
            columns={sqlColumns}
            rows={sqlLogs}
            rowKey={(row) => String(row.id ?? `${row.createdAt}-${row.sql}`)}
            loading={sqlQuery.isLoading}
            emptyTitle="暂无 SQL 日志"
            emptyDescription="数据库尚未开启 SQL 审计，或当前周期内没有执行记录。"
          />
        )}
        {tab === 'tables' && (
          <div className="divide-y divide-line/70">
            {tableSizes.map((database) => {
              const children = database.children ?? []
              const max = Math.max(...children.map((item) => item.size ?? 0), 1)
              return (
                <div key={database.name}>
                  <div className="flex items-center justify-between gap-3 bg-paper-2/40 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Database size={12} className="text-mute" />
                      <span className="font-mono text-[11px] text-ink">{database.name}</span>
                      <Badge>{children.length} TABLES</Badge>
                    </div>
                    <span className="mono text-[10px] text-ink-3">{(database.size ?? 0).toFixed(2)} MB</span>
                  </div>
                  <div className="divide-y divide-line/50">
                    {children.map((table) => (
                      <div key={`${database.name}.${table.name}`} className="grid grid-cols-[1fr_120px_90px] items-center gap-3 px-4 py-1.5">
                        <span className="truncate font-mono text-[10px] text-ink-3">{table.name}</span>
                        <div className="h-[4px] bg-paper-2">
                          <div
                            className="h-full bg-signal"
                            style={{ width: `${Math.min(((table.size ?? 0) / max) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="mono text-right text-[9.5px] text-mute">{(table.size ?? 0).toFixed(2)} MB</span>
                      </div>
                    ))}
                    {children.length === 0 && (
                      <div className="px-4 py-2 text-[10px] text-mute">该数据库暂无数据表</div>
                    )}
                  </div>
                </div>
              )
            })}
            {tableSizes.length === 0 && (
              <div className="px-4 py-12 text-center text-[11px] text-mute">
                {tableSizeQuery.isLoading ? '正在统计表容量…' : '暂无表容量数据'}
              </div>
            )}
          </div>
        )}
      </Panel>

      <Modal
        open={dbOpen}
        onOpenChange={setDbOpen}
        kicker="DATABASE / CREATE"
        title="创建业务数据库"
        description="可上传 .sql 初始化文件。创建过程由平台编排，可能需要数十秒。"
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setDbOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!dbForm.dataBaseName.trim() || !dbForm.service.trim()}
              loading={createDb.isPending}
              onClick={() => createDb.mutate()}
            >
              提交创建
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="数据库名" required>
            <input
              className="field font-mono"
              value={dbForm.dataBaseName}
              onChange={(event) => setDbForm({ ...dbForm, dataBaseName: event.target.value })}
              placeholder="situation_map"
            />
          </Field>
          <Field label="所属服务" required>
            <input
              className="field"
              value={dbForm.service}
              onChange={(event) => setDbForm({ ...dbForm, service: event.target.value })}
              placeholder="gaop-mysql"
            />
          </Field>
          <Field label="描述" className="sm:col-span-2">
            <input
              className="field"
              value={dbForm.desc}
              onChange={(event) => setDbForm({ ...dbForm, desc: event.target.value })}
              placeholder="业务用途说明"
            />
          </Field>
          <Field label="初始化文件" className="sm:col-span-2" hint="可选，支持 .sql 文件">
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".sql" className="hidden" />
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <FileUp size={11} /> 选择文件
              </Button>
              <span className="mono text-[9.5px] text-mute">上传后自动执行初始化脚本</span>
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={userOpen}
        onOpenChange={setUserOpen}
        kicker="DATABASE / USER"
        title="新建数据库用户"
        description="该账户仅用于数据库连接，不影响平台登录。"
        width={440}
        footer={
          <>
            <Button size="sm" onClick={() => setUserOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!userForm.username.trim() || !userForm.password}
              loading={createUser.isPending}
              onClick={() => createUser.mutate()}
            >
              创建账户
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="账户名" required>
            <input
              className="field font-mono"
              value={userForm.username}
              onChange={(event) => setUserForm({ ...userForm, username: event.target.value })}
              placeholder="app_user"
            />
          </Field>
          <Field label="密码" required>
            <input
              className="field"
              type="password"
              value={userForm.password}
              onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
              placeholder="连接密码"
            />
          </Field>
          <Field label="描述">
            <input
              className="field"
              value={userForm.desc}
              onChange={(event) => setUserForm({ ...userForm, desc: event.target.value })}
              placeholder="用途说明"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!grantDb}
        onOpenChange={(open) => {
          if (!open) {
            setGrantDb('')
            setGrantUser('')
          }
        }}
        kicker="DATABASE / ACCESS CONTROL"
        title={`访问授权 · ${grantDb || '—'}`}
        description="授权后数据库用户可连接该库。撤销将立即中断对应连接权限。"
        width={520}
        footer={
          <Button size="sm" onClick={() => setGrantDb('')}>
            关闭
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="label mb-2">已授权用户</div>
            <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 border border-line bg-paper-2/40 px-3 py-2">
              {authorizedUsers.map((user) => (
                <span
                  key={user}
                  className="mono inline-flex items-center gap-1.5 border border-line-strong bg-paper px-2 py-1 text-[9.5px] text-ink"
                >
                  {user}
                  <button
                    className="text-mute transition-colors hover:text-signal"
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(user)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {authorizedUsers.length === 0 && (
                <span className="text-[10.5px] text-mute">
                  {dbAuthQuery.isLoading ? '正在读取授权…' : '该数据库尚未授权任何用户'}
                </span>
              )}
            </div>
          </div>

          <Field label="新增授权" hint="从数据库用户中选择，授权后立即生效">
            <div className="flex items-center gap-2">
              <select className="field flex-1" value={grantUser} onChange={(event) => setGrantUser(event.target.value)}>
                <option value="">选择数据库用户</option>
                {dbUsers
                  .filter((user) => !authorizedUsers.includes(user.username))
                  .map((user) => (
                    <option key={user.username} value={user.username}>
                      {user.username}
                      {user.desc ? ` · ${user.desc}` : ''}
                    </option>
                  ))}
              </select>
              <Button
                size="sm"
                variant="signal"
                disabled={!grantUser}
                loading={grantMutation.isPending}
                onClick={() => grantMutation.mutate(grantUser)}
              >
                授权
              </Button>
            </div>
          </Field>

          <div className="border border-line bg-paper-2/30 px-3 py-2">
            <div className="mono text-[8.5px] tracking-widest text-mute">
              DATABASE / {grantDb || '—'} · USERS / {authorizedUsers.length}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={maintOpen}
        onOpenChange={setMaintOpen}
        kicker="DATABASE / MAINTENANCE"
        title={maintDb ? `数据库维护 · ${maintDb}` : '数据库维护'}
        description="导出数据、下载或更新初始化 SQL，也可以直接上传 SQL 文件执行到当前数据库。"
        width={620}
        footer={
          <Button size="sm" onClick={() => setMaintOpen(false)}>
            关闭
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await downloadFrom(
                    `/v1/database/export/${encodeURIComponent(maintDb)}`,
                    undefined,
                    `${maintDb}.sql`,
                  )
                } catch (error) {
                  toast.error('导出失败', errorMessage(error))
                }
              }}
            >
              <Download size={11} /> 导出数据库
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await downloadFrom('/v1/database/initSql/download', { databaseName: maintDb }, `${maintDb}-init.sql`)
                } catch (error) {
                  toast.error('下载失败', errorMessage(error))
                }
              }}
            >
              <FileUp size={11} /> 下载初始化 SQL
            </Button>
          </div>

          <div className="border border-line px-3 py-3">
            <div className="label mb-2">SQL 文件</div>
            <input
              ref={maintFileRef}
              type="file"
              accept=".sql"
              className="hidden"
              onChange={(event) => setMaintFile(event.target.files?.[0] ?? null)}
            />
            <button
              className="flex h-9 w-full items-center gap-2 rounded-md border border-line-strong px-3 text-left text-[12px] text-ink-3 transition-colors hover:border-signal"
              onClick={() => maintFileRef.current?.click()}
            >
              <FileUp size={12} className="text-mute" />
              <span className="truncate">{maintFile ? maintFile.name : '点击选择 SQL 文件'}</span>
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={!maintFile}
                loading={sqlFileMutation.isPending}
                onClick={() => sqlFileMutation.mutate('import')}
              >
                执行到数据库
              </Button>
              <Button
                size="sm"
                disabled={!maintFile}
                loading={sqlFileMutation.isPending}
                onClick={() => sqlFileMutation.mutate('update')}
              >
                更新初始化文件
              </Button>
            </div>
            <div className="mono mt-2 text-[8px] leading-relaxed tracking-wider text-mute">
              IMPORT 直接在当前库执行；UPDATE 仅替换数据库初始化 SQL，不执行导入。
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={backupOpen}
        onOpenChange={setBackupOpen}
        kicker="DATABASE / BUSINESS BACKUP"
        title="业务数据备份"
        description="选择需要备份的业务数据库，平台将导出表结构与数据，用于迁移或灾难恢复。"
        width={620}
        footer={
          <>
            <Button size="sm" onClick={() => setBackupOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={backupDataMutation.isPending}
              onClick={() => backupDataMutation.mutate()}
            >
              开始备份
            </Button>
          </>
        }
      >
        <div className="max-h-[420px] space-y-1.5 overflow-y-auto">
          {(backupTableQuery.data ?? []).map((item) => {
            const checked = backupSel.includes(item.name)
            return (
              <label
                key={item.name}
                className={`flex cursor-pointer items-center gap-3 border px-3 py-2 transition-colors ${
                  checked ? 'border-signal bg-signal/[0.04]' : 'border-line hover:border-line-strong'
                }`}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--color-signal)]"
                  checked={checked}
                  onChange={() =>
                    setBackupSel((prev) =>
                      prev.includes(item.name) ? prev.filter((name) => name !== item.name) : [...prev, item.name],
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-ink">{item.name}</div>
                  <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">
                    {item.children?.length ?? 0} TABLES · {item.size ?? 0} MB
                  </div>
                </div>
              </label>
            )
          })}
          {backupTableQuery.isLoading && (
            <div className="py-6 text-center text-[11px] text-mute">正在读取业务数据库…</div>
          )}
          {(backupTableQuery.data ?? []).length === 0 && !backupTableQuery.isLoading && (
            <div className="py-6 text-center text-[11px] text-mute">暂无可备份的业务数据库</div>
          )}
        </div>
      </Modal>
    </div>
  )
}
