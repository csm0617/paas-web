import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Grid2X2, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import type { Software } from '@/types'
import { Badge, Button, PageHeader, Panel, StatusDot } from '@/components/ui'
import { cn } from '@/lib/utils'

const platformHost = (import.meta.env.VITE_PLATFORM_HOST as string | undefined) || '172.16.209.170'

interface SoftwareListResponse {
  softwareList: Software[]
  total: number
}

export default function AppPortalPage() {
  const user = useAuthStore((state) => state.user)
  const role = useAuthStore((state) => state.role)
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<'ALL' | 'BS' | 'CS'>('ALL')

  const query = useQuery({
    queryKey: ['software'],
    queryFn: () => api.get<SoftwareListResponse>('/v1/software', { page: 1, size: 100, order: 'orderTop', sort: 'desc' }),
  })

  const apps = query.data?.softwareList ?? []
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return apps.filter((app) => {
      const matchType = type === 'ALL' || (app.framework || app.type) === type
      const matchKeyword =
        !q ||
        app.name.toLowerCase().includes(q) ||
        app.key.toLowerCase().includes(q) ||
        (app.desc || '').toLowerCase().includes(q)
      return matchType && matchKeyword
    })
  }, [apps, keyword, type])

  const released = apps.filter((app) => app.releaseStatus === 1)

  function launch(app: Software) {
    if (!app.routerKey) return
    if (app.routerKey.startsWith('http')) window.location.href = app.routerKey
    else window.open(`http://${platformHost}${app.routerKey}`, '_blank', 'noopener')
  }

  return (
    <div>
      <PageHeader
        index="02 / 00"
        en="SOFTWARE · APPLICATION HALL"
        title="应用门户"
        description="当前席位可访问的业务应用。所有应用经平台网关统一暴露，入口权限由席位与放行策略共同决定。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{role?.name || '未分配席位'}</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">{user?.nickname || user?.username} · {released.length} RELEASED</span>
          </>
        }
        actions={
          <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
            <RefreshCw size={11} /> 刷新应用
          </Button>
        }
      />

      <section className="mb-4 rounded border border-line bg-paper-2 px-5 py-4">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] text-mute">应用门户 / APPLICATION HALL</div>
            <h2 className="mt-1.5 text-[22px] font-semibold text-ink">
              选择一个系统<span className="text-signal">开始作业</span>
            </h2>
            <p className="mt-1.5 max-w-[560px] text-[12px] leading-relaxed text-ink-3">
              应用入口已在网关侧完成鉴权与路由注册。若入口不可用，请联系平台管理员核查席位授权或服务状态。
            </p>
          </div>
          <div className="flex flex-none gap-6">
            <div>
              <div className="text-[11px] text-mute">可用应用</div>
              <div className="num mt-1 text-[28px] leading-none text-ink">{apps.length}</div>
            </div>
            <div className="border-l border-line pl-6">
              <div className="text-[11px] text-mute">当前席位</div>
              <div className="mt-2 text-[13px] text-ink">{role?.name || '—'}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="field h-8 w-[260px] pl-8 text-[12px]"
            placeholder="搜索应用名称 / 标识"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <div className="flex overflow-hidden rounded-md border border-line-strong">
          {(['ALL', 'BS', 'CS'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setType(item)}
              className={cn(
                'h-8 px-4 text-[12px] transition-colors',
                type === item ? 'bg-signal text-white' : 'text-ink-3 hover:bg-paper-2',
              )}
            >
              {item === 'ALL' ? '全部应用' : item}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[12px] text-mute">{filtered.length} 个应用</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {filtered.map((app, index) => {
          const available = app.releaseStatus === 1
          return (
            <button
              key={app.id}
              onClick={() => launch(app)}
              disabled={!app.routerKey}
              className={cn(
                'panel group relative flex min-h-[148px] flex-col p-0 text-left transition-all hover:-translate-y-0.5 hover:border-signal/30 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] disabled:cursor-not-allowed',
                !available && 'opacity-70',
              )}
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <div className="flex items-start gap-3 px-4 pt-4">
                <div className="relative flex h-12 w-12 flex-none items-center justify-center rounded-lg border border-line bg-paper-2">
                  {app.icon ? (
                    <img src={app.icon} alt="" className="h-8 w-8 object-contain" />
                  ) : (
                    <span className="num text-[22px] text-ink">{(app.name || app.key).slice(0, 1).toUpperCase()}</span>
                  )}
                  <span
                    className="absolute -bottom-px -right-px h-2 w-2"
                    style={{ background: available ? 'var(--color-ok)' : 'var(--color-line-strong)' }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-ink">{app.name}</span>
                    <Badge tone={app.type === 'CS' ? 'warn' : 'info'}>{app.type || 'BS'}</Badge>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-mute">{app.routerKey || '未登记入口'}</div>
                  <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-ink-3">
                    {app.desc || '平台已登记的业务应用，点击进入。'}
                  </p>
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-line px-4 py-2">
                <span className="flex items-center gap-1 text-[11px] text-mute">
                  <ShieldCheck size={11} /> {available ? '已发布' : '未发布'}
                </span>
                <span className="flex items-center gap-1 text-[12px] text-ink-3 transition-colors group-hover:text-signal">
                  打开应用 <ArrowUpRight size={11} />
                </span>
              </div>
            </button>
          )
        })}
        {filtered.length === 0 && !query.isLoading && (
          <div className="sm:col-span-2 2xl:col-span-3">
            <Panel>
              <div className="flex flex-col items-center gap-2 py-14 text-mute">
                <Grid2X2 size={26} strokeWidth={1.2} />
                <span className="text-[11.5px]">当前席位暂无可用应用</span>
                <span className="text-[10px]">请管理员在「应用管理」中登记应用并放行。</span>
              </div>
            </Panel>
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Panel kicker="GATEWAY" title="网关入口">
          <div className="mono text-[10px] text-ink-3">{platformHost}</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusDot tone="ok" />
            <span className="mono text-[8.5px] tracking-widest text-mute">ISTIO / ENVOY ROUTING</span>
          </div>
        </Panel>
        <Panel kicker="SESSION" title="当前身份">
          <div className="text-[12px] text-ink">{user?.nickname || user?.username}</div>
          <div className="mono mt-1 text-[8.5px] tracking-widest text-mute">ROLE / {role?.key || '—'}</div>
        </Panel>
        <Panel kicker="POLICY" title="访问策略">
          <div className="text-[11px] leading-relaxed text-ink-3">
            应用入口遵循席位授权与网关放行策略，未放行应用不会出现在门户中。
          </div>
        </Panel>
      </div>
    </div>
  )
}
