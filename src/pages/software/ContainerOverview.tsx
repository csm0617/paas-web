import { useQuery } from '@tanstack/react-query'
import { Box, Cpu, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { formatBytes, formatNumber } from '@/lib/format'
import { Badge, Button, PageHeader, Panel, StatusDot } from '@/components/ui'
import { cn } from '@/lib/utils'

interface OverView {
  software?: { running?: number; stop?: number; pending?: number }
  service?: { running?: number; stop?: number; pending?: number }
  pod?: { running?: number; stop?: number; pending?: number }
}

interface ContainerMetric {
  podName: string
  cpuUsageRate?: string
  memory?: string
  networkOutBound?: string
  networkInBound?: string
  diskRead?: string
  diskWrite?: string
}

function rate(value?: string) {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '—'
  if (num >= 1024 * 1024) return `${formatNumber(num / 1024 / 1024, 2)} MB/s`
  if (num >= 1024) return `${formatNumber(num / 1024, 2)} KB/s`
  return `${formatNumber(num, 2)} B/s`
}

export default function ContainerOverviewPage() {
  const navigate = useNavigate()

  const overviewQuery = useQuery({
    queryKey: ['software-overview'],
    queryFn: () => api.post<OverView>('/v1/software/overView', {}),
    refetchInterval: 30_000,
  })
  const topQuery = useQuery({
    queryKey: ['software-top', 'cpu'],
    queryFn: () =>
      api.post<ContainerMetric[]>('/v1/software/top', {}, { type: 'cpu', namespace: 'gaop-namespace' }),
    refetchInterval: 30_000,
  })

  const data = overviewQuery.data
  const top = topQuery.data ?? []
  const maxCpu = Math.max(...top.map((item) => Number(item.cpuUsageRate ?? 0)), 1)

  const cards = [
    { key: 'software', label: '应用', en: 'APPLICATIONS', value: data?.software },
    { key: 'service', label: '服务', en: 'SERVICES', value: data?.service },
    { key: 'pod', label: '容器', en: 'CONTAINERS', value: data?.pod },
  ]

  return (
    <div>
      <PageHeader
        index="03 / 01"
        en="SOFTWARE · CONTAINER OVERVIEW"
        title="容器概览"
        description="以应用、服务与容器三个维度汇总运行状态，并展示最近 5 分钟内资源用量最高的容器实例。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={overviewQuery.isError ? 'warn' : 'ok'} pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {overviewQuery.isError ? 'METRICS DEGRADED' : 'NAMESPACE gaop-namespace'}
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">WINDOW 5 MIN</span>
          </>
        }
        actions={
          <Button
            size="sm"
            loading={overviewQuery.isFetching || topQuery.isFetching}
            onClick={() => {
              overviewQuery.refetch()
              topQuery.refetch()
            }}
          >
            <RefreshCw size={11} /> 刷新
          </Button>
        }
      />

      <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Panel key={card.key} bodyClassName="px-4 py-3.5">
            <div className="flex items-center justify-between">
              <div className="label">{card.label}</div>
              <span className="mono text-[8.5px] tracking-widest text-mute">{card.en}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="num text-[32px] leading-none text-ink">{card.value?.running ?? '—'}</span>
              <span className="text-[12px] text-mute">运行中</span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="warn">STOP {card.value?.stop ?? 0}</Badge>
              <Badge tone="info">PENDING {card.value?.pending ?? 0}</Badge>
            </div>
          </Panel>
        ))}
      </section>

      <Panel
        kicker="TOP 5 CONTAINERS · 5 MIN"
        title="容器实例资源用量 Top5"
        actions={
          <button
            onClick={() => navigate('/software/application/service')}
            className="mono text-[8.5px] tracking-widest text-mute hover:text-signal"
          >
            查看全部服务
          </button>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>容器实例</th>
                <th>CPU 使用量</th>
                <th>内存使用量</th>
                <th>网络流出速率</th>
                <th>网络流入速率</th>
                <th>磁盘读取</th>
                <th>磁盘写入</th>
              </tr>
            </thead>
            <tbody>
              {top.map((item, index) => {
                const cpu = Number(item.cpuUsageRate ?? 0)
                return (
                  <tr key={item.podName}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="mono w-5 text-[9px] text-mute">{String(index + 1).padStart(2, '0')}</span>
                        <Box size={12} className="text-mute" />
                        <span className="font-mono text-[10.5px] text-ink">{item.podName}</span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="num text-[12px] text-ink">{Math.round(cpu * 1000)}m</span>
                        <div className="h-[3px] w-16 bg-ink/[0.07]">
                          <div
                            className={cn('h-full', cpu / maxCpu > 0.8 ? 'bg-signal' : 'bg-ink')}
                            style={{ width: `${Math.min(100, (cpu / maxCpu) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="mono text-[10px] text-ink-3">{formatBytes(Number(item.memory ?? 0))}</span>
                    </td>
                    <td>
                      <span className="mono text-[10px] text-ink-3">{rate(item.networkOutBound)}</span>
                    </td>
                    <td>
                      <span className="mono text-[10px] text-ink-3">{rate(item.networkInBound)}</span>
                    </td>
                    <td>
                      <span className="mono text-[10px] text-mute">{rate(item.diskRead)}</span>
                    </td>
                    <td>
                      <span className="mono text-[10px] text-mute">{rate(item.diskWrite)}</span>
                    </td>
                  </tr>
                )
              })}
              {top.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[11px] text-mute">
                    {topQuery.isLoading ? '正在采集容器指标…' : '暂无容器指标，可能监控组件尚未就绪'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mono mt-4 flex items-center gap-2 text-[8px] tracking-wider text-mute">
        <Cpu size={10} /> 指标来源 PROMETHEUS · 容器指标按 5 分钟窗口聚合 · 单位 CPU m / 内存 B / 网络 B·s⁻¹
      </div>
    </div>
  )
}
