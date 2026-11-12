import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'

function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 40) setWidth(w)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

function smoothPath(points: Array<[number, number]>) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]
    const [x1, y1] = points[i]
    const cx = (x0 + x1) / 2
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`
  }
  return d
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */
export function Sparkline({
  data,
  width = 132,
  height = 34,
  color = 'var(--color-ink)',
  fill = true,
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
  fill?: boolean
}) {
  const gid = useId().replace(/:/g, '')
  const series = data.length ? data : [0, 0]
  const max = Math.max(...series)
  const min = Math.min(...series)
  const span = max - min || 1
  const pad = 3
  const points = series.map<[number, number]>((v, i) => [
    (i / Math.max(1, series.length - 1)) * (width - pad * 2) + pad,
    height - pad - ((v - min) / span) * (height - pad * 2),
  ])
  const line = smoothPath(points)
  const area = `${line} L ${width - pad} ${height} L ${pad} ${height} Z`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#spark-${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} strokeLinecap="square" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={2} fill={color} />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* AreaTrend                                                           */
/* ------------------------------------------------------------------ */
export interface TrendPoint {
  label: string
  value: number
}

export function AreaTrend({
  series,
  height = 210,
  unit = '',
  yMax,
  className,
  legend = true,
  reference,
}: {
  series: Array<{ name: string; points: TrendPoint[]; color?: string; dashed?: boolean }>
  height?: number
  unit?: string
  yMax?: number
  className?: string
  legend?: boolean
  reference?: number
}) {
  const { ref, width } = useMeasure<HTMLDivElement>()
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const pad = { top: 16, right: 34, bottom: 24, left: 8 }
  const w = Math.max(280, width)
  const innerW = w - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const count = Math.max(...series.map((s) => s.points.length), 1)
  const allValues = series.flatMap((s) => s.points.map((p) => p.value))
  const maxValue = yMax || Math.max(...allValues, 1) * 1.15
  const ticks = 4

  const colors = ['var(--color-signal)', 'var(--color-ink)', 'var(--color-info)', 'var(--color-ok)']

  function x(i: number) {
    return pad.left + (i / Math.max(1, count - 1)) * innerW
  }
  function y(v: number) {
    return pad.top + innerH - (Math.max(0, v) / maxValue) * innerH
  }

  const labels = series[0]?.points.map((p) => p.label) || []

  return (
    <div className={cn('relative', className)} ref={ref}>
      {legend && (
        <div className="mb-2 flex flex-wrap items-center gap-4">
          {series.map((s, i) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className="h-[2px] w-4" style={{ background: s.color || colors[i % colors.length] }} />
              <span className="label">{s.name}</span>
            </span>
          ))}
        </div>
      )}
      <svg width={w} height={height} className="block">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`area-${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color || colors[i % colors.length]} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color || colors[i % colors.length]} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const value = (maxValue / ticks) * i
          const yy = y(value)
          return (
            <g key={i}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={yy}
                y2={yy}
                stroke="var(--color-line)"
                strokeWidth={1}
                strokeDasharray={i === 0 ? undefined : '2 5'}
                opacity={i === 0 ? 0.9 : 0.55}
              />
              <text
                x={w - pad.right + 6}
                y={yy + 3}
                fontSize={9}
                fill="var(--color-mute)"
                fontFamily="var(--font-mono)"
              >
                {formatNumber(value, value >= 100 ? 0 : 1)}
              </text>
            </g>
          )
        })}
        {reference !== undefined && (
          <line
            x1={pad.left}
            x2={w - pad.right}
            y1={y(reference)}
            y2={y(reference)}
            stroke="var(--color-signal)"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.6}
          />
        )}
        {series.map((s, si) => {
          const color = s.color || colors[si % colors.length]
          const points = s.points.map<[number, number]>((p, i) => [x(i), y(p.value)])
          const line = smoothPath(points)
          if (points.length === 0) return null
          const area = `${line} L ${points[points.length - 1][0]} ${pad.top + innerH} L ${points[0][0]} ${pad.top + innerH} Z`
          return (
            <g key={s.name}>
              <path d={area} fill={`url(#area-${gid}-${si})`} />
              <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '4 4' : undefined}
                className={s.dashed ? undefined : 'chart-line'}
                style={{ ['--len' as string]: 2400 }}
              />
              {points.length <= 40 &&
                points.map(([px, py], i) => (
                  <circle key={i} cx={px} cy={py} r={1.6} fill={color} opacity={0.75} />
                ))}
            </g>
          )
        })}
        {labels.map((label, i) => {
          if (i % Math.ceil(count / 6) !== 0 && i !== count - 1) return null
          return (
            <text
              key={`${label}-${i}`}
              x={x(i)}
              y={height - 6}
              fontSize={8.5}
              fill="var(--color-mute)"
              fontFamily="var(--font-mono)"
              textAnchor={i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'}
            >
              {label}
            </text>
          )
        })}
        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.top}
              y2={pad.top + innerH}
              stroke="var(--color-ink)"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.5}
            />
            {series.map((s, si) => {
              const p = s.points[hover]
              if (!p) return null
              return (
                <circle
                  key={s.name}
                  cx={x(hover)}
                  cy={y(p.value)}
                  r={3}
                  fill="var(--color-paper)"
                  stroke={s.color || colors[si % colors.length]}
                  strokeWidth={1.6}
                />
              )
            })}
          </g>
        )}
        <rect
          x={pad.left}
          y={pad.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onMouseMove={(event) => {
            const rect = (event.currentTarget as SVGRectElement).getBoundingClientRect()
            const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
            setHover(Math.round(ratio * (count - 1)))
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 border border-ink bg-paper px-2 py-1.5 shadow-[3px_3px_0_rgba(21,24,27,0.12)]"
          style={{
            left: Math.min(Math.max(x(hover) + 12, 8), w - 130),
            top: 18,
          }}
        >
          <div className="mono text-[9px] tracking-wider text-mute">{labels[hover]}</div>
          {series.map((s, si) => (
            <div key={s.name} className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1.5 w-1.5" style={{ background: s.color || colors[si % colors.length] }} />
              <span className="text-[10px] text-ink-3">{s.name}</span>
              <span className="num ml-auto text-[12px] text-ink">
                {formatNumber(s.points[hover]?.value ?? 0, 1)}
                {unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* BarList                                                             */
/* ------------------------------------------------------------------ */
export function BarList({
  items,
  max,
  unit = '',
  className,
  formatter,
  tone,
  maxRows,
}: {
  items: Array<{ label: string; value: number; hint?: string }>
  max?: number
  unit?: string
  className?: string
  formatter?: (value: number) => string
  tone?: 'ink' | 'signal' | 'ok' | 'warn'
  maxRows?: number
}) {
  const list = maxRows ? items.slice(0, maxRows) : items
  const ceiling = max || Math.max(...list.map((i) => i.value), 1)
  return (
    <div className={cn('divide-y divide-line/70', className)}>
      {list.map((item, index) => {
        const ratio = Math.min(1, item.value / ceiling)
        const color =
          tone === 'signal'
            ? 'var(--color-signal)'
            : tone === 'ok'
              ? 'var(--color-ok)'
              : tone === 'warn'
                ? 'var(--color-warn)'
                : 'var(--color-ink)'
        return (
          <div key={`${item.label}-${index}`} className="group py-2.5">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="truncate font-mono text-[10.5px] text-ink-3 group-hover:text-ink">{item.label}</span>
              <span className="num flex-none text-[13px] text-ink">
                {formatter ? formatter(item.value) : formatNumber(item.value, 1)}
                <span className="ml-0.5 text-[9px] text-mute">{unit}</span>
              </span>
            </div>
            <div className="h-[3px] w-full bg-line">
              <div
                className="h-full transition-[width] duration-700 ease-out"
                style={{ width: `${ratio * 100}%`, background: color }}
              />
            </div>
            {item.hint && <div className="mt-1 text-[9.5px] text-mute">{item.hint}</div>}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* RingGauge                                                           */
/* ------------------------------------------------------------------ */
export function RingGauge({
  value,
  size = 132,
  stroke = 7,
  label,
  sublabel,
  color = 'var(--color-signal)',
  display,
}: {
  value: number
  size?: number
  stroke?: number
  label?: string
  sublabel?: string
  color?: string
  display?: string
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = Math.max(0, Math.min(1, value))
  return (
    <div className="relative inline-flex flex-none items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          style={{ transition: 'stroke-dasharray 900ms cubic-bezier(.2,.7,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[30px] leading-none text-ink">{display ?? `${Math.round(value * 100)}`}</span>
        {label && <span className="label mt-1">{label}</span>}
        {sublabel && <span className="mt-0.5 text-[9px] text-mute">{sublabel}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Donut                                                               */
/* ------------------------------------------------------------------ */
export function Donut({
  segments,
  size = 150,
  thickness = 16,
  centerValue,
  centerLabel,
}: {
  segments: Array<{ label: string; value: number; color: string }>
  size?: number
  thickness?: number
  centerValue?: string
  centerLabel?: string
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-line)" strokeWidth={thickness} opacity={0.5} />
        {segments.map((segment) => {
          const length = (segment.value / total) * circumference
          const dash = `${Math.max(0, length - 2)} ${circumference}`
          const el = (
            <circle
              key={segment.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          )
          offset += length
          return el
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-[26px] leading-none text-ink">{centerValue}</span>
        {centerLabel && <span className="label mt-1">{centerLabel}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* CountUp value                                                       */
/* ------------------------------------------------------------------ */
export function CountUp({
  value,
  duration = 900,
  decimals = 0,
  suffix = '',
}: {
  value: number
  duration?: number
  decimals?: number
  suffix?: string
}) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from + (value - from) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])
  return (
    <>
      {display.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Tiny bar series                                                     */
/* ------------------------------------------------------------------ */
export function MicroBars({ data, height = 46, color = 'var(--color-ink)' }: { data: number[]; height?: number; color?: string }) {
  const max = Math.max(...data, 1)
  const bars = useMemo(() => data.slice(-28), [data])
  return (
    <div className="flex items-end gap-[2px]" style={{ height }}>
      {bars.map((value, index) => (
        <div
          key={index}
          className="flex-1 transition-all"
          style={{
            height: `${Math.max(4, (value / max) * 100)}%`,
            background: color,
            opacity: 0.25 + (value / max) * 0.75,
          }}
        />
      ))}
    </div>
  )
}
