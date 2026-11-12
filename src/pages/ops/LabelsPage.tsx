import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, RefreshCw, Tags, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { Badge, Button, Field, Input, Modal, PageHeader, Panel, StatusDot } from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { toast } from '@/stores/toast'

interface LabelItem {
  id?: string | null
  key: string
  value: string
  isUserDefined?: boolean
  targets?: string[]
  createAt?: number | null
}

interface LabelSummary {
  nodes?: Record<string, Record<string, string>>
  summary?: Record<string, LabelItem>
}

export default function LabelsPage() {
  const [keyword, setKeyword] = useState('')
  const query = useQuery({
    queryKey: ['label-summary'],
    queryFn: () => api.get<LabelSummary>('/cloud/label-summary'),
    refetchInterval: 60_000,
  })

  const queryClient = useQueryClient()
  const nodeNames = useMemo(() => Object.keys(query.data?.nodes ?? {}).sort(), [query.data])
  const [editOpen, setEditOpen] = useState(false)
  const [editNode, setEditNode] = useState('')
  const [editRows, setEditRows] = useState<Array<{ key: string; value: string }>>([])

  useEffect(() => {
    if (!editOpen) return
    const labels = query.data?.nodes?.[editNode] ?? {}
    setEditRows(Object.entries(labels).map(([key, value]) => ({ key, value: String(value ?? '') })))
    // 仅在打开弹窗或切换节点时初始化，避免轮询刷新覆盖未保存的编辑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editOpen, editNode])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editNode) throw new Error('请选择要维护的节点')
      const labels: Record<string, string> = {}
      for (const row of editRows) {
        const key = row.key.trim()
        if (!key) continue
        if (labels[key] !== undefined) throw new Error(`标签键重复：${key}`)
        labels[key] = row.value.trim()
      }
      if (Object.keys(labels).length === 0) throw new Error('至少保留一个标签')
      const manifest = await api.get<{ metadata?: { labels?: Record<string, string> } }>(
        `/k8s/api/v1/nodes/${editNode}`,
      )
      manifest.metadata = { ...(manifest.metadata ?? {}), labels }
      return api.put(`/k8s/api/v1/nodes/${editNode}`, manifest)
    },
    onSuccess: () => {
      toast.success('节点标签已更新', `节点 ${editNode} 的标签变更已提交至集群`)
      queryClient.invalidateQueries({ queryKey: ['label-summary'] })
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
      setEditOpen(false)
    },
    onError: (error) => toast.error('标签更新失败', errorMessage(error)),
  })

  function openEditor(name?: string) {
    const target = name || nodeNames[0] || ''
    setEditNode(target)
    setEditRows([])
    setEditOpen(true)
  }

  const labels = useMemo(() => {
    const summary = query.data?.summary ?? {}
    return Object.values(summary).sort((a, b) => a.key.localeCompare(b.key))
  }, [query.data])

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    if (!text) return labels
    return labels.filter(
      (item) => item.key.toLowerCase().includes(text) || String(item.value).toLowerCase().includes(text),
    )
  }, [labels, keyword])

  const nodeCount = Object.keys(query.data?.nodes ?? {}).length
  const userDefined = labels.filter((item) => item.isUserDefined).length

  const columns: Array<Column<LabelItem>> = [
    {
      key: 'key',
      header: '标签键 / KEY',
      sortValue: (row) => row.key,
      cell: (row) => <span className="font-mono text-[11px] text-ink">{row.key}</span>,
    },
    {
      key: 'value',
      header: '值 / VALUE',
      cell: (row) => <span className="mono text-[10.5px] text-ink-3">{row.value || '—'}</span>,
    },
    {
      key: 'owner',
      header: '来源',
      cell: (row) => (
        <Badge tone={row.isUserDefined ? 'info' : 'default'}>{row.isUserDefined ? 'USER DEFINED' : 'SYSTEM'}</Badge>
      ),
    },
    {
      key: 'targets',
      header: '作用节点',
      cell: (row) => {
        const targets = row.targets ?? []
        if (targets.length === 0) return <span className="text-[10.5px] text-mute">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {targets.slice(0, 4).map((target) => (
              <Badge key={target}>{target}</Badge>
            ))}
            {targets.length > 4 && <span className="mono text-[9px] text-mute">+{targets.length - 4}</span>}
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <PageHeader
        index="04 / 04"
        en="OPERATIONS · NODE LABELS"
        title="节点标签"
        description="集群节点标签汇总。调度、亲和性与告警策略均依赖标签匹配，系统标签不建议手工修改。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {labels.length} LABELS · {nodeCount} NODES
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">{userDefined} USER DEFINED</span>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => openEditor()}>
              <Pencil size={11} /> 维护标签
            </Button>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ['标签总数', labels.length, 'LABEL KEYS'],
          ['系统标签', labels.length - userDefined, 'SYSTEM'],
          ['自定义标签', userDefined, 'USER DEFINED'],
          ['节点数', nodeCount, 'TARGETS'],
        ].map(([label, value, hint]) => (
          <Panel key={label} bodyClassName="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[28px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </Panel>
        ))}
      </div>

      <Panel
        kicker="LABEL INVENTORY"
        title="标签清单"
        bodyClassName="p-0"
        actions={
          <div className="flex items-center gap-1.5 border border-line-strong bg-paper px-2">
            <Tags size={11} className="text-mute" />
            <input
              className="h-7 w-44 bg-transparent font-mono text-[10px] text-ink outline-none placeholder:text-mute"
              placeholder="搜索标签键 / 值"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => `${row.key}=${row.value}`}
          loading={query.isLoading}
          pageSize={14}
          emptyTitle="暂无节点标签"
          emptyDescription="当前集群节点尚未暴露标签，或接口暂不可用。"
        />
      </Panel>

      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        kicker="NODE LABEL MAINTENANCE"
        title="维护节点标签"
        description="直接写入节点 metadata.labels。kubernetes.io 等系统标签可能影响调度与存储，修改前请确认影响面。"
        width={680}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const labels = query.data?.nodes?.[editNode] ?? {}
                setEditRows(Object.entries(labels).map(([key, value]) => ({ key, value: String(value ?? '') })))
              }}
            >
              <RefreshCw size={11} /> 重置
            </Button>
            <Button size="sm" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={saveMutation.isPending}
              disabled={!editNode}
              onClick={() => saveMutation.mutate()}
            >
              保存标签
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="目标节点" required>
            <select className="field" value={editNode} onChange={(event) => setEditNode(event.target.value)}>
              {nodeNames.length === 0 && <option value="">暂无节点</option>}
              {nodeNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-center justify-between">
            <span className="label">标签键值 / {editRows.length} ENTRIES</span>
            <Button size="sm" variant="ghost" onClick={() => setEditRows((prev) => [...prev, { key: '', value: '' }])}>
              <Plus size={11} /> 新增标签
            </Button>
          </div>

          <div className="max-h-[46vh] space-y-2 overflow-auto pr-1">
            {editRows.length === 0 && (
              <div className="border border-dashed border-line-strong px-3 py-6 text-center text-[11px] text-mute">
                该节点暂无标签，点击“新增标签”开始配置。
              </div>
            )}
            {editRows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  placeholder="标签键，如 gpu-type"
                  value={row.key}
                  onChange={(event) =>
                    setEditRows((prev) => prev.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)))
                  }
                />
                <span className="mono text-[11px] text-mute">=</span>
                <Input
                  className="flex-1"
                  placeholder="标签值"
                  value={row.value}
                  onChange={(event) =>
                    setEditRows((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)),
                    )
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="删除标签"
                  onClick={() => setEditRows((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  )
}
