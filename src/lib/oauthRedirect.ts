import { getRuntimePublicConfig } from './publicConfig'

const FALLBACK_REDIRECT_URL = 'https://sharkai.uk/video'
const TRUSTED_HOSTS = ['sharkai.uk', 'www.sharkai.uk', 'shark.pages.dev']
const TRUSTED_HOST_SUFFIXES = ['.shark.pages.dev']
const LEGACY_HOST_MARKERS = ['sparkwork', 'sparkmotion.work']

const parseUrl = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const toRedirectLocation = (url: URL) => `${url.origin}${url.pathname}`
const normalizeHost = (hostname: string) => hostname.trim().toLowerCase()

const isLegacyHost = (hostname: string) => {
  const normalized = normalizeHost(hostname)
  return LEGACY_HOST_MARKERS.some((marker) => normalized.includes(marker))
}

const isTrustedHost = (hostname: string, currentHostname: string) => {
  const normalized = normalizeHost(hostname)
  const normalizedCurrent = normalizeHost(currentHostname)
  if (normalized === normalizedCurrent) return true
  if (TRUSTED_HOSTS.includes(normalized)) return true
  return TRUSTED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

const resolveConfiguredRedirect = (configured: string | undefined, currentHostname: string) => {
  const configuredUrl = parseUrl(configured ?? '')
  if (!configuredUrl) return ''
  if (!isTrustedHost(configuredUrl.hostname, currentHostname)) return ''
  return toRedirectLocation(configuredUrl)
}

export const getOAuthRedirectUrl = () => {
  if (typeof window === 'undefined') return undefined

  const current = parseUrl(window.location.href)
  if (!current) return FALLBACK_REDIRECT_URL
  const currentUrl = toRedirectLocation(current)

  const runtimeConfig = getRuntimePublicConfig()
  const configured =
    (import.meta.env.VITE_SUPABASE_REDIRECT_URL as string | undefined) || runtimeConfig.VITE_SUPABASE_REDIRECT_URL

  const configuredRedirect = resolveConfiguredRedirect(configured, current.hostname)
  if (configuredRedirect) return configuredRedirect

  if (isLegacyHost(current.hostname)) return FALLBACK_REDIRECT_URL

  return currentUrl
}
