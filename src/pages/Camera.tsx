import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { ensureAuthConfigured, isAuthConfigured, signOutSafely, supabase } from '../lib/supabaseClient'
import { getOAuthRedirectUrl } from '../lib/oauthRedirect'
import { GuestIntro } from '../components/GuestIntro'
import { QwenEditPanel } from './QwenEditPanel'
import './camera.css'
import './video-studio.css'
import './fastmove.css'

type RenderResult = {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  video?: string
  error?: string
}

type VideoModel = 'v1' | 'v2' | 'v3' | 'v4'
type GenerationMode = 'i2v' | 'qwen_edit'
type QualityPresetKey = 'low' | 'medium' | 'high'
type DurationSeconds = 6 | 8 | 10
type QualityPreset = {
  key: QualityPresetKey
  label: string
  fps: 8 | 10 | 12
  cost: 0 | 1 | 2
}
type VideoModelConfig = {
  id: VideoModel
  label: 'V1' | 'V2' | 'V3' | 'V4'
  endpoint: string
  engine: string
}

const MAX_PARALLEL = 1
const VIDEO_MODELS: Record<VideoModel, VideoModelConfig> = {
  v1: { id: 'v1', label: 'V1', endpoint: '/api/wan-rapid', engine: 'rapid' },
  v2: { id: 'v2', label: 'V2', endpoint: '/api/wan-smoothmix', engine: 'smoothmix' },
  v3: { id: 'v3', label: 'V3', endpoint: '/api/wan-remix', engine: 'remix' },
  v4: { id: 'v4', label: 'V4', endpoint: '/api/wan-rapid-fastmove', engine: 'rapid_fastmove' },
}
const VIDEO_MODEL_ORDER: readonly VideoModel[] = ['v1', 'v2', 'v3', 'v4']
const VIDEO_MODEL_DESCRIPTIONS: Record<VideoModel, string> = {
  v1: '大胆な動きとシーン変化に強いモデル。',
  v2: '滑らかさと自然なモーション安定性を重視したモデル。',
  v3: '演出表現と幅広いプロンプト適性に強いモデル。',
  v4: '高精細ディテール保持と安定品質に強いモデル。',
}
const QUALITY_PRESETS: readonly QualityPreset[] = [
  { key: 'low', label: '速度優先', fps: 8, cost: 0 },
  { key: 'medium', label: '安定重視', fps: 10, cost: 1 },
  { key: 'high', label: '解像度優先', fps: 12, cost: 2 },
] as const
const DEFAULT_QUALITY_INDEX = 1
const DEFAULT_DURATION_SECONDS: DurationSeconds = 6
const durationTicketCostMap: Record<DurationSeconds, number> = {
  6: 1,
  8: 2,
  10: 3,
}
const DEFAULT_CFG = 1
const FIXED_MAX_LONG_SIDE = 768
const FIXED_MIN_SIDE = 256
const FIXED_SIZE_MULTIPLE = 64
const FIXED_STEPS = 4
const BONUS_ROULETTE_VALUES = [3] as const
const OAUTH_REDIRECT_URL = getOAuthRedirectUrl()
const DEFAULT_VIDEO_MODEL: VideoModel = 'v4'
const PROMPT_MAX_LENGTH = 1000
const PROMPT_PLACEHOLDER = '作りたい映像の指示を入力'
const I2V_IMAGE_INPUT_ID = 'video-i2v-image-file'
const COIN_PURCHASE_URL = 'https://checkoutcoins2.win/purchase.html'
const SHOP_URL = 'https://gettoken.uk/purchage/'
const BOARD_URL = 'https://civitai.uk/'
const parseVideoModel = (value: string | null): VideoModel =>
  value && value.toLowerCase() in VIDEO_MODELS ? (value.toLowerCase() as VideoModel) : DEFAULT_VIDEO_MODEL

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const runQueue = async (tasks: Array<() => Promise<void>>, concurrency: number) => {
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= tasks.length) return
      await tasks[index]()
    }
  })
  await Promise.all(runners)
}

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const getImageSize = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      URL.revokeObjectURL(url)
      resolve({ width, height })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('画像サイズの取得に失敗しました。'))
    }
    image.src = url
  })

const fileToResizedPngDataUrl = (file: File, width: number, height: number) =>
  new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('画像処理に失敗しました。'))
        return
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('画像のリサイズに失敗しました。'))
    }
    image.src = url
  })

const clampDimension = (value: number) => {
  const rounded = Math.round(value / FIXED_SIZE_MULTIPLE) * FIXED_SIZE_MULTIPLE
  return Math.max(FIXED_MIN_SIDE, Math.min(3000, rounded))
}

const toVideoDimensions = (width: number, height: number) => {
  const longest = Math.max(width, height)
  const scale = longest > FIXED_MAX_LONG_SIDE ? FIXED_MAX_LONG_SIDE / longest : 1
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  return {
    width: clampDimension(scaledWidth),
    height: clampDimension(scaledHeight),
  }
}

const normalizeVideo = (value: unknown, filename?: string) => {
  if (typeof value !== 'string' || !value) return null
  if (value.startsWith('data:') || value.startsWith('http')) return value
  const ext = filename?.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'webm' ? 'video/webm' : ext === 'gif' ? 'image/gif' : ext === 'mp4' ? 'video/mp4' : 'video/mp4'
  return `data:${mime};base64,${value}`
}

const base64ToBlob = (base64: string, mime: string) => {
  const chunkSize = 0x8000
  const byteChars = atob(base64)
  const byteArrays: ArrayBuffer[] = []
  for (let offset = 0; offset < byteChars.length; offset += chunkSize) {
    const slice = byteChars.slice(offset, offset + chunkSize)
    const byteNumbers = new Array(slice.length)
    for (let i = 0; i < slice.length; i += 1) {
      byteNumbers[i] = slice.charCodeAt(i)
    }
    byteArrays.push(new Uint8Array(byteNumbers).buffer)
  }
  return new Blob(byteArrays, { type: mime })
}

const dataUrlToBlob = (dataUrl: string, fallbackMime: string) => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!match) {
    return base64ToBlob(dataUrl, fallbackMime)
  }
  const mime = match[1] || fallbackMime
  const base64 = match[2] || ''
  return base64ToBlob(base64, mime)
}

const isProbablyMobile = () => {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  if (uaData && typeof uaData.mobile === 'boolean') {
    return uaData.mobile
  }
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true
  if (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number') {
    return navigator.maxTouchPoints > 1
  }
  return false
}

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

const POLICY_BLOCK_MESSAGE =
  'この画像には暴力的な表現、低年齢、または規約違反の可能性があります。別の画像でお試しください。'
const GENERIC_RETRY_MESSAGE = 'エラーです。やり直してください。'

const shouldMaskErrorMessage = (value: string) => {
  const text = String(value || '').trim()
  if (!text) return false
  const lowered = text.toLowerCase()
  const isJsonLike =
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('[') && text.endsWith(']'))
  const hasModelHints =
    lowered.includes('workflow validation failed') ||
    lowered.includes('.safetensors') ||
    lowered.includes('.gguf') ||
    lowered.includes('class_type') ||
    lowered.includes('unetloader') ||
    lowered.includes('/comfyui/') ||
    (lowered.includes('node ') && lowered.includes('not found'))
  return isJsonLike || hasModelHints
}

const normalizeErrorMessage = (value: unknown) => {
  if (!value) return 'エラーです。'
  if (typeof value === 'object') {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe?.error ?? maybe?.message ?? maybe?.detail
    if (typeof picked === 'string' && picked) return picked
    if (value instanceof Error && value.message) return value.message
  }
  const raw = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value)
  const lowered = raw.toLowerCase()
  if (
    lowered.includes('out of memory') ||
    lowered.includes('would exceed allowed memory') ||
    lowered.includes('allocation on device') ||
    lowered.includes('cuda') ||
    lowered.includes('oom')
  ) {
    return '画像サイズが大きすぎます。小さくして再度お試しください。'
  }
  if (
    lowered.includes('underage') ||
    lowered.includes('minor') ||
    lowered.includes('child') ||
    lowered.includes('age_range') ||
    lowered.includes('age range') ||
    lowered.includes('agerange') ||
    lowered.includes('policy') ||
    lowered.includes('moderation') ||
    lowered.includes('violence') ||
    lowered.includes('rekognition')
  ) {
    return POLICY_BLOCK_MESSAGE
  }
  const trimmed = raw.trim()
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed)
      const message = parsed?.error || parsed?.message || parsed?.detail
      if (typeof message === 'string' && message) {
        return shouldMaskErrorMessage(message) ? GENERIC_RETRY_MESSAGE : message
      }
      return GENERIC_RETRY_MESSAGE
    } catch {
      return GENERIC_RETRY_MESSAGE
    }
  }
  if (shouldMaskErrorMessage(trimmed)) return GENERIC_RETRY_MESSAGE
  return raw
}

const isTicketShortage = (status: number, message: string) => {
  if (status === 402) return true
  const lowered = message.toLowerCase()
  return (
    lowered.includes('no tickets') ||
    lowered.includes('no ticket') ||
    lowered.includes('insufficient_tickets') ||
    lowered.includes('insufficient tickets') ||
    lowered.includes('token不足') ||
    lowered.includes('token') ||
    lowered.includes('token') ||
    lowered.includes('credit')
  )
}

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const isSuccessStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return (
    normalized.includes('complete') ||
    normalized.includes('success') ||
    normalized.includes('succeed') ||
    normalized.includes('finished')
  )
}

const extractVideoList = (payload: any) => {
  const output = payload?.output ?? payload?.result ?? payload
  const nested = output?.output ?? output?.result ?? output?.data ?? payload?.output?.output ?? payload?.result?.output
  const listCandidates = [
    output?.videos,
    output?.outputs,
    output?.output_videos,
    output?.gifs,
    output?.images,
    payload?.videos,
    payload?.gifs,
    payload?.images,
    nested?.videos,
    nested?.outputs,
    nested?.output_videos,
    nested?.gifs,
    nested?.images,
    nested?.data,
  ]
  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue
    const normalized = candidate
      .map((item: any) => {
        const raw = item?.video ?? item?.data ?? item?.url ?? item
        const name = item?.filename
        return normalizeVideo(raw, name)
      })
      .filter(Boolean) as string[]
    if (normalized.length) return normalized
  }
  const singleCandidates = [
    output?.video,
    output?.output_video,
    output?.url,
    payload?.video,
    payload?.output_video,
    payload?.url,
    nested?.video,
    nested?.output_video,
    nested?.url,
  ]
  for (const candidate of singleCandidates) {
    const normalized = normalizeVideo(candidate)
    if (normalized) return [normalized]
  }
  return []
}

const extractJobId = (payload: any) => payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

export function Camera() {
  const [generationMode, setGenerationMode] = useState<GenerationMode>('i2v')
  const [qualityIndex, setQualityIndex] = useState(DEFAULT_QUALITY_INDEX)
  const [durationSeconds, setDurationSeconds] = useState<DurationSeconds>(DEFAULT_DURATION_SECONDS)
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [cfg, setCfg] = useState(DEFAULT_CFG)
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null)
  const [sourceImagePreview, setSourceImagePreview] = useState('')
  const [results, setResults] = useState<RenderResult[]>([])
  const [statusMessage, setStatusMessage] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [videoModel, setVideoModel] = useState<VideoModel>(DEFAULT_VIDEO_MODEL)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [ticketStatus, setTicketStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [ticketMessage, setTicketMessage] = useState('')
  const [showTicketModal, setShowTicketModal] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState<string | null>(null)
  const [bonusStatus, setBonusStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [bonusMessage, setBonusMessage] = useState('')
  const [bonusCanClaim, setBonusCanClaim] = useState(false)
  const [bonusNextEligibleAt, setBonusNextEligibleAt] = useState<string | null>(null)
  const [bonusClaiming, setBonusClaiming] = useState(false)
  const [bonusRouletteValue, setBonusRouletteValue] = useState<number>(BONUS_ROULETTE_VALUES[0])
  const [bonusRouletteRolling, setBonusRouletteRolling] = useState(false)
  const [bonusRouletteAwarded, setBonusRouletteAwarded] = useState<number | null>(null)
  const [showPurchaseConfirmModal, setShowPurchaseConfirmModal] = useState(false)
  const runIdRef = useRef(0)
  const bonusRouletteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sourceImageInputRef = useRef<HTMLInputElement | null>(null)

  const totalFrames = results.length || 1
  const completedCount = useMemo(() => results.filter((item) => item.video).length, [results])
  const progress = totalFrames ? completedCount / totalFrames : 0
  const displayVideo = results[0]?.video ?? null
  const accessToken = session?.access_token ?? ''
  const selectedVideoModel = VIDEO_MODELS[videoModel] ?? VIDEO_MODELS[DEFAULT_VIDEO_MODEL]
  const selectedVideoModelDescription =
    VIDEO_MODEL_DESCRIPTIONS[videoModel] ?? VIDEO_MODEL_DESCRIPTIONS[DEFAULT_VIDEO_MODEL]
  const selectedQuality = QUALITY_PRESETS[qualityIndex] ?? QUALITY_PRESETS[DEFAULT_QUALITY_INDEX]
  const durationTicketCost = durationTicketCostMap[durationSeconds]
  const totalTicketCost = selectedQuality.cost + durationTicketCost
  const selectedQualityWithCost = `${selectedQuality.label}(${selectedQuality.cost}枚)`
  const qualityDescription = `${selectedQuality.label} / ${durationSeconds}秒`
  const selectedFps = selectedQuality.fps
  const isI2vMode = generationMode === 'i2v'
  const disableModeSwitch = isI2vMode && isRunning
  const generationLabel = isI2vMode ? '動画生成' : '画像生成'
  const selectedTicketCost = isI2vMode ? totalTicketCost : 1
  const canGenerate = prompt.trim().length > 0 && Boolean(sourceImageFile) && !isRunning
  const durationHelpText = '1枚の画像から 6秒 / 8秒 / 10秒 の動画を生成できます。'

  const getLatestAccessToken = useCallback(async () => {
    if (!supabase) return accessToken

    const current = await supabase.auth.getSession()
    if (current?.data?.session?.access_token) {
      const nextSession = current.data.session
      if (!session || session.access_token !== nextSession.access_token) {
        setSession(nextSession)
      }
      return nextSession.access_token
    }

    const refreshed = await supabase.auth.refreshSession()
    if (refreshed?.data?.session?.access_token) {
      setSession(refreshed.data.session)
      return refreshed.data.session.access_token
    }

    return ''
  }, [accessToken, session])

  const viewerStyle = useMemo(
    () =>
      ({
        '--progress': progress,
      }) as CSSProperties,
    [progress],
  )

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setAuthReady(true)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase) return
    const url = new URL(window.location.href)
    const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (oauthError) {
      console.error('OAuth callback error', oauthError)
      setStatusMessage('ログインに失敗しました。もう一度お試しください。')
      url.searchParams.delete('error')
      url.searchParams.delete('error_description')
      window.history.replaceState({}, document.title, url.toString())
      return
    }
    const hasCode = url.searchParams.has('code')
    const hasState = url.searchParams.has('state')
    if (!hasCode || !hasState) return
    supabase.auth.exchangeCodeForSession(window.location.href).then(({ error }) => {
      if (error) {
        console.error('exchangeCodeForSession failed', error)
        setStatusMessage('ログインに失敗しました。もう一度お試しください。')
        return
      }
      const cleaned = new URL(window.location.href)
      cleaned.searchParams.delete('code')
      cleaned.searchParams.delete('state')
      window.history.replaceState({}, document.title, cleaned.toString())
    })
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mode = params.get('mode')?.toLowerCase()
    setVideoModel(parseVideoModel(params.get('model')))
    if (mode === 'edit' || mode === 'qwen_edit') {
      setGenerationMode('qwen_edit')
      return
    }
    if (mode === 'video' || mode === 'i2v') {
      setGenerationMode('i2v')
    }
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    const current = parseVideoModel(url.searchParams.get('model'))
    if (current === videoModel) return
    if (videoModel === DEFAULT_VIDEO_MODEL) {
      url.searchParams.delete('model')
    } else {
      url.searchParams.set('model', videoModel)
    }
    window.history.replaceState({}, document.title, url.toString())
  }, [videoModel])

  useEffect(() => {
    if (!sourceImageFile) {
      setSourceImagePreview('')
      return
    }
    const url = URL.createObjectURL(sourceImageFile)
    setSourceImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [sourceImageFile])

  useEffect(() => {
    if (!isMobileMenuOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [isMobileMenuOpen])

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 960) setIsMobileMenuOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    return () => {
      if (bonusRouletteTimerRef.current) {
        clearInterval(bonusRouletteTimerRef.current)
        bonusRouletteTimerRef.current = null
      }
    }
  }, [])

  const fetchTickets = useCallback(
    async (token: string) => {
      if (!token) return null
      setTicketStatus('loading')
      setTicketMessage('')
      const requestTickets = async (authToken: string) => {
        const res = await fetch('/api/tickets', {
          headers: { Authorization: `Bearer ${authToken}` },
        })
        const data = await res.json().catch(() => ({}))
        return { res, data }
      }

      let activeToken = token
      let { res, data } = await requestTickets(activeToken)

      if (res.status === 401) {
        const refreshedToken = await getLatestAccessToken()
        if (refreshedToken && refreshedToken !== activeToken) {
          activeToken = refreshedToken
          ;({ res, data } = await requestTickets(activeToken))
        }
      }

      if (!res.ok) {
        setTicketStatus('error')
        if (res.status === 401) {
          setTicketMessage('認証に失敗しました。ログアウトして再ログインしてください。')
          setSession(null)
        } else {
          setTicketMessage(data?.error || 'トークン残高の取得に失敗しました。')
        }
        return null
      }
      const nextCount = Number(data?.tickets ?? 0)
      setTicketStatus('idle')
      setTicketMessage('')
      setTicketCount(nextCount)
      return nextCount
    },
    [getLatestAccessToken],
  )

  const fetchDailyBonus = useCallback(async (token: string) => {
    if (!token) return
    setBonusStatus('loading')
    setBonusMessage('')
    const res = await fetch('/api/daily_bonus', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setBonusStatus('error')
      setBonusMessage(data?.error || 'ログインボーナス状態の取得に失敗しました。')
      return
    }
    setBonusStatus('idle')
    setBonusCanClaim(Boolean(data?.canClaim))
    setBonusNextEligibleAt(typeof data?.nextEligibleAt === 'string' ? data.nextEligibleAt : null)
  }, [])

  useEffect(() => {
    if (!session || !accessToken) {
      setTicketCount(null)
      setTicketStatus('idle')
      setTicketMessage('')
      setBonusStatus('idle')
      setBonusMessage('')
      setBonusCanClaim(false)
      setBonusNextEligibleAt(null)
      return
    }
    void fetchTickets(accessToken)
    void fetchDailyBonus(accessToken)
  }, [accessToken, fetchDailyBonus, fetchTickets, session])

  const submitVideo = useCallback(
    async (token: string) => {
      if (!sourceImageFile) {
        throw new Error('画像を選択してください。')
      }
      const imageSize = await getImageSize(sourceImageFile)
      const dims = toVideoDimensions(imageSize.width, imageSize.height)
      const imageDataUrl = await fileToResizedPngDataUrl(sourceImageFile, dims.width, dims.height)
      const targetSeconds = durationSeconds
      const targetFrameCount = selectedFps * targetSeconds + 1
      const stabilizedPrompt = `${prompt}, keep same person identity, keep same face, keep same camera distance, no zoom in`
      const stabilizedNegative = [negativePrompt, 'zoom in, close-up, crop, face distortion, identity change']
        .filter(Boolean)
        .join(', ')
      const input: Record<string, unknown> = {
        engine: selectedVideoModel.engine,
        mode: 'i2v',
        image: imageDataUrl,
        image_name: 'input.png',
        prompt: stabilizedPrompt,
        negative_prompt: stabilizedNegative,
        width: dims.width,
        height: dims.height,
        fps: selectedFps,
        seconds: targetSeconds,
        num_frames: targetFrameCount,
        steps: FIXED_STEPS,
        cfg: Number(cfg.toFixed(1)),
        seed: 0,
        randomize_seed: true,
        worker_mode: 'comfyui',
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      const res = await fetch(selectedVideoModel.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || '生成に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          throw new Error('TICKET_SHORTAGE')
        }
        setErrorModalMessage(message)
        throw new Error(message)
      }
      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      }
      const videos = extractVideoList(data)
      if (videos.length) {
        return { videos }
      }
      const jobId = extractJobId(data)
      if (!jobId) throw new Error('ジョブIDの取得に失敗しました。')
      return { jobId }
    },
    [cfg, durationSeconds, negativePrompt, prompt, selectedFps, selectedVideoModel, sourceImageFile],
  )

  const pollJob = useCallback(async (jobId: string, runId: number, token?: string, model: VideoModel = DEFAULT_VIDEO_MODEL) => {
    const config = VIDEO_MODELS[model] ?? VIDEO_MODELS[DEFAULT_VIDEO_MODEL]
    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) return { status: 'cancelled' as const, videos: [] }
      const headers: Record<string, string> = {}
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      const query = new URLSearchParams({
        id: jobId,
        engine: config.engine,
      })
      const res = await fetch(`${config.endpoint}?${query.toString()}`, { headers })
      const data = await res.json().catch(() => ({}))
      if (res.status === 524 || res.status === 522 || res.status === 504) {
        await wait(1000)
        continue
      }
      if (!res.ok) {
        const rawMessage = data?.error || data?.message || data?.detail || 'ステータス取得に失敗しました。'
        const message = normalizeErrorMessage(rawMessage)
        if (isTicketShortage(res.status, message)) {
          setShowTicketModal(true)
          throw new Error('TICKET_SHORTAGE')
        }
        setErrorModalMessage(message)
        throw new Error(message)
      }
      const nextTickets = Number(data?.ticketsLeft ?? data?.tickets_left)
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      }
      const status = String(data?.status || data?.state || '').toLowerCase()
      const statusError = extractErrorMessage(data)
      if (statusError) {
        const normalized = normalizeErrorMessage(statusError)
        if (isTicketShortage(res.status, normalized)) {
          setShowTicketModal(true)
          throw new Error('TICKET_SHORTAGE')
        }
      }
      if (statusError || isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(statusError || '生成に失敗しました。'))
      }
      const videos = extractVideoList(data)
      if (videos.length) {
        return { status: 'done' as const, videos }
      }
      if (isSuccessStatus(status)) {
        throw new Error('生成は完了しましたが動画データを取得できませんでした。')
      }
      await wait(1000)
    }
    throw new Error('生成がタイムアウトしました。')
  }, [])

  const ensureTicketsForGeneration = useCallback(async () => {
    if (!session) {
      setStatusMessage('先にログインしてください。')
      return false
    }
    if (ticketStatus === 'loading') {
      setStatusMessage('トークンを確認中...')
      return false
    }
    const token = accessToken || (await getLatestAccessToken())
    if (token) {
      setStatusMessage('トークンを確認中...')
      const latestCount = await fetchTickets(token)
      if (typeof latestCount === 'number' && latestCount < selectedTicketCost) {
        setShowTicketModal(true)
        return false
      }
      return true
    }
    setStatusMessage('セッション確認に失敗しました。再ログインしてください。')
    setSession(null)
    return false
  }, [accessToken, fetchTickets, getLatestAccessToken, selectedTicketCost, session, ticketStatus])

  const startBatch = useCallback(async () => {
    const hasTicket = await ensureTicketsForGeneration()
    if (!hasTicket) {
      return
    }
    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setIsRunning(true)
    setStatusMessage('')
    setResults([{ id: makeId(), status: 'queued' as const }])

    try {
      const tasks = [async () => {
        if (runIdRef.current !== runId) return
        setResults((prev) =>
          prev.map((item, itemIndex) =>
            itemIndex === 0 ? { ...item, status: 'running' as const, error: undefined } : item,
          ),
        )
        try {
          const token = accessToken || (await getLatestAccessToken())
          if (!token) {
            throw new Error('セッション確認に失敗しました。再ログインしてください。')
          }
          const submitted = await submitVideo(token)
          if (runIdRef.current !== runId) return
          if ('videos' in submitted && Array.isArray(submitted.videos) && submitted.videos.length > 0) {
            const firstVideo = submitted.videos[0]
            if (!firstVideo) return
            setResults((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === 0 ? { ...item, status: 'done' as const, video: firstVideo } : item,
              ),
            )
            return
          }
          if ('jobId' in submitted) {
            const polled = await pollJob(submitted.jobId, runId, token, videoModel)
            if (runIdRef.current !== runId) return
            if (polled.status === 'done' && polled.videos.length) {
              setResults((prev) =>
                prev.map((item, itemIndex) =>
                  itemIndex === 0 ? { ...item, status: 'done' as const, video: polled.videos[0] } : item,
                ),
              )
            }
          }
        } catch (error) {
          if (runIdRef.current !== runId) return
          const message = normalizeErrorMessage(error instanceof Error ? error.message : error)
          if (message === 'TICKET_SHORTAGE') {
            setShowTicketModal(true)
            setStatusMessage('')
            return
          }
          setResults((prev) =>
            prev.map((item, itemIndex) =>
              itemIndex === 0 ? { ...item, status: 'error' as const, error: message } : item,
            ),
          )
          setStatusMessage(message)
          setErrorModalMessage(message)
        }
      }]

      await runQueue(tasks, MAX_PARALLEL)
      if (runIdRef.current === runId) {
        setStatusMessage('生成完了')
        const token = accessToken || (await getLatestAccessToken())
        if (token) {
          void fetchTickets(token)
        }
      }
    } catch (error) {
      const message = normalizeErrorMessage(error instanceof Error ? error.message : error)
      setStatusMessage(message)
      setResults((prev) => prev.map((item) => ({ ...item, status: 'error', error: message })))
      setErrorModalMessage(message)
    } finally {
      if (runIdRef.current === runId) {
        setIsRunning(false)
      }
    }
  }, [accessToken, ensureTicketsForGeneration, fetchTickets, getLatestAccessToken, pollJob, submitVideo, videoModel])

  const handleGenerate = async () => {
    if (!sourceImageFile) {
      setStatusMessage('画像を選択してください。')
      return
    }
    if (!prompt.trim()) {
      setStatusMessage('プロンプトを入力してください。')
      return
    }
    if (prompt.length > PROMPT_MAX_LENGTH) {
      setStatusMessage(`プロンプトは${PROMPT_MAX_LENGTH}文字以内で入力してください。`)
      return
    }
    await startBatch()
  }

  const handleGoogleSignIn = async () => {
    const authReady = await ensureAuthConfigured()
    if (!authReady || !supabase || !isAuthConfigured) {
      window.alert('認証設定の準備ができていません。')
      return
    }
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT_URL, queryParams: { prompt: 'select_account' } },
    })
    if (error) {
      window.alert(error.message)
      return
    }
    if (data?.url) {
      window.location.assign(data.url)
      return
    }
    window.alert('ログインURLの取得に失敗しました。')
  }

  const handleOpenFastMove = useCallback(() => {
    setIsMobileMenuOpen(false)
    setGenerationMode('i2v')
    setVideoModel('v1')
  }, [])

  const handleOpenVideo = useCallback(() => {
    setIsMobileMenuOpen(false)
    setGenerationMode('i2v')
  }, [])

  const handleOpenLipSync = useCallback(() => {
    setIsMobileMenuOpen(false)
    window.location.assign('/lipsync')
  }, [])

  const handleSignOut = async () => {
    if (!supabase) return
    setIsMobileMenuOpen(false)
    await signOutSafely()
    setSession(null)
    setTicketCount(null)
    setTicketStatus('idle')
    setTicketMessage('')
    setBonusStatus('idle')
    setBonusMessage('')
    setBonusCanClaim(false)
    setBonusNextEligibleAt(null)
  }

  const handleOpenPurchaseConfirm = () => {
    setShowPurchaseConfirmModal(true)
  }

  const handleConfirmPurchaseMove = () => {
    setShowPurchaseConfirmModal(false)
    const popup = window.open(COIN_PURCHASE_URL, '_blank')
    if (popup) {
      popup.opener = null
    }
  }

  const formatDateTime = (value: string | null) => {
    if (!value) return ''
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return ''
    return date.toLocaleString('ja-JP', { hour12: false })
  }

  const formatTimeUntilClaim = (value: string | null) => {
    if (!value) return ''
    const nextMs = new Date(value).getTime()
    if (!Number.isFinite(nextMs)) return ''
    const diffMs = nextMs - Date.now()
    if (diffMs <= 0) return 'まもなく受け取れます'
    const totalMinutes = Math.ceil(diffMs / 60_000)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    if (hours > 0) return '次回受け取りまで約' + hours + '時間' + minutes + '分'
    return '次回受け取りまで約' + minutes + '分'
  }

  const startBonusRoulette = () => {
    if (bonusRouletteTimerRef.current) {
      clearInterval(bonusRouletteTimerRef.current)
      bonusRouletteTimerRef.current = null
    }
    setBonusRouletteAwarded(null)
    setBonusRouletteRolling(true)
    let cursor = 0
    bonusRouletteTimerRef.current = setInterval(() => {
      cursor = (cursor + 1) % BONUS_ROULETTE_VALUES.length
      setBonusRouletteValue(BONUS_ROULETTE_VALUES[cursor])
    }, 90)
  }

  const stopBonusRoulette = (finalValue?: number) => {
    if (bonusRouletteTimerRef.current) {
      clearInterval(bonusRouletteTimerRef.current)
      bonusRouletteTimerRef.current = null
    }
    setBonusRouletteRolling(false)
    if (Number.isFinite(finalValue)) {
      const normalized = Math.max(1, Math.min(5, Math.floor(Number(finalValue))))
      setBonusRouletteValue(normalized)
    }
  }

  const handleClaimDailyBonus = async () => {
    if (!session || !accessToken || bonusClaiming) return
    setBonusClaiming(true)
    setBonusMessage('')
    startBonusRoulette()
    const res = await fetch('/api/daily_bonus', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      stopBonusRoulette()
      setBonusStatus('error')
      setBonusMessage(data?.error || 'ログインボーナスの受け取りに失敗しました。')
      setBonusClaiming(false)
      return
    }
    const granted = Boolean(data?.granted)
    const nextEligibleAt = typeof data?.nextEligibleAt === 'string' ? data.nextEligibleAt : null
    setBonusNextEligibleAt(nextEligibleAt)
    setBonusCanClaim(false)
    if (granted) {
      const nextTickets = Number(data?.ticketsLeft)
      const awardedRaw = Number(data?.awarded)
      const awarded = Number.isFinite(awardedRaw)
        ? Math.max(1, Math.floor(awardedRaw))
        : 3
      if (Number.isFinite(nextTickets)) {
        setTicketCount(nextTickets)
      } else {
        await fetchTickets(accessToken)
      }
      setBonusStatus('idle')
      if (awarded !== null) {
        setBonusRouletteAwarded(awarded)
        stopBonusRoulette(awarded)
        setBonusMessage(`ログインボーナス獲得: ${awarded}枚`)
      } else {
        setBonusRouletteAwarded(null)
        stopBonusRoulette()
        setBonusMessage('ログインボーナスを受け取りました。')
      }
    } else {
      setBonusRouletteAwarded(null)
      stopBonusRoulette()
      setBonusStatus('idle')
      setBonusMessage(
        nextEligibleAt ? formatTimeUntilClaim(nextEligibleAt) : 'まだ受け取れません。',
      )
    }
    await fetchDailyBonus(accessToken)
    setBonusClaiming(false)
  }

  const isGif = displayVideo?.startsWith('data:image/gif')
  const canDownload = Boolean(displayVideo && !isGif)

  const handleDownload = useCallback(async () => {
    if (!displayVideo) return
    const filename = `sharkai-video.${isGif ? 'gif' : 'mp4'}`
    try {
      let blob: Blob
      if (displayVideo.startsWith('data:')) {
        blob = dataUrlToBlob(displayVideo, isGif ? 'image/gif' : 'video/mp4')
      } else if (displayVideo.startsWith('http') || displayVideo.startsWith('blob:')) {
        const response = await fetch(displayVideo)
        blob = await response.blob()
      } else {
        blob = base64ToBlob(displayVideo, isGif ? 'image/gif' : 'video/mp4')
      }
      const fileType = blob.type || (isGif ? 'image/gif' : 'video/mp4')
      const file = new File([blob], filename, { type: fileType })
      const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      const canShareFiles =
        canShare && typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : canShare
      if (isProbablyMobile() && canShareFiles) {
        try {
          await navigator.share({ files: [file], title: filename })
          return
        } catch {
          // Ignore share cancellations and fall back to download.
        }
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      window.location.assign(displayVideo)
    }
  }, [displayVideo, isGif])

  const pageEyebrow = isI2vMode ? '動画生成' : '画像編集'
  const pageTitle = isI2vMode ? '1枚の画像から動画を生成' : '画像編集生成'

  if (!authReady) {
    return (
      <div className="camera-app fastmove-shell video-studio-page">
        <div className="auth-boot" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="camera-app camera-app--guest fastmove-shell fastmove-shell--guest video-studio-page">
        <GuestIntro mode="video" onSignIn={handleGoogleSignIn} />
      </div>
    )
  }

  return (
    <div className="camera-app fastmove-shell video-studio-page">
      <header className="fastmove-top">
        <div>
          <p>{pageEyebrow}</p>
          <h1>{pageTitle}</h1>
        </div>
        <button
          type="button"
          className={`fastmove-menu-toggle${isMobileMenuOpen ? ' is-open' : ''}`}
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-expanded={isMobileMenuOpen}
          aria-label="メニューを開く"
        >
          <span />
          <span />
          <span />
        </button>
        <div className={`fastmove-top__actions${isMobileMenuOpen ? ' is-open' : ''}`} aria-label="生成モード切替">
          <button
            type="button"
            className={`fastmove-link video-mode-link${isI2vMode ? ' is-active' : ''}`}
            onClick={handleOpenVideo}
            disabled={disableModeSwitch}
          >
            動画
          </button>
          <button
            type="button"
            className={`fastmove-link video-mode-link${!isI2vMode ? ' is-active' : ''}`}
            onClick={() => {
              setIsMobileMenuOpen(false)
              setGenerationMode('qwen_edit')
            }}
            disabled={disableModeSwitch}
          >
            画像編集
          </button>
          <button
            type="button"
            className="fastmove-link"
            onClick={handleOpenLipSync}
            disabled={disableModeSwitch}
          >
            リップシンク
          </button>
          <a
            href={SHOP_URL}
            className="fastmove-link"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            ショップ
          </a>
          <a
            href={BOARD_URL}
            className="fastmove-link"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            掲示板
          </a>
          <button type="button" className="fastmove-ghost" onClick={handleSignOut}>
            ログアウト
          </button>
        </div>
        <button
          type="button"
          className={`fastmove-menu-backdrop${isMobileMenuOpen ? ' is-open' : ''}`}
          onClick={() => setIsMobileMenuOpen(false)}
          aria-label="メニューを閉じる"
        />
      </header>

      <section className="fastmove-account-row">
        <div className="fastmove-account-user">
          <strong>{session.user?.email ?? 'ログイン中'}</strong>
          <span>ログイン中</span>
        </div>
        <div className="fastmove-account-side">
          <div className={`fastmove-account-coins ${ticketStatus === 'error' ? 'is-error' : ''}`}>
            {ticketStatus === 'loading' && 'トークン確認中...'}
            {ticketStatus !== 'loading' && `トークン: ${ticketCount ?? 0}`}
            {ticketStatus === 'error' && ticketMessage ? ` / ${ticketMessage}` : ''}
          </div>
          <div className="fastmove-bonus">
            <button
              type="button"
              className="fastmove-bonus-button"
              onClick={handleClaimDailyBonus}
              disabled={bonusClaiming || bonusStatus === 'loading' || !bonusCanClaim}
            >
              {bonusClaiming ? '受け取り中...' : 'ログインボーナス'}
            </button>
            <small className="fastmove-bonus-hint">
              {bonusStatus === 'loading' && '状態確認中...'}
              {bonusStatus !== 'loading' && bonusCanClaim && '24時間ごとに受け取れます'}
              {bonusStatus !== 'loading' && !bonusCanClaim && bonusNextEligibleAt && formatTimeUntilClaim(bonusNextEligibleAt)}
              {bonusStatus !== 'loading' && !bonusCanClaim && !bonusNextEligibleAt && '24時間ごとに受け取れます'}
            </small>
            {bonusMessage && <small className="fastmove-bonus-msg">{bonusMessage}</small>}
          </div>
        </div>
      </section>
      {isI2vMode ? (
      <div className="video-studio-layout fastmove-grid">
        <section className="studio-block--input fastmove-card">
          <h2>入力設定</h2>
          <p className="fastmove-status">{durationHelpText}</p>
          <div className="fastmove-field">
            <span>元画像</span>
            <input
              id={I2V_IMAGE_INPUT_ID}
              ref={sourceImageInputRef}
              className="fastmove-file__native"
              type="file"
              accept="image/*"
              onChange={(event) => setSourceImageFile(event.target.files?.[0] || null)}
              disabled={isRunning}
            />
            <label
              htmlFor={I2V_IMAGE_INPUT_ID}
              className={`fastmove-file-picker ${sourceImageFile ? 'is-selected' : ''} ${isRunning ? 'is-disabled' : ''}`.trim()}
            >
              <span className="fastmove-file-picker__badge">画像</span>
              <span className="fastmove-file-picker__title">{sourceImageFile ? '画像を変更' : '画像を選択'}</span>
              <span className="fastmove-file-picker__meta">JPG / PNG / WEBP</span>
            </label>
            <small>{sourceImageFile ? sourceImageFile.name : '画像を選択してください'}</small>
          </div>

          {sourceImagePreview && (
            <figure className="studio-thumb">
              <img src={sourceImagePreview} alt="アップロード画像プレビュー" />
              <button
                type="button"
                className="studio-thumb__remove"
                onClick={() => {
                  setSourceImageFile(null)
                  if (sourceImageInputRef.current) {
                    sourceImageInputRef.current.value = ''
                  }
                }}
                aria-label="画像を削除"
              >
                x
              </button>
            </figure>
          )}

          <label className="fastmove-field">
            <span>プロンプト</span>
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={PROMPT_PLACEHOLDER}
              maxLength={PROMPT_MAX_LENGTH}
            />
            <small>{`${prompt.length}/${PROMPT_MAX_LENGTH}`}</small>
          </label>

          <label className="fastmove-field">
            <span>ネガティブプロンプト</span>
            <textarea
              rows={3}
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
            />
          </label>

          <label className="fastmove-field fastmove-field--compact">
            <span>動画モデル</span>
            <div className="fastmove-quality" role="group" aria-label="動画モデル">
              {VIDEO_MODEL_ORDER.map((modelId) => {
                const model = VIDEO_MODELS[modelId]
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`fastmove-quality__btn${videoModel === model.id ? ' is-active' : ''}`}
                    onClick={() => setVideoModel(model.id)}
                    disabled={isRunning}
                  >
                    {model.label}
                  </button>
                )
              })}
            </div>
            <small>{selectedVideoModelDescription}</small>
          </label>

          <label className="fastmove-field fastmove-field--compact">
            <span>画質プリセット</span>
            <div className="fastmove-quality" role="group" aria-label="画質プリセット">
              {QUALITY_PRESETS.map((preset, index) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`fastmove-quality__btn${index === qualityIndex ? ' is-active' : ''}`}
                  onClick={() => setQualityIndex(index)}
                  disabled={isRunning}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <small>{qualityDescription}</small>
          </label>

          <label className="fastmove-field fastmove-field--compact">
            <span>長さ</span>
            <div className="fastmove-quality" role="group" aria-label="動画の長さ">
              <button
                type="button"
                className={`fastmove-quality__btn${durationSeconds === 6 ? ' is-active' : ''}`}
                onClick={() => setDurationSeconds(6)}
                disabled={isRunning}
              >
                6s
              </button>
              <button
                type="button"
                className={`fastmove-quality__btn${durationSeconds === 8 ? ' is-active' : ''}`}
                onClick={() => setDurationSeconds(8)}
                disabled={isRunning}
              >
                8s
              </button>
              <button
                type="button"
                className={`fastmove-quality__btn${durationSeconds === 10 ? ' is-active' : ''}`}
                onClick={() => setDurationSeconds(10)}
                disabled={isRunning}
              >
                10s
              </button>
            </div>
          </label>

          <div className="fastmove-cost">
            <strong>{`消費トークン: ${totalTicketCost}枚`}</strong>
            <small>{`内訳: 画質 ${selectedQuality.cost}枚 + 長さ ${durationTicketCost}枚`}</small>
          </div>

          <div className="fastmove-actions">
            <button type="button" className="fastmove-primary" onClick={handleGenerate} disabled={!canGenerate}>
              {isRunning ? '生成中...' : `動画を生成 (${totalTicketCost}枚)`}
            </button>
            <small>{`現在の設定: ${selectedQualityWithCost} / ${durationSeconds}秒`}</small>
          </div>

        </section>

        <section className="studio-block--output fastmove-card" style={viewerStyle}>
          <header className="fastmove-output-head">
            <div>
              <h2>生成結果</h2>
              {statusMessage && !isRunning && <span>{statusMessage}</span>}
            </div>
            {canDownload && (
              <button type="button" className="fastmove-ghost" onClick={handleDownload}>
                保存
              </button>
            )}
          </header>

          <div className="fastmove-output">
            {isRunning ? (
              <div className="fastmove-loading" role="status" aria-live="polite">
                <div className="fastmove-loading__dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <p>生成中...</p>
              </div>
            ) : displayVideo ? (
              isGif ? (
                <img src={displayVideo} alt="結果" />
              ) : (
                <video controls src={displayVideo} />
              )
            ) : (
              <p>ここに生成動画が表示されます。</p>
            )}
          </div>
        </section>
      </div>
      ) : (
        <div className="studio-qwen-wrap">
          <QwenEditPanel
            generationMode={generationMode}
            onChangeMode={setGenerationMode}
            accessToken={accessToken}
            selectedTicketCost={selectedTicketCost}
            ticketStatus={ticketStatus}
            ticketCount={ticketCount}
            ticketMessage={ticketMessage}
            onOpenPurchaseConfirm={handleOpenPurchaseConfirm}
            bonusStatus={bonusStatus}
            bonusCanClaim={bonusCanClaim}
            bonusNextEligibleAt={bonusNextEligibleAt}
            bonusRouletteRolling={bonusRouletteRolling}
            bonusRouletteAwarded={bonusRouletteAwarded}
            bonusClaiming={bonusClaiming}
            bonusMessage={bonusMessage}
            onClaimDailyBonus={handleClaimDailyBonus}
            formatTimeUntilClaim={formatTimeUntilClaim}
            onEnsureTickets={ensureTicketsForGeneration}
            onTicketShortage={() => setShowTicketModal(true)}
            onTicketCountUpdate={(nextCount) => setTicketCount(nextCount)}
            onOpenFastMove={handleOpenFastMove}
            onOpenLipSync={handleOpenLipSync}
          />
        </div>
      )}

      {showTicketModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>トークン不足</h3>
            <p>{`この設定の${generationLabel}には${selectedTicketCost}枚必要です。`}</p>
            <div className="modal-actions">
              <button type="button" className="primary-button" onClick={() => setShowTicketModal(false)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
      {isI2vMode && errorModalMessage && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>生成エラー</h3>
            <p>{errorModalMessage}</p>
            <div className="modal-actions">
              <button type="button" className="primary-button" onClick={() => setErrorModalMessage(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
      {showPurchaseConfirmModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3>購入ページへ移動</h3>
            <p>新しいタブで購入ページを開きます。必要に応じて再ログインしてください。</p>
            <div className="modal-actions">
              <button type="button" className="primary-button" onClick={handleConfirmPurchaseMove}>
                移動する
              </button>
              <button type="button" className="ghost-button" onClick={() => setShowPurchaseConfirmModal(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
