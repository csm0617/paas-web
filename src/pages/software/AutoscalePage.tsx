import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import type { ServiceItem, ServiceList } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge, Button, Field, Modal, PageHeader, Panel, StatusDot, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'

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

export default function AutoscalePage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<HpaItem | null>(null)
  const [form, setForm] = useState({ service: '', min: '1', max: '3', cpu: '80' })

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

  const items = useMemo(() => hpaQuery.data?.items ?? [], [hpaQuery.data])
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
      key: 'service',
      header: '服务标识 / TARGET',
      cell: (row) => (
        <div>
          <div className="font-mono text-[11px] text-ink">{targetOf(row)}</div>
          <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">
            {row.spec?.scaleTargetRef?.kind || 'Deployment'} · {NAMESPACE}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: '开启状态',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <StatusDot tone="ok" />
          <Badge tone="ok">ENABLED</Badge>
        </div>
      ),
    },
    {
      key: 'threshold',
      header: '阈值',
      cell: (row) => (
        <span className="num text-[12px] text-ink">
          {cpuTarget(row) ?? '—'}
          <span className="ml-0.5 text-[9px] text-mute">% CPU</span>
        </span>
      ),
    },
    {
      key: 'min',
      header: '最小实例数',
      cell: (row) => <span className="num text-[12px] text-ink">{row.spec?.minReplicas ?? '—'}</span>,
    },
    {
      key: 'max',
      header: '最大实例数',
      cell: (row) => <span className="num text-[12px] text-ink">{row.spec?.maxReplicas ?? '—'}</span>,
    },
    {
      key: 'current',
      header: '当前 / 期望',
      cell: (row) => (
        <span className="num text-[12px] text-ink-3">
          {row.status?.currentReplicas ?? 0}
          <span className="text-[9.5px] text-mute"> / {row.status?.desiredReplicas ?? 0}</span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button size="sm" onClick={() => openEdit(row)}>
            配置
          </Button>
          <Button size="sm" onClick={() => remove(row)}>
            <Trash2 size={10} /> 删除
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="03 / 10"
        en="SOFTWARE · AUTOSCALING"
        title="自动伸缩策略"
        description="基于 CPU 使用率的水平伸缩（HPA）策略。策略生效后，工作负载将在最小与最大实例数之间自动调整。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={items.length ? 'ok' : 'idle'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{items.length} POLICIES</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">autoscaling/v2</span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={hpaQuery.isFetching} onClick={() => hpaQuery.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button
              size="sm"
              variant="signal"
              onClick={() => {
                setEditing(null)
                setForm({ service: '', min: '1', max: '3', cpu: '80' })
                setCreateOpen(true)
              }}
            >
              <Plus size={12} /> 新建策略
            </Button>
          </>
        }
      />

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

      <Modal
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setEditing(null)
        }}
        kicker="AUTOSCALING / POLICY"
        title={editing ? '配置伸缩策略' : '新建伸缩策略'}
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
            <select
              className="field"
              value={form.service}
              onChange={(event) => setForm({ ...form, service: event.target.value })}
            >
              <option value="">请选择服务</option>
              {deploymentOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
              {form.service && !deploymentOptions.includes(form.service) && (
                <option value={form.service}>{form.service}</option>
              )}
            </select>
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
      </Modal>
    </div>
  )
}
