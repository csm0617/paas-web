import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatBytes, formatNumber } from '@/lib/format'
import { Panel } from '@/components/ui'
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

function StatusRing({
  running,
  stop,
  pending,
  size = 116,
  stroke = 9,
}: {
  running: number
  stop: number
  pending: number
  size?: number
  stroke?: number
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const total = Math.max(1, running + stop + pending)
  const segments = [
    { value: running, color: 'var(--color-ok)' },
    { value: stop, color: 'var(--color-danger)' },
    { value: pending, color: 'var(--color-warn)' },
  ]
  let offset = 0
  return (
    <div className="relative inline-flex flex-none items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        {segments.map((segment, index) => {
          const length = (segment.value / total) * circumference
          if (length <= 0) return null
          const dash = `${length} ${circumference - length}`
          const dashOffset = -offset
          offset += length
          return (
            <circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={dashOffset}
            />
          )
        })}
      </svg>
    </div>
  )
}

export default function ContainerOverviewPage() {
  const [topType, setTopType] = useState<'cpu' | 'mem'>('cpu')

  const overviewQuery = useQuery({
    queryKey: ['software-overview'],
    queryFn: () => api.post<OverView>('/v1/software/overView', {}),
    refetchInterval: 30_000,
  })
  const topQuery = useQuery({
    queryKey: ['software-top', topType],
    queryFn: () =>
      api.post<ContainerMetric[]>('/v1/software/top', {}, { type: topType, namespace: 'gaop-namespace' }),
    refetchInterval: 30_000,
  })

  const data = overviewQuery.data
  const top = (topQuery.data ?? []).slice(0, 5)

  const cards = [
    { key: 'software', label: '应用', value: data?.software },
    { key: 'service', label: '服务', value: data?.service },
    { key: 'pod', label: '容器', value: data?.pod },
  ]

  return (
    <div>
      <section className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => {
          const running = card.value?.running ?? 0
          const stop = card.value?.stop ?? 0
          const pending = card.value?.pending ?? 0
          const total = running + stop + pending
          return (
            <Panel key={card.key} bodyClassName="px-4 py-3">
              <div className="mb-1 text-center">
                <div className="text-[13px] text-ink">{card.label}</div>
                <div className="mt-0.5 text-[10.5px] text-mute">
                  全部{card.label} {total} 个
                </div>
              </div>
              <div className="flex items-center justify-center gap-5">
                <StatusRing running={running} stop={stop} pending={pending} />
                <div className="space-y-2 text-[11.5px] text-ink-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-[1px] bg-ok" />
                    运行中 {running} 个
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-[1px] bg-danger" />
                    停止 {stop} 个
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-[1px] bg-warn" />
                    未知 {pending} 个
                  </div>
                </div>
              </div>
            </Panel>
          )
        })}
      </section>

      <Panel
        title={
          <span>
            容器实例资源用量Top5 <span className="text-mute">(5分钟内)</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <span className="flex h-[30px] items-center border border-signal/60 bg-signal/10 px-3 text-[12px] text-signal">
              资源使用量 Top5
            </span>
            <select
              className="field h-[30px] w-[132px] text-[12px]"
              value={topType}
              onChange={(event) => setTopType(event.target.value as 'cpu' | 'mem')}
            >
              <option value="cpu">CPU使用量</option>
              <option value="mem">内存使用量</option>
            </select>
            <button
              onClick={() => {
                overviewQuery.refetch()
                topQuery.refetch()
              }}
              className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[3px] border border-line bg-paper-2 text-ink-3 transition-colors hover:border-signal hover:text-signal"
              aria-label="刷新"
            >
              <RefreshCw size={12} className={cn(topQuery.isFetching && 'animate-spin')} />
            </button>
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="table-scroll">
          <table className="data-table min-w-max">
            <thead>
              <tr>
                <th>Top5 容器实例</th>
                <th>CPU使用量</th>
                <th>内存使用量</th>
                <th>网络流出速率</th>
                <th>网络流入速率</th>
                <th>磁盘读取</th>
                <th>磁盘写入</th>
              </tr>
            </thead>
            <tbody>
              {top.map((item) => {
                const cpu = Number(item.cpuUsageRate ?? 0)
                return (
                  <tr key={item.podName}>
                    <td>
                      <span className="font-mono text-[11.5px] text-ink">{item.podName}</span>
                    </td>
                    <td>
                      <span className="num text-[12px] text-ink">{Math.round(cpu * 1000)}m</span>
                    </td>
                    <td>
                      <span className="mono text-[11.5px] text-ink-3">{formatBytes(Number(item.memory ?? 0))}</span>
                    </td>
                    <td>
                      <span className="mono text-[11.5px] text-ink-3">{rate(item.networkOutBound)}</span>
                    </td>
                    <td>
                      <span className="mono text-[11.5px] text-ink-3">{rate(item.networkInBound)}</span>
                    </td>
                    <td>
                      <span className="mono text-[11.5px] text-ink-3">{rate(item.diskRead)}</span>
                    </td>
                    <td>
                      <span className="mono text-[11.5px] text-ink-3">{rate(item.diskWrite)}</span>
                    </td>
                  </tr>
                )
              })}
              {top.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[11.5px] text-mute">
                    {topQuery.isLoading ? '正在采集容器指标…' : '暂无容器指标，可能监控组件尚未就绪'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2">
          <button
            className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30"
            disabled
            aria-label="上一页"
          >
            ‹
          </button>
          <span className="text-[11.5px] text-ink-3">
            当前显示 1-{top.length} 共 {top.length} 条
          </span>
          <button
            className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30"
            disabled
            aria-label="下一页"
          >
            ›
          </button>
          <select className="field ml-2 h-[26px] w-[112px] text-[11.5px]" defaultValue="5">
            <option value="5">每页显示 5 条</option>
            <option value="10">每页显示 10 条</option>
          </select>
        </div>
      </Panel>

      <div className="mt-4 flex items-center justify-between border border-line bg-paper-2 px-4 py-2 text-[11.5px] text-mute">
        <span>«</span>
        <span>内容仅显示资源使用前5名，如需查看更多，请进入容器页面</span>
        <span>»</span>
      </div>
    </div>
  )
}
