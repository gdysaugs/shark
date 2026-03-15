import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getRuntimePublicConfig } from './publicConfig'

function normalizeEnvString(v: string | undefined): string {
  // Guard against accidentally quoted/whitespace-padded values in build vars.
  return (v ?? '').trim().replace(/^"(.*)"$/, '$1')
}

function normalizeSupabaseUrl(v: string | undefined): string {
  const s = normalizeEnvString(v)
  if (!s) return ''

  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''
    // Supabase client expects a base URL, not an arbitrary path.
    return u.origin
  } catch {
    return ''
  }
}

type PublicConfigPayload = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

const readConfigCandidates = () => {
  const runtimeConfig = getRuntimePublicConfig()
  return {
    url: normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL || runtimeConfig.VITE_SUPABASE_URL),
    anonKey: normalizeEnvString(import.meta.env.VITE_SUPABASE_ANON_KEY || runtimeConfig.VITE_SUPABASE_ANON_KEY),
  }
}

let supabaseUrl = ''
let supabaseAnonKey = ''
export let isAuthConfigured = false
export let supabase: SupabaseClient | null = null
let ensureAuthPromise: Promise<boolean> | null = null

const applyConfig = (nextUrl: string, nextAnonKey: string) => {
  const normalizedUrl = normalizeSupabaseUrl(nextUrl)
  const normalizedAnonKey = normalizeEnvString(nextAnonKey)
  const nextConfigured = Boolean(normalizedUrl && normalizedAnonKey)
  const changed = normalizedUrl !== supabaseUrl || normalizedAnonKey !== supabaseAnonKey

  supabaseUrl = normalizedUrl
  supabaseAnonKey = normalizedAnonKey
  isAuthConfigured = nextConfigured

  if (!nextConfigured) {
    supabase = null
    return
  }

  if (!changed && supabase) return
  supabase = createClient(supabaseUrl, supabaseAnonKey)
}

const mergeRuntimeConfig = (payload: PublicConfigPayload) => {
  if (typeof window === 'undefined') return
  window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, payload)
}

const loadRuntimePublicConfigFromApi = async () => {
  if (typeof window === 'undefined') return
  try {
    const response = await fetch('/api/public_config', { cache: 'no-store' })
    if (!response.ok) return
    const payload = (await response.json()) as unknown
    if (!payload || typeof payload !== 'object') return
    mergeRuntimeConfig(payload as PublicConfigPayload)
  } catch {
    // Ignore transient network/runtime errors; caller handles fallback state.
  }
}

const initial = readConfigCandidates()
applyConfig(initial.url, initial.anonKey)

export const ensureAuthConfigured = async () => {
  if (isAuthConfigured && supabase) return true
  if (typeof window === 'undefined') return false

  if (ensureAuthPromise) return ensureAuthPromise
  ensureAuthPromise = (async () => {
    await loadRuntimePublicConfigFromApi()
    const next = readConfigCandidates()
    applyConfig(next.url, next.anonKey)
    return Boolean(isAuthConfigured && supabase)
  })().finally(() => {
    ensureAuthPromise = null
  })

  return ensureAuthPromise
}

function getSupabaseProjectRef(url: string): string {
  if (!url) return ''
  try {
    const hostname = new URL(url).hostname
    const first = hostname.split('.')[0] ?? ''
    return first.trim()
  } catch {
    return ''
  }
}

function clearSupabaseBrowserStorage() {
  if (typeof window === 'undefined') return

  const projectRef = getSupabaseProjectRef(supabaseUrl)
  const prefixes = projectRef ? [`sb-${projectRef}-`, 'supabase.auth.token'] : ['sb-', 'supabase.auth.token']
  const storages: Storage[] = []

  try {
    storages.push(window.localStorage)
  } catch {
    // ignore
  }
  try {
    storages.push(window.sessionStorage)
  } catch {
    // ignore
  }

  for (const storage of storages) {
    const toRemove: string[] = []
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (!key) continue
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        toRemove.push(key)
      }
    }
    for (const key of toRemove) {
      storage.removeItem(key)
    }
  }
}

export async function signOutSafely(): Promise<void> {
  if (!supabase) return
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
  } catch {
    // If Supabase returns 403 on logout, still clear browser-side session keys.
  } finally {
    clearSupabaseBrowserStorage()
  }
}
