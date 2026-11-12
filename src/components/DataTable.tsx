import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { EmptyState } from './ui'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T, index: number) => ReactNode
  align?: 'left' | 'right' | 'center'
  width?: number | string
  className?: string
  headerClassName?: string
  sortValue?: (row: T) => string | number
}

interface DataTableProps<T> {
  columns: Array<Column<T>>
  rows: T[]
  rowKey: (row: T, index: number) => string
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  pageSize?: number
  selectable?: boolean
  selectedKeys?: string[]
  onSelectionChange?: (keys: string[]) => void
  onRowClick?: (row: T) => void
  dense?: boolean
  footer?: ReactNode
  className?: string
  hidePager?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  emptyTitle = '暂无数据',
  emptyDescription,
  emptyAction,
  pageSize = 10,
  selectable,
  selectedKeys = [],
  onSelectionChange,
  onRowClick,
  dense,
  footer,
  className,
  hidePager,
}: DataTableProps<T>) {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)

  useEffect(() => {
    setPage(1)
  }, [rows.length])

  const sorted = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((c) => c.key === sort.key)
    if (!column?.sortValue) return rows
    const list = [...rows]
    list.sort((a, b) => {
      const av = column.sortValue!(a)
      const bv = column.sortValue!(b)
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av
      return sort.dir === 'asc'
        ? String(av).localeCompare(String(bv), 'zh-CN')
        : String(bv).localeCompare(String(av), 'zh-CN')
    })
    return list
  }, [rows, sort, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, totalPages)
  const pageRows = sorted.slice((current - 1) * pageSize, current * pageSize)
  const keysOnPage = pageRows.map(rowKey)
  const allSelected = keysOnPage.length > 0 && keysOnPage.every((key) => selectedKeys.includes(key))

  function toggleAll() {
    if (!onSelectionChange) return
    if (allSelected) {
      onSelectionChange(selectedKeys.filter((key) => !keysOnPage.includes(key)))
    } else {
      onSelectionChange(Array.from(new Set([...selectedKeys, ...keysOnPage])))
    }
  }

  function toggleOne(key: string) {
    if (!onSelectionChange) return
    onSelectionChange(
      selectedKeys.includes(key) ? selectedKeys.filter((item) => item !== key) : [...selectedKeys, key],
    )
  }

  return (
    <div className={cn('w-full', className)}>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {selectable && (
                <th className="w-9 pl-3 pr-0">
                  <input type="checkbox" className="check" checked={allSelected} onChange={toggleAll} aria-label="全选" />
                </th>
              )}
              {columns.map((column) => (
                <th
                  key={column.key}
                  style={{ width: column.width }}
                  className={cn(
                    column.align === 'right' && 'text-right',
                    column.align === 'center' && 'text-center',
                    column.headerClassName,
                  )}
                >
                  {column.sortValue ? (
                    <button
                      className="inline-flex items-center gap-1 transition-colors hover:text-signal"
                      onClick={() =>
                        setSort((prev) =>
                          prev?.key === column.key
                            ? prev.dir === 'asc'
                              ? { key: column.key, dir: 'desc' }
                              : null
                            : { key: column.key, dir: 'asc' },
                        )
                      }
                    >
                      {column.header}
                      {sort?.key === column.key ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp size={9} />
                        ) : (
                          <ArrowDown size={9} />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: Math.min(pageSize, 6) }).map((_, index) => (
                <tr key={`sk-${index}`}>
                  {selectable && <td />}
                  {columns.map((column) => (
                    <td key={column.key}>
                      <div
                        className="h-3 animate-pulse bg-[#1c3a55]"
                        style={{ width: `${45 + ((index * 13 + column.key.length * 7) % 45)}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              pageRows.map((row, index) => {
                const key = rowKey(row, index)
                const selected = selectedKeys.includes(key)
                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      onRowClick && 'cursor-pointer',
                      selected && 'bg-[#16395a]',
                    )}
                  >
                    {selectable && (
                      <td className="pl-3 pr-0" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="check"
                          checked={selected}
                          onChange={() => toggleOne(key)}
                          aria-label={`选择 ${key}`}
                        />
                      </td>
                    )}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          column.align === 'right' && 'text-right',
                          column.align === 'center' && 'text-center',
                          dense && 'py-2',
                          column.className,
                        )}
                      >
                        {column.cell(row, index)}
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {!loading && rows.length === 0 && (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      )}

      {footer}

      {!hidePager && rows.length > 0 && (
        <div className="flex items-center gap-4 border-t border-line px-4 py-3">
          <div className="relative h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-[#14293e]">
            <i
              className="absolute inset-y-0 left-0 rounded-full bg-signal"
              style={{ width: `${(current / totalPages) * 100}%` }}
            />
          </div>
          <span className="flex-none text-[12px] text-ink-3">
            当前第 {current} / {totalPages} 页
            {selectedKeys.length > 0 && ` · 已选 ${selectedKeys.length}`}
          </span>
          <div className="flex flex-none items-center gap-0.5">
            <button
              className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-[#8fb4d4]"
              disabled={current <= 1}
              onClick={() => setPage(1)}
              aria-label="首页"
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-[#8fb4d4]"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
              aria-label="上一页"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-[#8fb4d4]"
              disabled={current >= totalPages}
              onClick={() => setPage(current + 1)}
              aria-label="下一页"
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="inline-flex h-6 w-6 items-center justify-center text-[#8fb4d4] transition-colors hover:text-white disabled:opacity-30 disabled:hover:text-[#8fb4d4]"
              disabled={current >= totalPages}
              onClick={() => setPage(totalPages)}
              aria-label="末页"
            >
              <ChevronsRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
