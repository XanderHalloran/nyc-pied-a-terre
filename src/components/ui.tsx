import { useEffect, useRef, type ReactNode } from 'react'
import { TYPE_COLOR, TYPE_LABEL, STATUS_LABEL } from '../lib/data'

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className="badge type" style={{ '--c': TYPE_COLOR[type] } as React.CSSProperties}>
      {TYPE_LABEL[type] ?? type}
    </span>
  )
}

const STATUS_PLAIN: Record<string, string> = {
  listed: 'On the list',
  inferred: 'Fits criteria',
  not_flagged: 'Unaffected',
}

export function StatusBadge({ status, plain }: { status: string; plain?: boolean }) {
  return (
    <span className={`badge ${status}`} title={plain ? STATUS_LABEL[status] : undefined}>
      {(plain ? STATUS_PLAIN[status] : STATUS_LABEL[status]) ?? status}
    </span>
  )
}

export function Dot({ type }: { type: string }) {
  return <i className="dotmark" style={{ '--c': TYPE_COLOR[type] } as React.CSSProperties} />
}

export function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="stat" title={title}>
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  )
}

export function Chip({ on, onClick, color, children }: { on: boolean; onClick: () => void; color?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className={color ? 'chip dot' : 'chip'}
      aria-pressed={on}
      onClick={onClick}
      style={color ? ({ '--c': color } as React.CSSProperties) : undefined}
    >
      {children}
    </button>
  )
}

export function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check small">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

/** Escape closes, focus is trapped to the dialog on open. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal"
        style={wide ? { maxWidth: 1180 } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="tiny">{label}</span>
      {children}
    </label>
  )
}

export function KV({ k, v, title }: { k: string; v: ReactNode; title?: string }) {
  return (
    <>
      <dt title={title}>{k}</dt>
      <dd>{v ?? <span className="dim">—</span>}</dd>
    </>
  )
}
