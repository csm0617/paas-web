import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, RefreshCw, Search, Square, TimerReset } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import type { ServiceItem, ServiceList } from '@/types'
import { toast } from '@/stores/toast'
import { Badge, Button, Field, PageHeader, Panel, StatusDot } from '@/components/ui'
import { cn } from '@/lib/utils'

export default function ServiceStartupPage() {
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [delay, setDelay] = useState('0')

  const query = useQuery({
    queryKey: ['startup-services'],
    queryFn: () => api.get<ServiceList>('/v1/service', { page: 1, size: 200 }),
    refetchInterval: 30_000,
  })

  const services = query.data?.services ?? []

  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    if (!text) return services
    return services.filter((service) =>
      (service.nameUs || service.nameFr || '').toLowerCase().includes(text),
    )
  }, [services, keyword])

  const startMutation = useMutation({
    mutationFn: () => api.post('/v1/service/startUp', { time: Number(delay) || 0, list: selected }),
    onSuccess: () => {
      toast.success('启动指令已下发')
      setSelected([])
      queryClient.invalidateQueries({ queryKey: ['startup-services'] })
    },
    onError: (error) => toast.error('启动失败', errorMessage(error)),
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.post('/v1/service/cancelStartUp', { list: selected }),
    onSuccess: () => {
      toast.success('已取消启动任务')
      setSelected([])
      queryClient.invalidateQueries({ queryKey: ['startup-services'] })
    },
    onError: (error) => toast.error('取消失败', errorMessage(error)),
  })

  function toggle(name: string) {
    setSelected((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    )
  }

  function statusOf(service: ServiceItem) {
    const ready = service.deployment?.status?.readyReplicas ?? 0
    const desired = service.deployment?.spec?.replicas ?? 0
    if (service.terminated) return { label: 'STOPPED', tone: 'default' as const }
    if (ready > 0) return { label: 'RUNNING', tone: 'ok' as const }
    if (desired > 0) return { label: 'PENDING', tone: 'warn' as const }
    return { label: 'STOPPED', tone: 'default' as const }
  }

  return (
    <div>
      <PageHeader
        index="02 / 05"
        en="SOFTWARE · STARTUP ORCHESTRATION"
        title="启动编排"
        description="按依赖顺序拉起服务。可设置批次间隔，避免数据库、缓存等基础服务尚未就绪导致业务启动失败。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={selected.length ? 'warn' : 'ok'} />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">
                {selected.length} SELECTED / {services.length} SERVICES
              </span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">DELAY {delay || 0}s</span>
          </>
        }
        actions={
          <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
            <RefreshCw size={11} /> 刷新
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-8"
          kicker="SERVICE QUEUE"
          title="服务清单"
          bodyClassName="p-0"
          actions={
            <div className="flex items-center gap-1.5 border border-line-strong bg-paper px-2">
              <Search size={11} className="text-mute" />
              <input
                className="h-7 w-40 bg-transparent font-mono text-[10px] text-ink outline-none placeholder:text-mute"
                placeholder="搜索服务"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
          }
        >
          <div className="max-h-[62vh] divide-y divide-line/70 overflow-y-auto">
            {filtered.map((service) => {
              const name = service.nameUs || service.nameFr
              const status = statusOf(service)
              const checked = selected.includes(name)
              return (
                <button
                  key={name}
                  onClick={() => toggle(name)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                    checked ? 'bg-ink text-paper' : 'hover:bg-paper-2/60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 flex-none items-center justify-center border',
                      checked ? 'border-signal bg-signal' : 'border-line-strong',
                    )}
                  >
                    {checked && <span className="h-1.5 w-1.5 bg-paper" />}
                  </span>
                  <StatusDot tone={status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : 'idle'} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{name}</span>
                  <span className={cn('mono text-[8.5px] tracking-widest', checked ? 'text-[#a9b0b3]' : 'text-mute')}>
                    {service.deployment?.status?.readyReplicas ?? 0}/{service.deployment?.spec?.replicas ?? 0}
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </button>
              )
            })}
            {filtered.length === 0 && !query.isLoading && (
              <div className="px-4 py-12 text-center text-[11px] text-mute">没有匹配的服务</div>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2">
            <button
              className="mono text-[8.5px] tracking-widest text-ink-3 hover:text-signal"
              onClick={() =>
                setSelected(
                  filtered.length && selected.length === filtered.length ? [] : filtered.map((s) => s.nameUs || s.nameFr),
                )
              }
            >
              {filtered.length && selected.length === filtered.length ? '取消全选' : '全选当前列表'}
            </button>
            <span className="mono text-[8.5px] tracking-widest text-mute">SELECTED / {selected.length}</span>
          </div>
        </Panel>

        <div className="space-y-4 lg:col-span-4">
          <Panel kicker="STARTUP PLAN" title="启动计划">
            <Field label="批次间隔（秒）" hint="每个服务启动后等待的秒数，0 表示连续启动">
              <input
                className="field font-mono"
                inputMode="numeric"
                value={delay}
                onChange={(event) => setDelay(event.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
              />
            </Field>
            <div className="mt-3 border border-line bg-paper-2/40 px-3 py-2">
              <div className="label mb-1">执行队列</div>
              <div className="text-[10px] leading-relaxed text-ink-3">
                {selected.length ? selected.join(' → ') : '尚未选择服务'}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="signal"
                disabled={!selected.length}
                loading={startMutation.isPending}
                onClick={() => startMutation.mutate()}
              >
                <Play size={11} /> 开始启动
              </Button>
              <Button
                size="sm"
                disabled={!selected.length}
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                <Square size={11} /> 取消启动
              </Button>
            </div>
          </Panel>

          <Panel kicker="NOTICE" title="编排建议">
            <div className="space-y-2 text-[10.5px] leading-relaxed text-ink-3">
              <p>建议按 数据库 → 缓存 → 中间件 → 业务服务 的顺序编排，并为批次设置 5–15 秒间隔。</p>
              <p>若服务依赖健康检查，请先在「服务配置」中启用就绪探针，确保启动完成后再拉起下一批。</p>
            </div>
            <div className="mt-3 flex items-center gap-2 border border-line px-2 py-1.5">
              <TimerReset size={11} className="text-mute" />
              <span className="mono text-[8.5px] tracking-widest text-mute">DELAY / {delay || 0} SEC</span>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
