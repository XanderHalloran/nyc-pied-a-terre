import { useState } from 'react'
import { POLICY } from '../lib/data'

const KEY = `nyc-pat-update-${POLICY.status_update?.id ?? 'none'}`

/**
 * One-shot notice when policy moves under the visitor: deadline extensions, litigation,
 * DOF clarifications. Dismisses per device so it does not nag every visit.
 */
export default function StatusBanner() {
  const u = POLICY.status_update
  const [open, setOpen] = useState(() => {
    if (!u) return false
    try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
  })
  if (!u || !open) return null

  const dismiss = () => {
    try { localStorage.setItem(KEY, 'off') } catch {}
    setOpen(false)
  }

  const asOf = new Date(u.as_of + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="update-banner" role="status">
      <div className="update-banner-in">
        <span className="update-tag">Update · {asOf}</span>
        <strong>{u.headline}.</strong>{' '}
        <span>{u.body}</span>{' '}
        <a href={u.source_url} target="_blank" rel="noreferrer">{u.source_label} ↗</a>
      </div>
      <button type="button" className="ghost small" onClick={dismiss} aria-label="Dismiss update">
        Dismiss
      </button>
    </div>
  )
}
