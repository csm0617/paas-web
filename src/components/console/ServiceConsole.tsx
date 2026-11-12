import { useQuery } from '@tanstack/react-query'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import {
  ArrowDownToLine,
  CirclePause,
  CirclePlay,
  Eraser,
  Maximize2,
  Minimize2,
  PlugZap,
  RotateCw,
  ScrollText,
  Search,
  SquareTerminal,
  WrapText,
  X,
} from 'lucide-react'
import SockJS from 'sockjs-client'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { PodInfoItem, ServiceItem, ServiceLogData } from '@/types'
import { Badge, Tip } from '@/components/ui'
import { cn } from '@/lib/utils'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api/gaop'

type ConsoleMode = 'logs' | 'terminal'
type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'
type SockJsClient = InstanceType<typeof SockJS>

const ANSI_RE = /\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g

/* The gateway exec endpoint rejects oversized PTYs; clamp to a safe 80x30. */
const EXEC_COLS = 80
const EXEC_ROWS = 30

function stripAnsi(value: string) {
  return value.replace(ANSI_RE, '')
}

function formatHistory(block: { logs: Array<{ timeNano: string | number; log: string }> } | undefined) {
  if (!block?.logs?.length) return ''
  return block.logs
    .map((line) => {
      const date = new Date(Number(line.timeNano) / 1e6)
      const time = Number.isNaN(date.getTime())
        ? '--:--:--'
        : date.toLocaleTimeString('zh-CN', { hour12: false })
      return `[${time}] ${line.log.replace(/\n$/, '')}`
    })
    .join('\n')
}

function appendCapped(current: string, chunk: string) {
  const next = current + chunk
  return next.length > 900_000 ? next.slice(next.length - 700_000) : next
}

function highlightLine(line: string, keyword: string) {
  if (!keyword) return line
  const lower = line.toLowerCase()
  const target = keyword.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let index = lower.indexOf(target)
  let key = 0
  while (index >= 0 && key < 20) {
    if (index > cursor) parts.push(line.slice(cursor, index))
    parts.push(
      <mark key={key} className="bg-signal/35 px-0.5 text-[#ffe3d8]">
        {line.slice(index, index + keyword.length)}
      </mark>,
    )
    key += 1
    cursor = index + keyword.length
    index = lower.indexOf(target, cursor)
  }
  if (cursor < line.length) parts.push(line.slice(cursor))
  return parts
}

function StateDot({ state }: { state: ConnState }) {
  const tone =
    state === 'open'
      ? 'bg-[#3fa87a]'
      : state === 'connecting'
        ? 'bg-[#d29a1c]'
        : state === 'error'
          ? 'bg-signal'
          : 'bg-[#6b7275]'
  return (
    <span className="relative flex h-2 w-2 flex-none">
      <span className={cn('absolute inline-flex h-full w-full opacity-40', tone, state !== 'idle' && 'animate-ping')} />
      <span className={cn('relative inline-flex h-2 w-2', tone)} />
    </span>
  )
}

const stateLabel: Record<ConnState, string> = {
  idle: '待连接',
  connecting: '连接中',
  open: '已连接',
  closed: '已断开',
  error: '连接失败',
}

export interface ServiceConsoleProps {
  open: boolean
  serviceName: string
  initialMode?: ConsoleMode
  onClose: () => void
  podOverride?: string
  namespaceOverride?: string
  containerOverride?: string
}

export function ServiceConsole({
  open,
  serviceName,
  initialMode = 'logs',
  onClose,
  podOverride,
  namespaceOverride,
  containerOverride,
}: ServiceConsoleProps) {
  const [mode, setMode] = useState<ConsoleMode>(initialMode)
  const [pod, setPod] = useState('')
  const [container, setContainer] = useState('')
  const [conn, setConn] = useState<ConnState>('idle')
  const [reconnectKey, setReconnectKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [logText, setLogText] = useState('')
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [maximized, setMaximized] = useState(false)

  const logRef = useRef<HTMLDivElement | null>(null)
  const logSocketRef = useRef<SockJsClient | null>(null)
  const termHostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const termSocketRef = useRef<SockJsClient | null>(null)
  const pausedRef = useRef(false)
  const pendingRef = useRef('')
  const seedKeyRef = useRef('')
  const attemptRef = useRef(0)

  const podsQuery = useQuery({
    queryKey: ['console-pods', serviceName],
    queryFn: () => api.get<PodInfoItem[]>('/v1/pub/podInfo', { nameList: serviceName }),
    enabled: open && !!serviceName && !podOverride,
    refetchInterval: open && !podOverride ? 15_000 : false,
  })
  const detailQuery = useQuery({
    queryKey: ['console-service-detail', serviceName],
    queryFn: () => api.get<ServiceItem>(`/v1/service/${encodeURIComponent(serviceName)}`),
    enabled: open && !!serviceName && !podOverride,
    staleTime: 60_000,
  })
  const historyQuery = useQuery({
    queryKey: ['console-history', serviceName],
    queryFn: () => api.post<ServiceLogData>('/v1/service/logs', { serviceName, size: 1000 }),
    enabled: open && !!serviceName && !podOverride,
    staleTime: 30_000,
  })

  const pods = useMemo(() => {
    if (podOverride) return [{ name: serviceName, podName: podOverride, status: 'RUNNING' } as PodInfoItem]
    const list = podsQuery.data ?? []
    const running = list.filter((item) => (item.status || '').toUpperCase() === 'RUNNING')
    return running.length ? running : list
  }, [podsQuery.data, podOverride, serviceName])

  const namespace =
    namespaceOverride ||
    detailQuery.data?.deployment?.metadata?.namespace ||
    detailQuery.data?.service?.metadata?.namespace ||
    'gaop-namespace'

  const containers = useMemo(() => {
    if (containerOverride) return [containerOverride]
    const names = new Set<string>()
    const historyPods = historyQuery.data?.podLogs ?? []
    historyPods
      .find((item) => item.podName === pod)
      ?.containerLogs?.forEach((item) => names.add(item.containerName))
    const spec = detailQuery.data?.deployment?.spec?.template?.spec
    const declared = (spec as { containers?: Array<{ name: string }> } | undefined)?.containers ?? []
    declared.forEach((item) => names.add(item.name))
    if (names.size === 0 && serviceName) names.add(serviceName)
    return Array.from(names)
  }, [detailQuery.data, historyQuery.data, pod, serviceName, containerOverride])

  const historyBlock = useMemo(() => {
    return historyQuery.data?.podLogs
      ?.find((item) => item.podName === pod)
      ?.containerLogs?.find((item) => item.containerName === container)
  }, [historyQuery.data, pod, container])

  const historyText = useMemo(() => formatHistory(historyBlock), [historyBlock])

  /* reset on service / open */
  useEffect(() => {
    if (!open) return
    setMode(initialMode)
    setPod('')
    setContainer('')
    setLogText('')
    setKeyword('')
    setError(null)
    attemptRef.current = 0
    setConn('idle')
    seedKeyRef.current = ''
    pendingRef.current = ''
    pausedRef.current = false
    setPaused(false)
  }, [open, serviceName, initialMode])

  /* auto-select pod */
  useEffect(() => {
    if (!open) return
    if (!pod && pods.length) {
      setPod(pods[0].podName)
      return
    }
    if (pod && pods.length && !pods.some((item) => item.podName === pod)) {
      setPod(pods[0].podName)
    }
  }, [open, pods, pod])

  /* auto-select container */
  useEffect(() => {
    if (!open || containers.length === 0) return
    if (!container || !containers.includes(container)) setContainer(containers[0])
  }, [open, containers, container])

  /* seed historical logs */
  useEffect(() => {
    if (!open || mode !== 'logs' || !pod || !container) return
    if (podOverride) return
    if (historyQuery.isLoading) return
    const key = `${pod}|${container}`
    if (seedKeyRef.current === key) return
    seedKeyRef.current = key
    setLogText(historyText ? `${historyText}\n` : '')
  }, [open, mode, pod, container, historyQuery.isLoading, historyText, podOverride])

  useEffect(() => {
    pausedRef.current = paused
    if (!paused && pendingRef.current) {
      const buffered = pendingRef.current
      pendingRef.current = ''
      setLogText((prev) => appendCapped(prev, buffered))
    }
  }, [paused])

  /* live logs socket */
  useEffect(() => {
    if (!open || mode !== 'logs' || !pod || !container) return
    if (historyQuery.isLoading) return
    setError(null)
    setConn('connecting')
    let socket: SockJsClient | null = null
    let disposed = false
    const timer = window.setTimeout(() => {
      if (disposed) return
      try {
        socket = new SockJS(
          `${API_BASE}/logs?pod=${encodeURIComponent(pod)}&container=${encodeURIComponent(container)}&namespace=${encodeURIComponent(namespace)}`,
        )
      } catch (err) {
        setConn('error')
        setError(errorMessage(err))
        return
      }
      logSocketRef.current = socket
      socket.onopen = () => {
        setConn('open')
        setError(null)
      }
      socket.onmessage = (event: MessageEvent) => {
        const chunk = typeof event.data === 'string' ? stripAnsi(event.data) : ''
        if (!chunk) return
        if (pausedRef.current) {
          pendingRef.current = appendCapped(pendingRef.current, chunk)
          return
        }
        setLogText((prev) => appendCapped(prev, chunk))
      }
      socket.onclose = () => setConn((prev) => (prev === 'error' ? 'error' : 'closed'))
      socket.onerror = () => {
        setConn('error')
        setError('实时日志连接失败，请确认 Pod 处于运行状态且网关支持 SockJS。')
      }
    }, 500)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
      if (logSocketRef.current === socket) logSocketRef.current = null
    }
  }, [open, mode, pod, container, namespace, historyQuery.isLoading, reconnectKey])

  /* terminal */
  useEffect(() => {
    if (!open || mode !== 'terminal' || !pod || !termHostRef.current) return
    const host = termHostRef.current
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
    term.open(host)
    try {
      fit.fit()
    } catch {
      /* ignore */
    }
    termRef.current = term
    term.writeln('\x1b[38;5;241mMSOP CONTAINER SHELL\x1b[0m')
    term.writeln(`\x1b[38;5;241mpod=${pod}  namespace=${namespace}\x1b[0m`)
    term.writeln('')
    setError(null)
    setConn('connecting')

    let socket: SockJsClient | null = null
    let disposed = false
    let gotShell = false
    const sendResize = () => {
      if (socket && socket.readyState === 1) {
        socket.send(
          JSON.stringify({
            type: 'resize',
            rows: Math.min(term.rows, EXEC_ROWS),
            cols: Math.min(term.cols, EXEC_COLS),
          }),
        )
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
    observer.observe(host)

    /* The gateway may keep the previous exec session briefly; delay avoids a race. */
    const connectTimer = window.setTimeout(() => {
      if (disposed) return
      try {
        const rows = Math.min(term.rows, EXEC_ROWS)
        const cols = Math.min(term.cols, EXEC_COLS)
        socket = new SockJS(`${API_BASE}/exec?pod=${encodeURIComponent(pod)}&rows=${rows}&cols=${cols}`)
      } catch (err) {
        setConn('error')
        setError(errorMessage(err))
        return
      }
      termSocketRef.current = socket
      socket.onopen = () => {
        setConn('open')
        setError(null)
        term.focus()
        window.setTimeout(sendResize, 250)
      }
      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return
        if (!/bash.*not found|连接 Pod 终端失败|无法打开终端/.test(event.data)) {
          if (event.data.trim()) gotShell = true
          term.write(event.data)
          return
        }
        term.write(event.data)
        setError('目标镜像不包含 bash，正在重建 exec 会话并尝试 sh…')
      }
      socket.onclose = () => {
        if (gotShell) {
          setConn('closed')
          term.write('\r\n\x1b[31m[connection closed]\x1b[0m\r\n')
          return
        }
        if (attemptRef.current < 2 && !disposed) {
          attemptRef.current += 1
          term.write(`\r\n\x1b[33m[exec init failed, retry ${attemptRef.current}/2]\x1b[0m\r\n`)
          window.setTimeout(() => {
            if (!disposed) setReconnectKey((key) => key + 1)
          }, 900)
          return
        }
        setConn('closed')
        setError('目标镜像不包含 bash，且平台 exec 未回退到 sh；请更换含 bash 的镜像或联系管理员。')
        term.write('\r\n\x1b[31m[no bash in image / sh fallback unavailable]\x1b[0m\r\n')
      }
      socket.onerror = () => {
        setConn('error')
        setError('容器终端连接失败，请确认 Pod 处于运行状态。')
        term.write('\r\n\x1b[31m[connection failed]\x1b[0m\r\n')
      }
    }, 700)

    return () => {
      disposed = true
      window.clearTimeout(connectTimer)
      dataSub.dispose()
      observer.disconnect()
      try {
        socket?.close()
      } catch {
        /* ignore */
      }
      if (termSocketRef.current === socket) termSocketRef.current = null
      term.dispose()
      termRef.current = null
    }
  }, [open, mode, pod, namespace, reconnectKey])

  /* scrolling / body lock / esc */
  useEffect(() => {
    if (autoScroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logText, autoScroll, mode])

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

  const displayLines = useMemo(() => {
    const lines = logText.split('\n')
    return lines.length > 5000 ? lines.slice(lines.length - 5000) : lines
  }, [logText])

  const matchCount = useMemo(() => {
    if (!keyword.trim()) return 0
    const value = keyword.trim().toLowerCase()
    return displayLines.filter((line) => line.toLowerCase().includes(value)).length
  }, [displayLines, keyword])

  if (!open) return null

  const reconnect = () => {
    attemptRef.current = 0
    setConn('connecting')
    setError(null)
    setReconnectKey((key) => key + 1)
  }

  const clearLogs = () => {
    setLogText('')
    pendingRef.current = ''
    seedKeyRef.current = `${pod}|${container}`
  }

  const downloadLogs = () => {
    const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${serviceName}-${pod}-${container}-${Date.now()}.log`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const darkSelect =
    'h-8 max-w-[260px] border border-[#343c41] bg-[#1a1f23] px-2 font-mono text-[10px] text-[#c8cecd] outline-none transition-colors hover:border-[#59656b] focus:border-[#d8401d]'

  return (
    <div className="fixed inset-0 z-[95] flex bg-[#090b0d]/80 backdrop-blur-[3px]" role="dialog" aria-modal="true">
      <div
        className={cn(
          'mx-auto flex h-full w-full flex-col border border-[#2b3236] bg-[#101417] shadow-[0_30px_80px_rgba(0,0,0,0.55)]',
          maximized ? 'max-w-none' : 'max-w-[1560px] lg:my-4 lg:h-[calc(100%-32px)]',
        )}
      >
        {/* header */}
        <header className="flex h-14 flex-none items-center gap-3 border-b border-[#2b3236] bg-[#171b1f] px-4">
          <div className="flex h-8 w-8 flex-none items-center justify-center border border-signal/50 text-signal">
            <SquareTerminal size={15} />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[7.5px] tracking-[0.24em] text-[#68716f]">CONTAINER CONSOLE / SOCKJS</div>
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[13.5px] font-medium text-[#ece7db]">{serviceName}</span>
              <span className="mono truncate text-[9px] text-[#7f8987]">
                {pod || 'NO POD'} / {container || 'NO CONTAINER'}
              </span>
            </div>
          </div>

          <div className="ml-3 flex h-8 border border-[#343c41]">
            {(
              [
                { value: 'logs', label: '实时日志', icon: <ScrollText size={11} /> },
                { value: 'terminal', label: '容器终端', icon: <SquareTerminal size={11} /> },
              ] as const
            ).map((item) => (
              <button
                key={item.value}
                onClick={() => setMode(item.value)}
                className={cn(
                  'flex items-center gap-1.5 px-3 font-mono text-[9.5px] tracking-[0.12em] transition-colors',
                  mode === item.value
                    ? 'bg-signal text-[#fff8ef]'
                    : 'text-[#8b9492] hover:bg-white/[0.04] hover:text-[#d5d9d8]',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex h-8 items-center gap-2 border border-[#343c41] px-2.5">
              <StateDot state={conn} />
              <span className="font-mono text-[8.5px] tracking-[0.14em] text-[#aab1b0]">{stateLabel[conn]}</span>
            </div>
            <button
              onClick={reconnect}
              className="flex h-8 w-8 items-center justify-center border border-[#343c41] text-[#8b9492] transition-colors hover:border-[#59656b] hover:text-[#e7e2d5]"
              title="重新连接"
            >
              <RotateCw size={13} />
            </button>
            <button
              onClick={() => setMaximized((value) => !value)}
              className="hidden h-8 w-8 items-center justify-center border border-[#343c41] text-[#8b9492] transition-colors hover:border-[#59656b] hover:text-[#e7e2d5] lg:flex"
              title={maximized ? '还原' : '最大化'}
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center border border-[#343c41] text-[#8b9492] transition-colors hover:border-signal hover:bg-signal hover:text-[#fff8ef]"
              title="关闭控制台"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {/* toolbar */}
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-[#262d31] bg-[#14181b] px-4 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] tracking-[0.16em] text-[#68716f]">POD</span>
            <select className={darkSelect} value={pod} onChange={(event) => setPod(event.target.value)}>
              {pods.length === 0 && <option value="">无运行 Pod</option>}
              {pods.map((item) => (
                <option key={item.podName} value={item.podName}>
                  {item.podName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[8px] tracking-[0.16em] text-[#68716f]">CONTAINER</span>
            <select className={darkSelect} value={container} onChange={(event) => setContainer(event.target.value)}>
              {containers.length === 0 && <option value="">无容器</option>}
              {containers.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="hidden h-5 w-px bg-[#2b3236] sm:block" />
          <span className="hidden font-mono text-[8px] tracking-[0.14em] text-[#68716f] sm:inline">NS / {namespace}</span>

          {mode === 'logs' && (
            <>
              <div className="relative ml-auto">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#6b7472]" />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="检索日志"
                  className="h-8 w-[180px] border border-[#343c41] bg-[#1a1f23] pl-7 pr-14 font-mono text-[10px] text-[#d5d9d8] outline-none transition-colors placeholder:text-[#5e6765] focus:border-[#d8401d]"
                />
                {keyword && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[8px] text-[#7f8987]">
                    {matchCount} 行
                  </span>
                )}
              </div>
              <Tip content={paused ? '继续接收日志' : '暂停接收日志'}>
                <button
                  onClick={() => setPaused((value) => !value)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center border transition-colors',
                    paused
                      ? 'border-warn/60 bg-warn/15 text-[#e0b04a]'
                      : 'border-[#343c41] text-[#8b9492] hover:border-[#59656b] hover:text-[#e7e2d5]',
                  )}
                >
                  {paused ? <CirclePlay size={13} /> : <CirclePause size={13} />}
                </button>
              </Tip>
              <Tip content={autoScroll ? '关闭自动滚动' : '开启自动滚动'}>
                <button
                  onClick={() => setAutoScroll((value) => !value)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center border transition-colors',
                    autoScroll
                      ? 'border-[#59656b] text-[#e7e2d5]'
                      : 'border-[#343c41] text-[#8b9492] hover:border-[#59656b] hover:text-[#e7e2d5]',
                  )}
                >
                  <ArrowDownToLine size={12} />
                </button>
              </Tip>
              <Tip content={wrap ? '关闭自动换行' : '开启自动换行'}>
                <button
                  onClick={() => setWrap((value) => !value)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center border transition-colors',
                    wrap ? 'border-[#59656b] text-[#e7e2d5]' : 'border-[#343c41] text-[#8b9492]',
                  )}
                >
                  <WrapText size={12} />
                </button>
              </Tip>
              <Tip content="清空当前视图">
                <button
                  onClick={clearLogs}
                  className="flex h-8 w-8 items-center justify-center border border-[#343c41] text-[#8b9492] transition-colors hover:border-[#59656b] hover:text-[#e7e2d5]"
                >
                  <Eraser size={12} />
                </button>
              </Tip>
              <Tip content="下载日志">
                <button
                  onClick={downloadLogs}
                  className="flex h-8 w-8 items-center justify-center border border-[#343c41] text-[#8b9492] transition-colors hover:border-[#59656b] hover:text-[#e7e2d5]"
                >
                  <ArrowDownToLine size={12} />
                </button>
              </Tip>
            </>
          )}

          {mode === 'terminal' && (
            <>
              <div className="ml-auto flex items-center gap-2">
                <span className="font-mono text-[8.5px] tracking-[0.14em] text-[#6b7472]">
                  TTY / {pod || '—'} · {namespace} · AUTO SHELL
                </span>
                {error && <Badge tone="bad">{error}</Badge>}
              </div>
            </>
          )}
        </div>

        {/* body */}
        <div className="relative flex min-h-0 flex-1 flex-col bg-[#0d1012]">
          {mode === 'logs' ? (
            <>
              <div
                ref={logRef}
                className={cn(
                  'min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11px] leading-[1.85] text-[#c9cfce]',
                  !wrap && 'overflow-x-auto whitespace-pre',
                )}
              >
                {displayLines.map((line, index) => {
                  const trimmed = line.trim()
                  if (!trimmed) return <div key={index} className="h-2" />
                  const matched = keyword && line.toLowerCase().includes(keyword.trim().toLowerCase())
                  return (
                    <div
                      key={index}
                      className={cn(
                        'whitespace-pre-wrap break-all border-l-2 border-transparent pl-2',
                        matched && 'border-signal/70 bg-signal/[0.06]',
                      )}
                    >
                      <span className="mr-4 inline-block w-10 select-none text-right text-[9px] text-[#4d5655]">
                        {String(index + 1).padStart(3, '0')}
                      </span>
                      {highlightLine(line, keyword.trim())}
                    </div>
                  )
                })}
                {displayLines.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-[#68716f]">
                    <ScrollText size={22} strokeWidth={1.2} />
                    <span className="font-mono text-[10px] tracking-[0.16em]">
                      {podsQuery.isLoading || historyQuery.isLoading ? 'LOADING LOG STREAM…' : 'NO LOG OUTPUT'}
                    </span>
                    <span className="text-[10.5px]">等待容器日志输出，或检查 Pod 是否正在运行。</span>
                  </div>
                )}
                {paused && (
                  <div className="sticky bottom-2 ml-auto w-fit border border-warn/50 bg-[#241b0b] px-2 py-1 font-mono text-[8.5px] tracking-widest text-[#e0b04a]">
                    STREAM PAUSED · {formatNumber(pendingRef.current.length, 0)} BYTES BUFFERED
                  </div>
                )}
              </div>
              {error && (
                <div className="flex flex-none items-center gap-2 border-t border-signal/30 bg-signal/[0.08] px-4 py-1.5">
                  <PlugZap size={11} className="text-signal" />
                  <span className="text-[10px] text-[#e7b1a4]">{error}</span>
                  <button onClick={reconnect} className="mono ml-auto text-[9px] tracking-widest text-signal hover:underline">
                    重连
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="relative min-h-0 flex-1">
              <div ref={termHostRef} className="console-term h-full w-full" />
              {conn !== 'open' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0d1012]/60">
                  <div className="flex items-center gap-2 border border-[#343c41] bg-[#14181b] px-3 py-2">
                    <StateDot state={conn} />
                    <span className="font-mono text-[9px] tracking-[0.16em] text-[#aab1b0]">
                      {conn === 'connecting' ? 'ESTABLISHING SHELL…' : conn === 'error' ? 'SHELL CONNECTION FAILED' : 'SHELL DISCONNECTED'}
                    </span>
                    {(conn === 'error' || conn === 'closed') && (
                      <button onClick={reconnect} className="mono ml-2 text-[9px] tracking-widest text-signal hover:underline">
                        RECONNECT
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <footer className="flex h-7 flex-none items-center gap-3 border-t border-[#262d31] bg-[#14181b] px-4 font-mono text-[8px] tracking-[0.14em] text-[#5f6967]">
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-1 bg-signal" />
            {mode === 'logs' ? 'SOCKJS /api/gaop/logs' : 'SOCKJS /api/gaop/exec'}
          </span>
          <span className="hidden sm:inline">POD / {pod || '—'}</span>
          <span className="hidden sm:inline">NS / {namespace}</span>
          {mode === 'logs' && <span>{formatNumber(displayLines.length, 0)} LINES</span>}
          {mode === 'terminal' && <span>TTY / {EXEC_COLS}×{EXEC_ROWS}</span>}
          <span className="ml-auto flex items-center gap-2">
            <span>{error ? 'CHECK CONNECTION' : 'SECURE CHANNEL'}</span>
            <span className="hidden md:inline">ESC 关闭</span>
          </span>
        </footer>
      </div>
    </div>
  )
}
