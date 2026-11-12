import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Command,
  Database,
  Grid2X2,
  HardDrive,
  HelpCircle,
  Layers,
  LogOut,
  Menu,
  Monitor,
  Network,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { findNav, flatNav, navigation } from '@/navigation'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
import type { UserInfo } from '@/types'
import { Button, Field, IconButton, Modal, StatusDot, ToastHost, useConfirm } from '@/components/ui'

/* ------------------------------------------------------------------ */
/* Module icons                                                        */
/* ------------------------------------------------------------------ */
const moduleIcons: Record<string, LucideIcon> = {
  '01': Monitor,
  '02': Layers,
  '03': Grid2X2,
  '04': Network,
  '05': HardDrive,
  '06': ShieldCheck,
  '07': Users,
  '08': Wrench,
  '09': Database,
}

/* ------------------------------------------------------------------ */
/* Profile modal                                                       */
/* ------------------------------------------------------------------ */
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
          <Button size="sm" variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
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

/* ------------------------------------------------------------------ */
/* Platform header                                                     */
/* ------------------------------------------------------------------ */
function PlatformHeader({
  onOpenPalette,
  onOpenMenu,
  onOpenQuickStart,
}: {
  onOpenPalette: () => void
  onOpenMenu: () => void
  onOpenQuickStart: () => void
}) {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const role = useAuthStore((state) => state.role)
  const clear = useAuthStore((state) => state.clear)
  const confirm = useConfirm()
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

  return (
    <header className="relative z-30 flex h-11 flex-none items-center justify-center border-b border-[#12314d] bg-[#0b1c2d] px-4">
      <button
        className="absolute left-3 flex h-7 w-7 items-center justify-center rounded border border-[#24405a] text-ink-3 lg:hidden"
        onClick={onOpenMenu}
        aria-label="打开菜单"
      >
        <Menu size={14} />
      </button>

      <span className="select-none truncate text-[15px] font-semibold tracking-[0.08em] text-[#eaf4ff]">
        微服务公共平台
      </span>

      <div className="absolute right-3 flex items-center gap-3">
        {modeQuery.data?.modeName && (
          <span className="hidden text-[12px] text-[#52a8ff] sm:block">{modeQuery.data.modeName}</span>
        )}
        <button
          onClick={onOpenPalette}
          aria-label="搜索功能"
          className="hidden h-7 w-7 items-center justify-center rounded text-[#7f9ab4] transition-colors hover:bg-white/5 hover:text-white sm:flex"
        >
          <Search size={14} />
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="flex h-7 items-center gap-1.5 rounded px-1 text-[12px] text-[#c8d8e8] outline-none transition-colors hover:text-white">
              <span>{user?.nickname || user?.username || '未登录'}</span>
              <ChevronDown size={11} className="text-[#7f9ab4]" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-[75] w-[220px] rounded border border-line bg-paper-2 p-0 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
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
                  className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-[#16304a] data-[highlighted]:text-white"
                >
                  <ShieldCheck size={13} /> 席位与角色
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => setProfileOpen(true)}
                  className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-[#16304a] data-[highlighted]:text-white"
                >
                  <UserRound size={13} /> 个人设置
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={onOpenQuickStart}
                  className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-[#16304a] data-[highlighted]:text-white"
                >
                  <HelpCircle size={13} /> 快速开始
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => navigate('/usermanage/settingGlobal')}
                  className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-[#16304a] data-[highlighted]:text-white"
                >
                  <Settings2 size={13} /> 全局设置
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => navigate('/setting/version')}
                  className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-ink-3 outline-none data-[highlighted]:bg-[#16304a] data-[highlighted]:text-white"
                >
                  <Command size={13} /> 平台版本与授权
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={logout}
                  className="flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[12px] text-danger outline-none data-[highlighted]:bg-[#3a1b22] data-[highlighted]:text-danger"
                >
                  <LogOut size={13} /> 退出登录
                </DropdownMenu.Item>
              </div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <span className="h-4 w-px bg-[#24405a]" />
        <button
          onClick={() => setProfileOpen(true)}
          aria-label="平台设置"
          className="flex h-7 w-7 items-center justify-center rounded text-[#4aa3f0] transition-colors hover:bg-white/5 hover:text-white"
        >
          <Settings2 size={16} />
        </button>
      </div>

      <ProfileModal open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Module bar                                                          */
/* ------------------------------------------------------------------ */
function ModuleBar({ activeIndex }: { activeIndex: string }) {
  const navigate = useNavigate()
  return (
    <nav className="scrollbar-thin flex flex-none items-stretch gap-1 overflow-x-auto border-b border-[#10293d] bg-[#0a1928] px-2 py-1.5">
      {navigation.map((group) => {
        const Icon = moduleIcons[group.index] ?? Monitor
        const active = activeIndex === group.index
        return (
          <button
            key={group.index}
            onClick={() => navigate(group.items[0].path)}
            className={cn(
              'flex h-[46px] w-[88px] flex-none flex-col items-center justify-center gap-1 rounded-[3px] border text-[12px] transition-colors',
              active
                ? 'border-[#2f7ec4] bg-[#15395b] text-white'
                : 'border-transparent text-[#a9c1d8] hover:border-[#1e3d5a] hover:bg-[#10293f] hover:text-white',
            )}
          >
            <Icon size={17} strokeWidth={1.7} className={active ? 'text-[#5cb3ff]' : 'text-[#4791d0]'} />
            <span className="truncate">{group.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/* Context sidebar                                                     */
/* ------------------------------------------------------------------ */
function Sidebar({
  groupIndex,
  onNavigate,
}: {
  groupIndex: string
  onNavigate?: () => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const clear = useAuthStore((state) => state.clear)
  const confirm = useConfirm()
  const group = navigation.find((item) => item.index === groupIndex) ?? navigation[0]
  const activeNav = findNav(location.pathname)
  const [collapsed, setCollapsed] = useState(false)

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

  return (
    <div className="flex h-full flex-col border-r border-[#10293d] bg-[#0a1928]">
      <nav className="scrollbar-thin flex-1 overflow-y-auto py-2">
        <button
          className="flex w-full items-center gap-1.5 px-3 pb-1.5 pt-1 text-left text-[12px] text-[#7f9ab4]"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
          <span>{group.label}</span>
        </button>
        {!collapsed &&
          group.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={() => cn('nav-item', activeNav?.path === item.path && 'active')}
            >
              <span className="flex-1 truncate">{item.label}</span>
            </NavLink>
          ))}
      </nav>
      <div className="border-t border-[#10293d] p-2">
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-[#7f9ab4] transition-colors hover:bg-white/5 hover:text-white"
        >
          <LogOut size={12} /> 退出登录
        </button>
      </div>
    </div>
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
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[85] bg-black/55" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-[16%] z-[86] w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 rounded border border-line bg-paper-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)] outline-none">
          <Dialog.Title className="sr-only">检索功能</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
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
                  'mx-1 flex w-[calc(100%-8px)] items-center gap-3 rounded px-3 py-2 text-left transition-colors',
                  index === active ? 'bg-[#16395a] text-white' : 'text-ink-3 hover:bg-[#142a3e]',
                )}
              >
                <span className={cn('text-[11px]', index === active ? 'text-[#7cc4ff]' : 'text-mute')}>
                  {item.group.label}
                </span>
                <span className="flex-1 text-[13px]">{item.label}</span>
                <span className={cn('text-[11px]', index === active ? 'text-[#7cc4ff]' : 'text-mute')}>
                  {item.en}
                </span>
                <ArrowRight size={12} className={index === active ? 'text-[#7cc4ff]' : 'text-line-strong'} />
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
      width={600}
      footer={
        <>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            稍后再说
          </Button>
          <Button
            size="sm"
            variant="primary"
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
            className="group flex w-full items-start gap-3 px-1 py-3 text-left transition-colors hover:bg-[#142a3e]"
            onClick={() => {
              navigate(step.path)
              onOpenChange(false)
            }}
          >
            <span className="mono mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded border border-line-strong text-[10px] text-ink-3">
              {step.code}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[12px] font-medium text-ink">
                {step.title}
                <ArrowRight size={10} className="text-mute transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-mute">{step.desc}</span>
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

  const activeGroup = findNav(location.pathname)?.group ?? navigation[0]

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
    <div className="flex h-screen flex-col overflow-hidden bg-paper">
      <PlatformHeader
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenMenu={() => setMobileOpen(true)}
        onOpenQuickStart={() => setQuickOpen(true)}
      />
      <ModuleBar activeIndex={activeGroup.index} />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[168px] flex-none lg:block">
          <Sidebar groupIndex={activeGroup.index} />
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[184px] border-r border-[#12314d] bg-[#0a1928]">
              <Sidebar groupIndex={activeGroup.index} onNavigate={() => setMobileOpen(false)} />
              <button
                className="absolute -right-9 top-2 flex h-7 w-7 items-center justify-center rounded border border-white/25 text-white"
                onClick={() => setMobileOpen(false)}
                aria-label="关闭菜单"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto p-3">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <QuickStartModal open={quickOpen} onOpenChange={setQuickOpen} />
      <ToastHost />
      <div className="fixed bottom-4 right-3 z-20 hidden lg:block">
        <IconButton label="检索 ⌘K" onClick={() => setPaletteOpen(true)}>
          <Command size={12} />
        </IconButton>
      </div>
    </div>
  )
}
