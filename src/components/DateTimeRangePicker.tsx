import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { Button } from './ui'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function sameDay(a: Date | null, b: Date | null) {
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function parseValue(value: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function timeOf(date: Date | null, fallback: string) {
  if (!date) return fallback
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDisplay(value: string) {
  const date = parseValue(value)
  if (!date) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`
}

function buildValue(date: Date, time: string) {
  const [h, m, s] = time.split(':')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(Number(h) || 0)}:${pad(
    Number(m) || 0,
  )}:${pad(Number(s) || 0)}`
}

function monthCells(month: Date) {
  const first = startOfMonth(month)
  const offset = (first.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: Array<Date | null> = Array.from({ length: offset }, () => null)
  for (let day = 1; day <= days; day += 1) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), day))
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function TimeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parts = value.split(':')
  while (parts.length < 3) parts.push('00')
  const update = (index: number, raw: string) => {
    const next = [...parts]
    next[index] = raw.replace(/\D/g, '').slice(0, 2)
    onChange(next.join(':'))
  }
  return (
    <div className="flex items-center gap-1 font-mono text-[14px]">
      {[0, 1, 2].map((index) => (
        <span key={index} className="flex items-center gap-1">
          <input
            value={parts[index]}
            onChange={(event) => update(index, event.target.value)}
            onBlur={() => update(index, pad(Math.min(index === 0 ? 23 : 59, Number(parts[index]) || 0)))}
            inputMode="numeric"
            className="h-7 w-9 border border-[#2f4f6d] bg-[#16293c] text-center text-[14px] text-[#c6dbef] outline-none focus:border-signal"
          />
          {index < 2 && <span className="text-mute">:</span>}
        </span>
      ))}
    </div>
  )
}

function MonthPanel({
  month,
  start,
  end,
  active,
  onChange,
  onPrev,
  onNext,
  showPrev,
  showNext,
}: {
  month: Date
  start: Date | null
  end: Date | null
  active: 'start' | 'end'
  onChange: (date: Date) => void
  onPrev?: () => void
  onNext?: () => void
  showPrev?: boolean
  showNext?: boolean
}) {
  return (
    <div className="w-[248px] flex-none">
      <div className="mb-2 flex h-7 items-center justify-between px-1">
        <button
          type="button"
          onClick={onPrev}
          className={cn(
            'flex h-6 w-6 items-center justify-center text-ink-3 transition-colors hover:text-ink',
            !showPrev && 'invisible',
          )}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[14px] text-ink">
          {month.getFullYear()} 年 {month.getMonth() + 1} 月
        </span>
        <button
          type="button"
          onClick={onNext}
          className={cn(
            'flex h-6 w-6 items-center justify-center text-ink-3 transition-colors hover:text-ink',
            !showNext && 'invisible',
          )}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[12px] text-mute">
        {WEEK.map((day) => (
          <span key={day} className="py-1">
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-[13px]">
        {monthCells(month).map((day, index) => {
          if (!day) return <span key={`empty-${index}`} />
          const isStart = sameDay(day, start)
          const isEnd = sameDay(day, end)
          const inRange = !!(start && end && day > start && day < end)
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onChange(day)}
              className={cn(
                'h-7 text-[13px] transition-colors',
                inRange && 'bg-signal/15 text-ink',
                (isStart || isEnd) && 'bg-[#1670c2] text-white',
                !inRange && !isStart && !isEnd && 'text-ink-3 hover:bg-[#16304a] hover:text-white',
                active === 'start' && !isStart && !isEnd && !inRange && 'hover:bg-[#16304a]',
              )}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export interface DateTimeRangePickerProps {
  start: string
  end: string
  onChange: (start: string, end: string) => void
  className?: string
}

export function DateTimeRangePicker({ start, end, onChange, className }: DateTimeRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [active, setActive] = useState<'start' | 'end'>('start')
  const [draftStart, setDraftStart] = useState<{ date: Date | null; time: string }>({
    date: null,
    time: '00:00:00',
  })
  const [draftEnd, setDraftEnd] = useState<{ date: Date | null; time: string }>({
    date: null,
    time: '23:59:59',
  })

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  function openPanel() {
    const rect = triggerRef.current?.getBoundingClientRect()
    const width = 560
    const height = 388
    if (rect) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      const up = rect.bottom + height > window.innerHeight - 8 && rect.top > height + 8
      setPos({ left, top: up ? rect.top - height - 6 : rect.bottom + 6 })
    }
    const parsedStart = parseValue(start)
    const parsedEnd = parseValue(end)
    setDraftStart({ date: parsedStart, time: timeOf(parsedStart, '00:00:00') })
    setDraftEnd({ date: parsedEnd, time: timeOf(parsedEnd, '23:59:59') })
    setActive(parsedStart ? 'end' : 'start')
    setMonth(startOfMonth(parsedStart ?? parsedEnd ?? new Date()))
    setOpen((value) => !value)
  }

  const startValue = draftStart.date ? buildValue(draftStart.date, draftStart.time) : ''
  const endValue = draftEnd.date ? buildValue(draftEnd.date, draftEnd.time) : ''
  const valid = !!startValue && !!endValue && startValue <= endValue

  function confirm() {
    if (!valid) return
    onChange(startValue, endValue)
    setOpen(false)
  }

  const display =
    start || end
      ? `${formatDisplay(start) || '开始时间'} ~ ${formatDisplay(end) || '结束时间'}`
      : '请选择时间范围'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPanel}
        className={cn(
          'field flex h-8 items-center justify-between gap-2 text-left text-[14px]',
          className,
        )}
      >
        <span className={cn('truncate', start || end ? 'text-ink' : 'text-mute')}>{display}</span>
        <CalendarDays size={13} className="flex-none text-mute" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 220 }}
            className="w-[560px] rounded border border-line-strong bg-paper-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start gap-3 p-3">
              <MonthPanel
                month={month}
                start={draftStart.date}
                end={draftEnd.date}
                active={active}
                showPrev
                showNext={false}
                onPrev={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                onChange={(date) => {
                  if (active === 'start') {
                    setDraftStart((prev) => ({ ...prev, date }))
                    setActive('end')
                  } else {
                    setDraftEnd((prev) => ({ ...prev, date }))
                  }
                }}
              />
              <MonthPanel
                month={new Date(month.getFullYear(), month.getMonth() + 1, 1)}
                start={draftStart.date}
                end={draftEnd.date}
                active={active}
                showNext
                showPrev={false}
                onNext={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                onChange={(date) => {
                  if (active === 'start') {
                    setDraftStart((prev) => ({ ...prev, date }))
                    setActive('end')
                  } else {
                    setDraftEnd((prev) => ({ ...prev, date }))
                  }
                }}
              />
            </div>
            <div className="flex gap-6 border-t border-line px-3 py-2.5 text-[14px]">
              <div className="flex-1">
                <div className="mb-1 text-[12px] text-mute">开始时间</div>
                <TimeInput
                  value={draftStart.time}
                  onChange={(time) => setDraftStart((prev) => ({ ...prev, time }))}
                />
                <div className="mt-1 font-mono text-[12px] text-mute">
                  {draftStart.date
                    ? `${draftStart.date.getFullYear()}-${pad(draftStart.date.getMonth() + 1)}-${pad(
                        draftStart.date.getDate(),
                      )}`
                    : '未选择日期'}
                </div>
              </div>
              <div className="flex-1">
                <div className="mb-1 text-[12px] text-mute">结束时间</div>
                <TimeInput value={draftEnd.time} onChange={(time) => setDraftEnd((prev) => ({ ...prev, time }))} />
                <div className="mt-1 font-mono text-[12px] text-mute">
                  {draftEnd.date
                    ? `${draftEnd.date.getFullYear()}-${pad(draftEnd.date.getMonth() + 1)}-${pad(
                        draftEnd.date.getDate(),
                      )}`
                    : '未选择日期'}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-line px-3 py-2">
              <span className={cn('text-[12px]', valid ? 'text-mute' : 'text-warn')}>
                {valid ? '选择完成后点击确定' : '请选择有效的起止时间'}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button size="sm" variant="signal" disabled={!valid} onClick={confirm}>
                  确定
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
