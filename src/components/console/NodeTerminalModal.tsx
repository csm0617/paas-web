import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { KeyRound, Loader2, RotateCw, Server, SquareTerminal, X } from 'lucide-react'
import SockJS from 'sockjs-client'
import { useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import type { NodeTerminalInfo } from '@/types'
import { Button, Field, Tip } from '@/components/ui'
import { cn } from '@/lib/utils'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api/gaop'
const ROWS = 30
const COLS = 80

type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

const stateLabel: Record<ConnState, string> = {
  idle: '等待凭据',
  connecting: '连接中',
  open: '已连接',
  closed: '已断开',
  error: '连接失败',
}

export function NodeTerminalModal({
  open,
  host,
  nodeName,
  onClose,
}: {
  open: boolean
  host: string
  nodeName: string
  onClose: () => void
}) {
  const [username, setUsername] = useState('root')
  const [password, setPassword] = useState('')
  const [info, setInfo] = useState<NodeTerminalInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conn, setConn] = useState<ConnState>('idle')
  const [attempt, setAttempt] = useState(0)
  const termHostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!open) return
    setInfo(null)
    setError(null)
    setConn('idle')
    setPassword('')
    setUsername('root')
    setAttempt(0)
  }, [open, host])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !info || !termHostRef.current) return
    const hostEl = termHostRef.current
    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: '"IBM Plex Mono", "SFMono-Regular", Menlo, monospace',
      lineHeight: 1.3,
      scrollback: 5000,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'underline',
      theme: {
        background: '#0d1012',
        foreground: '#d9d5c9',
        cursor: '#d8401d',
        cursorAccent: '#0d1012',
        selectionBackground: 'rgba(216,64,29,0.35)',
        black: '#14171a',
        red: '#e2481e',
        green: '#4aa880',
        yellow: '#d0a033',
        blue: '#6b93b3',
        magenta: '#b07aa1',
        cyan: '#5aa9a3',
        white: '#e6e1d5',
        brightBlack: '#6b7275',
        brightRed: '#ff6b45',
        brightGreen: '#6fc79c',
        brightYellow: '#e7bd5f',
        brightBlue: '#8db4d2',
        brightMagenta: '#c99bb9',
        brightCyan: '#7fc7c1',
        brightWhite: '#fffaf0',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostEl)
    try {
      fit.fit()
    } catch {
      /* ignore */
    }
    termRef.current = term
    term.writeln('\x1b[38;5;241mMSOP NODE SSH CONSOLE\x1b[0m')
    term.writeln(`\x1b[38;5;241mnode=${nodeName}  host=${host}  user=${username}\x1b[0m`)
    term.writeln('')

    let socket: InstanceType<typeof SockJS> | null = null
    let disposed = false
    const sendResize = () => {
      if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'resize', rows: Math.min(term.rows, ROWS), cols: Math.min(term.cols, COLS) }))
      }
    }
    const dataSub = term.onData((data) => {
      if (socket && socket.readyState === 1) socket.send(data)
    })
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        sendResize()
      } catch {
        /* ignore */
      }
    })
    observer.observe(hostEl)

    const timer = window.setTimeout(() => {
      if (disposed) return
      try {
        const separator = info.websocketPath.includes('?') ? '&' : '?'
        socket = new SockJS(
          `${API_BASE}${info.websocketPath}${separator}host=${encodeURIComponent(host)}&rows=${ROWS}&cols=${COLS}`,
        )
      } catch (err) {
        setConn('error')
        setError(errorMessage(err))
        return
      }
      setConn('connecting')
      socket.onopen = () => {
        setConn('open')
        setError(null)
        term.focus()
        window.setTimeout(sendResize, 250)
      }
      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') term.write(event.data)
      }
      socket.onclose = () => {
        setConn('closed')
        term.write('\r\n\x1b[31m[ssh session closed]\x1b[0m\r\n')
      }
      socket.onerror = () => {
        setConn('error')
        setError('SSH 终端连接失败，请检查凭据或网络。')
        term.write('\r\n\x1b[31m[ssh connection failed]\x1b[0m\r\n')
      }
    }, 300)

    return () => {
      disposed = true
      window.clearTimeout(timer)
      dataSub.dispose()
      observer.disconnect()
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
      term.dispose()
      termRef.current = null
    }
  }, [open, info, attempt, host, nodeName, username])

  async function connect(reset = true) {
    if (!username.trim() || !password) {
      setError('请输入 SSH 用户名与密码')
      return
    }
    setLoading(true)
    setError(null)
    setConn('connecting')
    try {
      const result = await api.post<NodeTerminalInfo>('/v1/pub/node/terminal', {
        host,
        username: username.trim(),
        password,
      })
      if (reset) setAttempt(0)
      setInfo(result)
      setAttempt((value) => value + 1)
    } catch (err) {
      setConn('error')
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#090b0d]/85 p-0 backdrop-blur-[3px] lg:p-5">
      <div className="flex h-full w-full max-w-[1180px] flex-col border border-[#2b3236] bg-[#101417] shadow-[0_30px_80px_rgba(0,0,0,0.55)] lg:h-[min(88vh,860px)]">
        <header className="flex h-14 flex-none items-center gap-3 border-b border-[#2b3236] bg-[#171b1f] px-4">
          <div className="flex h-8 w-8 items-center justify-center border border-signal/50 text-signal">
            <Server size={15} />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[7.5px] tracking-[0.24em] text-[#68716f]">NODE SSH CONSOLE / SOCKJS</div>
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[13.5px] font-medium text-[#ece7db]">{nodeName}</span>
              <span className="mono truncate text-[9px] text-[#7f8987]">{host} / {username}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex h-8 items-center gap-2 border border-[#343c41] px-2.5">
              <span
                className={cn(
                  'h-1.5 w-1.5',
                  conn === 'open' ? 'bg-[#3fa87a]' : conn === 'connecting' ? 'bg-[#d29a1c]' : conn === 'error' ? 'bg-signal' : 'bg-[#6b7275]',
                )}
              />
              <span className="font-mono text-[8.5px] tracking-[0.14em] text-[#aab1b0]">{stateLabel[conn]}</span>
            </div>
            <Tip content="重新获取 ticket 并连接">
              <button
                onClick={() => connect(false)}
                disabled={loading || !info}
                className="flex h-8 w-8 items-center justify-center border border-[#343c41] text-[#8b9492] transition-colors hover:border-[#59656b] hover:text-[#e7e2d5] disabled:opacity-40"
              >
                <RotateCw size={13} />
              </button>
            </Tip>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center border border-[#343c41] text-[#8b9492] transition-colors hover:border-signal hover:bg-signal hover:text-[#fff8ef]"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {!info ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="w-full max-w-[380px]">
              <div className="mb-4 flex items-center gap-2 text-[#d9d5c9]">
                <KeyRound size={14} className="text-signal" />
                <span className="text-[12px]">SSH 凭据验证</span>
              </div>
              <div className="space-y-3">
                <Field label="主机地址">
                  <input className="field border-[#3a4247] bg-[#1a1f23] font-mono text-[#d5d9d8]" value={host} disabled />
                </Field>
                <Field label="SSH 用户名" required>
                  <input
                    className="field border-[#3a4247] bg-[#1a1f23] font-mono text-[#d5d9d8]"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoFocus
                  />
                </Field>
                <Field label="SSH 密码" required>
                  <input
                    className="field border-[#3a4247] bg-[#1a1f23] text-[#d5d9d8]"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') connect()
                    }}
                  />
                </Field>
                {error && (
                  <div className="border-l-2 border-signal bg-signal/[0.08] px-3 py-2 text-[10.5px] leading-relaxed text-[#e7b1a4]">
                    {error}
                  </div>
                )}
                <Button
                  variant="signal"
                  className="w-full justify-between"
                  loading={loading}
                  onClick={() => connect()}
                >
                  <span>验证并打开终端</span>
                  <SquareTerminal size={13} />
                </Button>
                <p className="text-[9.5px] leading-relaxed text-[#68716f]">
                  凭据仅用于本次 SSH 会话，ticket 由后端一次性签发，不写入浏览器存储。
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1">
            <div ref={termHostRef} className="console-term h-full w-full" />
            {loading && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0d1012]/70">
                <div className="flex items-center gap-2 border border-[#343c41] bg-[#14181b] px-3 py-2">
                  <Loader2 size={12} className="animate-spin text-[#d29a1c]" />
                  <span className="font-mono text-[9px] tracking-[0.16em] text-[#aab1b0]">REQUESTING TICKET…</span>
                </div>
              </div>
            )}
            {conn === 'closed' && !loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#0d1012]/60">
                <div className="flex items-center gap-2 border border-[#343c41] bg-[#14181b] px-3 py-2">
                  <span className="h-1.5 w-1.5 bg-signal" />
                  <span className="font-mono text-[9px] tracking-[0.16em] text-[#aab1b0]">SSH SESSION CLOSED</span>
                  <button onClick={() => connect(false)} className="mono ml-2 text-[9px] tracking-widest text-signal hover:underline">
                    RECONNECT
                  </button>
                </div>
              </div>
            )}
            {conn === 'error' && error && (
              <div className="absolute bottom-2 left-2 right-2 border border-signal/40 bg-signal/[0.08] px-3 py-2 text-[10px] text-[#e7b1a4]">
                {error}
              </div>
            )}
          </div>
        )}

        <footer className="flex h-7 flex-none items-center gap-3 border-t border-[#262d31] bg-[#14181b] px-4 font-mono text-[8px] tracking-[0.14em] text-[#5f6967]">
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-1 bg-signal" />
            SOCKJS /node/exec
          </span>
          <span className="hidden sm:inline">HOST / {host}</span>
          <span className="hidden sm:inline">TTY / {COLS}×{ROWS}</span>
          <span className="ml-auto">ESC 关闭</span>
        </footer>
      </div>
    </div>
  )
}
