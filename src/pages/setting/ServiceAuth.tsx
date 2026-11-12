import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Copy, Download, KeyRound, RefreshCw, ShieldCheck, ShieldOff, Timer, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { ServiceItem, ServiceList } from '@/types'
import { toast } from '@/stores/toast'
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
import { DataTable, type Column } from '@/components/DataTable'
import { cn } from '@/lib/utils'

interface ServiceAuthInfo {
  serviceId?: string
  auth?: boolean | number
  authType?: number | null
  authTime?: number | null
  authInterval?: number | null
  authCode?: string | null
}

interface AuthService extends ServiceItem {
  serviceAuth?: ServiceAuthInfo | null
}

const intervals = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 365, label: '365 天' },
]

function nameOf(service: AuthService) {
  return service.nameUs || service.nameFr
}

export default function ServiceAuthPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [codeOpen, setCodeOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [intervalOpen, setIntervalOpen] = useState<AuthService | null>(null)
  const [intervalValue, setIntervalValue] = useState(30)
  const [selected, setSelected] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [results, setResults] = useState<Array<{ serviceId?: string; result?: boolean }>>([])

  const query = useQuery({
    queryKey: ['service-auth'],
    queryFn: () => api.get<ServiceList>('/v1/service/serviceAuth', { page: 1, size: 200 }),
    refetchInterval: 60_000,
  })

  const services = (query.data?.services ?? []) as AuthService[]

  const authorized = useMemo(
    () => services.filter((service) => Number(service.serviceAuth?.auth) === 1),
    [services],
  )

  const generateMutation = useMutation({
    mutationFn: () => api.post<string>('/auth/gene_identifier', { serviceIdList: selected }),
    onSuccess: (data) => {
      setCode(typeof data === 'string' ? data : JSON.stringify(data))
      toast.success('机器码已生成')
    },
    onError: (error) => toast.error('生成失败', errorMessage(error)),
  })

  const adminAuthMutation = useMutation({
    mutationFn: (names: string) =>
      api.post<Array<{ serviceId?: string; result?: boolean }>>('/auth/admin/auth', undefined, {
        serviceIdList: names,
      }),
    onSuccess: (data) => {
      const failed = (data ?? []).filter((item) => !item.result).map((item) => item.serviceId)
      if (failed.length) toast.warn('部分服务授权失败', failed.join(', '))
      else toast.success('授权已生效')
      queryClient.invalidateQueries({ queryKey: ['service-auth'] })
    },
    onError: (error) => toast.error('授权失败', errorMessage(error)),
  })

  const cancelMutation = useMutation({
    mutationFn: (name: string) => api.post('/auth/cancelAuth', [name]),
    onSuccess: () => {
      toast.success('授权已取消')
      queryClient.invalidateQueries({ queryKey: ['service-auth'] })
    },
    onError: (error) => toast.error('取消失败', errorMessage(error)),
  })

  const intervalMutation = useMutation({
    mutationFn: () => {
      if (!intervalOpen) throw new Error('未选择服务')
      return api.post('/auth/updateAuthInfo', {
        serviceId: nameOf(intervalOpen),
        auth: true,
        authType: 2,
        authInterval: intervalValue,
      })
    },
    onSuccess: () => {
      toast.success('授权周期已更新')
      setIntervalOpen(null)
      queryClient.invalidateQueries({ queryKey: ['service-auth'] })
    },
    onError: (error) => toast.error('更新失败', errorMessage(error)),
  })

  const importMutation = useMutation({
    mutationFn: () => api.post<Array<{ serviceId?: string; result?: boolean }>>('/v1/pub/authing', { authToken: token.trim() }),
    onSuccess: (data) => {
      setResults(data ?? [])
      const ok = (data ?? []).filter((item) => item.result).length
      if (ok) toast.success(`授权导入成功：${ok} 个服务`)
      else toast.warn('授权未匹配到服务')
      queryClient.invalidateQueries({ queryKey: ['service-auth'] })
    },
    onError: (error) => toast.error('导入失败', errorMessage(error)),
  })

  async function cancelAuth(service: AuthService) {
    const ok = await confirm({
      title: `取消「${nameOf(service)}」的服务授权？`,
      description: '取消后该服务将受授权策略限制，可能需要重新导入授权码。',
      danger: true,
      confirmText: '取消授权',
    })
    if (ok) cancelMutation.mutate(nameOf(service))
  }

  const columns: Array<Column<AuthService>> = [
    {
      key: 'name',
      header: '服务 / SERVICE',
      sortValue: (row) => nameOf(row),
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <StatusDot tone={Number(row.serviceAuth?.auth) === 1 ? 'ok' : 'warn'} />
          <div>
            <div className="font-mono text-[11px] text-ink">{nameOf(row)}</div>
            <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">
              {row.deployment?.status?.readyReplicas ?? 0}/{row.deployment?.spec?.replicas ?? 0} REPLICAS
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'auth',
      header: '授权状态',
      cell: (row) => {
        const info = row.serviceAuth
        const ok = Number(info?.auth) === 1
        return <Badge tone={ok ? 'ok' : 'warn'}>{ok ? 'AUTHORIZED' : 'UNAUTHORIZED'}</Badge>
      },
    },
    {
      key: 'type',
      header: '授权类型',
      cell: (row) => {
        const info = row.serviceAuth
        if (Number(info?.auth) !== 1) return <span className="text-[10.5px] text-mute">—</span>
        if (info?.authType === 2) return <Badge tone="info">周期 · {info.authInterval || 0} 天</Badge>
        return <Badge tone="info">管理员授权</Badge>
      },
    },
    {
      key: 'expire',
      header: '授权时间',
      sortValue: (row) => row.serviceAuth?.authTime ?? 0,
      cell: (row) => (
        <span className="mono text-[9.5px] text-ink-3">{row.serviceAuth?.authTime ? formatDate(row.serviceAuth.authTime) : '—'}</span>
      ),
    },
    {
      key: 'code',
      header: '授权码',
      cell: (row) => {
        const value = row.serviceAuth?.authCode
        if (!value) return <span className="text-mute">—</span>
        return (
          <button
            className="mono flex items-center gap-1 text-[8.5px] tracking-wider text-ink-3 hover:text-signal"
            onClick={() => {
              navigator.clipboard?.writeText(value)
              toast.success('授权码已复制')
            }}
          >
            {value.slice(0, 18)}… <Copy size={9} />
          </button>
        )
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <ActionMenu
          items={[
            {
              label: '管理员授权',
              icon: <ShieldCheck size={12} />,
              onSelect: () => adminAuthMutation.mutate(nameOf(row)),
            },
            { label: '设置授权周期', icon: <Timer size={12} />, onSelect: () => setIntervalOpen(row) },
            {
              label: '取消授权',
              danger: true,
              icon: <ShieldOff size={12} />,
              disabled: Number(row.serviceAuth?.auth) !== 1,
              onSelect: () => cancelAuth(row),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="09 / 02"
        en="PLATFORM · SERVICE AUTHORIZATION"
        title="服务授权"
        description="为业务服务签发与导入授权。机器码用于离线申请授权文件，授权码可批量导入并绑定服务。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {authorized.length}/{services.length} AUTHORIZED
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">LICENSE / SERVICE</span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              loading={query.isFetching}
              onClick={() => query.refetch()}
            >
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setCode('')
                setSelected(services.filter((s) => Number(s.serviceAuth?.auth) !== 1).map(nameOf))
                setCodeOpen(true)
              }}
            >
              <KeyRound size={11} /> 生成机器码
            </Button>
            <Button
              size="sm"
              variant="signal"
              onClick={() => {
                setToken('')
                setResults([])
                setImportOpen(true)
              }}
            >
              <Upload size={11} /> 导入授权码
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ['服务总数', services.length, 'SERVICES'],
          ['已授权', authorized.length, 'AUTHORIZED'],
          ['未授权', services.length - authorized.length, 'PENDING'],
          ['周期授权', services.filter((s) => s.serviceAuth?.authType === 2).length, 'INTERVAL'],
        ].map(([label, value, hint]) => (
          <Panel key={label} bodyClassName="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[28px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </Panel>
        ))}
      </div>

      <Panel kicker="SERVICE LICENSE" title="授权清单" bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={services}
          rowKey={(row) => nameOf(row)}
          loading={query.isLoading}
          pageSize={12}
          emptyTitle="暂无服务"
          emptyDescription="创建服务后可在此签发授权。"
        />
      </Panel>

      <Modal
        open={codeOpen}
        onOpenChange={setCodeOpen}
        kicker="LICENSE / MACHINE CODE"
        title="生成机器码"
        description="选择需要授权的服务，平台将生成包含机器标识的申请码，用于离线申请授权文件。"
        width={620}
        footer={
          <>
            <Button size="sm" onClick={() => setCodeOpen(false)}>
              关闭
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!selected.length}
              loading={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
            >
              <BadgeCheck size={11} /> 生成
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="max-h-[180px] overflow-y-auto border border-line">
            {services.map((service) => {
              const name = nameOf(service)
              const checked = selected.includes(name)
              return (
                <button
                  key={name}
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
                    )
                  }
                  className={cn(
                    'flex w-full items-center gap-2 border-b border-line/60 px-3 py-2 text-left last:border-0',
                    checked ? 'bg-ink text-paper' : 'hover:bg-paper-2/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 items-center justify-center border',
                      checked ? 'border-signal bg-signal' : 'border-line-strong',
                    )}
                  >
                    {checked && <span className="h-1.5 w-1.5 bg-paper" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{name}</span>
                  <span className={cn('mono text-[8px]', checked ? 'text-[#a9b0b3]' : 'text-mute')}>
                    {Number(service.serviceAuth?.auth) === 1 ? 'AUTHORIZED' : 'PENDING'}
                  </span>
                </button>
              )
            })}
          </div>
          {code && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="label">机器码</span>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(code)
                      toast.success('机器码已复制')
                    }}
                  >
                    <Copy size={10} /> 复制
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
                      const url = URL.createObjectURL(blob)
                      const link = document.createElement('a')
                      link.href = url
                      link.download = `${window.location.hostname}-service-code.txt`
                      link.click()
                      URL.revokeObjectURL(url)
                    }}
                  >
                    <Download size={10} /> 下载
                  </Button>
                </div>
              </div>
              <textarea
                readOnly
                className="field h-[110px] resize-none font-mono text-[10px] leading-relaxed"
                value={code}
              />
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onOpenChange={setImportOpen}
        kicker="LICENSE / IMPORT"
        title="导入授权码"
        description="粘贴授权文件内容，平台将校验签名并绑定到对应服务。"
        width={560}
        footer={
          <>
            <Button size="sm" onClick={() => setImportOpen(false)}>
              关闭
            </Button>
            <Button
              size="sm"
              variant="signal"
              disabled={!token.trim()}
              loading={importMutation.isPending}
              onClick={() => importMutation.mutate()}
            >
              <Upload size={11} /> 导入
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="授权码" required>
            <textarea
              className="field h-[150px] resize-none font-mono text-[10px] leading-relaxed"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="粘贴授权码"
            />
          </Field>
          {results.length > 0 && (
            <div className="border border-line">
              <div className="label border-b border-line bg-paper-2/40 px-3 py-1.5">导入结果</div>
              <div className="max-h-[140px] overflow-y-auto">
                {results.map((item) => (
                  <div key={item.serviceId} className="flex items-center justify-between border-b border-line/60 px-3 py-1.5 last:border-0">
                    <span className="mono text-[10px] text-ink">{item.serviceId || '—'}</span>
                    <Badge tone={item.result ? 'ok' : 'bad'}>{item.result ? 'SUCCESS' : 'FAILED'}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!intervalOpen}
        onOpenChange={(open) => {
          if (!open) setIntervalOpen(null)
        }}
        kicker="LICENSE / INTERVAL"
        title={`设置授权周期 · ${intervalOpen ? nameOf(intervalOpen) : ''}`}
        description="周期授权到期后服务将受授权策略限制，需重新签发。"
        width={420}
        footer={
          <>
            <Button size="sm" onClick={() => setIntervalOpen(null)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={intervalMutation.isPending} onClick={() => intervalMutation.mutate()}>
              保存
            </Button>
          </>
        }
      >
        <Field label="授权周期">
          <select className="field" value={intervalValue} onChange={(event) => setIntervalValue(Number(event.target.value))}>
            {intervals.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
      </Modal>
    </div>
  )
}
