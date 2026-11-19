import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  Loader2,
  MoreHorizontal,
  Search,
  X,
  XCircle,
} from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useToastStore } from '@/stores/toast'

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */
type ButtonVariant = 'default' | 'primary' | 'signal' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'default',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}) {
  return (
    <button
      className={cn(
        'btn',
        variant === 'primary' && 'btn-primary',
        variant === 'signal' && 'btn-signal',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        size === 'sm' && 'btn-sm',
        size === 'lg' && 'btn-lg',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <Tip content={label}>
      <button
        aria-label={label}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded border border-line-strong bg-paper-2 text-ink-3 transition-colors hover:border-signal hover:text-[#7cc4ff]',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tip>
  )
}

/* ------------------------------------------------------------------ */
/* Badge / status                                                      */
/* ------------------------------------------------------------------ */
export function Badge({
  tone = 'default',
  children,
  className,
}: {
  tone?: 'default' | 'ok' | 'warn' | 'bad' | 'info'
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'badge',
        tone === 'ok' && 'badge-ok',
        tone === 'warn' && 'badge-warn',
        tone === 'bad' && 'badge-bad',
        tone === 'info' && 'badge-info',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusDot({ tone = 'ok', pulse }: { tone?: 'ok' | 'warn' | 'bad' | 'idle'; pulse?: boolean }) {
  return <span className={cn('status-dot', `dot-${tone}`, pulse && 'blink')} />
}

export function Meter({ value, tone }: { value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const level = tone ?? (value >= 85 ? 'bad' : value >= 65 ? 'warn' : 'ok')
  return (
    <div className={cn('meter', level === 'warn' && 'warn', level === 'bad' && 'bad')}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */
export function Panel({
  title,
  kicker,
  actions,
  children,
  className,
  bodyClassName,
  corner,
}: {
  title?: ReactNode
  kicker?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  corner?: boolean
}) {
  return (
    <section className={cn('panel', corner && 'corner-marks', className)}>
      {(title || actions || kicker) && (
        <header className="panel-head">
          <div className="min-w-0">
            {kicker && <div className="label mb-0.5">{kicker}</div>}
            {title && <div className="truncate text-[14px] font-semibold text-ink">{title}</div>}
          </div>
          {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
  toolbar,
  search,
}: {
  index?: string
  title: string
  en?: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
  toolbar?: ReactNode
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    width?: number
  }
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <h1 className="flex-none text-[16px] font-semibold text-ink">{title}</h1>
      {meta && <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 lg:flex">{meta}</div>}
      {description && (
        <span className="hidden max-w-[420px] truncate text-[14px] text-mute 2xl:inline">{description}</span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {toolbar}
        {search && (
          <div className="flex h-[30px]">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
              <input
                className="field h-[30px] rounded-r-none pl-8 text-[14px]"
                style={{ width: search.width ?? 220 }}
                placeholder={search.placeholder ?? '请输入关键字搜索'}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
              />
            </div>
            <button
              type="button"
              aria-label="搜索"
              className="flex w-9 items-center justify-center rounded-r-[3px] border border-l-0 border-[#1a7ad1] bg-[#1670c2] text-white transition-colors hover:bg-[#1a82dd]"
            >
              <Search size={13} />
            </button>
          </div>
        )}
        {actions}
      </div>
    </div>
  )
}

export function PageToolbar({
  children,
  search,
  extra,
}: {
  children?: ReactNode
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    width?: number
    onSubmit?: () => void
  }
  extra?: ReactNode
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      {children}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {extra}
        {search && (
          <div className="flex h-[30px]">
            <input
              className="field h-[30px] rounded-r-none text-[14px]"
              style={{ width: search.width ?? 232 }}
              placeholder={search.placeholder ?? '请输入关键字搜索'}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') search.onSubmit?.()
              }}
            />
            <button
              type="button"
              aria-label="搜索"
              onClick={search.onSubmit}
              className="flex w-9 items-center justify-center rounded-r-[3px] border border-l-0 border-[#1a7ad1] bg-[#1670c2] text-white transition-colors hover:bg-[#1a82dd]"
            >
              <Search size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="h-3.5 w-[3px] rounded-full bg-signal" />
      <h2 className="text-[14px] font-semibold text-ink">{children}</h2>
      <span className="h-px flex-1 bg-line" />
      {extra}
    </div>
  )
}

export function Stat({
  label,
  value,
  unit,
  hint,
  accent,
  className,
}: {
  label: string
  value: ReactNode
  unit?: string
  hint?: ReactNode
  accent?: boolean
  className?: string
}) {
  return (
    <div className={cn('relative px-4 py-3.5', className)}>
      <div className="label">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cn('num text-[34px] leading-none', accent ? 'text-signal' : 'text-ink')}>{value}</span>
        {unit && <span className="mono text-[12px] uppercase tracking-widest text-mute">{unit}</span>}
      </div>
      {hint && <div className="mt-2 text-[12px] text-ink-3">{hint}</div>}
    </div>
  )
}

export function KV({ k, v, mono = true }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="pt-0.5 text-[14px] text-mute">{k}</span>
      <span className={cn('text-right text-[14px] text-ink', mono && 'mono')}>{v}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Field                                                               */
/* ------------------------------------------------------------------ */
export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 flex items-center gap-1.5">
        <span className="label-ink">{label}</span>
        {required && <span className="text-[12px] text-signal">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[12px] leading-relaxed text-mute">{hint}</span>}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('field', props.className)} />
}

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */
export interface SelectOption {
  value: string
  label: string
}

export function Select({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled,
  className,
  searchable,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [pos, setPos] = useState<{ left: number; top: number; bottom?: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const current = options.find((option) => option.value === value)

  const openPanel = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const panelHeight = Math.min(240, options.length * 32 + 10)
    const up = rect.bottom + panelHeight > window.innerHeight - 8 && rect.top > panelHeight + 8
    setPos({
      left: rect.left,
      top: up ? rect.top - 4 : rect.bottom + 4,
      bottom: up ? window.innerHeight - rect.top + 4 : undefined,
      width: Math.max(rect.width, 120),
    })
    setKeyword('')
    setOpen(true)
  }

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
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const list = keyword
    ? options.filter((option) => option.label.toLowerCase().includes(keyword.toLowerCase()))
    : options

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          if (open) setOpen(false)
          else openPanel()
        }}
        className={cn(
          'field flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60',
          open && 'border-signal',
          className,
        )}
      >
        <span className={cn('truncate', current ? 'text-ink' : 'text-mute')}>
          {current?.label ?? placeholder}
        </span>
        {searchable ? (
          <Search size={12} className="flex-none text-mute" />
        ) : (
          <ChevronDown size={12} className="flex-none text-mute" />
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.bottom === undefined ? pos.top : undefined,
              bottom: pos.bottom,
              width: pos.width,
              zIndex: 200,
            }}
            className="pointer-events-auto max-h-[240px] overflow-auto rounded border border-line-strong bg-paper-2 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          >
            {searchable && (
              <div className="px-1.5 pb-1">
                <input
                  autoFocus
                  className="field h-7 text-[12px]"
                  placeholder="搜索"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </div>
            )}
            {list.map((option) => (
              <button
                key={option.value}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[14px] transition-colors',
                  option.value === value
                    ? 'bg-signal/15 text-signal'
                    : 'text-ink-3 hover:bg-line/40 hover:text-ink',
                )}
              >
                <span className="flex w-3 flex-none justify-center">
                  {option.value === value && <Check size={11} />}
                </span>
                <span className="truncate">{option.label}</span>
              </button>
            ))}
            {list.length === 0 && <div className="px-2 py-1.5 text-[14px] text-mute">无匹配项</div>}
          </div>,
          document.body,
        )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */
const TipProvider = Tooltip.Provider

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-[80] max-w-[260px] rounded border border-[#2b4c6d] bg-[#0b1c2d] px-2.5 py-1.5 text-[14px] leading-relaxed text-[#dbe9f7] shadow-lg"
        >
          {content}
          <Tooltip.Arrow className="fill-[#0b1c2d]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export { TipProvider }

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */
export function Modal({
  open,
  onOpenChange,
  title,
  kicker,
  description,
  children,
  footer,
  width = 520,
  titleAlign = 'left',
  headerClassName,
  bodyClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  kicker?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
  titleAlign?: 'left' | 'center'
  headerClassName?: string
  bodyClassName?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[70] bg-black/55" />
        <Dialog.Content
          className="dialog-content fixed left-1/2 top-1/2 z-[71] max-h-[88vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded border border-line bg-paper-2 shadow-[0_18px_48px_rgba(0,0,0,0.55)] outline-none"
          style={{ maxWidth: width }}
        >
          <div
            className={cn(
              'sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-paper-2 px-4 py-3',
              titleAlign === 'center' && 'items-center justify-center gap-0 px-2.5 py-0',
              headerClassName,
            )}
          >
            {titleAlign === 'center' ? (
              <>
                <span className="h-7 w-7 flex-none" />
                <Dialog.Title className="flex-1 text-center text-[14px] font-medium leading-[30px] text-white">
                  {title}
                </Dialog.Title>
                <Dialog.Close className="inline-flex h-7 w-7 flex-none items-center justify-center rounded text-white/85 outline-none transition-colors hover:bg-white/10 hover:text-white">
                  <X size={14} />
                </Dialog.Close>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  {kicker && <div className="label mb-1">{kicker}</div>}
                  <Dialog.Title className="text-[16px] font-semibold leading-6 text-ink">{title}</Dialog.Title>
                  {description && (
                    <Dialog.Description className="mt-1.5 text-[14px] leading-relaxed text-ink-3">
                      {description}
                    </Dialog.Description>
                  )}
                </div>
                <Dialog.Close className="mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded text-ink-3 outline-none transition-colors hover:bg-[#16304a] hover:text-white">
                  <X size={14} />
                </Dialog.Close>
              </>
            )}
          </div>
          <div className={cn('px-4 py-3.5', bodyClassName)}>{children}</div>
          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-line bg-paper-3 px-4 py-2.5">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Drawer({
  open,
  onOpenChange,
  title,
  kicker,
  description,
  children,
  footer,
  actions,
  width = 760,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  kicker?: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  actions?: ReactNode
  width?: number
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay fixed inset-0 z-[70] bg-black/55" />
        <Dialog.Content
          className="drawer-content fixed inset-y-0 right-0 z-[71] flex w-[calc(100vw-40px)] flex-col border-l border-line bg-paper-2 shadow-[-12px_0_40px_rgba(0,0,0,0.55)] outline-none"
          style={{ maxWidth: width }}
        >
          <div className="flex flex-none items-center justify-between gap-4 border-b border-line px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Dialog.Close className="inline-flex h-7 w-7 flex-none items-center justify-center rounded text-ink-3 outline-none transition-colors hover:bg-[#16304a] hover:text-white">
                <X size={16} />
              </Dialog.Close>
              <div className="min-w-0">
                <Dialog.Title className="truncate text-[16px] font-semibold leading-6 text-ink">{title}</Dialog.Title>
                {description && (
                  <Dialog.Description className="mt-0.5 truncate text-[12px] leading-4 text-mute">
                    {description}
                  </Dialog.Description>
                )}
              </div>
            </div>
            <div className="flex flex-none items-center gap-2">{actions}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">{children}</div>
          {footer && (
            <div className="flex flex-none items-center justify-end gap-2 border-t border-line bg-paper-3 px-4 py-2.5">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false)

interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null)

  const confirm = (opts: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      setOptions(opts)
      setResolver(() => resolve)
    })

  const close = (value: boolean) => {
    resolver?.(value)
    setResolver(null)
    setOptions(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog.Root open={!!options} onOpenChange={(open) => !open && close(false)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay fixed inset-0 z-[80] bg-black/55" />
          <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 z-[81] w-[calc(100vw-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded border border-line bg-paper-2 p-0 shadow-[0_18px_48px_rgba(0,0,0,0.55)] outline-none">
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <AlertTriangle size={18} className={options?.danger ? 'mt-0.5 text-danger' : 'mt-0.5 text-warn'} />
              <div>
                <Dialog.Title className="text-[16px] font-semibold text-ink">{options?.title}</Dialog.Title>
                {options?.description && (
                  <div className="mt-1.5 text-[14px] leading-relaxed text-ink-3">{options.description}</div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3">
              <Button size="sm" onClick={() => close(false)}>
                {options?.cancelText || '取消'}
              </Button>
              <Button
                size="sm"
                variant={options?.danger ? 'danger' : 'primary'}
                onClick={() => close(true)}
                autoFocus
              >
                {options?.confirmText || '确认'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}

/* ------------------------------------------------------------------ */
/* Dropdown actions                                                    */
/* ------------------------------------------------------------------ */
export function ActionMenu({
  items,
  label = '更多操作',
  triggerText,
}: {
  items: Array<{ label: string; onSelect?: () => void; danger?: boolean; disabled?: boolean; icon?: ReactNode }>
  label?: string
  triggerText?: string
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {triggerText ? (
          <button className="text-[14px] text-[#4aa3f0] transition-colors hover:text-[#7cc4ff]">{triggerText}</button>
        ) : (
          <button
            aria-label={label}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-3 transition-colors hover:bg-[#16304a] hover:text-white"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-[75] min-w-[168px] rounded border border-line bg-paper-2 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.45)]"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                'flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-[14px] text-ink-3 outline-none transition-colors data-[highlighted]:bg-[#16304a] data-[highlighted]:text-white data-[disabled]:opacity-35',
                item.danger && 'text-danger data-[highlighted]:bg-[#3a1b22] data-[highlighted]:text-danger',
              )}
            >
              {item.icon}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/* ------------------------------------------------------------------ */
/* Tabs (controlled, pill-less)                                        */
/* ------------------------------------------------------------------ */
export function TabStrip<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          className={cn('tab', value === tab.value && 'active')}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 text-[12px] text-mute">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */
export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-ink-3" />
}

export function LoadingBlock({ label = '载入中', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center gap-2 text-[12px] tracking-widest text-mute">
        <Spinner size={12} /> {label}
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-7 animate-pulse bg-line/50"
          style={{ width: `${92 - index * 9}%`, animationDelay: `${index * 90}ms` }}
        />
      ))}
    </div>
  )
}

export function EmptyState({
  title = '暂无数据',
  description,
  action,
  icon,
}: {
  title?: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-paper-2 text-mute">
        {icon || <span className="text-[16px]">∅</span>}
      </div>
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {description && <div className="max-w-sm text-[14px] leading-relaxed text-mute">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2.5 rounded border border-[#5c2a2a] bg-[#2a161b] px-3 py-2.5">
      <XCircle size={14} className="mt-0.5 flex-none text-danger" />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] text-ink">{message}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-[14px] text-danger hover:underline">
          重试
        </button>
      )}
    </div>
  )
}

export function ToastHost() {
  const items = useToastStore((state) => state.items)
  const dismiss = useToastStore((state) => state.dismiss)
  return (
    <div className="pointer-events-none fixed bottom-11 right-4 z-[90] flex w-[330px] flex-col gap-2">
      {items.map((item) => {
        const tone =
          item.kind === 'success'
            ? 'border-[#2f6f4f]'
            : item.kind === 'error'
              ? 'border-[#5c2a2a]'
              : item.kind === 'warn'
                ? 'border-[#6b5228]'
                : 'border-[#2b5c86]'
        const Icon =
          item.kind === 'success' ? Check : item.kind === 'error' ? XCircle : item.kind === 'warn' ? AlertTriangle : Info
        return (
          <div
            key={item.id}
            className={cn(
              'toast-item pointer-events-auto flex items-start gap-2.5 rounded border bg-paper-2 px-3.5 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.5)]',
              tone,
            )}
          >
            <Icon
              size={15}
              className={cn(
                'mt-0.5 flex-none',
                item.kind === 'success'
                  ? 'text-ok'
                  : item.kind === 'error'
                    ? 'text-danger'
                    : item.kind === 'warn'
                      ? 'text-warn'
                      : 'text-info',
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium leading-tight text-ink">{item.title}</div>
              {item.description && (
                <div className="mt-1 break-words text-[14px] leading-relaxed text-ink-3">{item.description}</div>
              )}
            </div>
            <button onClick={() => dismiss(item.id)} className="text-mute transition-colors hover:text-ink">
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
export function SelectChevron() {
  return <ChevronDown size={12} />
}

export function CopyText({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const id = useId()
  return (
    <button
      key={id}
      className="group inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-3 transition-colors hover:text-signal"
      onClick={async (event) => {
        event.stopPropagation()
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        } catch {
          /* ignore */
        }
      }}
      title={label || '复制'}
    >
      {value}
      {copied ? <Check size={11} className="text-ok" /> : <span className="text-[12px] opacity-0 group-hover:opacity-60">COPY</span>}
    </button>
  )
}
