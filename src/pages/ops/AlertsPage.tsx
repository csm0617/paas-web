import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { formatDate, relativeTime } from '@/lib/format'
import type { AlertRecord, AlertRule } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import {
  ActionMenu,
  Badge,
  Button,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  PageHeader,
  Panel,
  StatusDot,
  TabStrip,
  useConfirm,
} from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

interface Paged<T> {
  data: T[]
  total: number
  page?: number
  pageSize?: number
}

const alertTypes = [
  { value: 0, label: '资源告警' },
  { value: 1, label: '日志告警' },
]

const emptyForm = {
  strategyName: '',
  targetName: '',
  namespace: 'gaop-namespace',
  interval: '5m',
  metric: 'cpu',
  operator: '>',
  value: '85',
  alertType: 0,
}

export default function AlertsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const mode = location.pathname.includes('alert-record') ? 'records' : 'rules'
  const [alertType, setAlertType] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<AlertRule | null>(null)
  const [form, setForm] = useState(emptyForm)

  const rulesQuery = useQuery({
    queryKey: ['alert-rules', alertType],
    queryFn: () => api.get<Paged<AlertRule>>('/cloud/alert', { alertType, page: 1, pageSize: 100 }),
    enabled: mode === 'rules',
    refetchInterval: 60_000,
  })
  const recordsQuery = useQuery({
    queryKey: ['alert-records', alertType],
    queryFn: () => api.post<Paged<AlertRecord>>('/cloud/alert/record', { alertType, page: 1, pageSize: 100 }),
    enabled: mode === 'records',
    refetchInterval: 60_000,
  })

  const rules = rulesQuery.data?.data ?? []
  const records = recordsQuery.data?.data ?? []

  const toggleMutation = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: number }) =>
      api.put('/cloud/alert/enable', undefined, { strategyId: id, enable }),
    onSuccess: () => {
      toast.success('告警策略状态已更新')
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    },
    onError: (error) => toast.error('更新失败', errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del('/cloud/alert', [id], { alertType }),
    onSuccess: () => {
      toast.success('告警策略已删除')
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/cloud/alert', {
        strategyName: form.strategyName.trim(),
        namespace: form.namespace.trim(),
        targetName: form.targetName.trim(),
        interval: form.interval,
        alertType: form.alertType,
        enable: 1,
        alertRules: [{ metric: form.metric, operator: form.operator, value: String(form.value) }],
      }),
    onSuccess: () => {
      toast.success('告警策略已创建')
      setCreateOpen(false)
      setForm(emptyForm)
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    },
    onError: (error) => toast.error('创建失败', errorMessage(error)),
  })

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('未选择策略')
      const base = editing.alertRules ?? []
      const first = { ...(base[0] ?? {}), metric: form.metric, operator: form.operator, value: String(form.value) }
      return api.put('/cloud/alert', {
        id: editing.id,
        interval: form.interval,
        alertRules: [first, ...base.slice(1)],
      })
    },
    onSuccess: () => {
      toast.success('告警策略已更新')
      setEditing(null)
      setForm(emptyForm)
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  function openEdit(rule: AlertRule) {
    const first = rule.alertRules?.[0]
    const rawInterval = rule.interval === undefined || rule.interval === null ? '5m' : String(rule.interval)
    const interval = ['1m', '5m', '15m', '1h'].includes(rawInterval)
      ? rawInterval
      : rawInterval === '1'
        ? '1m'
        : rawInterval === '15'
          ? '15m'
          : rawInterval === '60'
            ? '1h'
            : '5m'
    setForm({
      strategyName: rule.strategyName || '',
      targetName: rule.targetName || '',
      namespace: rule.namespace || 'gaop-namespace',
      interval,
      metric: first?.metric || 'cpu',
      operator: first?.operator || '>',
      value: first?.value !== undefined ? String(first.value) : '85',
      alertType: rule.alertType ?? alertType,
    })
    setEditing(rule)
  }

  async function remove(rule: AlertRule) {
    const ok = await confirm({
      title: `删除策略「${rule.strategyName}」？`,
      description: '删除后该策略将不再产生新的告警记录，历史记录保留。',
      danger: true,
      confirmText: '删除策略',
    })
    if (ok) deleteMutation.mutate(rule.id)
  }

  const ruleColumns: Array<Column<AlertRule>> = [
    {
      key: 'name',
      header: '策略 / STRATEGY',
      sortValue: (row) => row.strategyName,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <StatusDot tone={Number(row.enable) === 1 ? 'ok' : 'idle'} />
          <div>
            <div className="text-[12px] font-medium text-ink">{row.strategyName}</div>
            <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.id || '—'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'target',
      header: '监控对象',
      cell: (row) => (
        <div>
          <div className="mono text-[10.5px] text-ink-3">{row.targetName || '全集群'}</div>
          <div className="mono mt-0.5 text-[8.5px] text-mute">{row.namespace || '—'}</div>
        </div>
      ),
    },
    {
      key: 'rules',
      header: '规则',
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {(row.alertRules ?? []).length === 0 && <span className="text-mute">—</span>}
          {(row.alertRules ?? []).slice(0, 3).map((rule, index) => (
            <Badge key={index} tone="info">
              {rule.metric || 'METRIC'} {rule.operator || '>'} {rule.value}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'interval',
      header: '周期',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.interval || '—'}</span>,
    },
    {
      key: 'enable',
      header: '启用',
      cell: (row) => {
        const enabled = Number(row.enable) === 1
        return (
          <button
            onClick={() => toggleMutation.mutate({ id: row.id, enable: enabled ? 0 : 1 })}
            className={cn(
              'relative h-[18px] w-9 border transition-colors',
              enabled ? 'border-signal bg-signal' : 'border-line-strong bg-transparent',
            )}
            aria-label={enabled ? '停用' : '启用'}
          >
            <span
              className={cn(
                'absolute top-[2px] h-[12px] w-[12px] transition-all',
                enabled ? 'left-[20px] bg-signal' : 'left-[2px] bg-line-strong',
              )}
            />
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
            { label: '编辑策略', onSelect: () => openEdit(row) },
            {
              label: Number(row.enable) === 1 ? '停用策略' : '启用策略',
              onSelect: () => toggleMutation.mutate({ id: row.id, enable: Number(row.enable) === 1 ? 0 : 1 }),
            },
            { label: '删除策略', danger: true, onSelect: () => remove(row), icon: <Trash2 size={12} /> },
          ]}
        />
      ),
    },
  ]

  const recordColumns: Array<Column<AlertRecord>> = [
    {
      key: 'strategy',
      header: '告警策略',
      cell: (row) => <span className="text-[11.5px] text-ink">{row.strategyName || '—'}</span>,
    },
    {
      key: 'target',
      header: '对象',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.targetName || '—'}</span>,
    },
    {
      key: 'metric',
      header: '指标',
      cell: (row) => (
        <Badge tone="info">
          {row.metric || '—'} {row.value !== undefined ? `= ${row.value}` : ''}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (row) => (
        <Badge tone={String(row.status) === '1' ? 'bad' : 'warn'}>
          {String(row.status) === '1' ? 'FIRING' : 'RESOLVED'}
        </Badge>
      ),
    },
    {
      key: 'time',
      header: '发生时间',
      sortValue: (row) => row.startTime ?? row.createdAt ?? 0,
      cell: (row) => (
        <div>
          <div className="mono text-[10px] text-ink-3">{formatDate(row.startTime ?? row.createdAt)}</div>
          <div className="mono mt-0.5 text-[8px] text-mute">{relativeTime(row.startTime ?? row.createdAt)}</div>
        </div>
      ),
    },
  ]

  const typeLabel = alertTypes.find((item) => item.value === alertType)?.label || '告警'

  return (
    <div>
      <PageHeader
        index={mode === 'rules' ? '04 / 02' : '04 / 03'}
        en={mode === 'rules' ? 'OPERATIONS · ALERT RULES' : 'OPERATIONS · ALERT RECORDS'}
        title={mode === 'rules' ? '告警策略' : '告警记录'}
        description={
          mode === 'rules'
            ? '为集群资源与日志设定阈值规则。策略启用后由平台巡检任务周期性评估，触发后写入告警记录。'
            : '按时间倒序查阅历史告警。告警用于值班交接与故障复盘，支持按资源/日志类型过滤。'
        }
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={mode === 'rules' ? 'ok' : records.length ? 'warn' : 'ok'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {mode === 'rules' ? `${rules.length} STRATEGIES` : `${records.length} RECORDS`}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">{typeLabel}</span>
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              loading={mode === 'rules' ? rulesQuery.isFetching : recordsQuery.isFetching}
              onClick={() => (mode === 'rules' ? rulesQuery.refetch() : recordsQuery.refetch())}
            >
              <RefreshCw size={11} /> 刷新
            </Button>
            {mode === 'rules' && (
              <Button size="sm" variant="signal" onClick={() => setCreateOpen(true)}>
                <Plus size={11} /> 新建策略
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line-strong">
        <TabStrip
          value={mode}
          onChange={(value) => navigate(value === 'rules' ? '/ops/alert-setting' : '/ops/alert-record')}
          tabs={[
            { value: 'rules', label: '告警策略', count: mode === 'rules' ? rules.length : undefined },
            { value: 'records', label: '告警记录', count: mode === 'records' ? records.length : undefined },
          ]}
        />
        <div className="mb-2 flex border border-line-strong">
          {alertTypes.map((type) => (
            <button
              key={type.value}
              onClick={() => setAlertType(type.value)}
              className={cn(
                'mono h-7 px-3 text-[9px] tracking-[0.14em] transition-colors',
                alertType === type.value ? 'bg-signal text-white' : 'text-ink-3 hover:bg-paper-2',
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      <Panel bodyClassName="p-0">
        {mode === 'rules' ? (
          <DataTable
            columns={ruleColumns}
            rows={rules}
            rowKey={(row) => row.id}
            loading={rulesQuery.isLoading}
            emptyTitle="尚未配置告警策略"
            emptyDescription="创建资源或日志阈值策略，平台将按周期自动巡检并在异常时记录告警。"
            emptyAction={
              <Button size="sm" variant="signal" onClick={() => setCreateOpen(true)}>
                <Plus size={11} /> 新建策略
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={recordColumns}
            rows={records}
            rowKey={(row) => row.id}
            loading={recordsQuery.isLoading}
            emptyTitle="暂无告警记录"
            emptyDescription="当前监控周期内没有触发任何告警，系统运行平稳。"
          />
        )}
      </Panel>

      <Modal
        open={createOpen || !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false)
            setEditing(null)
            setForm(emptyForm)
          } else {
            setCreateOpen(true)
          }
        }}
        kicker={editing ? 'ALERT / EDIT' : 'ALERT / CREATE'}
        title={editing ? `编辑告警策略 · ${editing.strategyName}` : '新建告警策略'}
        description="策略将按设定周期扫描目标对象，命中规则后生成告警记录。"
        width={560}
        footer={
          <>
            <Button
              size="sm"
              onClick={() => {
                setCreateOpen(false)
                setEditing(null)
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={editing ? editMutation.isPending : createMutation.isPending}
              disabled={!form.strategyName.trim() || !form.targetName.trim()}
              onClick={() => (editing ? editMutation.mutate() : createMutation.mutate())}
            >
              {editing ? '保存修改' : '创建策略'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="策略名称" required>
            <input
              className="field"
              value={form.strategyName}
              disabled={!!editing}
              onChange={(event) => setForm({ ...form, strategyName: event.target.value })}
              placeholder="如：节点 CPU 高位告警"
            />
          </Field>
          <Field label="告警类型">
            <select
              className="field"
              value={form.alertType}
              disabled={!!editing}
              onChange={(event) => setForm({ ...form, alertType: Number(event.target.value) })}
            >
              <option value={0}>资源告警</option>
              <option value={1}>日志告警</option>
            </select>
          </Field>
          <Field label="监控对象" required>
            <input
              className="field"
              value={form.targetName}
              disabled={!!editing}
              onChange={(event) => setForm({ ...form, targetName: event.target.value })}
              placeholder="节点名 / 服务名"
            />
          </Field>
          <Field label="命名空间">
            <input
              className="field"
              value={form.namespace}
              disabled={!!editing}
              onChange={(event) => setForm({ ...form, namespace: event.target.value })}
            />
          </Field>
          <Field label="巡检周期">
            <select className="field" value={form.interval} onChange={(event) => setForm({ ...form, interval: event.target.value })}>
              <option value="1m">1 分钟</option>
              <option value="5m">5 分钟</option>
              <option value="15m">15 分钟</option>
              <option value="1h">1 小时</option>
            </select>
          </Field>
          <Field label="指标">
            <select className="field" value={form.metric} onChange={(event) => setForm({ ...form, metric: event.target.value })}>
              <option value="cpu">CPU 使用率</option>
              <option value="memory">内存使用率</option>
              <option value="disk">磁盘使用率</option>
              <option value="restart">容器重启</option>
            </select>
          </Field>
          <Field label="比较符">
            <select className="field" value={form.operator} onChange={(event) => setForm({ ...form, operator: event.target.value })}>
              <option value=">">大于 &gt;</option>
              <option value=">=">大于等于 ≥</option>
              <option value="<">小于 &lt;</option>
              <option value="=">等于 =</option>
            </select>
          </Field>
          <Field label="阈值">
            <input
              className="field"
              value={form.value}
              onChange={(event) => setForm({ ...form, value: event.target.value })}
              placeholder="如 85"
            />
          </Field>
        </div>
        <div className="mt-3 flex items-start gap-2 border border-line bg-paper-2/40 px-3 py-2">
          <BellRing size={12} className="mt-0.5 flex-2 text-mute" />
          <p className="text-[10.5px] leading-relaxed text-ink-3">
            表达式预览：<span className="mono text-ink">{form.metric} {form.operator} {form.value}</span>，每 {form.interval} 评估一次。
          </p>
        </div>
      </Modal>
    </div>
  )
}
