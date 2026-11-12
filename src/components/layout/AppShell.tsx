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
    <div className="flex h-16 flex-none items-center gap-2.5 border-b border-[#002140] px-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-signal text-[15px] font-bold text-white">
        M
      </span>
      <div className="leading-none">
        <div className="text-[17px] font-semibold tracking-[0.02em] text-white">MSOP</div>
        <div className="mt-1 text-[10px] tracking-[0.08em] text-white/45">机动微服务运行框架</div>
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
  const activeNav = findNav(location.pathname)

  return (
    <div className="flex h-full flex-col bg-deck">
      <Brand />
      <nav className="scrollbar-thin flex-1 overflow-y-auto pb-4">
        {navigation.map((group) => {
          const isCollapsed = collapsed[group.index]
          const active = group.items.some((item) => location.pathname.startsWith(item.path))
          return (
            <div key={group.index}>
              <button
                className="flex w-full items-center gap-2 px-6 pb-1.5 pt-4 text-left"
                onClick={() => setCollapsed((prev) => ({ ...prev, [group.index]: !prev[group.index] }))}
              >
                <span
                  className={cn(
                    'flex-1 text-[11px] tracking-[0.04em]',
                    active ? 'text-white/80' : 'text-white/40',
                  )}
                >
                  {group.en}
                </span>
                {isCollapsed ? (
                  <ChevronRight size={11} className="text-white/30" />
                ) : (
                  <ChevronDown size={11} className="text-white/30" />
                )}
              </button>
              {!isCollapsed && (
                <div className="pb-1">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={onNavigate}
                      className={() => cn('nav-item', activeNav?.path === item.path && 'active')}
                    >
                      <span className="flex-1 truncate">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="border-t border-[#002140] p-3">
        <div className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-white/5">
          <div className="relative flex h-8 w-8 flex-none items-center justify-center rounded-full bg-signal">
            <span className="text-[11px] font-medium text-white">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] text-white/85">{user?.nickname || user?.username || '未登录'}</div>
            <div className="truncate text-[11px] text-white/40">
              {role?.name || '未分配席位'}
            </div>
          </div>
          <button
            onClick={logout}
            aria-label="退出登录"
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut size={13} />
          </button>
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
    <header className="sticky top-0 z-30 flex h-14 flex-none items-center gap-3 border-b border-line bg-white px-4 lg:px-6">
      <button
        className="mr-1 flex h-8 w-8 items-center justify-center rounded-md border border-line-strong text-ink-3 lg:hidden"
        onClick={onOpenMenu}
        aria-label="打开菜单"
      >
        <Menu size={15} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12px] text-mute">
          <span>{nav?.group.label || '平台'}</span>
          <ChevronRight size={11} className="text-line-strong" />
          <span className="truncate text-ink-3">{nav?.label || '机动微服务运行框架'}</span>
        </div>
        <div className="mt-0.5 truncate text-[14px] font-medium text-ink">{nav?.label || '机动微服务运行框架'}</div>
      </div>

      <button
        onClick={onOpenPalette}
        className="hidden h-8 items-center gap-2 rounded-md border border-line bg-paper-2 px-3 text-mute transition-colors hover:border-signal hover:text-signal sm:flex"
      >
        <Search size={13} />
        <span className="text-[12px]">搜索功能 / 页面</span>
        <span className="key ml-2">⌘K</span>
      </button>

      {modeQuery.data?.modeName && (
        <div className="hidden items-center gap-1.5 rounded-md bg-[#e6f4ff] px-2.5 py-1 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-signal" />
          <span className="text-[11px] text-signal">{modeQuery.data.modeName}</span>
        </div>
      )}

      <div className="hidden items-center gap-2 border-l border-line pl-3 md:flex">
        <div className="text-right">
          <div className="text-[12px] leading-none tabular-nums text-ink-3">{clock}</div>
          <div className="mt-1 text-[10px] text-mute">{date}</div>
        </div>
      </div>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex h-8 items-center gap-2 rounded-md px-1.5 transition-colors hover:bg-paper-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-signal text-[10px] font-medium text-white">
              {(user?.username || 'MS').slice(0, 2).toUpperCase()}
            </span>
            <span className="hidden max-w-[90px] truncate text-[12px] text-ink sm:block">{user?.nickname || user?.username}</span>
            <ChevronDown size={11} className="text-mute" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-[75] w-[230px] rounded-lg border border-line bg-white p-0 shadow-[0_6px_16px_rgba(0,0,0,0.08)]"
          >
            <div className="border-b border-line px-3.5 py-3">
              <div className="text-[13px] font-medium text-ink">{user?.nickname || user?.username}</div>
              <div className="mt-1 text-[11px] text-mute">UID · {user?.id || '—'}</div>
              <div className="mt-2 flex items-center gap-1.5">
                <StatusDot tone="ok" />
                <span className="text-[11px] text-ink-3">{role?.name || '未分配席位'}</span>
              </div>
            </div>
            <div className="py-1">
              <DropdownMenu.Item
                onSelect={() => navigate('/usermanage/role')}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-paper-3 data-[highlighted]:text-ink"
              >
                <ShieldCheck size={13} /> 席位与角色
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => setProfileOpen(true)}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-paper-3 data-[highlighted]:text-ink"
              >
                <UserRound size={13} /> 个人设置
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={onOpenQuickStart}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-paper-3 data-[highlighted]:text-ink"
              >
                <HelpCircle size={13} /> 快速开始
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => navigate('/usermanage/settingGlobal')}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-paper-3 data-[highlighted]:text-ink"
              >
                <Settings2 size={13} /> 全局设置
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => navigate('/setting/version')}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-paper-3 data-[highlighted]:text-ink"
              >
                <Command size={13} /> 平台版本与授权
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={logout}
                className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-danger outline-none data-[highlighted]:bg-[#fff2f0] data-[highlighted]:text-danger"
              >
                <LogOut size={13} /> 退出登录
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
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[85] bg-black/25 backdrop-blur-[1px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-[16%] z-[86] w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 rounded-lg border border-line bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)] outline-none">
          <Dialog.Title className="sr-only">检索功能</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
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
              <div className="px-4 py-8 text-center text-[12px] text-mute">未找到匹配的功能</div>
            )}
            {results.map((item, index) => (
              <button
                key={item.path}
                onMouseEnter={() => setActive(index)}
                onClick={() => go(item)}
                className={cn(
                  'mx-1 flex w-[calc(100%-8px)] items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                  index === active ? 'bg-[#e6f4ff] text-signal' : 'text-ink-3 hover:bg-paper-3',
                )}
              >
                <span
                  className={cn(
                    'text-[10px] tracking-wider',
                    index === active ? 'text-signal' : 'text-mute',
                  )}
                >
                  {item.group.index}.{item.code}
                </span>
                <span className="flex-1 text-[13px]">{item.label}</span>
                <span className={cn('text-[10px] tracking-[0.06em]', index === active ? 'text-signal/70' : 'text-mute')}>
                  {item.en}
                </span>
                <ArrowRight size={12} className={index === active ? 'text-signal' : 'text-line-strong'} />
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-2">
            <span className="text-[11px] text-mute">↑↓ 导航 · ENTER 跳转</span>
            <span className="text-[11px] text-mute">{results.length} 个结果</span>
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
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[220px] lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/45" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[220px] animate-[reveal-up_.25s_ease]">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button
              className="absolute -right-10 top-3 flex h-8 w-8 items-center justify-center rounded-md border border-white/30 text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="关闭菜单"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-screen flex-col lg:ml-[220px]">
        <Topbar
          onOpenMenu={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenQuickStart={() => setQuickOpen(true)}
        />
        <main className="flex-1 bg-paper px-4 pb-10 pt-4 lg:px-6">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <QuickStartModal open={quickOpen} onOpenChange={setQuickOpen} />
      <ToastHost />
      <div className="fixed bottom-6 right-4 z-20 hidden lg:block">
        <IconButton label="检索 ⌘K" onClick={() => setPaletteOpen(true)}>
          <Command size={12} />
        </IconButton>
      </div>
    </div>
  )
}
