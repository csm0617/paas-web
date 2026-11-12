import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, ShieldOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { WhitelistItem } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge, Button, EmptyState, PageHeader, Panel, StatusDot, useConfirm } from '@/components/ui'
import { toast } from '@/stores/toast'

export default function WhitelistPage() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [path, setPath] = useState('')

  const query = useQuery({
    queryKey: ['whitelist'],
    queryFn: () => api.get<{ list: WhitelistItem[]; total: number }>('/v1/white_list/list', { page: 1, size: 200 }),
  })

  const list = query.data?.list ?? []

  const addMutation = useMutation({
    mutationFn: () => api.post('/v1/white_list', undefined, { path: path.trim() }),
    onSuccess: () => {
      toast.success('放行路径已添加')
      setPath('')
      queryClient.invalidateQueries({ queryKey: ['whitelist'] })
    },
    onError: (error) => toast.error('添加失败', errorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del('/v1/white_list', undefined, { pathId: id }),
    onSuccess: () => {
      toast.success('放行路径已移除')
      queryClient.invalidateQueries({ queryKey: ['whitelist'] })
    },
    onError: (error) => toast.error('移除失败', errorMessage(error)),
  })

  async function remove(item: WhitelistItem) {
    const ok = await confirm({
      title: '移除该放行路径？',
      description: `移除后访问 ${item.path} 将重新经过网关鉴权。`,
      danger: true,
      confirmText: '移除',
    })
    if (ok) deleteMutation.mutate(item.id)
  }

  const columns: Array<Column<WhitelistItem>> = [
    {
      key: 'path',
      header: '放行路径 / PATH',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <StatusDot tone="ok" />
          <span className="font-mono text-[11px] text-ink">{row.path}</span>
        </div>
      ),
    },
    {
      key: 'id',
      header: '标识',
      cell: (row) => <span className="mono text-[9px] text-mute">{row.id}</span>,
    },
    {
      key: 'time',
      header: '创建时间',
      sortValue: (row) => row.createdAt ?? 0,
      cell: (row) => <span className="mono text-[10px] text-ink-3">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <Button size="sm" variant="danger" onClick={() => remove(row)}>
          <Trash2 size={10} /> 移除
        </Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        index="04 / 05"
        en="OPERATIONS · GATEWAY ALLOWLIST"
        title="白名单"
        description="配置无需身份校验即可访问的网关路径。请仅放行静态资源、健康检查等低风险端点。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={list.length ? 'warn' : 'ok'} />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{list.length} ALLOWED PATHS</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">GATEWAY POLICY</span>
          </>
        }
        actions={
          <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
            <RefreshCw size={11} /> 刷新
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Panel className="xl:col-span-8" kicker="ALLOWLIST" title="放行路径" bodyClassName="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <input
              className="field h-9 flex-1 text-[12px]"
              placeholder="输入需要放行的路径，例如 /v1/pub/health"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && path.trim()) addMutation.mutate()
              }}
            />
            <Button
              size="sm"
              variant="signal"
              disabled={!path.trim()}
              loading={addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              <Plus size={11} /> 添加路径
            </Button>
          </div>
          <DataTable
            columns={columns}
            rows={list}
            rowKey={(row) => row.id}
            loading={query.isLoading}
            pageSize={12}
            emptyTitle="白名单为空"
            emptyDescription="当前所有请求均需通过网关鉴权，未配置任何匿名放行路径。"
          />
        </Panel>

        <div className="flex flex-col gap-4 xl:col-span-4">
          <Panel kicker="SECURITY NOTICE" title="风险提示">
            <div className="flex items-start gap-3">
              <ShieldOff size={20} className="mt-0.5 flex-none text-signal" />
              <div className="space-y-2 text-[10.5px] leading-relaxed text-ink-3">
                <p>放行路径将跳过平台 Token 校验，直接由后端服务处理。</p>
                <p>请勿放行包含业务数据、配置写入或用户信息的接口。</p>
                <p>新增路径后建议立即验证鉴权边界，并记录变更原因。</p>
              </div>
            </div>
          </Panel>
          <Panel kicker="POLICY SUMMARY" title="策略概览" bodyClassName="px-4 py-3">
            <div className="flex items-center justify-between border-b border-line py-2">
              <span className="label">放行路径</span>
              <span className="num text-[20px] text-ink">{list.length}</span>
            </div>
            <div className="flex items-center justify-between border-b border-line py-2">
              <span className="label">鉴权模式</span>
              <Badge tone="ok">TOKEN</Badge>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="label">网关</span>
              <span className="mono text-[10px] text-ink-3">ISTIO / ENVOY</span>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
