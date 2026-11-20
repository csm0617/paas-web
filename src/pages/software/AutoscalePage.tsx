import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { ServiceItem, ServiceList } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import { ActionMenu, Button, Modal, PageToolbar, Panel, Select, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

const NAMESPACE = 'gaop-namespace'
const HPA_PATH = `/k8s/apis/autoscaling/v2/namespaces/${NAMESPACE}/horizontalpodautoscalers`

type ThresholdType = 'cpu' | 'memory'

interface ThresholdRow {
  id: number
  type: ThresholdType
  value: string
}

const THRESHOLD_OPTIONS = [
  { value: 'cpu', label: 'CPU阈值' },
  { value: 'memory', label: '内存阈值' },
]

let thresholdSeq = 1

function defaultThresholds(): ThresholdRow[] {
  return [{ id: thresholdSeq++, type: 'cpu', value: '80' }]
}

interface HpaItem {
  metadata?: { name?: string; creationTimestamp?: string }
  spec?: {
    scaleTargetRef?: { kind?: string; name?: string; apiVersion?: string }
    minReplicas?: number
    maxReplicas?: number
    metrics?: Array<{
      type?: string
      resource?: { name?: string; target?: { type?: string; averageUtilization?: number } }
    }>
  }
  status?: { currentReplicas?: number; desiredReplicas?: number; currentMetrics?: unknown }
}

function targetOf(item: HpaItem) {
  return item.spec?.scaleTargetRef?.name || item.metadata?.name || '—'
}

function isDisabled(item: HpaItem) {
  return (item.spec?.scaleTargetRef?.name || '').includes('-disabled')
}

function thresholdLines(item: HpaItem) {
  const metrics = item.spec?.metrics ?? []
  const current =
    ((item.status?.currentMetrics as
      | Array<{ resource?: { name?: string; current?: { averageUtilization?: number } } }>
      | undefined) ?? [])
  return metrics.map((metric) => {
    const name = metric.resource?.name
    const value = current.find((entry) => entry.resource?.name === name)?.resource?.current
      ?.averageUtilization
    const label = name === 'memory' ? '内存' : 'CPU'
    const target = metric.resource?.target?.averageUtilization
    return `${label}: ${value != null ? `${value}%` : '--'} / ${target != null ? `${target}%` : '--'}`
  })
}

function PolicyField({
  label,
  required,
  children,
}: {
  label?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-[104px] flex-none text-right text-[14px] text-white">
        {label ? (
          <>
            {required && <span className="mr-1 text-[#ff5c5c]">*</span>}
            {label}：
          </>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export default function AutoscalePage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<HpaItem | null>(null)
  const [form, setForm] = useState({
    name: '',
    service: '',
    min: '1',
    max: '2',
    thresholds: defaultThresholds(),
  })
  const [keyword, setKeyword] = useState('')
  const [eventsTarget, setEventsTarget] = useState<HpaItem | null>(null)

  const hpaQuery = useQuery({
    queryKey: ['hpa-list'],
    queryFn: () =>
      api.get<{ items?: HpaItem[] }>(HPA_PATH, { pretty: 'true' }),
    refetchInterval: 30_000,
  })
  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 100 }),
    enabled: createOpen,
  })

  const eventsQuery = useQuery({
    queryKey: ['hpa-events', eventsTarget?.metadata?.name || ''],
    queryFn: () =>
      api.get<{ items?: Array<{ reason?: string; message?: string; lastTimestamp?: string; type?: string }> }>(
        `/k8s/api/v1/namespaces/${NAMESPACE}/events`,
        {
          pretty: 'true',
          fieldSelector: `involvedObject.kind=HorizontalPodAutoscaler,involvedObject.name=${eventsTarget?.metadata?.name || ''}`,
        },
      ),
    enabled: !!eventsTarget,
  })

  const items = useMemo(() => {
    const list = hpaQuery.data?.items ?? []
    const text = keyword.trim().toLowerCase()
    if (!text) return list
    return list.filter((item) =>
      `${item.metadata?.name || ''} ${targetOf(item)}`.toLowerCase().includes(text),
    )
  }, [hpaQuery.data, keyword])
  const services = servicesQuery.data?.services ?? []
  const deploymentOptions = useMemo(
    () =>
      services
        .map((service: ServiceItem) => service.deployment?.metadata?.name || service.service?.metadata?.name || '')
        .filter(Boolean),
    [services],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const name = form.name.trim()
      const target = form.service.trim()
      if (!name) throw new Error('请输入策略名称')
      if (!target) throw new Error('请选择服务标识')
      if (form.thresholds.some((row) => !row.value.trim())) throw new Error('请填写阈值')
      const manifest = {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: { name, namespace: NAMESPACE },
        spec: {
          scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: target },
          minReplicas: Number(form.min) || 1,
          maxReplicas: Number(form.max) || 2,
          metrics: form.thresholds.map((row) => ({
            type: 'Resource',
            resource: {
              name: row.type,
              target: { type: 'Utilization', averageUtilization: Number(row.value) || 80 },
            },
          })),
        },
      }
      if (editing?.metadata?.name) {
        if (editing.metadata.name !== name) await api.del(`${HPA_PATH}/${editing.metadata.name}`)
        else return api.put(`${HPA_PATH}/${name}`, manifest)
      }
      return api.post(HPA_PATH, manifest)
    },
    onSuccess: () => {
      toast.success(editing ? '伸缩策略已更新' : '伸缩策略已创建')
      setCreateOpen(false)
      setEditing(null)
      setForm({ name: '', service: '', min: '1', max: '2', thresholds: defaultThresholds() })
      queryClient.invalidateQueries({ queryKey: ['hpa-list'] })
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.del(`${HPA_PATH}/${name}`),
    onSuccess: () => {
      toast.success('伸缩策略已删除')
      queryClient.invalidateQueries({ queryKey: ['hpa-list'] })
    },
    onError: (error) => toast.error('删除失败', errorMessage(error)),
  })

  const toggleMutation = useMutation({
    mutationFn: (item: HpaItem) => {
      const name = item.metadata?.name || ''
      const target = item.spec?.scaleTargetRef?.name || ''
      const nextTarget = isDisabled(item) ? target.replace('-disabled', '') : `${target}-disabled`
      return api.put(`${HPA_PATH}/${name}`, {
        ...item,
        metadata: { name, namespace: NAMESPACE },
        spec: { ...item.spec, scaleTargetRef: { ...item.spec?.scaleTargetRef, name: nextTarget } },
      })
    },
    onSuccess: (_data, item) => {
      toast.success(isDisabled(item) ? '策略已启用' : '策略已停用')
      queryClient.invalidateQueries({ queryKey: ['hpa-list'] })
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  })

  async function remove(item: HpaItem) {
    const name = item.metadata?.name
    if (!name) return
    const ok = await confirm({
      title: `删除 ${name} 的伸缩策略？`,
      description: '删除后该服务将不再自动伸缩，当前副本数保持不变。',
      confirmText: '删除',
      danger: true,
    })
    if (ok) deleteMutation.mutate(name)
  }

  function openEdit(item: HpaItem) {
    setEditing(item)
    const metrics = (item.spec?.metrics ?? []).filter((metric) => metric.type === 'Resource')
    setForm({
      name: item.metadata?.name || '',
      service: (item.spec?.scaleTargetRef?.name || '').replace('-disabled', ''),
      min: String(item.spec?.minReplicas ?? 1),
      max: String(item.spec?.maxReplicas ?? 2),
      thresholds: metrics.length
        ? metrics.map((metric) => ({
            id: thresholdSeq++,
            type: (metric.resource?.name === 'memory' ? 'memory' : 'cpu') as ThresholdType,
            value: String(metric.resource?.target?.averageUtilization ?? 80),
          }))
        : defaultThresholds(),
    })
    setCreateOpen(true)
  }

  const columns: Array<Column<HpaItem>> = [
    {
      key: 'index',
      header: '序号',
      width: 80,
      align: 'center',
      cell: (_row, index) => <span className="text-[14px] text-ink">{index + 1}</span>,
    },
    {
      key: 'name',
      header: '策略名称',
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{row.metadata?.name || '—'}</span>,
    },
    {
      key: 'target',
      header: '服务标识',
      align: 'center',
      cell: (row) => (
        <span className="text-[14px] text-ink">
          {(row.spec?.scaleTargetRef?.name || '').replace('-disabled', '') || '—'}
        </span>
      ),
    },
    {
      key: 'enabled',
      header: '开启状态',
      align: 'center',
      cell: (row) =>
        isDisabled(row) ? (
          <span className="text-[14px] text-danger">已禁用</span>
        ) : (
          <span className="text-[14px] text-ok">已启用</span>
        ),
    },
    {
      key: 'threshold',
      header: '阈值',
      align: 'center',
      cell: (row) => {
        const lines = thresholdLines(row)
        return lines.length ? (
          <div className="leading-[1.6] text-[14px] text-ink-3">
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : (
          <span className="text-[14px] text-mute">—</span>
        )
      },
    },
    {
      key: 'min',
      header: '最小实例数',
      align: 'center',
      cell: (row) => (
        <span className="num text-[14px] text-ink">{Math.round(row.spec?.minReplicas ?? 0)}</span>
      ),
    },
    {
      key: 'max',
      header: '最大实例数',
      align: 'center',
      cell: (row) => (
        <span className="num text-[14px] text-ink">{Math.round(row.spec?.maxReplicas ?? 0)}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: 250,
      align: 'center',
      headerAlign: 'center',
      cell: (row) => (
        <div className="flex items-center justify-center gap-2.5 text-[14px]">
          <button
            className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            onClick={() => setEventsTarget(row)}
          >
            伸缩事件
          </button>
          <button
            className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            onClick={() => openEdit(row)}
          >
            编辑
          </button>
          <ActionMenu
            triggerText="更多"
            items={[
              {
                label: isDisabled(row) ? '启用' : '停用',
                onSelect: () => toggleMutation.mutate(row),
              },
              { label: '删除', danger: true, onSelect: () => remove(row) },
            ]}
          />
        </div>
      ),
    },
  ]

  const nextThresholdType = THRESHOLD_OPTIONS.find(
    (option) => !form.thresholds.some((item) => item.type === option.value),
  )

  return (
    <div>
      <PageToolbar
        search={{ value: keyword, onChange: setKeyword, placeholder: '请输入策略或服务名称搜索' }}
      >
        <Button
          size="sm"
          variant="signal"
          onClick={() => {
            setEditing(null)
            setForm({ name: '', service: '', min: '1', max: '2', thresholds: defaultThresholds() })
            setCreateOpen(true)
          }}
        >
          <Plus size={12} /> 创建策略
        </Button>
      </PageToolbar>

      <Panel kicker="HORIZONTAL POD AUTOSCALER" title="策略清单" bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(row) => row.metadata?.name || targetOf(row)}
          loading={hpaQuery.isLoading}
          pageSize={12}
          rowHeight={77}
          emptyTitle="暂无伸缩策略"
          emptyDescription="为关键服务创建基于 CPU 的伸缩策略，以应对流量波峰。"
        />
      </Panel>

      <div className="mono mt-3 flex items-center gap-2 text-[12px] tracking-wider text-mute">
        <Activity size={10} /> 依赖 metrics-server 提供容器 CPU 指标；指标缺失时水平伸缩不会触发。
      </div>

      <Modal
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setEditing(null)
        }}
        title={editing ? '修改自动伸缩策略' : '创建自动伸缩策略'}
        titleAlign="center"
        headerClassName="h-[30px] border-b-0 bg-[#28538f] px-2.5 py-0"
        bodyClassName="px-6 py-5"
        width={560}
        footer={
          <div className="flex w-full items-center justify-center gap-3">
            <Button size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              确定
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <PolicyField label="策略名称" required>
            <input
              className="field"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </PolicyField>
          <PolicyField label="服务标识" required>
            <Select
              searchable
              className="w-full"
              placeholder="输入服务标识或关键字搜索"
              value={form.service}
              options={[
                ...deploymentOptions.map((name) => ({ value: name, label: name })),
                ...(form.service && !deploymentOptions.includes(form.service)
                  ? [{ value: form.service, label: form.service }]
                  : []),
              ]}
              onChange={(value) => setForm({ ...form, service: value })}
            />
          </PolicyField>
          <PolicyField label="最小实例数" required>
            <input
              className="field"
              type="number"
              min={1}
              value={form.min}
              onChange={(event) => setForm({ ...form, min: event.target.value })}
            />
          </PolicyField>
          <PolicyField label="最大实例数" required>
            <input
              className="field"
              type="number"
              min={1}
              value={form.max}
              onChange={(event) => setForm({ ...form, max: event.target.value })}
            />
          </PolicyField>
          {form.thresholds.map((row, index) => (
            <PolicyField key={row.id} label={index === 0 ? '阈值' : ''}>
              <div className="flex items-center gap-2">
                <Select
                  className="w-[104px] flex-none"
                  value={row.type}
                  options={THRESHOLD_OPTIONS.filter(
                    (option) =>
                      option.value === row.type ||
                      !form.thresholds.some(
                        (item) => item.id !== row.id && item.type === option.value,
                      ),
                  )}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      thresholds: form.thresholds.map((item) =>
                        item.id === row.id ? { ...item, type: value as ThresholdType } : item,
                      ),
                    })
                  }
                />
                <div className="flex min-w-0 flex-1 items-center">
                  <input
                    className="field rounded-r-none"
                    type="number"
                    min={1}
                    max={100}
                    value={row.value}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        thresholds: form.thresholds.map((item) =>
                          item.id === row.id ? { ...item, value: event.target.value } : item,
                        ),
                      })
                    }
                  />
                  <span className="flex h-[30px] w-8 flex-none items-center justify-center border border-l-0 border-line bg-paper-3 text-[14px] text-ink-3">
                    %
                  </span>
                </div>
                <button
                  type="button"
                  disabled={form.thresholds.length === 1}
                  className={cn(
                    'flex-none text-[14px] transition-colors',
                    form.thresholds.length === 1
                      ? 'cursor-not-allowed text-mute'
                      : 'text-[#ff7b7b] hover:text-[#ff9a9a]',
                  )}
                  onClick={() =>
                    setForm({
                      ...form,
                      thresholds: form.thresholds.filter((item) => item.id !== row.id),
                    })
                  }
                >
                  删除
                </button>
              </div>
            </PolicyField>
          ))}
          <div className="pl-[114px]">
            <button
              type="button"
              disabled={!nextThresholdType}
              className={cn(
                'text-[14px] transition-colors',
                nextThresholdType
                  ? 'text-[#4aa3f0] hover:text-[#7cc4ff]'
                  : 'cursor-not-allowed text-mute',
              )}
              onClick={() => {
                if (!nextThresholdType) return
                setForm({
                  ...form,
                  thresholds: [
                    ...form.thresholds,
                    { id: thresholdSeq++, type: nextThresholdType.value as ThresholdType, value: '80' },
                  ],
                })
              }}
            >
              添加阈值
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!eventsTarget}
        onOpenChange={(open) => !open && setEventsTarget(null)}
        title={`${eventsTarget?.metadata?.name || ''} 伸缩事件`}
        width={1000}
        footer={
          <Button size="sm" onClick={() => setEventsTarget(null)}>
            关闭
          </Button>
        }
      >
        <div className="max-h-[520px] space-y-2 overflow-y-auto">
          {(eventsQuery.data?.items ?? []).map((event, index) => (
            <div key={index} className="border border-line px-3 py-2">
              <div className="flex items-center gap-3 text-[14px]">
                <span
                  className={cn(
                    'w-[120px] flex-none',
                    event.type === 'Warning' ? 'text-danger' : 'text-ok',
                  )}
                >
                  {event.reason || '—'}
                </span>
                <span className="flex-none text-ink-3">消息</span>
                <span className="min-w-0 flex-1 text-ink">{event.message || '—'}</span>
                <span className="mono flex-none text-[12px] text-mute">
                  {event.lastTimestamp ? formatDate(event.lastTimestamp, true) : ''}
                </span>
              </div>
            </div>
          ))}
          {!eventsQuery.isLoading && (eventsQuery.data?.items ?? []).length === 0 && (
            <div className="py-8 text-center text-[14px] text-mute">暂无事件</div>
          )}
        </div>
      </Modal>
    </div>
  )
}
