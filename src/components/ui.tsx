import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'
import { Check } from 'lucide-react'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Keyboard shortcuts stay quiet while the user types in a field. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'default' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'default', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-accent text-accent-ink hover:opacity-90',
        variant === 'default' && 'border border-line bg-surface text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'text-rose hover:bg-rose-soft',
        className,
      )}
      {...props}
    />
  )
}

export function IconButton({ className, label, ...props }: ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30',
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx('field', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx('field min-h-[84px] resize-y py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cx('field appearance-none pr-8', className)} {...props}>
      {children}
    </select>
  )
}

export function Checkbox({
  checked,
  onChange,
  className,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  className?: string
  label?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cx(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
        checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-2 bg-surface hover:border-ink-3',
        className,
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </button>
  )
}

export function Chip({ className, children, tone = 'neutral' }: { className?: string; children: ReactNode; tone?: 'neutral' | 'amber' | 'rose' | 'accent' }) {
  return (
    <span
      className={cx(
        'inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] leading-none',
        tone === 'neutral' && 'bg-surface-2 text-ink-2',
        tone === 'amber' && 'bg-amber-soft text-amber',
        tone === 'rose' && 'bg-rose-soft text-rose',
        tone === 'accent' && 'bg-accent-soft text-accent',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface px-1 font-sans text-[11px] text-ink-2">
      {children}
    </kbd>
  )
}

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-8">
      <div className="min-w-0">
        <h1 className="text-[22px] font-medium leading-tight tracking-[-0.02em] md:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-ink-2">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  )
}

export function SectionLabel({ children, className, right }: { children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cx('mb-2 flex items-center justify-between', className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{children}</div>
      {right}
    </div>
  )
}

export function Empty({ title, body, children }: { title: ReactNode; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="fade-in flex flex-col items-center justify-center py-24 text-center">
      <p className="text-[17px] text-ink">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-[14px] text-ink-2">{body}</p>}
      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label
      className={cx('block', className)}
      onClick={(e) => {
        // A click on the caption or beside the controls activates the label's first control: fine for a
        // field (it gets the focus), wrong for a row of buttons (it would pick the first estimate or priority).
        if ((e.target as HTMLElement).closest('button,input,select,textarea,a')) return
        if (e.currentTarget.querySelector('button,input,select,textarea')?.tagName === 'BUTTON') e.preventDefault()
      }}
    >
      <span className="mb-1 block text-[12px] font-medium text-ink-2">
        {label}
        {hint && <span className="ml-1.5 font-normal text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

/** Segmented control for small enumerations (priority, status, …). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-2.5 transition-colors',
            size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[13px]',
            o.value === value ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({ open, onClose, children, width = 'max-w-lg', top = 'pt-4 md:pt-[12vh]' }: { open: boolean; onClose: () => void; children: ReactNode; width?: string; top?: string }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className={cx('fixed inset-0 z-50 flex items-start justify-center bg-ink/15 px-4 backdrop-blur-[2px]', top)} onMouseDown={onClose}>
      <div className={cx('card fade-in max-h-[calc(100dvh-2rem)] w-full overflow-y-auto p-5 shadow-[var(--shadow)]', width)} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40" onMouseDown={onClose}>
      <aside
        className="fade-in absolute inset-y-0 right-0 w-full overflow-y-auto border-l border-line bg-surface p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow)] md:w-[440px] md:p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </aside>
    </div>
  )
}

/**
 * A small per-device preference (open view, folded section) kept in localStorage. Storage can be
 * missing or blocked (private window): the value then just isn't remembered.
 */
export function useLocalState(key: string, initial: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) ?? initial
    } catch {
      return initial
    }
  })
  const set = (next: string) => {
    setValue(next)
    try {
      localStorage.setItem(key, next)
    } catch {
      // not remembered
    }
  }
  return [value, set]
}

/** True while the media query matches (e.g. useMediaQuery('(max-width: 767px)') for phones). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

export const useIsPhone = () => useMediaQuery('(max-width: 767px)')
