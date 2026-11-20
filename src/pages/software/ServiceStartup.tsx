import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import type { ServiceItem, ServiceList } from '@/types'
import { toast } from '@/stores/toast'
import { Button, Modal, PageToolbar, Panel } from '@/components/ui'
import { DataTable, type Column } from '@/components/DataTable'
import { cn } from '@/lib/utils'

function serviceName(service: ServiceItem) {
  return service.nameUs || service.nameFr
}

function serviceKey(service: ServiceItem) {
  return service.deployment?.metadata?.name || serviceName(service)
}

function serviceType(service: ServiceItem) {
  const type = service.deployment?.spec?.template?.metadata?.annotations?.['gaop/serviceType']
  if (type === '前台服务') return '前台服务'
  if (type === '后台服务') return '后台服务'
  return type || '—'
}

function delayTime(service: ServiceItem) {
  const value = service.deployment?.spec?.template?.metadata?.annotations?.['gaop/serviceInitTime']
  return value ? `${value} 秒` : '--'
}

export default function ServiceStartupPage() {
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [delayOpen, setDelayOpen] = useState(false)
  const [delay, setDelay] = useState('')

  const query = useQuery({
    queryKey: ['startup-services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 200 }),
    refetchInterval: 5_000,
  })

  const services = query.data?.services ?? []

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    if (!text) return services
    return services.filter((service) =>
      `${serviceName(service)} ${serviceKey(service)}`.toLowerCase().includes(text),
    )
  }, [services, keyword])

  const startMutation = useMutation({
    mutationFn: () => api.post('/v1/service/startUp', { time: Number(delay) || 0, list: selected }),
    onSuccess: () => {
      toast.success('延迟设置成功')
      setSelected([])
      setDelayOpen(false)
      setDelay('')
      queryClient.invalidateQueries({ queryKey: ['startup-services'] })
    },
    onError: (error) => toast.error('设置失败', errorMessage(error)),
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.post('/v1/service/cancelStartUp', { list: selected }),
    onSuccess: () => {
      toast.success('已取消延迟')
      setSelected([])
      queryClient.invalidateQueries({ queryKey: ['startup-services'] })
    },
    onError: (error) => toast.error('取消失败', errorMessage(error)),
  })

  const columns: Array<Column<ServiceItem>> = [
    {
      key: 'index',
      header: '序号',
      width: 240,
      align: 'center',
      cell: (_row, index) => <span className="text-[14px] text-ink">{index + 1}</span>,
    },
    {
      key: 'name',
      header: '服务名称',
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{serviceName(row)}</span>,
    },
    {
      key: 'key',
      header: '服务标识',
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{serviceKey(row)}</span>,
    },
    {
      key: 'type',
      header: '服务类型',
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{serviceType(row)}</span>,
    },
    {
      key: 'delay',
      header: '延迟时间',
      align: 'center',
      cell: (row) => <span className="text-[14px] text-ink">{delayTime(row)}</span>,
    },
  ]

  return (
    <div>
      <PageToolbar
        search={{ value: keyword, onChange: setKeyword, placeholder: '请输入服务名搜索' }}
      >
        <Button
          size="sm"
          variant="signal"
          disabled={selected.length === 0}
          onClick={() => setDelayOpen(true)}
        >
          设置延迟
        </Button>
        <Button
          size="sm"
          disabled={selected.length === 0}
          className={cn(
            'border-[#a01820] bg-[#a01820] text-white hover:border-[#c03039] hover:bg-[#b8202a]',
            selected.length === 0 &&
              'border-[#1e3448] bg-[#122434] text-[#4f6a82] hover:border-[#1e3448] hover:bg-[#122434]',
          )}
          loading={cancelMutation.isPending}
          onClick={() => cancelMutation.mutate()}
        >
          取消延迟
        </Button>
      </PageToolbar>

      <Panel bodyClassName="p-0">
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => serviceKey(row)}
          loading={query.isLoading}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          rowHeight={65}
          emptyTitle="暂无服务"
          emptyDescription="未检测到可设置延迟启动的服务。"
        />
      </Panel>

      <Modal
        open={delayOpen}
        onOpenChange={(open) => {
          setDelayOpen(open)
          if (!open) setDelay('')
        }}
        title="设置延迟"
        width={500}
        footer={
          <>
            <Button size="sm" onClick={() => setDelayOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="signal"
              loading={startMutation.isPending}
              disabled={!delay.trim() || Number(delay) < 5 || Number(delay) > 600}
              onClick={() => startMutation.mutate()}
            >
              确定
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-2 px-2 py-2">
          <span className="w-[90px] flex-none pt-[7px] text-right text-[14px] text-ink-3">
            <span className="text-danger">* </span>延迟时间：
          </span>
          <div className="flex min-w-0 flex-1">
            <input
              className="field h-8 flex-1 text-[14px]"
              inputMode="numeric"
              placeholder="5秒~600秒之间"
              value={delay}
              onChange={(event) => setDelay(event.target.value.replace(/[^\d]/g, ''))}
            />
            <span className="flex h-8 flex-none items-center border border-l-0 border-line-strong px-2 text-[14px] text-ink-3">
              秒
            </span>
          </div>
        </div>
      </Modal>
    </div>
  )
}
