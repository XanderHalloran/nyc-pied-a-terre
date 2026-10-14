import { useState } from 'react'
import { Modal } from '../../components/ui'
import { signIn, signUp, accountError } from '../../lib/account'

/**
 * The only place an account is ever asked for, and it is always dismissible. The copy leads with
 * what signing in does (sync) rather than what it unlocks (nothing), because nothing on this site
 * is behind it.
 */
export default function SignIn({ saved, onClose, onDone }: { saved: number; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'up' | 'in'>('up')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await (mode === 'up' ? signUp(email.trim(), password) : signIn(email.trim(), password))
      onDone()
    } catch (e) {
      setErr(accountError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={mode === 'up' ? 'Keep your saved properties' : 'Sign in'} onClose={onClose}>
      <p className="prose" style={{ marginTop: 0 }}>
        {saved > 0
          ? `You have ${saved} saved propert${saved === 1 ? 'y' : 'ies'} on this device. An account keeps them if you switch phone or browser.`
          : 'An account keeps your saved properties across devices.'}{' '}
        That is all it does. Every part of this site works without one, and nothing is emailed to you.
      </p>

      <form onSubmit={submit} className="stack" style={{ maxWidth: 380 }}>
        <label className="field">
          <span className="tiny">Email</span>
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="tiny">Password{mode === 'up' ? ' (8 characters or more)' : ''}</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {err && <div className="small" style={{ color: 'var(--danger)' }}>{err}</div>}
        <div className="row wrap">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Working…' : mode === 'up' ? 'Create account' : 'Sign in'}
          </button>
          <button type="button" className="ghost small" onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setErr(null) }}>
            {mode === 'up' ? 'I already have an account' : 'Create one instead'}
          </button>
          <div className="grow" />
          <button type="button" className="ghost small" onClick={onClose}>Not now</button>
        </div>
      </form>

      <p className="small dim" style={{ marginTop: 14, lineHeight: 1.55 }}>
        Your email is used to sign you in and nothing else. Saved properties are the only thing stored against the account: no search history, no addresses you looked at.
      </p>
    </Modal>
  )
}
