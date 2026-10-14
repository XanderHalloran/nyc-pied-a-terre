// Optional accounts, for one purpose: keeping saved properties across devices.
//
// Everything on this site works logged out and nothing here gates a feature. Favourites live in
// localStorage first and always; signing in only adds sync. That ordering is deliberate — a visitor
// who never signs in must lose nothing, and a visitor who does must not lose what they already saved.
//
// Same-origin `/accounts/*` proxies to the shared PocketBase identity store, so there is no CORS,
// no third-party cookie, and no SDK: PocketBase's REST API is four fetches.

const API = '/accounts/api'
const FAVS_KEY = 'nyc-pat-favs'
const AUTH_KEY = 'nyc-pat-auth'
/** One record per user, holding the whole list — same shape the other apps on this store use. */
const COLLECTION = 'thelist_favorites'

export interface Account { token: string; id: string; email: string }

// ------------------------------------------------------------------ local set

const read = (): string[] => {
  try { return JSON.parse(localStorage.getItem(FAVS_KEY) ?? '[]') } catch { return [] }
}
const write = (ids: string[]) => localStorage.setItem(FAVS_KEY, JSON.stringify(ids))

export const favourites = read
export const isFavourite = (id: string) => read().includes(id)

/** Toggle locally and return the new set. Never awaits the network — the star must feel instant. */
export function toggleFavourite(id: string): string[] {
  const cur = read()
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  write(next)
  void push(next)
  return next
}

// --------------------------------------------------------------------- account

export function account(): Account | null {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') } catch { return null }
}
const setAccount = (a: Account | null) =>
  a ? localStorage.setItem(AUTH_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTH_KEY)

async function call(path: string, init: RequestInit = {}) {
  const a = account()
  const res = await fetch(API + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(a ? { Authorization: a.token } : {}),
      ...init.headers,
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message || `Request failed (${res.status})`)
  return body
}

/** PocketBase reports field-level problems in `data`; surface the first one, not a generic 400. */
function message(e: unknown) {
  const m = e instanceof Error ? e.message : String(e)
  return m === 'Failed to fetch' ? 'Could not reach the server. Your saved properties are safe on this device.' : m
}

export async function signUp(email: string, password: string) {
  await call('/collections/users/records', {
    method: 'POST',
    body: JSON.stringify({ email, password, passwordConfirm: password, emailVisibility: false }),
  })
  return signIn(email, password)
}

export async function signIn(email: string, password: string) {
  const r = await call('/collections/users/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity: email, password }),
  })
  setAccount({ token: r.token, id: r.record.id, email: r.record.email })
  return merge()
}

export function signOut() {
  setAccount(null)
  // Deliberately leaves the local list alone: signing out is not a request to lose your saves.
}

// ----------------------------------------------------------------------- sync

async function row() {
  const a = account()
  if (!a) return null
  const r = await call(`/collections/${COLLECTION}/records?perPage=1&filter=${encodeURIComponent(`user="${a.id}"`)}`)
  return r.items?.[0] ?? null
}

/** Local wins on conflict by union: two devices adding different properties keeps both. */
async function merge() {
  const a = account()
  if (!a) return read()
  const existing = await row()
  const remote: string[] = Array.isArray(existing?.properties) ? existing.properties : []
  const union = [...new Set([...remote, ...read()])]
  write(union)
  await save(union, existing?.id)
  return union
}

async function save(ids: string[], recordId?: string) {
  const a = account()
  if (!a) return
  if (recordId) {
    await call(`/collections/${COLLECTION}/records/${recordId}`, { method: 'PATCH', body: JSON.stringify({ properties: ids }) })
  } else {
    await call(`/collections/${COLLECTION}/records`, { method: 'POST', body: JSON.stringify({ user: a.id, properties: ids }) })
  }
}

/**
 * Fire-and-forget upstream write. A failure is swallowed on purpose: the local list is the source
 * of truth for the session, and an offline visitor should not see an error for starring a row.
 */
async function push(ids: string[]) {
  if (!account()) return
  try { await save(ids, (await row())?.id) } catch { /* local set stands */ }
}

/** Pull the account's list on load and union it in, so a second device sees the first device's saves. */
export async function hydrate() {
  if (!account()) return read()
  try { return await merge() } catch { return read() }
}

export { message as accountError }
