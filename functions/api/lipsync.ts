import { createClient, type User } from '@supabase/supabase-js'
import { buildCorsHeaders, isCorsBlocked } from '../_shared/cors'
import { presignUrl } from '../_shared/sigv4'

type Stage = 'tts' | 'lipsync'

type Env = {
  RUNPOD_API_KEY?: string
  RUNPOD_SOVITS_API_KEY?: string
  RUNPOD_LIPSYNC_API_KEY?: string
  RUNPOD_ENDPOINT_URL?: string
  RUNPOD_SOVITS_ENDPOINT_URL?: string
  RUNPOD_LIPSYNC_ENDPOINT_URL?: string
  RUNPOD_W2L_ENDPOINT_URL?: string
  SOVITS_REF_AUDIO_URL?: string
  SOVITS_REF_TEXT?: string
  SOVITS_MODE?: string
  SOVITS_TEXT_LANG?: string
  SOVITS_PROMPT_LANG?: string
  SOVITS_AUTO_PROMPT_TEXT?: string
  SOVITS_FRAGMENT_INTERVAL?: string
  SOVITS_SPEED_FACTOR?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  MEDIA_BUCKET?: R2Bucket
  R2_PUBLIC_BASE_URL?: string
  R2_ACCOUNT_ID?: string
  R2_BUCKET?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  R2_REGION?: string
}

const corsMethods = 'POST, GET, OPTIONS'
const DEFAULT_SOVITS_MODE = 'gptsovits_v4_tts'
const DEFAULT_SOVITS_TEXT_LANG = 'ja'
const DEFAULT_SOVITS_PROMPT_LANG = 'ja'
const DEFAULT_SOVITS_FRAGMENT_INTERVAL = 0.08
const MIN_SOVITS_FRAGMENT_INTERVAL = 0
const MAX_SOVITS_FRAGMENT_INTERVAL = 1
const DEFAULT_SOVITS_SPEED_FACTOR = 1
const MIN_SOVITS_SPEED_FACTOR = 1
const MAX_SOVITS_SPEED_FACTOR = 2
const DEFAULT_SOVITS_TEMPERATURE = 1
const MIN_SOVITS_TEMPERATURE = 1
const MAX_SOVITS_TEMPERATURE = 2
const DEFAULT_W2L_CHECKPOINT = 'checkpoints/wav2lip_gan.onnx'
const DEFAULT_W2L_ENHANCER = 'codeformer'
const DEFAULT_W2L_BLENDING = 6
const NON_PREMIUM_MAX_TEXT_LENGTH = 30
const PREMIUM_MAX_TEXT_LENGTH = 100
const MAX_VIDEO_BYTES = 80 * 1024 * 1024
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const MAX_REF_AUDIO_BYTES = 5 * 1024 * 1024
const MIN_REF_AUDIO_SECONDS = 3
const MAX_REF_AUDIO_SECONDS = 10
const REF_AUDIO_DURATION_RANGE_ERROR = 'Reference audio is outside the 3-10 second range, please choose another one!'
const MAX_TTS_AUDIO_SECONDS = 30
const MAX_REF_TEXT_REPEAT_COUNT = 20
const MAX_TTS_PROBE_TEXT_LENGTH = 32
const DEFAULT_TTS_PROBE_TEXT = '。'
const TTS_TOO_LONG_POPUP_MESSAGE = '\u751f\u6210\u30a8\u30e9\u30fc\u3067\u3059\u3002\u53c2\u8003\u97f3\u58f0\u3001\u30bb\u30ea\u30d5\u306e\u3044\u305a\u308c\u304b\u306b\u554f\u984c\u304c\u3042\u308a\u307e\u3059\u3002\u4fee\u6b63\u3057\u3066\u518d\u5ea6\u751f\u6210\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
const RUNPOD_MAX_BODY_BYTES = 10 * 1024 * 1024
const SIGNUP_TICKET_GRANT = 5
const LIPSYNC_SHORT_TEXT_TICKET_COST = 2
const LIPSYNC_LONG_TEXT_TICKET_COST = 3
const LIPSYNC_LONG_TEXT_THRESHOLD = 60
const LIPSYNC_VIDEO_STAGE_TICKET_COST = 1
const LIPSYNC_TTS_USAGE_PREFIX = "lipsync:tts:"
const PREMIUM_USAGE_ID_PREFIX = 'premium_status:'
const PREMIUM_UPLOAD_ONLY_MESSAGE =
  '参考音声アップロードはプレミアム限定です。アップロードした音声または動画の声を称してボイスクローン出来ます。'
const DEFAULT_R2_PUBLIC_BASE_URL = 'https://pub-899ab9de55a1446ca40d9795dce93fa6.r2.dev'
const FALLBACK_SOVITS_ENDPOINT = 'https://api.runpod.ai/v2/5uvujcc8baqwu1'
const FALLBACK_LIPSYNC_ENDPOINT = 'https://api.runpod.ai/v2/mifzq3lqydu04d'
const SOVITS_USER_UPLOAD_PREFIX = 'user_upload/sovits'
const SOVITS_USER_UPLOAD_RETENTION_DAYS = 7
const SOVITS_USER_UPLOAD_RETENTION_MS = SOVITS_USER_UPLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000
const SOVITS_USER_UPLOAD_CLEANUP_MAX_PAGES = 4
const SOVITS_USER_UPLOAD_CLEANUP_LIST_LIMIT = 250
const INTERNAL_ERROR_MESSAGE = 'エラーです。やり直してください。'
const GENERIC_TTS_ERROR_MESSAGE = '音声生成に失敗しました。セリフやプリセットを変更して再度お試しください。'
const GENERIC_LIPSYNC_ERROR_MESSAGE = '動画生成に失敗しました。セリフやプリセットを変更して再度お試しください。'
const PRESET_REF_BY_ID: Record<string, string> = {
  onnanoko1: 'onnanoko1_priorityseat.mp3',
  onnanoko2: 'onnanoko2_motivation.wav',
  onnanoko3: 'onnanoko3_ganbattemiyou.wav',
  onnanoko4: 'onnanoko4_100man.wav',
  onnanoko5: 'onnanoko5_shashinbu.mp3',
  yandere1: 'yandere1_hitorigurashi.mp3',
  aegi1: 'aegi1_datte_hic.mp3',
}
const ALLOWED_PRESET_REF_FILENAMES = new Set(Object.values(PRESET_REF_BY_ID))
const PUBLIC_PRESET_REF_IDS = new Set(['onnanoko1', 'onnanoko2', 'onnanoko3', 'onnanoko4', 'onnanoko5', 'yandere1', 'aegi1'])

const jsonResponse = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  })

const internalErrorResponse = (corsHeaders: HeadersInit) =>
  jsonResponse({ error: INTERNAL_ERROR_MESSAGE }, 500, corsHeaders)

const pickNestedMessage = (value: any): string => {
  if (!value || typeof value !== 'object') return ''
  const candidate =
    value?.error ??
    value?.message ??
    value?.detail ??
    value?.output?.error ??
    value?.result?.error ??
    value?.output?.output?.error ??
    value?.result?.output?.error
  return typeof candidate === 'string' ? candidate : ''
}

const tryExtractMessageFromJson = (value: string) => {
  const text = String(value || '').trim()
  if (!text) return ''
  if (!((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) {
    return ''
  }
  try {
    const parsed = JSON.parse(text)
    return pickNestedMessage(parsed) || ''
  } catch {
    return ''
  }
}

const rewritePublicMessage = (value: string) => {
  const text = String(value || '').trim()
  if (!text) return ''
  return text
    .replace(/gpt[-_ ]?sovits/gi, '音声生成')
    .replace(/wav2lip/gi, '動画生成')
    .replace(/sovits/gi, '音声生成')
    .replace(/SoVITS/gi, '音声生成')
    .replace(/Wav2Lip/gi, '動画生成')
    .replace(/\bTTS\b/gi, '音声生成')
    .replace(/LipSync/gi, '動画生成')
    .replace(/RunPod/gi, 'サーバー')
    .replace(/codeformer/gi, '補正処理')
    .replace(/gfpgan/gi, '補正処理')
    .replace(/restoreformer/gi, '補正処理')
    .replace(/gpen/gi, '補正処理')
    .replace(/onnx/gi, '推論処理')
}

const isTechnicalError = (value: string) => {
  const text = String(value || '').trim()
  if (!text) return false
  const lowered = text.toLowerCase()
  const isJsonLike =
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  const hasTechnicalHints =
    lowered === '[object object]' ||
    lowered.includes('"error":') ||
    lowered.includes('"error_message":') ||
    lowered.includes('"error_type":') ||
    lowered.includes('traceback') ||
    lowered.includes('onnxruntime') ||
    lowered.includes('gptsovits') ||
    lowered.includes('wav2lip') ||
    lowered.includes('sovits') ||
    lowered.includes('executionprovider') ||
    lowered.includes('runtimeerror') ||
    lowered.includes('valueerror') ||
    lowered.includes('workflow validation failed') ||
    lowered.includes('class_type') ||
    lowered.includes('comfyui') ||
    lowered.includes('.safetensors') ||
    lowered.includes('.gguf') ||
    lowered.includes('no such file') ||
    lowered.includes('runpod') ||
    lowered.includes('content security policy') ||
    lowered.includes('cors policy') ||
    lowered.includes('/app/') ||
    lowered.includes('stack') ||
    lowered.includes('inference failed') ||
    lowered.includes('cuda') ||
    lowered.includes('tensor')
  return isJsonLike || hasTechnicalHints
}

const sanitizePublicErrorMessage = (value: unknown, stage: Stage) => {
  const fallback = stage === 'tts' ? GENERIC_TTS_ERROR_MESSAGE : GENERIC_LIPSYNC_ERROR_MESSAGE
  let message = ''
  if (typeof value === 'object' && value !== null) {
    message = pickNestedMessage(value)
    if (!message && value instanceof Error) {
      message = value.message
    }
    if (!message) {
      message = String(value)
    }
  } else {
    message = String(value ?? '')
  }
  message = message.trim()
  if (!message) return fallback

  const extracted = tryExtractMessageFromJson(message)
  if (extracted) {
    message = extracted.trim()
  }

  if (message === TTS_TOO_LONG_POPUP_MESSAGE) {
    return TTS_TOO_LONG_POPUP_MESSAGE
  }

  const exactMap: Record<string, string> = {
    'Authentication is required.': 'ログインが必要です。',
    'Authentication failed.': '認証に失敗しました。',
    'Email not available.': 'メールアドレスを取得できません。',
    'No tickets available.': 'トークン情報の取得に失敗しました。',
    'No tickets remaining.': 'トークンが不足しています。',
    'Invalid ticket request.': 'リクエストが不正です。',
    'Invalid request body.': 'リクエスト形式が不正です。',
    'Invalid input.': '入力内容が不正です。',
    'id is required.': 'ジョブIDが必要です。',
    'text is required.': 'セリフを入力してください。',
    'ref_text is required.': '参考音声の文字起こしテキストを入力してください。',
    'text is too long. Max 30 characters.': 'セリフは30文字以内にしてください。',
    'text is too long. Max 100 characters.': 'セリフは100文字以内にしてください。',
    'Reference audio is outside the 3-10 second range, please choose another one!': '参考音声の長さは3〜10秒にしてください。',
    'ref_audio is too long. Max 20 seconds.': '参考音声は20秒以内にしてください。',
    'ref_audio is too large.': '参考音声ファイルが大きすぎます。',
    'audio is too large.': '音声ファイルが大きすぎます。',
    'video is too large.': '動画ファイルが大きすぎます。',
    'audio_url must be a public https URL.': '音声URLの形式が不正です。',
    'video_url must be a public https URL.': '動画URLの形式が不正です。',
    'ref_audio_url must be a public https URL.': '参考音声URLの形式が不正です。',
    'preset_ref_id is invalid.': 'プリセット音声の指定が不正です。',
    'preset_ref_url is not allowed.': '許可されていないプリセット音声です。',
    'Failed to fetch preset reference audio.': 'プリセット参考音声の取得に失敗しました。',
    'RunPod status check failed.': 'ステータス確認に失敗しました。',
    'Failed to fetch': '通信に失敗しました。時間をおいて再度お試しください。',
    'NetworkError when attempting to fetch resource.': '通信に失敗しました。時間をおいて再度お試しください。',
    'Load failed': '通信に失敗しました。時間をおいて再度お試しください。',
    'no healthy upstream': 'サーバーが混み合っています。時間をおいて再度お試しください。',
    'Service Temporarily Unavailable': 'サーバーが混み合っています。時間をおいて再度お試しください。',
    'Input exceeds RunPod 10MiB limit. Configure MEDIA_BUCKET binding (or R2_* env vars), or use a shorter video.':
      '入力データが大きすぎます。動画または音声を短くして再度お試しください。',
    'RunPod payload exceeded 10MiB. Configure MEDIA_BUCKET binding (or R2_* env vars) so video is sent via R2 URL.':
      '入力データが大きすぎます。動画または音声を短くして再度お試しください。',
    'SOVITS endpoint is likely pointing to Wav2Lip. Check RUNPOD_SOVITS_ENDPOINT_URL.':
      'Server configuration error. Please try again later.',
    'LipSync endpoint is likely pointing to SoVITS. Check RUNPOD_LIPSYNC_ENDPOINT_URL.':
      'Server configuration error. Please try again later.',
    'tts_usage_id is required for lipsync stage.': 'リップシンク実行には先に音声生成が必要です。',
    'tts_usage_id is invalid.': '音声生成IDが不正です。',
    'Linked tts usage is not a tts stage usage.': '音声生成IDが不正です。',
    'Linked tts usage is already consumed.': 'この音声生成IDはすでに使用済みです。音声生成からやり直してください。',
  }
  if (exactMap[message]) return exactMap[message]

  const rewritten = rewritePublicMessage(message)
  if (!rewritten || rewritten === '[object Object]') return fallback
  if (isTechnicalError(message) || isTechnicalError(rewritten) || rewritten.length > 300) {
    return fallback
  }
  return rewritten
}

const normalizeStage = (value: unknown): Stage =>
  String(value ?? '').toLowerCase() === 'tts' ? 'tts' : 'lipsync'

const parseBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (!normalized) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return fallback
}

const normalizeInt = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const normalizeNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const normalizeEndpoint = (value?: string) => {
  if (!value) return ''
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '')
  if (!trimmed) return ''
  const normalized = trimmed.replace(/\/+$/, '')
  try {
    const parsed = new URL(normalized)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length >= 2 && segments[0].toLowerCase() === 'v2') {
      return `${parsed.origin}/v2/${segments[1]}`
    }
    const cleanedPath = parsed.pathname.replace(/\/+$/, '').replace(/\/run(?:sync)?$/i, '')
    return `${parsed.origin}${cleanedPath}`
  } catch {
    return ''
  }
}

const resolveEndpoint = (env: Env, stage: Stage) => {
  if (stage === 'tts') {
    return (
      normalizeEndpoint(env.RUNPOD_SOVITS_ENDPOINT_URL) ||
      normalizeEndpoint(env.RUNPOD_ENDPOINT_URL) ||
      FALLBACK_SOVITS_ENDPOINT
    )
  }
  return (
    normalizeEndpoint(env.RUNPOD_LIPSYNC_ENDPOINT_URL) ||
    normalizeEndpoint(env.RUNPOD_W2L_ENDPOINT_URL) ||
    normalizeEndpoint(env.RUNPOD_ENDPOINT_URL) ||
    FALLBACK_LIPSYNC_ENDPOINT
  )
}

const resolveApiKey = (env: Env, stage: Stage) => {
  if (stage === 'tts') {
    return String(env.RUNPOD_SOVITS_API_KEY || env.RUNPOD_API_KEY || '').trim()
  }
  return String(env.RUNPOD_LIPSYNC_API_KEY || env.RUNPOD_API_KEY || '').trim()
}

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const extractBearerToken = (request: Request) => {
  const header = request.headers.get('Authorization') || ''
  const match = header.match(/Bearer\s+(.+)/i)
  return match ? match[1] : ''
}

const getSupabaseAdmin = (env: Env) => {
  const url = env.SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const requireAuthenticatedUser = async (request: Request, env: Env, corsHeaders: HeadersInit) => {
  const token = extractBearerToken(request)
  if (!token) {
    return { response: jsonResponse({ error: 'ログインが必要です。' }, 401, corsHeaders) }
  }

  const admin = getSupabaseAdmin(env)
  if (!admin) {
    return {
      response: jsonResponse(
        { error: '認証設定が不足しています。' },
        500,
        corsHeaders,
      ),
    }
  }

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) {
    return { response: jsonResponse({ error: '認証に失敗しました。' }, 401, corsHeaders) }
  }

  return { admin, user: data.user }
}

const makeUsageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const fetchTicketRow = async (
  admin: ReturnType<typeof createClient>,
  user: User,
) => {
  const email = user.email
  const { data: byUser, error: userError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .eq('user_id', user.id)
    .maybeSingle()
  if (userError) {
    return { error: userError }
  }
  if (byUser) {
    return { data: byUser, error: null }
  }
  if (!email) {
    return { data: null, error: null }
  }
  const { data: byEmail, error: emailError } = await admin
    .from('user_tickets')
    .select('id, email, user_id, tickets')
    .eq('email', email)
    .maybeSingle()
  if (emailError) {
    return { error: emailError }
  }
  return { data: byEmail, error: null }
}

const ensureTicketRow = async (
  admin: ReturnType<typeof createClient>,
  user: User,
) => {
  const email = user.email
  if (!email) {
    return { data: null, error: null }
  }

  const { data: existing, error } = await fetchTicketRow(admin, user)
  if (error) {
    return { data: null, error }
  }
  if (existing) {
    return { data: existing, error: null, created: false }
  }

  const { data: inserted, error: insertError } = await admin
    .from('user_tickets')
    .insert({ email, user_id: user.id, tickets: SIGNUP_TICKET_GRANT })
    .select('id, email, user_id, tickets')
    .maybeSingle()

  if (insertError || !inserted) {
    const { data: retry, error: retryError } = await fetchTicketRow(admin, user)
    if (retryError) {
      return { data: null, error: retryError }
    }
    return { data: retry, error: null, created: false }
  }

  const grantUsageId = makeUsageId()
  await admin.from('ticket_events').insert({
    usage_id: grantUsageId,
    email,
    user_id: user.id,
    delta: SIGNUP_TICKET_GRANT,
    reason: 'signup_bonus',
    metadata: { source: 'auto_grant' },
  })

  return { data: inserted, error: null, created: true }
}

const ensureTicketAvailable = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  requiredTickets = 1,
  corsHeaders: HeadersInit = {},
) => {
  const email = user.email
  if (!email) {
    return { response: jsonResponse({ error: 'メールアドレスを取得できません。' }, 400, corsHeaders) }
  }

  const { data: existing, error } = await ensureTicketRow(admin, user)
  if (error) {
    return { response: internalErrorResponse(corsHeaders) }
  }
  if (!existing) {
    return { response: jsonResponse({ error: 'トークン情報の取得に失敗しました。' }, 402, corsHeaders) }
  }
  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }
  if (existing.tickets < requiredTickets) {
    return { response: jsonResponse({ error: 'トークンが不足しています。' }, 402, corsHeaders) }
  }

  return { existing }
}

const fetchPremiumStatus = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  corsHeaders: HeadersInit = {},
) => {
  const usageId = `${PREMIUM_USAGE_ID_PREFIX}${user.id}`
  const { data, error } = await admin
    .from('ticket_events')
    .select('delta')
    .eq('usage_id', usageId)
    .maybeSingle()
  if (error) {
    return { response: internalErrorResponse(corsHeaders) }
  }
  return { isPremium: Number(data?.delta || 0) > 0 }
}

const consumeTicket = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  metadata: Record<string, unknown>,
  usageId: string,
  ticketCost = 1,
  corsHeaders: HeadersInit = {},
) => {
  const cost = Math.max(1, Math.floor(ticketCost))
  const email = user.email
  if (!email) {
    return { response: jsonResponse({ error: 'メールアドレスを取得できません。' }, 400, corsHeaders) }
  }

  const { data: existing, error } = await fetchTicketRow(admin, user)
  if (error) {
    return { response: internalErrorResponse(corsHeaders) }
  }
  if (!existing) {
    return { response: jsonResponse({ error: 'トークン情報の取得に失敗しました。' }, 402, corsHeaders) }
  }
  if (!existing.user_id) {
    await admin.from('user_tickets').update({ user_id: user.id }).eq('id', existing.id)
  }

  const { data: rpcData, error: rpcError } = await admin.rpc('consume_tickets', {
    p_ticket_id: existing.id,
    p_usage_id: usageId,
    p_cost: cost,
    p_reason: 'generate_lipsync',
    p_metadata: metadata,
  })

  if (rpcError) {
    const message = rpcError.message ?? 'Failed to update tickets.'
    if (message.includes('INSUFFICIENT_TICKETS')) {
      return { response: jsonResponse({ error: 'トークンが不足しています。' }, 402, corsHeaders) }
    }
    if (message.includes('INVALID')) {
      return { response: jsonResponse({ error: 'リクエストが不正です。' }, 400, corsHeaders) }
    }
    return { response: internalErrorResponse(corsHeaders) }
  }

  const result = Array.isArray(rpcData) ? rpcData[0] : rpcData
  const ticketsLeft = Number(result?.tickets_left)
  const alreadyConsumed = Boolean(result?.already_consumed)
  return {
    ticketsLeft: Number.isFinite(ticketsLeft) ? ticketsLeft : undefined,
    alreadyConsumed,
  }
}

const ensureUsageOwnership = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  usageId: string,
  corsHeaders: HeadersInit,
) => {
  const { data: chargeEvent, error: chargeError } = await admin
    .from('ticket_events')
    .select('user_id, email, metadata')
    .eq('usage_id', usageId)
    .maybeSingle()

  if (chargeError) {
    return { response: internalErrorResponse(corsHeaders) }
  }
  if (!chargeEvent) {
    return { response: jsonResponse({ error: 'ジョブが見つかりません。' }, 404, corsHeaders) }
  }

  const email = user.email ?? ''
  const chargeUserId = chargeEvent.user_id ? String(chargeEvent.user_id) : ''
  const chargeEmail = chargeEvent.email ? String(chargeEvent.email) : ''
  const matchesUser = Boolean(chargeUserId && chargeUserId === user.id)
  const matchesEmail = Boolean(email && chargeEmail && chargeEmail.toLowerCase() === email.toLowerCase())
  if (!matchesUser && !matchesEmail) {
    return { response: jsonResponse({ error: 'ジョブが見つかりません。' }, 404, corsHeaders) }
  }

  return { ok: true as const, chargeEvent }
}


const resolveLinkedTtsUsageId = (input: Record<string, unknown>) =>
  String(input.tts_usage_id ?? input.ttsUsageId ?? input.tts_usage ?? input.ttsUsage ?? '').trim()

const ensureLinkedTtsUsage = async (
  admin: ReturnType<typeof createClient>,
  user: User,
  input: Record<string, unknown>,
  corsHeaders: HeadersInit,
) => {
  const linkedUsageId = resolveLinkedTtsUsageId(input)
  if (!linkedUsageId) {
    return { response: jsonResponse({ error: 'tts_usage_id is required for lipsync stage.' }, 400, corsHeaders) }
  }
  if (!linkedUsageId.toLowerCase().startsWith(LIPSYNC_TTS_USAGE_PREFIX)) {
    return { response: jsonResponse({ error: 'tts_usage_id is invalid.' }, 400, corsHeaders) }
  }
  const ownership = await ensureUsageOwnership(admin, user, linkedUsageId, corsHeaders)
  if ('response' in ownership) {
    return { response: ownership.response }
  }
  const metadata = ownership.chargeEvent?.metadata
  const linkedStage =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? String((metadata as Record<string, unknown>).stage ?? '').trim().toLowerCase()
      : ''
  if (linkedStage && linkedStage !== 'tts') {
    return { response: jsonResponse({ error: 'Linked tts usage is not a tts stage usage.' }, 400, corsHeaders) }
  }
  const { data: linkedUsageCharge, error: linkedUsageChargeError } = await admin
    .from('ticket_events')
    .select('usage_id')
    .eq('reason', 'generate_lipsync')
    .filter('metadata->>linked_tts_usage_id', 'eq', linkedUsageId)
    .limit(1)
    .maybeSingle()
  if (linkedUsageChargeError) {
    return { response: internalErrorResponse(corsHeaders) }
  }
  if (linkedUsageCharge?.usage_id) {
    return { response: jsonResponse({ error: 'Linked tts usage is already consumed.' }, 409, corsHeaders) }
  }
  return { ok: true as const, linkedUsageId }
}

const stripDataUrl = (value: string) => {
  const comma = value.indexOf(',')
  if (value.startsWith('data:') && comma !== -1) return value.slice(comma + 1)
  return value
}

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim())

const isAllowedPresetRefUrl = (value: string) => {
  const trimmed = value.trim()
  if (!isHttpUrl(trimmed)) return false
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:') return false
    if (!parsed.hostname.endsWith('.r2.dev')) return false
    if (!parsed.pathname.startsWith('/sovits_ref/')) return false
    const filename = parsed.pathname.split('/').pop()?.toLowerCase() || ''
    return ALLOWED_PRESET_REF_FILENAMES.has(filename)
  } catch {
    return false
  }
}

const buildPresetRefUrlFromId = (env: Env, presetRefId: string, requestOrigin: string) => {
  const normalizedId = String(presetRefId || '').trim().toLowerCase()
  if (!normalizedId) return ''
  const filename = PRESET_REF_BY_ID[normalizedId]
  if (!filename) return ''
  if (PUBLIC_PRESET_REF_IDS.has(normalizedId)) {
    const base = String(requestOrigin || '').trim().replace(/\/+$/, '')
    if (!base) return ''
    return `${base}/sovits_ref/${encodeURIComponent(filename)}`
  }
  const base = String(env.R2_PUBLIC_BASE_URL || DEFAULT_R2_PUBLIC_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
  return `${base}/sovits_ref/${encodeURIComponent(filename)}`
}

const estimateBase64Bytes = (value: string) => {
  const trimmed = value.trim()
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding)
}

const sanitizeUploadName = (value: unknown, fallback: string) => {
  const raw = String(value ?? fallback).trim()
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  if (!cleaned) return fallback
  return cleaned
}

const normalizeExt = (value: unknown, fallback: string) => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return fallback
  const normalized = raw.startsWith('.') ? raw : `.${raw}`
  const cleaned = normalized.replace(/[^a-z0-9.]/g, '')
  if (!/^\.[a-z0-9]{1,8}$/.test(cleaned)) return fallback
  return cleaned
}

const extFromFilename = (value: string, fallback: string) => {
  const ext = value.split('.').pop()?.toLowerCase() || ''
  return normalizeExt(ext ? `.${ext}` : '', fallback)
}

const inferFilenameFromUrl = (value: string, fallback: string) => {
  try {
    const pathname = new URL(value).pathname
    const base = pathname.split('/').pop() || ''
    return sanitizeUploadName(base, fallback)
  } catch {
    return fallback
  }
}

const hasR2SignedUploadConfig = (env: Env) =>
  Boolean(
    env.R2_ACCOUNT_ID &&
      env.R2_BUCKET &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY,
  )

const hasR2BindingUploadConfig = (env: Env) => Boolean(env.MEDIA_BUCKET)

const buildPublicR2Url = (env: Env, key: string) => {
  const base = String(env.R2_PUBLIC_BASE_URL || DEFAULT_R2_PUBLIC_BASE_URL).trim().replace(/\/+$/, '')
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${base}/${encodedKey}`
}

const buildSovitsUploadExpiryIso = (baseDate = new Date()) =>
  new Date(baseDate.getTime() + SOVITS_USER_UPLOAD_RETENTION_MS).toISOString()

const cleanupExpiredSovitsUploads = async (env: Env, baseDate = new Date()) => {
  if (!env.MEDIA_BUCKET) return
  const cutoffMs = baseDate.getTime() - SOVITS_USER_UPLOAD_RETENTION_MS
  if (!Number.isFinite(cutoffMs)) return

  let cursor: string | undefined
  for (let page = 0; page < SOVITS_USER_UPLOAD_CLEANUP_MAX_PAGES; page += 1) {
    const listed = await env.MEDIA_BUCKET.list({
      prefix: `${SOVITS_USER_UPLOAD_PREFIX}/`,
      cursor,
      limit: SOVITS_USER_UPLOAD_CLEANUP_LIST_LIMIT,
    })
    if (!listed.objects.length) break

    const expiredKeys = listed.objects
      .filter((obj) => {
        const uploadedMs = new Date(obj.uploaded).getTime()
        return Number.isFinite(uploadedMs) && uploadedMs <= cutoffMs
      })
      .map((obj) => obj.key)

    if (expiredKeys.length) {
      await Promise.all(expiredKeys.map((key) => env.MEDIA_BUCKET!.delete(key)))
    }

    if (!listed.truncated || !listed.cursor) break
    cursor = listed.cursor
  }
}

const detectVideoContentType = (value: unknown, ext: string) => {
  if (typeof value === 'string') {
    const match = value.match(/^data:([^;]+);base64,/i)
    if (match?.[1]) return match[1].toLowerCase()
  }
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mov') return 'video/quicktime'
  if (ext === '.mkv') return 'video/x-matroska'
  if (ext === '.gif') return 'image/gif'
  return 'video/mp4'
}

const detectAudioContentType = (value: unknown, ext: string) => {
  if (typeof value === 'string') {
    const match = value.match(/^data:([^;]+);base64,/i)
    if (match?.[1]) return match[1].toLowerCase()
  }
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.m4a' || ext === '.aac') return 'audio/mp4'
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.flac') return 'audio/flac'
  return 'audio/wav'
}

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const uploadBase64ToR2Binding = async (env: Env, key: string, contentType: string, base64: string) => {
  if (!env.MEDIA_BUCKET) {
    throw new Error('R2 bucket binding is not configured.')
  }
  const bytes = decodeBase64(base64)
  const expiresAt = buildSovitsUploadExpiryIso()
  await env.MEDIA_BUCKET.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      source: 'lipsync',
      lifecycle: `delete_after_${SOVITS_USER_UPLOAD_RETENTION_DAYS}d`,
      expires_at: expiresAt,
    },
  })
  return buildPublicR2Url(env, key)
}

const uploadBase64ToR2 = async (env: Env, key: string, contentType: string, base64: string) => {
  const accountId = String(env.R2_ACCOUNT_ID || '').trim()
  const bucket = String(env.R2_BUCKET || '').trim()
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim()
  const region = String(env.R2_REGION || 'auto').trim() || 'auto'
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 upload is not configured.')
  }

  const host = `${accountId}.r2.cloudflarestorage.com`
  const canonicalUri = `/${bucket}/${key}`
  const expiresAt = buildSovitsUploadExpiryIso()
  const metadataHeaders = {
    'x-amz-meta-source': 'lipsync',
    'x-amz-meta-lifecycle': `delete_after_${SOVITS_USER_UPLOAD_RETENTION_DAYS}d`,
    'x-amz-meta-expires_at': expiresAt,
  }

  const put = await presignUrl({
    method: 'PUT',
    host,
    canonicalUri,
    accessKeyId,
    secretAccessKey,
    region,
    expiresSeconds: 15 * 60,
    additionalSignedHeaders: {
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      ...metadataHeaders,
    },
  })

  const putRes = await fetch(put.url, {
    method: 'PUT',
    headers: {
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'content-type': contentType,
      ...metadataHeaders,
    },
    body: decodeBase64(base64),
  })
  if (!putRes.ok) {
    const raw = await putRes.text().catch(() => '')
    throw new Error(`R2 upload failed (${putRes.status}): ${raw.slice(0, 240)}`)
  }

  const get = await presignUrl({
    method: 'GET',
    host,
    canonicalUri,
    accessKeyId,
    secretAccessKey,
    region,
    expiresSeconds: 6 * 60 * 60,
  })
  return get.url
}

const estimateRunpodBodySize = (inputPayload: Record<string, unknown>) =>
  new TextEncoder().encode(JSON.stringify({ input: inputPayload })).length

const normalizeDurationSeconds = (value: unknown) => {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return seconds
}

const normalizeRepeatCount = (value: unknown, fallback = 1) => {
  const count = Number(value)
  if (!Number.isFinite(count)) return fallback
  return Math.max(1, Math.min(MAX_REF_TEXT_REPEAT_COUNT, Math.floor(count)))
}

const normalizeRefTextForPrompt = (value: unknown) => {
  const collapsed = String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return ''
  if (/[。．.!！?？]$/.test(collapsed)) return collapsed
  return `${collapsed}。`
}

const ensureBase64Input = (label: string, value: unknown, maxBytes: number) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  const trimmed = value.trim()
  if (isHttpUrl(trimmed)) {
    throw new Error(`${label}_url is not allowed. Use base64.`)
  }
  const base64 = stripDataUrl(trimmed)
  if (!base64) {
    throw new Error(`${label} is empty.`)
  }
  const bytes = estimateBase64Bytes(base64)
  if (bytes > maxBytes) {
    throw new Error(`${label} is too large.`)
  }
  return base64
}

const extractDialogueLengthForTicketing = (input: Record<string, unknown>) => {
  const text = String(input.text ?? input.tts_text ?? '').trim()
  if (text.length > 0) {
    return text.length
  }
  const explicitLength = Number(
    input.dialogue_length ??
      input.dialogueLength ??
      input.text_length ??
      input.textLength ??
      input.character_count ??
      input.characterCount,
  )
  if (Number.isFinite(explicitLength) && explicitLength >= 0) {
    return Math.floor(explicitLength)
  }
  return 0
}

const resolveTotalTicketCost = (dialogueLength: number) =>
  dialogueLength >= LIPSYNC_LONG_TEXT_THRESHOLD ? LIPSYNC_LONG_TEXT_TICKET_COST : LIPSYNC_SHORT_TEXT_TICKET_COST

const resolveStageTicketCost = (stage: Stage, dialogueLength: number) => {
  if (stage === 'lipsync') {
    return LIPSYNC_VIDEO_STAGE_TICKET_COST
  }
  const totalCost = resolveTotalTicketCost(dialogueLength)
  return Math.max(1, totalCost - LIPSYNC_VIDEO_STAGE_TICKET_COST)
}

const resolveRequiredTicketsByStage = (stage: Stage, dialogueLength: number) => {
  if (stage === 'lipsync') {
    return LIPSYNC_VIDEO_STAGE_TICKET_COST
  }
  return resolveTotalTicketCost(dialogueLength)
}

const buildTtsInput = async (
  input: Record<string, unknown>,
  env: Env,
  options: { requestOrigin: string; isPremium: boolean },
) => {
  const ttsProbeOnly = parseBoolean(input.tts_probe_only ?? input.prompt_probe_only, false)
  const baseText = String(input.text ?? input.tts_text ?? '').trim()
  const probeText = String(input.tts_probe_text ?? DEFAULT_TTS_PROBE_TEXT).trim() || DEFAULT_TTS_PROBE_TEXT
  const text = ttsProbeOnly ? probeText.slice(0, MAX_TTS_PROBE_TEXT_LENGTH) : baseText
  const maxTextLength = options.isPremium ? PREMIUM_MAX_TEXT_LENGTH : NON_PREMIUM_MAX_TEXT_LENGTH
  if (!text) {
    throw new Error('text is required.')
  }
  if (!ttsProbeOnly && text.length > maxTextLength) {
    throw new Error(`text is too long. Max ${maxTextLength} characters.`)
  }

  const customRefAudioDurationSeconds = normalizeDurationSeconds(
    input.ref_audio_duration_seconds ?? input.ref_audio_duration ?? input.custom_ref_audio_duration_seconds,
  )
  if (
    customRefAudioDurationSeconds !== null &&
    (customRefAudioDurationSeconds < MIN_REF_AUDIO_SECONDS || customRefAudioDurationSeconds > MAX_REF_AUDIO_SECONDS)
  ) {
    throw new Error(REF_AUDIO_DURATION_RANGE_ERROR)
  }

  const shouldUploadViaBinding = hasR2BindingUploadConfig(env)
  const shouldUploadViaSigned = hasR2SignedUploadConfig(env)
  const shouldUploadMedia = shouldUploadViaBinding || shouldUploadViaSigned
  const uploadBase64 = async (key: string, contentType: string, base64: string) =>
    shouldUploadViaBinding
      ? uploadBase64ToR2Binding(env, key, contentType, base64)
      : uploadBase64ToR2(env, key, contentType, base64)

  let refAudioUrl = String(input.ref_audio_url ?? env.SOVITS_REF_AUDIO_URL ?? '').trim()
  const refAudioSource = String(input.ref_audio_source ?? '').trim().toLowerCase()
  const presetRefId = String(input.preset_ref_id ?? input.sovits_preset_id ?? '').trim().toLowerCase()
  let refName = sanitizeUploadName(
    input.ref_audio_name,
    refAudioUrl ? inferFilenameFromUrl(refAudioUrl, 'ref_audio.wav') : 'ref_audio.wav',
  )

  if (presetRefId) {
    const presetUrl = buildPresetRefUrlFromId(env, presetRefId, options.requestOrigin)
    if (!presetUrl) {
      throw new Error('preset_ref_id is invalid.')
    }
    refAudioUrl = presetUrl
    const presetFilename = PRESET_REF_BY_ID[presetRefId] || refName
    refName = sanitizeUploadName(presetFilename, refName)
  }

  if (!options.isPremium) {
    if (refAudioSource === 'upload') {
      throw new Error(PREMIUM_UPLOAD_ONLY_MESSAGE)
    }
    if (!presetRefId) {
      throw new Error(PREMIUM_UPLOAD_ONLY_MESSAGE)
    }
  }

  if (!refAudioUrl) {
    const rawRefAudio = input.ref_audio_base64 ?? input.ref_audio ?? input.ref_audio_data
    const hasCustomRefAudio = typeof rawRefAudio === 'string' && rawRefAudio.trim().length > 0
    if (hasCustomRefAudio) {
      if (!options.isPremium) {
        throw new Error(PREMIUM_UPLOAD_ONLY_MESSAGE)
      }
      const refAudioExt = normalizeExt(input.ref_audio_ext, extFromFilename(refName, '.wav'))
      const refAudioBase64 = ensureBase64Input('ref_audio', rawRefAudio, MAX_REF_AUDIO_BYTES)
      if (!shouldUploadMedia) {
        throw new Error('ref_audio upload requires MEDIA_BUCKET binding (or R2_* env vars).')
      }
      const refAudioMime = detectAudioContentType(rawRefAudio, refAudioExt)
      refName = sanitizeUploadName(refName, `ref_audio${refAudioExt}`)
      const key = `${SOVITS_USER_UPLOAD_PREFIX}/${crypto.randomUUID()}${refAudioExt}`
      refAudioUrl = await uploadBase64(key, refAudioMime, refAudioBase64)
      if (shouldUploadViaBinding) {
        cleanupExpiredSovitsUploads(env).catch(() => {
          // Cleanup is best-effort and should not block generation.
        })
      }
    }
  }

  if (!refAudioUrl) {
    throw new Error('SOVITS_REF_AUDIO_URL is not set.')
  }
  if (!isHttpUrl(refAudioUrl)) {
    throw new Error('ref_audio_url must be a public https URL.')
  }

  const autoPromptText = ttsProbeOnly ? true : false
  const refText = ttsProbeOnly ? '' : normalizeRefTextForPrompt(input.ref_text)
  if (!ttsProbeOnly && !refText) {
    throw new Error('ref_text is required.')
  }
  const refTextRepeatCount = ttsProbeOnly
    ? 1
    : normalizeRepeatCount(input.ref_text_repeat_count ?? input.ref_text_repeat ?? input.reference_text_repeat_count, 1)
  const promptText =
    ttsProbeOnly
      ? ''
      : refTextRepeatCount > 1
      ? Array.from({ length: refTextRepeatCount }, () => refText).join('')
      : refText
  const mode = String(input.mode ?? env.SOVITS_MODE ?? DEFAULT_SOVITS_MODE).trim() || DEFAULT_SOVITS_MODE
  const textLang =
    String(input.text_lang ?? env.SOVITS_TEXT_LANG ?? DEFAULT_SOVITS_TEXT_LANG).trim() ||
    DEFAULT_SOVITS_TEXT_LANG
  const promptLang =
    String(input.prompt_lang ?? env.SOVITS_PROMPT_LANG ?? DEFAULT_SOVITS_PROMPT_LANG).trim() ||
    DEFAULT_SOVITS_PROMPT_LANG
  const fragmentInterval = Number(
    normalizeNumber(
      input.fragment_interval ?? env.SOVITS_FRAGMENT_INTERVAL,
      DEFAULT_SOVITS_FRAGMENT_INTERVAL,
      MIN_SOVITS_FRAGMENT_INTERVAL,
      MAX_SOVITS_FRAGMENT_INTERVAL,
    ).toFixed(2),
  )
  const speedFactor = Number(
    normalizeNumber(
      input.speed_factor ?? input.speech_rate ?? env.SOVITS_SPEED_FACTOR,
      DEFAULT_SOVITS_SPEED_FACTOR,
      MIN_SOVITS_SPEED_FACTOR,
      MAX_SOVITS_SPEED_FACTOR,
    ).toFixed(2),
  )
  const temperature = Number(
    normalizeNumber(
      input.temperature ?? input.emotion_parameter ?? input.emotion_param,
      DEFAULT_SOVITS_TEMPERATURE,
      MIN_SOVITS_TEMPERATURE,
      MAX_SOVITS_TEMPERATURE,
    ).toFixed(2),
  )
  return {
    mode,
    text,
    text_lang: textLang,
    prompt_lang: promptLang,
    prompt_text: promptText,
    fragment_interval: fragmentInterval,
    speed_factor: speedFactor,
    temperature,
    ref_audio: {
      name: refName,
      url: refAudioUrl,
    },
    params: {
      auto_prompt_text: autoPromptText,
      fragment_interval: fragmentInterval,
      speed_factor: speedFactor,
      temperature,
    },
  }
}

const buildLipSyncInput = async (input: Record<string, unknown>, env: Env) => {
  const videoName = sanitizeUploadName(input.video_name ?? input.filename, 'input.mp4')
  const rawVideo = input.video_base64 ?? input.video ?? input.video_data
  const rawAudio = input.audio_base64 ?? input.audio ?? input.audio_data
  const generatedAudioDurationSeconds = normalizeDurationSeconds(
    input.audio_duration_seconds ?? input.generated_audio_duration_seconds ?? input.audio_duration,
  )
  const videoExt = normalizeExt(input.video_ext, extFromFilename(videoName, '.mp4'))
  const audioExt = normalizeExt(input.audio_ext, '.wav')
  const enhancerRaw = String(input.enhancer ?? DEFAULT_W2L_ENHANCER).trim().toLowerCase()
  const enhancer = ['none', 'gpen', 'gfpgan', 'codeformer', 'restoreformer'].includes(enhancerRaw)
    ? enhancerRaw
    : DEFAULT_W2L_ENHANCER
  const shouldUploadViaBinding = hasR2BindingUploadConfig(env)
  const shouldUploadViaSigned = hasR2SignedUploadConfig(env)
  const shouldUploadMedia = shouldUploadViaBinding || shouldUploadViaSigned

  const uploadBase64 = async (key: string, contentType: string, base64: string) =>
    shouldUploadViaBinding
      ? uploadBase64ToR2Binding(env, key, contentType, base64)
      : uploadBase64ToR2(env, key, contentType, base64)

  const result: Record<string, unknown> = {
    video_ext: videoExt,
    audio_ext: audioExt,
    checkpoint_path: String(input.checkpoint_path ?? DEFAULT_W2L_CHECKPOINT).trim() || DEFAULT_W2L_CHECKPOINT,
    enhancer,
    blending: Number(normalizeNumber(input.blending, DEFAULT_W2L_BLENDING, 0, 10).toFixed(2)),
    denoise: Boolean(input.denoise ?? false),
    face_occluder: input.face_occluder === undefined ? true : Boolean(input.face_occluder),
    face_mask: input.face_mask === undefined ? true : Boolean(input.face_mask),
    pads: normalizeInt(input.pads, 4, 0, 64),
    face_mode: normalizeInt(input.face_mode, 0, 0, 4),
    resize_factor: normalizeInt(input.resize_factor, 1, 1, 8),
    target_face_index: normalizeInt(input.target_face_index, 0, 0, 32),
    face_id_threshold: Number(normalizeNumber(input.face_id_threshold, 0.45, 0, 1).toFixed(3)),
    keep_original_audio: parseBoolean(input.keep_original_audio, true),
    generated_audio_mix_volume: Number(normalizeNumber(input.generated_audio_mix_volume, 1, 0, 2).toFixed(2)),
    original_audio_mix_volume: Number(normalizeNumber(input.original_audio_mix_volume, 0.9, 0, 2).toFixed(2)),
  }

  const providedAudioUrl = String(input.audio_url ?? '').trim()
  if (providedAudioUrl) {
    if (!isHttpUrl(providedAudioUrl)) {
      throw new Error('audio_url must be a public https URL.')
    }
    result.audio_url = providedAudioUrl
  } else {
    const audioBase64 = ensureBase64Input('audio', rawAudio, MAX_AUDIO_BYTES)
    if (shouldUploadMedia) {
      const audioMime = detectAudioContentType(rawAudio, audioExt)
      const key = `lipsync_inputs/${crypto.randomUUID()}${audioExt}`
      result.audio_url = await uploadBase64(key, audioMime, audioBase64)
    } else {
      result.audio_base64 = audioBase64
    }
  }

  const providedVideoUrl = String(input.video_url ?? '').trim()
  if (providedVideoUrl) {
    if (!isHttpUrl(providedVideoUrl)) {
      throw new Error('video_url must be a public https URL.')
    }
    result.video_url = providedVideoUrl
  } else {
    const videoBase64 = ensureBase64Input('video', rawVideo, MAX_VIDEO_BYTES)
    if (shouldUploadMedia) {
      const videoMime = detectVideoContentType(rawVideo, videoExt)
      const key = `lipsync_inputs/${crypto.randomUUID()}${videoExt}`
      result.video_url = await uploadBase64(key, videoMime, videoBase64)
    } else {
      result.video_base64 = videoBase64
    }
  }

  if (generatedAudioDurationSeconds !== null && generatedAudioDurationSeconds >= MAX_TTS_AUDIO_SECONDS) {
    throw new Error(TTS_TOO_LONG_POPUP_MESSAGE)
  }

  const estimatedBytes = estimateRunpodBodySize(result)
  if (estimatedBytes > RUNPOD_MAX_BODY_BYTES) {
    throw new Error(
      'Input exceeds RunPod 10MiB limit. Configure MEDIA_BUCKET binding (or R2_* env vars), or use a shorter video.',
    )
  }

  return result
}

const extractJobId = (payload: any) =>
  payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

const looksLikeW2LInputError = (message: string) =>
  message.toLowerCase().includes('missing video_base64 or video_url')

const looksLikeTtsInputError = (message: string) =>
  message.toLowerCase().includes('text is required')

const isFailureStatus = (status: unknown) => {
  const normalized = String(status || '').toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const pickErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }
  return new Response(null, { headers: corsHeaders })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }

  const auth = await requireAuthenticatedUser(request, env, corsHeaders)
  if ('response' in auth) {
    return auth.response
  }

  const url = new URL(request.url)
  const presetRefId = String(url.searchParams.get('preset_ref_id') || '').trim().toLowerCase()
  const presetRefUrl = String(url.searchParams.get('preset_ref_url') || '').trim()
  if (presetRefId || presetRefUrl) {
    let resolvedPresetRefUrl = ''
    let fromPresetId = false
    if (presetRefId) {
      resolvedPresetRefUrl = buildPresetRefUrlFromId(env, presetRefId, url.origin)
      if (!resolvedPresetRefUrl) {
        return jsonResponse({ error: '許可されていないプリセット音声です。' }, 400, corsHeaders)
      }
      fromPresetId = true
    } else {
      if (!isAllowedPresetRefUrl(presetRefUrl)) {
        return jsonResponse({ error: '許可されていないプリセット音声です。' }, 400, corsHeaders)
      }
      resolvedPresetRefUrl = presetRefUrl
    }

    if (!fromPresetId && !isAllowedPresetRefUrl(resolvedPresetRefUrl)) {
      return jsonResponse({ error: '許可されていないプリセット音声です。' }, 400, corsHeaders)
    }

    let upstream: Response
    try {
      upstream = await fetchWithTimeout(resolvedPresetRefUrl, { method: 'GET' }, 15000)
    } catch {
      return jsonResponse({ error: 'プリセット参考音声の取得に失敗しました。' }, 502, corsHeaders)
    }

    if (!upstream.ok) {
      return jsonResponse({ error: 'プリセット参考音声の取得に失敗しました。' }, 502, corsHeaders)
    }

    const audioBody = await upstream.arrayBuffer()
    const contentType = upstream.headers.get('content-type') || 'audio/wav'
    return new Response(audioBody, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    })
  }

  const id = String(url.searchParams.get('id') || '').trim()
  if (!id) {
    return jsonResponse({ error: 'ジョブIDが必要です。' }, 400, corsHeaders)
  }
  const stage = normalizeStage(url.searchParams.get('stage') || '')
  const usageIdParam = String(url.searchParams.get('usage_id') ?? url.searchParams.get('usageId') ?? '').trim()
  const expectedUsageId = `lipsync:${stage}:${id}`
  if (usageIdParam && usageIdParam !== expectedUsageId) {
    return jsonResponse({ error: 'ジョブが見つかりません。' }, 404, corsHeaders)
  }
  const usageId = usageIdParam || expectedUsageId
  const ownership = await ensureUsageOwnership(auth.admin, auth.user, usageId, corsHeaders)
  if ('response' in ownership) {
    return ownership.response
  }
  const endpoint = resolveEndpoint(env, stage)
  if (!endpoint) {
    return jsonResponse({ error: 'サーバー設定エラーです。' }, 500, corsHeaders)
  }
  const apiKey = resolveApiKey(env, stage)
  if (!apiKey) {
    return jsonResponse({ error: 'サーバー設定エラーです。' }, 500, corsHeaders)
  }

  let upstream: Response
  try {
    upstream = await fetchWithTimeout(
      `${endpoint}/status/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      15000,
    )
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    if (isTimeout) {
      return jsonResponse({ id, stage, status: 'IN_PROGRESS', state: 'IN_PROGRESS' }, 200, corsHeaders)
    }
    return jsonResponse({ error: 'ステータス確認に失敗しました。' }, 502, corsHeaders)
  }

  const raw = await upstream.text()
  if (!upstream.ok) {
    let message = raw
    try {
      const parsed = JSON.parse(raw)
      message = pickErrorMessage(parsed) || raw
    } catch {
      // keep raw
    }
    return jsonResponse({ error: sanitizePublicErrorMessage(message, stage) }, upstream.status, corsHeaders)
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const upstreamStatus = parsed?.status ?? parsed?.state ?? ''
      const upstreamError = pickErrorMessage(parsed)
      if (upstreamError || isFailureStatus(upstreamStatus)) {
        return jsonResponse(
          {
            id: extractJobId(parsed) ?? id,
            stage,
            status: upstreamStatus || null,
            state: upstreamStatus || null,
            error: sanitizePublicErrorMessage(String(upstreamError || ''), stage),
          },
          upstream.status,
          corsHeaders,
        )
      }
      return jsonResponse(parsed, upstream.status, corsHeaders)
    }
  } catch {
    // ignore parse failure
  }
  return jsonResponse(
    {
      id,
      stage,
      error: sanitizePublicErrorMessage('', stage),
    },
    502,
    corsHeaders,
  )
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = buildCorsHeaders(request, env, corsMethods)
  if (isCorsBlocked(request, env)) {
    return new Response(null, { status: 403, headers: corsHeaders })
  }

  const auth = await requireAuthenticatedUser(request, env, corsHeaders)
  if ('response' in auth) {
    return auth.response
  }

  const payload = await request.json().catch(() => null)
  if (!payload || typeof payload !== 'object') {
    return jsonResponse({ error: 'リクエスト形式が不正です。' }, 400, corsHeaders)
  }

  const input = (payload as Record<string, unknown>).input ?? payload
  if (!input || typeof input !== 'object') {
    return jsonResponse({ error: '入力内容が不正です。' }, 400, corsHeaders)
  }

  const inputObj = input as Record<string, unknown>
  const stage = normalizeStage(inputObj.stage ?? inputObj.pipeline_stage ?? '')
  const linkedTtsUsage =
    stage === 'lipsync' ? await ensureLinkedTtsUsage(auth.admin, auth.user, inputObj, corsHeaders) : null
  if (linkedTtsUsage && 'response' in linkedTtsUsage) {
    return linkedTtsUsage.response
  }
  const premium = await fetchPremiumStatus(auth.admin, auth.user, corsHeaders)
  if ('response' in premium) {
    return premium.response
  }
  const isPremium = premium.isPremium
  const endpoint = resolveEndpoint(env, stage)
  if (!endpoint) {
    return jsonResponse({ error: 'サーバー設定エラーです。' }, 500, corsHeaders)
  }
  const apiKey = resolveApiKey(env, stage)
  if (!apiKey) {
    return jsonResponse({ error: 'サーバー設定エラーです。' }, 500, corsHeaders)
  }

  let runpodInput: Record<string, unknown>
  try {
    runpodInput =
      stage === 'tts'
        ? await buildTtsInput(inputObj, env, {
            requestOrigin: new URL(request.url).origin,
            isPremium,
          })
        : await buildLipSyncInput(inputObj, env)
  } catch (error) {
    return jsonResponse(
      { error: sanitizePublicErrorMessage(error instanceof Error ? error.message : 'Invalid parameters.', stage) },
      400,
      corsHeaders,
    )
  }

  const isTtsProbeOnly = stage === 'tts' && parseBoolean(inputObj.tts_probe_only ?? inputObj.prompt_probe_only, false)
  const dialogueLengthForTicketing = extractDialogueLengthForTicketing(inputObj)
  const requiredTickets = resolveRequiredTicketsByStage(stage, dialogueLengthForTicketing)
  const stageTicketCost = resolveStageTicketCost(stage, dialogueLengthForTicketing)
  const totalTicketCost = resolveTotalTicketCost(dialogueLengthForTicketing)

  if (!isTtsProbeOnly) {
    const ticketCheck = await ensureTicketAvailable(
      auth.admin,
      auth.user,
      requiredTickets,
      corsHeaders,
    )
    if ('response' in ticketCheck) {
      return ticketCheck.response
    }
  }

  const runpodPath = isTtsProbeOnly ? 'runsync' : 'run'
  const upstream = await fetch(`${endpoint}/${runpodPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: runpodInput }),
  })

  const raw = await upstream.text()
  if (!upstream.ok) {
    let message = raw
    try {
      const parsed = JSON.parse(raw)
      message = parsed?.error || parsed?.message || raw
    } catch {
      // keep raw
    }
    const rawMessage = String(message || 'RunPod request failed.')
    const normalizedMessage = sanitizePublicErrorMessage(rawMessage, stage)
    if (stage === 'tts' && looksLikeW2LInputError(rawMessage)) {
      return jsonResponse(
        {
          error: 'サーバー設定エラーです。時間をおいて再度お試しください。',
        },
        500,
        corsHeaders,
      )
    }
    if (stage === 'lipsync' && looksLikeTtsInputError(rawMessage)) {
      return jsonResponse(
        {
          error: 'サーバー設定エラーです。時間をおいて再度お試しください。',
        },
        500,
        corsHeaders,
      )
    }
    if (stage === 'lipsync' && rawMessage.toLowerCase().includes('exceeded max body size of 10mib')) {
      return jsonResponse(
        {
          error: '入力データが大きすぎます。動画または音声を短くして再度お試しください。',
        },
        400,
        corsHeaders,
      )
    }
    return jsonResponse({ error: normalizedMessage }, upstream.status, corsHeaders)
  }

  try {
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const id = extractJobId(data)
      const usageId = id ? `lipsync:${stage}:${id}` : `lipsync:${stage}:${makeUsageId()}`
      const upstreamStatus = data?.status ?? data?.state ?? ''
      const upstreamError = pickErrorMessage(data)
      const shouldCharge = !isFailureStatus(upstreamStatus) && !upstreamError
      let ticketsLeft: number | undefined

      if (!shouldCharge) {
        return jsonResponse(
          {
            id: id ?? null,
            stage,
            source: stage,
            status: upstreamStatus || null,
            state: upstreamStatus || null,
            usage_id: isTtsProbeOnly ? null : usageId,
            error: sanitizePublicErrorMessage(String(upstreamError || ''), stage),
          },
          upstream.status,
          corsHeaders,
        )
      }

      if (isTtsProbeOnly) {
        return jsonResponse(
          {
            ...data,
            stage,
            source: stage,
            probe_only: true,
          },
          upstream.status,
          corsHeaders,
        )
      }

      const ticketMeta = {
        stage,
        source: 'run',
        status: upstreamStatus || null,
        job_id: id ?? null,
        linked_tts_usage_id: stage === 'lipsync' ? linkedTtsUsage?.linkedUsageId ?? null : null,
        ticket_cost: stageTicketCost,
        total_ticket_cost: totalTicketCost,
        required_tickets: requiredTickets,
        dialogue_length: dialogueLengthForTicketing,
      }
      const chargeResult = await consumeTicket(
        auth.admin,
        auth.user,
        ticketMeta,
        usageId,
        stageTicketCost,
        corsHeaders,
      )
      if ('response' in chargeResult) {
        return chargeResult.response
      }
      const nextTickets = Number((chargeResult as { ticketsLeft?: unknown }).ticketsLeft)
      if (Number.isFinite(nextTickets)) {
        ticketsLeft = nextTickets
      }

      return jsonResponse(
        {
          ...data,
          stage,
          source: stage,
          usage_id: usageId,
          ticketsLeft,
        },
        upstream.status,
        corsHeaders,
      )
    }
  } catch {
    // ignore parse failure and return raw
  }

  return jsonResponse({ error: sanitizePublicErrorMessage(raw, stage) }, upstream.status, corsHeaders)
}
