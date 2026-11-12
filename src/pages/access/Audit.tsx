import { useQuery } from '@tanstack/react-query'
import { Download, RefreshCw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { formatDate, relativeTime } from '@/lib/format'
import type { AuditItem } from '@/types'
import { DataTable, type Column } from '@/components/DataTable'
import { Badge, Button, PageHeader, Panel, StatusDot } from '@/components/ui'
import { cn } from '@/lib/utils'

interface AuditDictItem {
  id?: number
  parentId?: number
  dictionaryKey?: string
  dictionaryName?: string
}

const moduleTone: Record<string, 'default' | 'info' | 'warn' | 'ok' | 'bad'> = {
  USER: 'info',
  ROLE: 'warn',
  SOFTWARE: 'ok',
  SERVICE: 'bad',
  LOGIN: 'info',
}

export default function AuditPage() {
  const [keyword, setKeyword] = useState('')
  const [moduleName, setModuleName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : undefined
  const endMs = endDate ? new Date(`${endDate}T23:59:59`).getTime() : undefined
  const dictQuery = useQuery({
    queryKey: ['audit-dictionary'],
    queryFn: () => api.get<{ list?: AuditDictItem[] }>('/audit/dictionaryList', { page: 1, size: 200 }),
  })
  const moduleOptions = (dictQuery.data?.list ?? []).filter(
    (item) => (item.parentId ?? 0) !== 0 && !!item.dictionaryKey,
  )
  const query = useQuery({
    queryKey: ['audit', moduleName, startMs, endMs],
    queryFn: () =>
      api.get<{ list: AuditItem[]; total: number }>('/audit', {
        page: 1,
        size: 300,
        moduleName: moduleName || undefined,
        start: startMs,
        end: endMs,
      }),
  })
  const hasFilter = !!keyword.trim() || !!moduleName || !!startDate || !!endDate

  const list = query.data?.list ?? []
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (item) =>
        item.username.toLowerCase().includes(q) ||
        (item.reasonName || '').toLowerCase().includes(q) ||
        (item.moduleName || '').toLowerCase().includes(q) ||
        (item.ip || '').includes(q) ||
        (item.requestPath || '').toLowerCase().includes(q),
    )
  }, [list, keyword])

  const today = new Date().toDateString()
  const todayCount = list.filter((item) => item.createdAt && new Date(item.createdAt).toDateString() === today).length
  const logins = list.filter((item) => (item.reason || '').includes('LOGIN') || item.moduleName === 'USER').length
  const users = new Set(list.map((item) => item.username)).size

  const columns: Array<Column<AuditItem>> = [
    {
      key: 'time',
      header: '时间',
      sortValue: (row) => row.createdAt ?? 0,
      cell: (row) => (
        <div>
          <div className="mono text-[10.5px] text-ink">{formatDate(row.createdAt)}</div>
          <div className="mono mt-0.5 text-[8px] text-mute">{relativeTime(row.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'user',
      header: '操作人',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <StatusDot tone="ok" />
          <div>
            <div className="text-[11.5px] text-ink">{row.username}</div>
            <div className="mono mt-0.5 text-[8.5px] text-mute">{row.roleName || '—'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'action',
      header: '操作',
      cell: (row) => (
        <div>
          <div className="text-[11.5px] text-ink">{row.reasonName || row.reason || '—'}</div>
          <div className="mono mt-0.5 text-[8.5px] tracking-wider text-mute">{row.requestPath || '—'}</div>
        </div>
      ),
    },
    {
      key: 'module',
      header: '模块',
      cell: (row) => <Badge tone={moduleTone[row.moduleName || ''] || 'default'}>{row.moduleName || 'SYSTEM'}</Badge>,
    },
    {
      key: 'ip',
      header: '来源 IP',
      cell: (row) => <span className="mono text-[10px] text-ink-3">{row.ip || '—'}</span>,
    },
  ]

  return (
    <div>
      <PageHeader
        index="07 / 03"
        en="ACCESS · AUDIT TRAIL"
        title="审计日志"
        description="记录平台内所有登录、配置变更与敏感操作。日志用于安全审计与故障复盘，不建议用于业务数据分析。"
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone="ok" pulse />
              <span className="mono text-[9.5px] tracking-widest text-ink-3">{list.length} EVENTS</span>
            </span>
            <span className="mono text-[9.5px] tracking-widest text-mute">RETENTION / PLATFORM DEFAULT</span>
          </>
        }
        actions={
          <>
            <Button size="sm" loading={query.isFetching} onClick={() => query.refetch()}>
              <RefreshCw size={11} /> 刷新
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const header = '时间,用户,席位,模块,操作,路径,IP\n'
                const rows = filtered
                  .map((item) =>
                    [
                      formatDate(item.createdAt),
                      item.username,
                      item.roleName || '',
                      item.moduleName || '',
                      item.reasonName || item.reason || '',
                      item.requestPath || '',
                      item.ip || '',
                    ]
                      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
                      .join(','),
                  )
                  .join('\n')
                const blob = new Blob([`\ufeff${header}${rows}`], { type: 'text/csv;charset=utf-8' })
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = `msop-audit-${Date.now()}.csv`
                anchor.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download size={11} /> 导出 CSV
            </Button>
          </>
        }
      />

      <section className="panel mb-4 grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        {[
          ['总事件', list.length, 'ALL EVENTS'],
          ['今日事件', todayCount, 'TODAY'],
          ['登录相关', logins, 'AUTH EVENTS'],
          ['涉及用户', users, 'UNIQUE USERS'],
        ].map(([label, value, hint]) => (
          <div key={label} className="px-4 py-3.5">
            <div className="label">{label}</div>
            <div className="num mt-1.5 text-[28px] leading-none text-ink">{value}</div>
            <div className="mono mt-2 text-[8.5px] tracking-[0.14em] text-mute">{hint}</div>
          </div>
        ))}
      </section>

      <Panel bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="relative min-w-[180px] flex-1">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input
              className={cn('field h-8 border-0 bg-transparent pl-8 text-[12px] shadow-none focus:shadow-none')}
              placeholder="搜索用户 / 操作 / 模块 / IP"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          <select
            className="field h-8 w-[150px] font-mono text-[10.5px]"
            value={moduleName}
            onChange={(event) => setModuleName(event.target.value)}
          >
            <option value="">全部行为类型</option>
            {moduleOptions.map((item) => (
              <option key={item.dictionaryKey} value={item.dictionaryKey}>
                {item.dictionaryName || item.dictionaryKey}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="field h-8 w-[140px] font-mono text-[10px]"
            value={startDate}
            max={endDate || undefined}
            onChange={(event) => setStartDate(event.target.value)}
            title="开始时间"
          />
          <span className="mono text-[9px] text-mute">~</span>
          <input
            type="date"
            className="field h-8 w-[140px] font-mono text-[10px]"
            value={endDate}
            min={startDate || undefined}
            onChange={(event) => setEndDate(event.target.value)}
            title="结束时间"
          />
          {hasFilter && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setKeyword('')
                setModuleName('')
                setStartDate('')
                setEndDate('')
              }}
            >
              <X size={10} /> 清除
            </Button>
          )}
          <span className="mono text-[9px] tracking-widest text-mute">{filtered.length} 条</span>
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => String(row.id)}
          loading={query.isLoading}
          pageSize={15}
          emptyTitle="暂无审计记录"
          emptyDescription="平台尚未记录任何操作事件。"
        />
      </Panel>
    </div>
  )
}
