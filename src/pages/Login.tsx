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
      setError('请输入用户名与密码')
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
      toast.success('登录成功', '正在进入控制台')
      navigate(redirect, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-4 py-10">
      <div className="mb-6 flex flex-col items-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-signal text-[22px] font-bold text-white shadow-[0_6px_16px_rgba(22,119,255,0.28)]">
          M
        </span>
        <h1 className="mt-4 text-[24px] font-semibold text-ink">机动微服务运行框架</h1>
        <p className="mt-1 text-[13px] text-mute">MSOP · Mobile Service Operation Platform</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}
        className="w-full max-w-[400px] rounded-lg border border-line bg-white px-7 py-7 shadow-[0_6px_20px_rgba(0,0,0,0.06)]"
      >
        <div className="mb-5">
          <h2 className="text-[18px] font-semibold text-ink">登录</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-mute">
            使用平台账户验证身份，所有操作将记录至审计日志。
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="用户名" required>
            <input
              className="field h-9"
              autoComplete="username"
              placeholder="请输入用户名"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value)
                setError(null)
              }}
            />
          </Field>

          <Field label="密码" required>
            <div className="relative">
              <input
                className="field h-9 pr-10"
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
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-mute transition-colors hover:bg-paper-3 hover:text-ink"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12px] text-ink-3">席位</span>
              <button
                type="button"
                onClick={() => setShowRole((prev) => !prev)}
                className="flex items-center gap-1 text-[12px] text-mute transition-colors hover:text-signal"
              >
                <LockKeyhole size={11} /> 更换
              </button>
            </div>
            {showRole || roles.length === 0 ? (
              <input
                className="field h-9"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                placeholder="席位标识，默认 admin"
              />
            ) : (
              <select className="field h-9" value={role} onChange={(event) => setRole(event.target.value)}>
                {roles.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.name} · {item.key}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-[#ffccc7] bg-[#fff2f0] px-3 py-2 text-[12px] leading-relaxed text-danger">
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
            <span className="text-[12px] text-ink-3">在此终端记住用户名</span>
          </label>

          <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-1 w-full justify-between">
            <span>{loading ? '正在登录' : '登录'}</span>
            <ArrowRight size={15} />
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between border-t border-line pt-4 text-[11px] text-mute">
          <span>MSOP CONSOLE</span>
          <span>BUILD 0.0.3 · {platformHost}</span>
        </div>
      </motion.div>

      <div className="mt-5 text-[11px] text-mute">会话令牌由平台网关签发，退出或失效后需重新认证</div>
    </div>
  )
}
