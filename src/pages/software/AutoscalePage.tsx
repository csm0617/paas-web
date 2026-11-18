import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { ServiceItem, ServiceList } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import { ActionMenu, Button, Drawer, Field, Modal, PageToolbar, Panel, Select, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'
import { cn } from '@/lib/utils'

const NAMESPACE = 'gaop-namespace'
const HPA_PATH = `/k8s/apis/autoscaling/v2/namespaces/${NAMESPACE}/horizontalpodautoscalers`

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

function cpuTarget(item: HpaItem) {
  const metric = item.spec?.metrics?.find((entry) => entry.type === 'Resource' && entry.resource?.name === 'cpu')
  return metric?.resource?.target?.averageUtilization
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
    return `${label}：${value != null ? `${value}%` : '--'} / ${target != null ? `${target}%` : '--'}`
  })
}

export default function AutoscalePage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<HpaItem | null>(null)
  const [form, setForm] = useState({ service: '', min: '1', max: '3', cpu: '80' })
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
      const target = form.service.trim()
      if (!target) throw new Error('请选择目标服务')
      const manifest = {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: { name: target, namespace: NAMESPACE },
        spec: {
          scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: target },
          minReplicas: Number(form.min) || 1,
          maxReplicas: Number(form.max) || 3,
          metrics: [
            {
              type: 'Resource',
              resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: Number(form.cpu) || 80 } },
            },
          ],
        },
      }
      if (editing?.metadata?.name && editing.metadata.name !== target) {
        await api.del(`${HPA_PATH}/${editing.metadata.name}`)
      }
      if (editing?.metadata?.name) {
        return api.put(`${HPA_PATH}/${editing.metadata.name}`, { ...manifest, metadata: { name: editing.metadata.name, namespace: NAMESPACE } })
      }
      return api.post(HPA_PATH, manifest)
    },
    onSuccess: () => {
      toast.success(editing ? '伸缩策略已更新' : '伸缩策略已创建')
      setCreateOpen(false)
      setEditing(null)
      setForm({ service: '', min: '1', max: '3', cpu: '80' })
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
    setForm({
      service: item.spec?.scaleTargetRef?.name || item.metadata?.name || '',
      min: String(item.spec?.minReplicas ?? 1),
      max: String(item.spec?.maxReplicas ?? 3),
      cpu: String(cpuTarget(item) ?? 80),
    })
    setCreateOpen(true)
  }

  const columns: Array<Column<HpaItem>> = [
    {
      key: 'index',
      header: '序号',
      width: 80,
      align: 'center',
      cell: (_row, index) => <span className="mono text-[11.5px] text-ink-3">{index + 1}</span>,
    },
    {
      key: 'name',
      header: '策略名称',
      align: 'center',
      cell: (row) => <span className="text-[12px] text-ink">{row.metadata?.name || '—'}</span>,
    },
    {
      key: 'target',
      header: '服务标识',
      align: 'center',
      cell: (row) => (
        <span className="mono text-[11.5px] text-ink-3">
          {(row.spec?.scaleTargetRef?.name || '').replace('-disabled', '') || '—'}
        </span>
      ),
    },
    {
      key: 'enabled',
      header: '启用状态',
      align: 'center',
      cell: (row) =>
        isDisabled(row) ? (
          <span className="text-[12px] text-danger">禁用</span>
        ) : (
          <span className="text-[12px] text-ok">启用</span>
        ),
    },
    {
      key: 'threshold',
      header: '阈值',
      align: 'center',
      cell: (row) => {
        const lines = thresholdLines(row)
        return lines.length ? (
          <div className="leading-[1.6] text-[12px] text-ink-3">
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : (
          <span className="text-[12px] text-mute">—</span>
        )
      },
    },
    {
      key: 'min',
      header: '最小实例',
      align: 'center',
      cell: (row) => (
        <span className="num text-[12px] text-ink">{Math.round(row.spec?.minReplicas ?? 0)}</span>
      ),
    },
    {
      key: 'max',
      header: '最大实例',
      align: 'center',
      cell: (row) => (
        <span className="num text-[12px] text-ink">{Math.round(row.spec?.maxReplicas ?? 0)}</span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      width: 250,
      align: 'center',
      headerAlign: 'center',
      cell: (row) => (
        <div className="flex items-center justify-center gap-2.5 text-[12px]">
          <button
            className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            onClick={() => setEventsTarget(row)}
          >
            缩容事件
          </button>
          <button
            className="text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]"
            onClick={() => openEdit(row)}
          >
            修改
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

  return (
    <div>
      <PageToolbar
        search={{ value: keyword, onChange: setKeyword, placeholder: '请输入策略名或服务名搜索' }}
      >
        <Button
          size="sm"
          variant="signal"
          onClick={() => {
            setEditing(null)
            setForm({ service: '', min: '1', max: '3', cpu: '80' })
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
          emptyTitle="暂无伸缩策略"
          emptyDescription="为关键服务创建基于 CPU 的伸缩策略，以应对流量波峰。"
        />
      </Panel>

      <div className="mono mt-3 flex items-center gap-2 text-[8px] tracking-wider text-mute">
        <Activity size={10} /> 依赖 metrics-server 提供容器 CPU 指标；指标缺失时水平伸缩不会触发。
      </div>

      <Drawer
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setEditing(null)
        }}
        kicker="AUTOSCALING / POLICY"
        title={editing ? '修改策略' : '创建策略'}
        description="目标服务以 Deployment 名称标识。阈值表示容器平均 CPU 使用率，超过阈值时扩容。"
        width={470}
        footer={
          <>
            <Button size="sm" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button size="sm" variant="signal" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {editing ? '保存策略' : '创建策略'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="目标服务" required hint="选择需要自动伸缩的 Deployment">
            <Select
              placeholder="请选择服务"
              value={form.service}
              options={[
                ...deploymentOptions.map((name) => ({ value: name, label: name })),
                ...(form.service && !deploymentOptions.includes(form.service)
                  ? [{ value: form.service, label: form.service }]
                  : []),
              ]}
              onChange={(value) => setForm({ ...form, service: value })}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="CPU 阈值" required>
              <input
                className="field"
                type="number"
                min={1}
                max={100}
                value={form.cpu}
                onChange={(event) => setForm({ ...form, cpu: event.target.value })}
              />
            </Field>
            <Field label="最小实例" required>
              <input
                className="field"
                type="number"
                min={1}
                value={form.min}
                onChange={(event) => setForm({ ...form, min: event.target.value })}
              />
            </Field>
            <Field label="最大实例" required>
              <input
                className="field"
                type="number"
                min={1}
                value={form.max}
                onChange={(event) => setForm({ ...form, max: event.target.value })}
              />
            </Field>
          </div>
          <div className="mono border border-line bg-paper-2/40 px-3 py-2 text-[8px] leading-relaxed tracking-wider text-mute">
            HPA 需要 metrics-server 支持；创建后在「工作负载」中可观察副本变化。
          </div>
        </div>
      </Drawer>

      <Modal
        open={!!eventsTarget}
        onOpenChange={(open) => !open && setEventsTarget(null)}
        title={`${eventsTarget?.metadata?.name || ''} 缩容事件`}
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
              <div className="flex items-center gap-3 text-[12px]">
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
                <span className="mono flex-none text-[11px] text-mute">
                  {event.lastTimestamp ? formatDate(event.lastTimestamp, true) : ''}
                </span>
              </div>
            </div>
          ))}
          {!eventsQuery.isLoading && (eventsQuery.data?.items ?? []).length === 0 && (
            <div className="py-8 text-center text-[12px] text-mute">暂无事件</div>
          )}
        </div>
      </Modal>
    </div>
  )
}
