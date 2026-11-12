export function formatBytes(bytes?: number | null, digits = 1): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '—'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : digits)} ${units[i]}`
}

export function formatPercent(value?: number | null, digits = 1): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function formatNumber(value?: number | null, digits = 0): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—'
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatDate(value?: number | string | null, withTime = true): string {
  if (value === undefined || value === null || value === '') return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (!withTime) return base
  return `${base} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function relativeTime(value?: number | string | null): string {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  const diff = Date.now() - date.getTime()
  if (Number.isNaN(diff)) return '—'
  const abs = Math.abs(diff)
  const suffix = diff >= 0 ? '前' : '后'
  if (abs < 60_000) return `${Math.max(1, Math.round(abs / 1000))} 秒${suffix}`
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)} 分钟${suffix}`
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} 小时${suffix}`
  if (abs < 2_592_000_000) return `${Math.round(abs / 86_400_000)} 天${suffix}`
  return formatDate(value, false)
}

export function parseCpu(value?: string | number | null): number {
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return value
  if (value.endsWith('m')) return parseFloat(value) / 1000
  if (value.endsWith('n')) return parseFloat(value) / 1e9
  return parseFloat(value) || 0
}

export function parseMemoryMiB(value?: string | number | null): number {
  if (value === undefined || value === null) return 0
  if (typeof value === 'number') return value
  const num = parseFloat(value)
  if (value.endsWith('Gi')) return num * 1024
  if (value.endsWith('Mi')) return num
  if (value.endsWith('Ki')) return num / 1024
  if (value.endsWith('G')) return num * 1024
  if (value.endsWith('M')) return num
  return num / (1024 * 1024)
}

export function pctColor(value: number): 'ok' | 'warn' | 'bad' {
  if (value >= 85) return 'bad'
  if (value >= 65) return 'warn'
  return 'ok'
}

/* ------------------------------------------------------------------ */
/* Kubernetes node helpers (backend returns flattened node objects)    */
/* ------------------------------------------------------------------ */
import type { NodeItem } from '@/types'

export function nodeReady(node?: NodeItem | null): boolean {
  if (!node) return false
  if (typeof node.ready === 'string') return node.ready.toLowerCase() === 'true'
  return node.status?.conditions?.find((item) => item.type === 'Ready')?.status === 'True'
}

export function nodeAddress(node?: NodeItem | null): string {
  if (!node) return '—'
  return (
    node.address ||
    node.status?.addresses?.find((item) => item.type === 'InternalIP')?.address ||
    '—'
  )
}

export function nodeCapacityCpu(node?: NodeItem | null): number {
  if (!node) return 0
  if (typeof node.cpu_total === 'number') return node.cpu_total / 1000
  return parseCpu(node.status?.capacity?.cpu)
}

export function nodeCapacityMemMiB(node?: NodeItem | null): number {
  if (!node) return 0
  if (typeof node.memory_total_kb === 'number') return node.memory_total_kb / 1024
  return parseMemoryMiB(node.status?.capacity?.memory)
}

export function nodePodCapacity(node?: NodeItem | null): number {
  return node?.pod_cap ?? Number(node?.status?.capacity?.pods ?? 0)
}

/** Kubernetes quota values without unit are millicores / kilobytes. */
export function parseMilliCores(value?: string | number | null): number {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') return value / 1000
  if (/[a-zA-Z]/.test(value)) return parseCpu(value)
  return (parseFloat(value) || 0) / 1000
}

export function parseMemoryKb(value?: string | number | null): number {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') return value / 1024
  if (/[a-zA-Z]/.test(value)) return parseMemoryMiB(value)
  return (parseFloat(value) || 0) / 1024
}
