import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArrowLeftRight, DatabaseBackup, Download, FileClock, RefreshCw, RotateCcw, Settings2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, API_BASE, errorMessage } from '@/lib/api'
import { formatBytes, formatDate, relativeTime } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
import type { BackupItem, SyncStatus } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import { PasswordPrompt } from '@/components/PasswordPrompt'
import {
  Badge,
  Button,
  Field,
  KV,
  Meter,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  TabStrip,
  useConfirm,
} from '@/components/ui'
import { cn } from '@/lib/utils'

interface FileItem {
  name?: string
  fileName?: string
  size?: number
  path?: string
  createTime?: string
  updatedAt?: number
}

const syncDataOptions = [
  { key: 'role', label: '席位数据', desc: '角色、菜单与授权关系' },
  { key: 'user', label: '用户数据', desc: '账户、密码与席位绑定' },
  { key: 'software', label: '软件数据', desc: '应用注册信息与图标' },
]

export default function BackupSyncPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const user = useAuthStore((state) => state.user)
  const mode = location.pathname.includes('/sync') ? 'sync' : 'backup'
  const [syncMode, setSyncMode] = useState(0)
  const [selectedData, setSelectedData] = useState<string[]>(['role', 'user', 'software'])
  const [baseUrl, setBaseUrl] = useState('')
  const [logType, setLogType] = useState<'backup' | 'recovery' | null>(null)
  const [settingOpen, setSettingOpen] = useState(false)
  const [restoreRow, setRestoreRow] = useState<BackupItem | null>(null)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [pwdAction, setPwdAction] = useState<{ type: 'reset-all' } | { type: 'reset-single'; key: string } | null>(null)
  const restoreRef = useRef<HTMLInputElement | null>(null)

  const logsQuery = useQuery({
    queryKey: ['backup-logs', logType],
    queryFn: () =>
      api.get<{ list?: Array<{ content?: string; message?: string; time?: string; createTime?: string }> }>(
        logType === 'backup' ? '/v1/backup/backupLogs' : '/v1/backup/recoveryLogs',
      ),
    enabled: !!logType,
  })

  const settingsQuery = useQuery({
    queryKey: ['backup-settings'],
    queryFn: () =>
      api.get<{ list?: Array<{ id?: number; databaseName: string; type?: number }> }>('/v1/backup/backupSetting', {
        page: 1,
        size: 100,
      }),
    enabled: settingOpen,
  })

  const changeSettingMutation = useMutation({
    mutationFn: (payload: { name: string; type: number }) =>
      api.post('/v1/backup/changeSetting', undefined, payload),
    onSuccess: () => {
      toast.success('备份结构已更新')
      queryClient.invalidateQueries({ queryKey: ['backup-settings'] })
    },
    onError: (error) => toast.error('设置失败', errorMessage(error)),
  })

  const singleResetMutation = useMutation({
    mutationFn: (key: string) => api.post('/v1/backup/singleReset', undefined, { key }),
    onSuccess: () => {
      toast.success('重置任务已提交', '该数据对象的归档将被清除')
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (error) => toast.error('重置失败', errorMessage(error)),
  })

  const cancelBackupMutation = useMutation({
    mutationFn: () => api.post('/v1/backup/delete'),
    onSuccess: () => {
      toast.success('一键备份已取消')
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (error) => toast.error('取消失败', errorMessage(error)),
  })

  const backupQuery = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<{ list: BackupItem[]; total: number }>('/v1/backup/list', { page: 1, size: 100 }),
    enabled: mode === 'backup',
  })
  const filesQuery = useQuery({
    queryKey: ['backup-files'],
    queryFn: () => api.get<{ list: FileItem[]; total: number }>('/v1/backup/backFileList', { page: 1, size: 100 }),
    enabled: mode === 'backup',
  })
  const syncStatusQuery = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get<SyncStatus>('/v1/sync/status'),
    refetchInterval: 3000,
    enabled: mode === 'sync',
  })
  const syncUrlQuery = useQuery({
    queryKey: ['sync-url'],
    queryFn: () => api.get<string | null>('/v1/sync/base_url'),
    enabled: mode === 'sync',
  })

  const backups = backupQuery.data?.list ?? []
  const files = filesQuery.data?.list ?? []
  const syncStatus = syncStatusQuery.data
  const effectiveUrl = baseUrl || (typeof syncUrlQuery.data === 'string' ? syncUrlQuery.data : '')

  const backupMutation = useMutation({
    mutationFn: () => api.post('/v1/backup'),
    onSuccess: () => {
      toast.success('备份任务已提交', '平台将在后台生成数据归档')
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (error) => toast.error('备份失败', errorMessage(error)),
  })

  const backupOneMutation = useMutation({
    mutationFn: (key: string) => {
      const baseKeys = ['user', 'role', 'software']
      const path = baseKeys.includes(key) ? '/v1/backup/singleBaseData' : '/v1/backup/singleService'
      return api.post(path, undefined, { key })
    },
    onSuccess: () => {
      toast.success('单表备份已提交')
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (error) => toast.error('备份失败', errorMessage(error)),
  })

  const resetMutation = useMutation({
    mutationFn: () => api.post('/v1/backup/reset'),
    onSuccess: () => toast.success('重置任务已提交'),
    onError: (error) => toast.error('重置失败', errorMessage(error)),
  })

  async function exportData(row: BackupItem) {
    const token = useAuthStore.getState().token
    try {
      const response = await fetch(`${API_BASE}/v1/backup/singleDownload`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { token } : {}) },
        body: JSON.stringify({ dataKey: row.databaseKey }),
      })
      if (!response.ok) throw new Error(`导出失败 (${response.status})`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${row.databaseName || row.databaseKey}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('数据已导出', row.databaseName || row.databaseKey)
    } catch (error) {
      toast.error('导出失败', errorMessage(error))
    }
  }

  async function restoreData() {
    if (!restoreRow) return
    const key = restoreRow.databaseKey
    const token = useAuthStore.getState().token
    setRestoring(true)
    try {
      if (key === 'database') {
        await api.post('/v1/backup/singleService', undefined, { key })
      } else if (key === 'image') {
        if (!restoreFile) throw new Error('请选择镜像包文件')
        const formData = new FormData()
        formData.append('file', restoreFile)
        const storage = restoreFile.name.includes('_') ? restoreFile.name.split('_')[0] : 'gaop'
        const response = await fetch(
          `${API_BASE}/v1/image/upload?storage=${encodeURIComponent(storage)}&username=${encodeURIComponent(user?.username || 'admin')}&type=2`,
          { method: 'POST', credentials: 'include', headers: token ? { token } : undefined, body: formData },
        )
        if (!response.ok) throw new Error(`还原失败 (${response.status})`)
      } else {
        if (!restoreFile) throw new Error('请选择备份文件')
        const formData = new FormData()
        formData.append('file', restoreFile)
        const path =
          key === 'user'
            ? '/v1/user/import?isCover=true'
            : key === 'role'
              ? '/v1/role/import?isCover=true'
              : key === 'sub_role'
                ? '/v1/sub_role/import?isCover=true'
                : key === 'configmap'
                  ? '/v1/config_map/import'
                  : '/v1/pub/import'
        const response = await fetch(`${API_BASE}${path}`, {
          method: 'POST',
          credentials: 'include',
          headers: token ? { token } : undefined,
          body: formData,
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok || (payload && typeof payload === 'object' && 'code' in payload && Number(payload.code) !== 0)) {
          throw new Error((payload && 'msg' in payload ? String(payload.msg) : '') || `还原失败 (${response.status})`)
        }
      }
      toast.success('数据还原完成', restoreRow.databaseName)
      setRestoreRow(null)
      setRestoreFile(null)
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (error) {
      toast.error('还原失败', errorMessage(error))
    } finally {
      setRestoring(false)
    }
  }

  const syncMutation = useMutation({
    mutationFn: () =>
      api.post('/v1/sync', {
        baseUrl: effectiveUrl.trim(),
        sync: syncMode,
        data: selectedData,
        userName: user?.username || 'admin',
      }),
    onSuccess: () => {
      toast.success('同步任务已启动', '进度将实时刷新')
      syncStatusQuery.refetch()
    },
    onError: (error) => toast.error('同步失败', errorMessage(error)),
  })

  const urlMutation = useMutation({
    mutationFn: () => api.put('/v1/sync/base_url', undefined, { baseUrl: effectiveUrl.trim() }),
    onSuccess: () => {
      toast.success('同步地址已保存')
      queryClient.invalidateQueries({ queryKey: ['sync-url'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const backupColumns: Array<Column<BackupItem>> = [
    {
      key: 'name',
      header: '数据对象',
      cell: (row) => (
        <div>
          <div className="text-[11.5px] text-ink">{row.databaseName}</div>
          <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.databaseKey}</div>
        </div>
      ),
    },
    {
      key: 'file',
      header: '归档文件',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.databaseFilename || '—'}</span>,
    },
    {
      key: 'size',
      header: '大小',
      align: 'right',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{formatBytes(row.size)}</span>,
    },
    {
      key: 'time',
      header: '最近备份',
      sortValue: (row) => row.createdAt ?? 0,
      cell: (row) => (
        <div>
          <div className="mono text-[10px] text-ink-3">{formatDate(row.createdAt)}</div>
          <div className="mono mt-0.5 text-[8px] text-mute">{relativeTime(row.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" onClick={() => backupOneMutation.mutate(row.databaseKey)} loading={backupOneMutation.isPending}>
            备份
          </Button>
          <Button size="sm" onClick={() => exportData(row)}>
            <Download size={10} /> 导出
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setRestoreFile(null)
              setRestoreRow(row)
            }}
          >
            还原
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={singleResetMutation.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `重置「${row.databaseName}」？`,
                description: '该数据对象的归档文件与备份状态将被清除，操作不可撤销。',
                confirmText: '确认重置',
                danger: true,
              })
              if (ok) setPwdAction({ type: 'reset-single', key: row.databaseKey })
            }}
          >
            重置
          </Button>
        </div>
      ),
    },
  ]

  async function oneClickBackup() {
    const ok = await confirm({
      title: '执行一键备份？',
      description: '平台将备份基础数据与业务数据库，期间可能产生额外磁盘 IO。',
      confirmText: '开始备份',
    })
    if (ok) backupMutation.mutate()
  }

  async function resetAll() {
    const ok = await confirm({
      title: '执行一键重置？',
      description: '重置将回滚平台数据到初始状态，可能导致用户、席位与软件数据丢失。请在维护窗口内操作。',
      confirmText: '确认重置',
      danger: true,
    })
    if (ok) setPwdAction({ type: 'reset-all' })
  }

  return (
    <div>
      <PageHeader
        index={mode === 'backup' ? '04 / 04' : '04 / 05'}
        en={mode === 'backup' ? 'OPERATIONS · BACKUP' : 'OPERATIONS · DATA SYNC'}
        title="备份与同步"
        description={
          mode === 'backup'
            ? '按数据对象生成平台归档。备份文件保存在服务器本地，可用于迁移与灾难恢复。'
            : '在主备平台之间同步席位、用户与软件配置。镜像同步由后台任务执行，进度实时回传。'
        }
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={syncStatus?.syncing ? 'warn' : 'ok'} pulse={!!syncStatus?.syncing} />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {mode === 'backup' ? `${backups.length} DATA OBJECTS` : syncStatus?.syncing ? 'SYNC IN PROGRESS' : 'SYNC IDLE'}
              </span>
            </span>
            {mode === 'sync' && (
              <span className="mono text-[9.5px] tracking-widest text-mute">
                LAST {syncStatus?.success ? 'SUCCESS' : syncStatus?.errorStatus ? 'FAILED' : 'N/A'}
              </span>
            )}
          </>
        }
        actions={
          mode === 'backup' ? (
            <>
              <Button size="sm" onClick={() => setLogType('backup')}>
                <FileClock size={11} /> 备份日志
              </Button>
              <Button size="sm" onClick={() => setLogType('recovery')}>
                <FileClock size={11} /> 还原日志
              </Button>
              <Button size="sm" onClick={async () => {
                for (const row of backups) {
                  await exportData(row)
                }
              }}>
                <Download size={11} /> 一键导出
              </Button>
              <Button size="sm" onClick={() => setSettingOpen(true)}>
                <Settings2 size={11} /> 备份设置
              </Button>
              <Button
                size="sm"
                loading={cancelBackupMutation.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: '取消一键备份？',
                    description: '正在执行或已提交的一键备份任务将被取消，已生成的归档不会被删除。',
                    confirmText: '取消备份',
                    danger: true,
                  })
                  if (ok) cancelBackupMutation.mutate()
                }}
              >
                取消备份
              </Button>
              <Button size="sm" onClick={resetAll} loading={resetMutation.isPending}>
                <RotateCcw size={11} /> 一键重置
              </Button>
              <Button size="sm" variant="signal" onClick={oneClickBackup} loading={backupMutation.isPending}>
                <DatabaseBackup size={11} /> 一键备份
              </Button>
            </>
          ) : (
            <Button size="sm" loading={syncStatusQuery.isFetching} onClick={() => syncStatusQuery.refetch()}>
              <RefreshCw size={11} /> 刷新状态
            </Button>
          )
        }
      />

      <div className="mb-4">
        <TabStrip
          value={mode}
          onChange={(value) => navigate(value === 'backup' ? '/ops/Backup-sync/backup' : '/ops/Backup-sync/sync')}
          tabs={[
            { value: 'backup', label: '数据备份' },
            { value: 'sync', label: '数据同步' },
          ]}
        />
      </div>

      {mode === 'backup' ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-8" kicker="BACKUP OBJECTS" title="备份对象" bodyClassName="p-0">
            <DataTable
              columns={backupColumns}
              rows={backups}
              rowKey={(row) => String(row.id)}
              loading={backupQuery.isLoading}
              pageSize={8}
              emptyTitle="暂无备份对象"
              emptyDescription="平台尚未初始化备份数据对象。"
            />
          </Panel>
          <div className="flex flex-col gap-4 xl:col-span-4">
            <Panel kicker="ARCHIVE" title="服务器归档">
              <div className="flex items-center justify-between">
                <div>
                  <div className="label">归档文件</div>
                  <div className="num mt-1 text-[28px] text-ink">{files.length}</div>
                </div>
                <Archive size={24} strokeWidth={1.2} className="text-mute" />
              </div>
              <div className="mt-3 space-y-2">
                {files.slice(0, 5).map((file, index) => (
                  <div key={index} className="flex items-center justify-between border-t border-line pt-2">
                    <span className="mono truncate text-[9.5px] text-ink-3">{file.fileName || file.name || file.path}</span>
                    <span className="mono text-[9px] text-mute">{formatBytes(file.size)}</span>
                  </div>
                ))}
                {files.length === 0 && <div className="py-3 text-[10.5px] text-mute">服务器暂无归档文件</div>}
              </div>
            </Panel>
            <Panel kicker="NOTICE" title="操作须知">
              <ul className="space-y-2 text-[10.5px] leading-relaxed text-ink-3">
                <li className="flex gap-2">
                  <span className="mt-1 h-1 w-1 flex-none bg-signal" />
                  一键备份会覆盖同名归档文件，请确认磁盘余量。
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-1 w-1 flex-none bg-signal" />
                  一键重置属于高危操作，仅建议在交付初始化阶段使用。
                </li>
                <li className="flex gap-2">
                  <span className="mt-1 h-1 w-1 flex-none bg-signal" />
                  备份期间避免变更席位与软件配置。
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-7" kicker="SYNC CONFIG" title="同步配置">
            <div className="space-y-5">
              <Field label="对端同步地址" hint="主备平台间需要网络可达，且对端已开启同步接口。">
                <div className="flex gap-2">
                  <input
                    className="field"
                    placeholder="http://172.16.209.171"
                    value={effectiveUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                  />
                  <Button size="sm" onClick={() => urlMutation.mutate()} loading={urlMutation.isPending} disabled={!effectiveUrl.trim()}>
                    保存
                  </Button>
                </div>
              </Field>

              <div>
                <div className="label-ink mb-2">同步模式</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 0, label: '增量同步', desc: '仅同步对端缺失的数据' },
                    { value: 1, label: '覆盖同步', desc: '以本端数据覆盖对端' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setSyncMode(option.value)}
                      className={cn(
                        'border px-3 py-2.5 text-left transition-colors',
                        syncMode === option.value
                          ? 'border-signal bg-signal text-white'
                          : 'border-line-strong hover:border-signal',
                      )}
                    >
                      <div className="text-[11.5px] font-medium">{option.label}</div>
                      <div className={cn('mt-1 text-[9.5px]', syncMode === option.value ? 'text-white/70' : 'text-mute')}>
                        {option.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="label-ink mb-2">同步数据</div>
                <div className="space-y-2">
                  {syncDataOptions.map((option) => {
                    const checked = selectedData.includes(option.key)
                    return (
                      <label
                        key={option.key}
                        className="flex cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2.5 transition-colors hover:border-signal"
                      >
                        <input
                          type="checkbox"
                          className="check"
                          checked={checked}
                          onChange={() =>
                            setSelectedData((prev) =>
                              checked ? prev.filter((item) => item !== option.key) : [...prev, option.key],
                            )
                          }
                        />
                        <div className="flex-1">
                          <div className="text-[11.5px] text-ink">{option.label}</div>
                          <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{option.desc}</div>
                        </div>
                        <Badge>{option.key}</Badge>
                      </label>
                    )
                  })}
                </div>
              </div>

              <Button
                variant="signal"
                className="w-full justify-between"
                disabled={!effectiveUrl.trim() || selectedData.length === 0 || syncStatus?.syncing}
                loading={syncMutation.isPending}
                onClick={() => syncMutation.mutate()}
              >
                <span>{syncStatus?.syncing ? '同步进行中' : '启动同步任务'}</span>
                <ArrowLeftRight size={13} />
              </Button>
            </div>
          </Panel>

          <div className="flex flex-col gap-4 xl:col-span-5">
            <Panel kicker="SYNC STATUS" title="任务状态">
              <div className="flex items-center gap-3">
                <StatusDot tone={syncStatus?.syncing ? 'warn' : syncStatus?.success ? 'ok' : 'idle'} pulse={!!syncStatus?.syncing} />
                <span className="text-[12px] text-ink">
                  {syncStatus?.syncing ? '正在同步' : syncStatus?.success ? '上次同步成功' : '空闲'}
                </span>
                <span className="mono ml-auto text-[9px] text-mute">
                  {syncStatus?.current ?? 0} / {syncStatus?.total ?? 0}
                </span>
              </div>
              <div className="mt-3">
                <Meter
                  value={syncStatus?.total ? ((syncStatus.current ?? 0) / syncStatus.total) * 100 : 0}
                  tone={syncStatus?.errorStatus ? 'bad' : 'ok'}
                />
              </div>
              <div className="mt-4">
                <KV k="当前对象" v={syncStatus?.currentSyncName || '—'} />
                <KV k="同步类型" v={syncStatus?.currentSyncType || '—'} />
                <KV k="错误信息" v={syncStatus?.errorStatus || '无'} />
                <KV k="操作人" v={user?.username || '—'} />
              </div>
            </Panel>
            <Panel kicker="TOPOLOGY" title="主备链路">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 border border-line px-3 py-3">
                  <div className="label">本端 PRIMARY</div>
                  <div className="mono mt-1 text-[10px] text-ink">
                    {(import.meta.env.VITE_PLATFORM_HOST as string) || '172.16.209.170'}
                  </div>
                </div>
                <ArrowLeftRight size={14} className="flex-none text-signal" />
                <div className="flex-1 border border-line px-3 py-3">
                  <div className="label">对端 STANDBY</div>
                  <div className="mono mt-1 truncate text-[10px] text-ink">{effectiveUrl || '未配置'}</div>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      <Modal
        open={!!logType}
        onOpenChange={(open) => !open && setLogType(null)}
        kicker={logType === 'backup' ? 'BACKUP / LOGS' : 'RECOVERY / LOGS'}
        title={logType === 'backup' ? '备份日志' : '还原日志'}
        description="日志由平台备份服务实时写入，仅展示最近的任务记录。"
        width={720}
        footer={
          <Button size="sm" onClick={() => setLogType(null)}>
            关闭
          </Button>
        }
      >
        <div className="max-h-[420px] overflow-y-auto border border-line">
          {(logsQuery.data?.list ?? []).map((item, index) => (
            <div key={index} className="grid grid-cols-[140px_1fr] gap-2 border-b border-line/60 px-3 py-2 last:border-b-0">
              <span className="mono text-[9px] text-mute">{formatDate(item.time || item.createTime)}</span>
              <span className="text-[10.5px] leading-relaxed text-ink-3">{item.content || item.message || '—'}</span>
            </div>
          ))}
          {(logsQuery.data?.list ?? []).length === 0 && (
            <div className="px-3 py-10 text-center text-[11px] text-mute">
              {logsQuery.isLoading ? '正在读取日志…' : '暂无日志记录'}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={settingOpen}
        onOpenChange={setSettingOpen}
        kicker="BACKUP / SETTINGS"
        title="业务数据库备份结构"
        description="按数据库设置归档内容。仅结构适用于迁移表定义，数据结构与数据适用于完整恢复。"
        width={620}
        footer={
          <>
            <Button size="sm" loading={settingsQuery.isFetching} onClick={() => settingsQuery.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button size="sm" onClick={() => setSettingOpen(false)}>
              关闭
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {(settingsQuery.data?.list ?? []).map((item) => (
            <div key={item.databaseName} className="flex items-center justify-between gap-3 border border-line px-3 py-2">
              <span className="mono truncate text-[11px] text-ink">{item.databaseName}</span>
              <select
                className="field h-8 w-[190px] flex-none"
                value={String(item.type ?? 1)}
                disabled={changeSettingMutation.isPending}
                onChange={(event) =>
                  changeSettingMutation.mutate({ name: item.databaseName, type: Number(event.target.value) })
                }
              >
                <option value="0">仅数据结构</option>
                <option value="1">数据结构与数据</option>
              </select>
            </div>
          ))}
          {(settingsQuery.data?.list ?? []).length === 0 && (
            <div className="border border-dashed border-line-strong px-3 py-10 text-center text-[11px] text-mute">
              {settingsQuery.isLoading ? '正在读取备份设置…' : '暂无业务数据库备份设置'}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!restoreRow}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreRow(null)
            setRestoreFile(null)
          }
        }}
        kicker="BACKUP / RESTORE"
        title={restoreRow ? `还原 · ${restoreRow.databaseName}` : '数据还原'}
        description={
          restoreRow?.databaseKey === 'database'
            ? '将从平台最近一次备份归档还原业务数据库。还原期间业务写入可能短暂中断。'
            : '上传该数据对象的备份文件，平台将按数据对象类型执行导入还原。'
        }
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setRestoreRow(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={restoring}
              disabled={restoreRow?.databaseKey !== 'database' && !restoreFile}
              onClick={restoreData}
            >
              开始还原
            </Button>
          </>
        }
      >
        {restoreRow?.databaseKey === 'database' ? (
          <div className="border-l-2 border-signal bg-signal/[0.05] px-3 py-2 text-[10.5px] leading-relaxed text-ink-3">
            还原会覆盖当前业务数据库内容。请确认已完成必要的数据导出，并在维护窗口内执行。
          </div>
        ) : (
          <div className="space-y-3">
            <input
              ref={restoreRef}
              type="file"
              accept=".xls,.xlsx,.json,.zip,.tar,.gz"
              className="hidden"
              onChange={(event) => {
                setRestoreFile(event.target.files?.[0] ?? null)
                event.target.value = ''
              }}
            />
            <button
              onClick={() => restoreRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-8 text-mute hover:border-signal hover:text-signal"
            >
              <Upload size={18} strokeWidth={1.4} />
              <span className="text-[11px]">{restoreFile ? restoreFile.name : '点击选择备份文件'}</span>
              <span className="mono text-[8.5px] tracking-widest">EXCEL / JSON / ARCHIVE</span>
            </button>
            <div className="mono border border-line bg-paper-2/40 px-3 py-2 text-[8.5px] leading-relaxed tracking-wider text-mute">
              用户、席位、子角色使用 Excel 备份文件；应用与配置组使用 JSON；镜像使用 tar 包。还原将覆盖同名数据。
            </div>
          </div>
        )}
      </Modal>

      <PasswordPrompt
        open={!!pwdAction}
        type={1}
        title={pwdAction?.type === 'reset-all' ? '验证密码 · 一键重置' : '验证密码 · 重置数据对象'}
        description="重置操作将清除备份归档并回滚数据，请输入管理员密码后继续。"
        onOpenChange={(open) => {
          if (!open) setPwdAction(null)
        }}
        onSuccess={() => {
          if (pwdAction?.type === 'reset-all') resetMutation.mutate()
          else if (pwdAction?.type === 'reset-single') singleResetMutation.mutate(pwdAction.key)
          setPwdAction(null)
        }}
      />
    </div>
  )
}
