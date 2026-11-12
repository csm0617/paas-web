import { ArrowRight, Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/stores/toast'
import type { LoginResult, RoleItem } from '@/types'
import { Button, Field } from '@/components/ui'

const platformHost = (import.meta.env.VITE_PLATFORM_HOST as string | undefined) || '172.16.209.170'

function Radar() {
  return (
    <svg viewBox="0 0 320 320" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="radar-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#d8401d" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#d8401d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#d8401d" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#d8401d" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="160" cy="160" r="150" fill="url(#radar-glow)" />
      {[42, 78, 114, 150].map((r) => (
        <circle key={r} cx="160" cy="160" r={r} fill="none" stroke="#3a4145" strokeWidth="0.8" />
      ))}
      <line x1="10" y1="160" x2="310" y2="160" stroke="#333a3e" strokeWidth="0.8" />
      <line x1="160" y1="10" x2="160" y2="310" stroke="#333a3e" strokeWidth="0.8" />
      <path d="M160 60 L176 160 L160 260 L144 160 Z" fill="#d8401d" opacity="0.03" />
      <g className="sweep" style={{ transformOrigin: '160px 160px' }}>
        <path d="M160 160 L160 10 A150 150 0 0 1 290 160 Z" fill="url(#sweep-grad)" opacity="0.5" />
        <line x1="160" y1="160" x2="160" y2="10" stroke="#d8401d" strokeWidth="1" />
      </g>
      {[
        [212, 96],
        [108, 214],
        [236, 204],
        [92, 112],
        [160, 72],
      ].map(([cx, cy], index) => (
        <g key={index}>
          <circle cx={cx} cy={cy} r="2.5" fill="#d8401d" opacity={0.8} />
          <circle cx={cx} cy={cy} r="7" fill="none" stroke="#d8401d" strokeWidth="0.6" opacity="0.35" />
        </g>
      ))}
      <text x="168" y="24" fill="#6b7377" fontSize="7" fontFamily="IBM Plex Mono" letterSpacing="1">
        N
      </text>
      <text x="296" y="166" fill="#6b7377" fontSize="7" fontFamily="IBM Plex Mono" letterSpacing="1">
        E
      </text>
      <text x="162" y="304" fill="#6b7377" fontSize="7" fontFamily="IBM Plex Mono" letterSpacing="1">
        S
      </text>
      <text x="14" y="166" fill="#6b7377" fontSize="7" fontFamily="IBM Plex Mono" letterSpacing="1">
        W
      </text>
    </svg>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = useAuthStore((state) => state.token)
  const setSession = useAuthStore((state) => state.setSession)
  const [username, setUsername] = useState(() => localStorage.getItem('msop.lastUser') || '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [showRole, setShowRole] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seatUser, setSeatUser] = useState('')
  const timerRef = useRef<number | null>(null)

  const rolesQuery = useQuery({
    queryKey: ['login-roles'],
    queryFn: () => api.get<{ list: RoleItem[]; total: number }>('/v1/role', { page: 1, size: 100 }),
    staleTime: 60_000,
  })
  const seatsQuery = useQuery({
    queryKey: ['login-user', seatUser],
    queryFn: () =>
      api.get<{ list: Array<{ username: string; lastLoginRole?: string }>; total: number }>('/v1/user/get', {
        page: 1,
        size: 100,
        keyword: seatUser,
      }),
    enabled: !!seatUser,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setSeatUser(username.trim()), 400)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [username])

  useEffect(() => {
    const target = seatsQuery.data?.list?.find((item) => item.username === seatUser)
    if (target?.lastLoginRole) setRole(target.lastLoginRole)
  }, [seatsQuery.data, seatUser])

  const roles = (rolesQuery.data?.list ?? []).filter((item) => item.key !== 'user')

  const redirectParam = params.get('r') || '/global/system-overview'
  const redirect = redirectParam.startsWith('/') && !redirectParam.startsWith('//') ? redirectParam : '/global/system-overview'

  if (token) return <Navigate to={redirect} replace />

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!username.trim() || !password) {
      setError('请输入用户标识与访问密钥')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await api.post<LoginResult>('/v1/user/login', {
        username: username.trim(),
        password,
        role: role.trim() || 'admin',
      })
      setSession(result)
      if (remember) localStorage.setItem('msop.lastUser', username.trim())
      toast.success('身份验证通过', '正在进入控制台')
      navigate(redirect, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-deck lg:grid-cols-[1.08fr_0.92fr]">
      {/* ---------------------------------------------------------- */}
      {/* Left / instrument panel                                     */}
      {/* ---------------------------------------------------------- */}
      <section className="relative hidden overflow-hidden border-r border-[#2b3236] lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0 opacity-[0.5]">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px)',
              backgroundSize: '64px 64px',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(216,64,29,0.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(216,64,29,0.09) 1px, transparent 1px)',
              backgroundSize: '256px 256px',
            }}
          />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d8401d]/60 to-transparent" />
          <div
            className="absolute -left-24 bottom-[-20%] h-[520px] w-[520px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(216,64,29,0.12), transparent 65%)' }}
          />
        </div>

        <div className="relative z-10 flex items-center justify-between px-10 pt-8">
          <div className="flex items-center gap-3">
            <svg width="30" height="30" viewBox="0 0 26 26" aria-hidden>
              <rect x="0.5" y="0.5" width="25" height="25" fill="none" stroke="#d8401d" strokeWidth="1" />
              <path d="M5 20V6l8 8 8-8v14" fill="none" stroke="#d8401d" strokeWidth="2" />
            </svg>
            <div>
              <div className="num text-[26px] leading-none tracking-[0.08em] text-[#f4f0e6]">MSOP</div>
              <div className="mono mt-1 text-[8px] tracking-[0.24em] text-[#727a7e]">MOBILE SERVICE OPERATION PLATFORM</div>
            </div>
          </div>
          <div className="flex items-center gap-2 border border-[#384044] px-2.5 py-1.5">
            <span className="h-1.5 w-1.5 bg-ok blink" />
            <span className="mono text-[8px] tracking-[0.18em] text-[#9aa1a4]">GATEWAY ONLINE</span>
          </div>
        </div>

        <div className="relative z-10 flex flex-1 items-center px-10">
          <div className="w-full max-w-[640px]">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
            >
              <div className="mb-5 flex items-center gap-3">
                <span className="h-px w-10 bg-signal" />
                <span className="mono text-[9px] tracking-[0.3em] text-[#8b9296]">SELF-DEVELOPED CONSOLE / 01</span>
              </div>
              <h1 className="serif-title text-[42px] leading-[1.15] text-[#f4f0e6]">
                机动平台
                <br />
                <span className="text-[#d8401d]">运行控制台</span>
              </h1>
              <p className="mt-5 max-w-[430px] text-[12.5px] leading-[1.9] text-[#8f9799]">
                面向机动环境的微服务运行与保障系统。集群状态、软件生命周期、网络编排与席位权限，纳入同一作战视野。
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.12, ease: [0.2, 0.7, 0.2, 1] }}
              className="mt-10 grid grid-cols-4 border-y border-[#2f363a]"
            >
              {[
                ['02', 'DOMAINS'],
                ['24', 'MODULES'],
                ['504', 'ENDPOINTS'],
                ['01', 'CLUSTER'],
              ].map(([value, label], index) => (
                <div key={label} className={index === 0 ? 'py-4 pr-4' : 'border-l border-[#2f363a] px-4 py-4'}>
                  <div className="num text-[32px] leading-none text-[#e7e2d5]">{value}</div>
                  <div className="mono mt-2 text-[8px] tracking-[0.2em] text-[#6f777b]">{label}</div>
                </div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
              className="mt-8 flex items-end gap-8"
            >
              <div className="h-[210px] w-[210px] flex-none">
                <Radar />
              </div>
              <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 pb-2">
                {[
                  ['CLUSTER', 'K8S 1.14.3'],
                  ['SERVICE MESH', 'ISTIO / ENVOY'],
                  ['NODE', platformHost],
                  ['REGION', 'CN-SH / ZONE-A'],
                  ['TELEMETRY', 'PROMETHEUS'],
                  ['AUTH', 'GATEWAY TOKEN'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="mono text-[8px] tracking-[0.16em] text-[#5f676b]">{k}</div>
                    <div className="mono mt-1 text-[10px] text-[#b9bfbf]">{v}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between border-t border-[#2b3236] px-10 py-4">
          <span className="mono text-[8px] tracking-[0.16em] text-[#5f676b]">BUILD 0.0.3 / SELF-DEVELOPED FRONTEND</span>
          <span className="mono text-[8px] tracking-[0.16em] text-[#5f676b]">NO EXTERNAL TELEMETRY</span>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {/* Right / credential form                                     */}
      {/* ---------------------------------------------------------- */}
      <section className="relative flex min-h-screen flex-col bg-paper">
        <div className="flex items-center justify-between px-6 pt-6 lg:px-10">
          <div className="flex items-center gap-2 lg:hidden">
            <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden>
              <rect x="0.5" y="0.5" width="25" height="25" fill="none" stroke="#d8401d" strokeWidth="1" />
              <path d="M5 20V6l8 8 8-8v14" fill="none" stroke="#d8401d" strokeWidth="2" />
            </svg>
            <span className="num text-[20px] tracking-[0.08em]">MSOP</span>
          </div>
          <span className="label hidden lg:block">访问控制 / ACCESS CONTROL</span>
          <div className="mono flex items-center gap-2 text-[9px] tracking-[0.14em] text-mute">
            <span className="h-1.5 w-1.5 bg-ok" />
            SECURE CHANNEL
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.2, 0.7, 0.2, 1] }}
            className="w-full max-w-[368px]"
          >
            <div className="mb-7">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-[2px] w-6 bg-signal" />
                <span className="mono text-[8.5px] tracking-[0.24em] text-mute">IDENTITY VERIFICATION</span>
              </div>
              <h2 className="serif-title text-[30px] leading-none text-ink">进入控制台</h2>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                使用平台账户验证身份。所有操作将记录至审计日志。
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <Field label="01 / 用户标识" required>
                <input
                  className="field field-lg"
                  autoComplete="username"
                  placeholder="请输入用户名"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value)
                    setError(null)
                  }}
                />
              </Field>

              <Field label="02 / 访问密钥" required>
                <div className="relative">
                  <input
                    className="field field-lg pr-10"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="请输入密码"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setError(null)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-mute transition-colors hover:text-ink"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </Field>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="label-ink">03 / 席位标识</span>
                  <button
                    type="button"
                    onClick={() => setShowRole((prev) => !prev)}
                    className="mono flex items-center gap-1 text-[9px] tracking-widest text-mute transition-colors hover:text-signal"
                  >
                    <LockKeyhole size={9} /> 更换
                  </button>
                </div>
                {showRole || roles.length === 0 ? (
                  <input
                    className="field"
                    value={role}
                    onChange={(event) => setRole(event.target.value)}
                    placeholder="席位标识，默认 admin"
                  />
                ) : (
                  <select className="field h-10" value={role} onChange={(event) => setRole(event.target.value)}>
                    {roles.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.name} · {item.key}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {error && (
                <div className="border-l-2 border-signal bg-signal/[0.05] px-3 py-2 text-[11px] leading-relaxed text-signal">
                  {error}
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  className="check"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span className="text-[11px] text-ink-3">在此终端记住用户标识</span>
              </label>

              <Button type="submit" variant="signal" size="lg" loading={loading} className="mt-2 w-full justify-between">
                <span>{loading ? '正在验证身份' : '验证并进入控制台'}</span>
                <ArrowRight size={15} />
              </Button>
            </form>

            <div className="mt-8 space-y-2 border-t border-line pt-4">
              <div className="flex items-start gap-2 text-[10px] leading-relaxed text-mute">
                <span className="mt-1 h-1 w-1 flex-none bg-signal" />
                会话令牌由平台网关签发，退出或失效后需重新认证。
              </div>
              <div className="mono flex items-center justify-between text-[8.5px] tracking-[0.14em] text-mute">
                <span>MSOP CONSOLE</span>
                <span>BUILD 0.0.3 / {platformHost}</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}
