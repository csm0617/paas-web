import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Command,
  HelpCircle,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { findNav, flatNav, navigation } from '@/navigation'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
import type { ClusterSummary, NodeSummary, UserInfo } from '@/types'
import { Button, Field, IconButton, Modal, StatusDot, ToastHost, useConfirm } from '@/components/ui'

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */
function Brand() {
  return (
    <div className="flex h-[88px] flex-col justify-center border-b border-[#2a3034] px-5">
      <div className="flex items-center gap-2.5">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
          <rect x="0.5" y="0.5" width="25" height="25" fill="none" stroke="var(--color-signal)" strokeWidth="1" />
          <path d="M5 20V6l8 8 8-8v14" fill="none" stroke="var(--color-signal)" strokeWidth="2" />
          <path d="M2 2h4M20 2h4M2 24h4M20 24h4" stroke="#5c6468" strokeWidth="1" />
        </svg>
        <div className="leading-none">
          <div className="num text-[25px] tracking-[0.06em] text-[#f4f0e6]">MSOP</div>
          <div className="mt-1 font-mono text-[8px] tracking-[0.22em] text-[#7c8488]">CONSOLE / v0.0.3</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="h-px flex-1 bg-[#2a3034]" />
        <span className="font-mono text-[8.5px] tracking-[0.14em] text-[#6a7175]">机动微服务运行框架</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */
function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const role = useAuthStore((state) => state.role)
  const clear = useAuthStore((state) => state.clear)
  const confirm = useConfirm()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  async function logout() {
    const ok = await confirm({
      title: '退出当前会话？',
      description: '退出后需要重新验证身份才能访问平台。',
      confirmText: '退出登录',
      danger: true,
    })
    if (!ok) return
    try {
      await api.post('/v1/user/logout')
    } catch {
      /* backend may reject if session already gone */
    }
    clear()
    toast.info('会话已结束')
    navigate('/user/login', { replace: true })
  }

  const initials = (user?.nickname || user?.username || 'MS').slice(0, 2).toUpperCase()

  return (
    <div className="flex h-full flex-col bg-deck">
      <Brand />
      <nav className="scrollbar-thin flex-1 overflow-y-auto pb-4">
        {navigation.map((group) => {
          const isCollapsed = collapsed[group.index]
          const active = group.items.some((item) => location.pathname.startsWith(item.path))
          return (
            <div key={group.index} className="border-b border-[#242a2e]/70">
              <button
                className="flex w-full items-center gap-2 px-5 py-2.5 text-left transition-colors hover:bg-white/[0.025]"
                onClick={() => setCollapsed((prev) => ({ ...prev, [group.index]: !prev[group.index] }))}
              >
                <span className={cn('font-mono text-[8.5px] tracking-wider', active ? 'text-signal' : 'text-[#5d6569]')}>
                  {group.index}
                </span>
                <span
                  className={cn(
                    'flex-1 font-mono text-[9px] uppercase tracking-[0.2em]',
                    active ? 'text-[#d8d3c6]' : 'text-[#7c8488]',
                  )}
                >
                  {group.en}
                </span>
                {isCollapsed ? (
                  <ChevronRight size={11} className="text-[#5d6569]" />
                ) : (
                  <ChevronDown size={11} className="text-[#5d6569]" />
                )}
              </button>
              {!isCollapsed && (
                <div className="pb-1">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={onNavigate}
                      className={({ isActive }) => cn('nav-item', isActive && 'active')}
                    >
                      <span className="nav-index">{item.code}</span>
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="font-mono text-[7.5px] tracking-[0.12em] text-[#525a5e]">{item.en}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="border-t border-[#2a3034] p-3">
        <div className="flex items-center gap-2.5 border border-[#2e3539] bg-[#191d21] px-2.5 py-2">
          <div className="relative flex h-8 w-8 flex-none items-center justify-center border border-[#3c4448] bg-[#22282c]">
            <span className="mono text-[10px] text-[#cfc9ba]">{initials}</span>
            <span className="absolute -bottom-px -right-px h-1.5 w-1.5 bg-ok" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] text-[#e4dfd2]">{user?.nickname || user?.username || '未登录'}</div>
            <div className="truncate font-mono text-[8px] tracking-[0.12em] text-[#6f777b]">
              {role?.name || '—'} / {role?.key || '—'}
            </div>
          </div>
          <button
            onClick={logout}
            aria-label="退出登录"
            className="flex h-6 w-6 items-center justify-center border border-transparent text-[#6f777b] transition-colors hover:border-[#3c4448] hover:text-signal"
          >
            <LogOut size={12} />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <span className="font-mono text-[8px] tracking-[0.12em] text-[#565e62]">SESSION ENCRYPTED</span>
          <span className="font-mono text-[8px] tracking-[0.12em] text-[#565e62]">CN-SH</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Topbar                                                              */
/* ------------------------------------------------------------------ */
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function ProfileModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const [form, setForm] = useState({ nickname: '', email: '', phone: '', desc: '', password: '' })

  const detailQuery = useQuery({
    queryKey: ['profile-detail', user?.id],
    queryFn: () => api.get<UserInfo>('/v1/user/detailByUserId', { userId: user?.id }),
    enabled: open && !!user?.id,
  })
  const detail = detailQuery.data

  useEffect(() => {
    if (!detail) return
    setForm({
      nickname: detail.nickname || '',
      email: detail.email || '',
      phone: detail.phone || '',
      desc: detail.desc || '',
      password: '',
    })
  }, [detail])

  const mutation = useMutation({
    mutationFn: () => {
      const subRoleList = (detail as (UserInfo & { subRoles?: Array<{ key?: string }> }) | undefined)?.subRoles ?? []
      return api.put(`/v1/user/${user?.id}`, {
        username: user?.username,
        nickname: form.nickname.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        desc: form.desc.trim(),
        status: 1,
        avatar: detail?.avatar ?? null,
        roleListKey: (detail?.belongRole ?? []).map((item) => item.key).filter(Boolean),
        userListKey: subRoleList.map((item) => item.key).filter(Boolean),
        ...(form.password ? { password: form.password } : {}),
      })
    },
    onSuccess: () => {
      toast.success('个人信息已更新')
      if (user) {
        setUser({
          ...user,
          nickname: form.nickname.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          desc: form.desc.trim(),
        })
      }
      onOpenChange(false)
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  })

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      kicker="IDENTITY / PROFILE"
      title="个人设置"
      description="修改昵称、联系方式与密码。密码留空表示保持原密码不变。"
      width={480}
      footer={
        <>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" variant="signal" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            保存修改
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="登录账户">
          <input className="field font-mono" value={user?.username || ''} disabled />
        </Field>
        <Field label="昵称">
          <input
            className="field"
            value={form.nickname}
            onChange={(event) => setForm({ ...form, nickname: event.target.value })}
            placeholder="显示名称"
          />
        </Field>
        <Field label="邮箱">
          <input
            className="field"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            placeholder="name@example.com"
          />
        </Field>
        <Field label="手机号">
          <input
            className="field font-mono"
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
            placeholder="联系方式"
          />
        </Field>
        <Field label="描述" className="sm:col-span-2">
          <input
            className="field"
            value={form.desc}
            onChange={(event) => setForm({ ...form, desc: event.target.value })}
            placeholder="职责或备注"
          />
        </Field>
        <Field label="新密码" className="sm:col-span-2" hint="留空则保持原密码">
          <input
            className="field"
            type="password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="••••••"
          />
        </Field>
      </div>
    </Modal>
  )
}

function Topbar({
  onOpenMenu,
  onOpenPalette,
  onOpenQuickStart,
}: {
  onOpenMenu: () => void
  onOpenPalette: () => void
  onOpenQuickStart: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const now = useClock()
  const user = useAuthStore((state) => state.user)
  const role = useAuthStore((state) => state.role)
  const clear = useAuthStore((state) => state.clear)
  const confirm = useConfirm()
  const nav = findNav(location.pathname)
  const [profileOpen, setProfileOpen] = useState(false)
  const modeQuery = useQuery({
    queryKey: ['mode-current'],
    queryFn: () => api.get<{ mode?: string; modeName?: string; type?: number }>('/v1/mode/current'),
    staleTime: 60_000,
    retry: 0,
  })

  async function logout() {
    const ok = await confirm({
      title: '退出当前会话？',
      description: '退出后需要重新验证身份才能访问平台。',
      confirmText: '退出登录',
      danger: true,
    })
    if (!ok) return
    try {
      await api.post('/v1/user/logout')
    } catch {
      /* ignore */
    }
    clear()
    navigate('/user/login', { replace: true })
  }

  const clock = now.toLocaleTimeString('zh-CN', { hour12: false })
  const date = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')

  return (
    <header className="sticky top-0 z-30 flex h-14 flex-none items-center gap-3 border-b border-line-strong bg-paper/90 px-4 backdrop-blur-md lg:px-6">
      <button
        className="mr-1 flex h-8 w-8 items-center justify-center border border-line-strong text-ink lg:hidden"
        onClick={onOpenMenu}
        aria-label="打开菜单"
      >
        <Menu size={15} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-mute">
          <span>{nav?.group.en || 'PLATFORM'}</span>
          <ChevronRight size={9} />
          <span className="truncate text-ink-3">{nav?.en || 'CONSOLE'}</span>
        </div>
        <div className="mt-0.5 truncate text-[12.5px] font-medium text-ink">{nav?.label || '机动微服务运行框架'}</div>
      </div>

      <button
        onClick={onOpenPalette}
        className="hidden h-8 items-center gap-2 border border-line-strong bg-white/30 px-3 text-mute transition-colors hover:border-ink hover:text-ink sm:flex"
      >
        <Search size={12} />
        <span className="font-mono text-[9.5px] tracking-[0.1em]">检索功能 / 页面</span>
        <span className="key ml-2">⌘K</span>
      </button>

      {modeQuery.data?.modeName && (
        <div className="hidden items-center gap-2 border-l border-line pl-3 sm:flex">
          <span
            className={cn('h-1.5 w-1.5', modeQuery.data.mode === 'TRAIN' ? 'bg-info' : 'bg-signal')}
          />
          <span className="mono text-[9px] tracking-[0.16em] text-ink-3">{modeQuery.data.modeName}</span>
        </div>
      )}

      <div className="hidden items-center gap-2 border-l border-line pl-3 md:flex">
        <div className="text-right">
          <div className="mono text-[11px] leading-none tabular-nums text-ink">{clock}</div>
          <div className="mono mt-1 text-[8.5px] tracking-widest text-mute">{date} CST</div>
        </div>
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex h-8 items-center gap-2 border border-line-strong bg-white/25 pl-2 pr-2.5 transition-colors hover:border-ink">
            <span className="flex h-5 w-5 items-center justify-center bg-ink text-[8px] text-paper">
              {(user?.username || 'MS').slice(0, 2).toUpperCase()}
            </span>
            <span className="hidden max-w-[90px] truncate text-[11px] text-ink sm:block">{user?.nickname || user?.username}</span>
            <ChevronDown size={10} className="text-mute" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-[75] w-[230px] border border-ink bg-paper p-0 shadow-[5px_5px_0_rgba(21,24,27,0.14)]"
          >
            <div className="border-b border-line px-3.5 py-3">
              <div className="text-[12.5px] font-medium text-ink">{user?.nickname || user?.username}</div>
              <div className="mono mt-1 text-[9px] tracking-widest text-mute">UID · {user?.id || '—'}</div>
              <div className="mt-2 flex items-center gap-1.5">
                <StatusDot tone="ok" />
                <span className="text-[10px] text-ink-3">{role?.name || '未分配席位'}</span>
              </div>
            </div>
            <div className="py-1">
              <DropdownMenu.Item
                onSelect={() => navigate('/usermanage/role')}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[11.5px] text-ink-3 outline-none data-[highlighted]:bg-ink data-[highlighted]:text-paper"
              >
                <ShieldCheck size={12} /> 席位与角色
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => setProfileOpen(true)}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[11.5px] text-ink-3 outline-none data-[highlighted]:bg-ink data-[highlighted]:text-paper"
              >
                <UserRound size={12} /> 个人设置
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={onOpenQuickStart}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[11.5px] text-ink-3 outline-none data-[highlighted]:bg-ink data-[highlighted]:text-paper"
              >
                <HelpCircle size={12} /> 快速开始
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => navigate('/usermanage/settingGlobal')}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[11.5px] text-ink-3 outline-none data-[highlighted]:bg-ink data-[highlighted]:text-paper"
              >
                <Settings2 size={12} /> 全局设置
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => navigate('/setting/version')}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[11.5px] text-ink-3 outline-none data-[highlighted]:bg-ink data-[highlighted]:text-paper"
              >
                <Command size={12} /> 平台版本与授权
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={logout}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[11.5px] text-signal outline-none data-[highlighted]:bg-signal data-[highlighted]:text-paper"
              >
                <LogOut size={12} /> 退出登录
              </DropdownMenu.Item>
            </div>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <ProfileModal open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Status rail                                                         */
/* ------------------------------------------------------------------ */
function StatusRail() {
  const { data: summary } = useQuery({
    queryKey: ['cluster-summary'],
    queryFn: () => api.get<ClusterSummary>('/cloud/summary'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
  const { data: nodes } = useQuery({
    queryKey: ['nodes-summary'],
    queryFn: () => api.get<NodeSummary>('/cloud/nodesummary'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const items = [
    'MSOP / 机动微服务运行框架',
    `NODES ${nodes?.nodeInfo?.health ?? '—'}/${nodes?.nodeInfo?.total ?? '—'} HEALTHY`,
    `PODS ${summary?.static?.pod?.Running ?? '—'} RUNNING`,
    `CPU ${formatPercent(summary?.dynamic?.useRate?.cpu ?? nodes?.cpu?.[0]?.used)}`,
    `MEM ${formatPercent(summary?.dynamic?.useRate?.mem ?? nodes?.memory?.[0]?.used)}`,
    `SCHEDULABLE ${summary?.static?.node?.schedulable ?? '—'}`,
    'TELEMETRY STREAM ACTIVE',
    'API GATEWAY / ISTIO',
  ]
  const content = items.join('   ///   ')

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-30 flex h-7 items-center border-t border-[#2c3237] bg-deck px-3 text-[#8b9296] lg:left-[252px]">
      <span className="hidden flex-none items-center gap-1.5 border-r border-[#2c3237] pr-3 sm:flex">
        <StatusDot tone="ok" pulse />
        <span className="font-mono text-[8px] tracking-[0.18em] text-[#b3b8b8]">LIVE</span>
      </span>
      <div className="relative ml-0 flex-1 overflow-hidden">
        <div className="ticker-track font-mono text-[8px] tracking-[0.16em]">
          <span className="pr-10">{content}</span>
          <span className="pr-10">{content}</span>
        </div>
      </div>
      <div className="hidden flex-none items-center gap-3 border-l border-[#2c3237] pl-3 md:flex">
        <span className="font-mono text-[8px] tracking-[0.14em]">BUILD 0.0.3</span>
        <span className="font-mono text-[8px] tracking-[0.14em] text-[#6d7478]">172.16.209.170</span>
      </div>
    </footer>
  )
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */
function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return flatNav.filter(
      (item) =>
        !q ||
        item.label.toLowerCase().includes(q) ||
        item.en.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q),
    )
  }, [query])

  useEffect(() => {
    setActive(0)
  }, [query, open])

  function go(item: (typeof flatNav)[number]) {
    navigate(item.path)
    onOpenChange(false)
    setQuery('')
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[85] bg-ink/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-[16%] z-[86] w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 border border-ink bg-paper shadow-[10px_10px_0_rgba(21,24,27,0.16)] outline-none">
          <Dialog.Title className="sr-only">检索功能</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line-strong px-4 py-3">
            <Search size={15} className="text-mute" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive((prev) => Math.min(results.length - 1, prev + 1))
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((prev) => Math.max(0, prev - 1))
                }
                if (event.key === 'Enter' && results[active]) {
                  event.preventDefault()
                  go(results[active])
                }
              }}
              placeholder="输入模块名 / 英文标识 / 路径…"
              className="h-8 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-mute"
            />
            <span className="key">ESC</span>
          </div>
          <div className="max-h-[52vh] overflow-y-auto py-1">
            {results.length === 0 && (
              <div className="px-4 py-8 text-center text-[11.5px] text-mute">未找到匹配的功能</div>
            )}
            {results.map((item, index) => (
              <button
                key={item.path}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                  index === active ? 'bg-ink text-paper' : 'text-ink-3 hover:bg-paper-2',
                )}
              >
                <span
                  className={cn(
                    'font-mono text-[8.5px] tracking-wider',
                    index === active ? 'text-signal' : 'text-mute',
                  )}
                >
                  {item.group.index}.{item.code}
                </span>
                <span className="flex-1 text-[12px]">{item.label}</span>
                <span className={cn('font-mono text-[8px] tracking-[0.14em]', index === active ? 'text-[#a9aeb0]' : 'text-mute')}>
                  {item.en}
                </span>
                <ArrowRight size={11} className={index === active ? 'text-signal' : 'text-line-strong'} />
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2">
            <span className="font-mono text-[8.5px] tracking-widest text-mute">↑↓ 导航 · ENTER 跳转</span>
            <span className="font-mono text-[8.5px] tracking-widest text-mute">{results.length} RESULTS</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Quick start                                                        */
/* ------------------------------------------------------------------ */
const quickStartSteps = [
  { code: '01', title: '准备镜像', desc: '在镜像构建中上传或构建业务镜像，并推送到镜像仓库。', path: '/mirror/list' },
  { code: '02', title: '登记应用', desc: '在应用管理中新建应用，绑定镜像、端口与访问入口。', path: '/software/application' },
  { code: '03', title: '配置服务', desc: '调整环境变量、健康检查、存储挂载与节点调度策略。', path: '/software/application/service-params' },
  { code: '04', title: '观察运行', desc: '在状态监控与容器页面确认副本、日志与资源水位。', path: '/ops/status-monitor' },
]

function QuickStartModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (status: number) => api.post('/v1/pub/updateQuickStart', undefined, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['quick-start'] }),
  })

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      kicker="GUIDE / QUICK START"
      title="快速开始"
      description="四步完成一次业务应用的上线流程。点击任一步骤可直接进入对应功能页。"
      width={620}
      footer={
        <>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            稍后再说
          </Button>
          <Button
            size="sm"
            variant="signal"
            loading={mutation.isPending}
            onClick={() => {
              mutation.mutate(1)
              onOpenChange(false)
            }}
          >
            开始使用
          </Button>
        </>
      }
    >
      <div className="divide-y divide-line">
        {quickStartSteps.map((step) => (
          <button
            key={step.code}
            className="group flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-paper-2/60"
            onClick={() => {
              navigate(step.path)
              onOpenChange(false)
            }}
          >
            <span className="mono mt-0.5 flex h-6 w-6 flex-none items-center justify-center border border-line-strong text-[9px] text-ink-3">
              {step.code}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[12px] font-medium text-ink">
                {step.title}
                <ArrowRight size={10} className="text-mute transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-1 block text-[10.5px] leading-relaxed text-mute">{step.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* App shell                                                           */
/* ------------------------------------------------------------------ */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const location = useLocation()

  const quickStartQuery = useQuery({
    queryKey: ['quick-start'],
    queryFn: () => api.get<boolean>('/v1/pub/quickStart'),
    staleTime: Infinity,
    retry: false,
  })

  useEffect(() => {
    if (quickStartQuery.data !== false) return
    if (sessionStorage.getItem('msop.quickstart.shown')) return
    sessionStorage.setItem('msop.quickstart.shown', '1')
    setQuickOpen(true)
  }, [quickStartQuery.data])

  useEffect(() => {
    window.scrollTo({ top: 0 })
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[252px] animate-[reveal-up_.25s_ease]">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button
              className="absolute -right-10 top-3 flex h-8 w-8 items-center justify-center border border-paper/30 text-paper"
              onClick={() => setMobileOpen(false)}
              aria-label="关闭菜单"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-col lg:ml-[252px]">
        <Topbar
          onOpenMenu={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenQuickStart={() => setQuickOpen(true)}
        />
        <main className="flex-1 px-4 pb-12 pt-5 lg:px-6">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.34, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      <StatusRail />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <QuickStartModal open={quickOpen} onOpenChange={setQuickOpen} />
      <ToastHost />
      <div className="fixed bottom-7 right-4 z-20 hidden lg:block">
        <IconButton label="检索 ⌘K" onClick={() => setPaletteOpen(true)}>
          <Command size={12} />
        </IconButton>
      </div>
    </div>
  )
}
