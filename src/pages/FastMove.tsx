import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { GuestIntro } from '../components/GuestIntro'
import { getOAuthRedirectUrl } from '../lib/oauthRedirect'
import { ensureAuthConfigured, isAuthConfigured, signOutSafely, supabase } from '../lib/supabaseClient'
import './fastmove.css'
import './video-studio.css'

type JobSubmitResult =
  | { videos: string[] }
  | { jobId: string }

type PollResult =
  | { status: 'done'; videos: string[] }
  | { status: 'cancelled'; videos: string[] }

type QualityPreset = {
  key: 'low' | 'medium' | 'high'
  label: string
  fps: 8 | 10 | 12
  ticketCost: 0 | 1 | 2
}

type DurationSeconds = 6 | 8 | 10
type TicketStatus = 'idle' | 'loading' | 'error'
type BonusStatus = 'idle' | 'loading' | 'error'
type FastMoveProps = {
  apiEndpoint?: string
  engineName?: string
  pageTitle?: string
  activeNav?: 'fastmove' | 'smoothmix'
  imageInputId?: string
  resultFilePrefix?: string
}

const DEFAULT_API_ENDPOINT = '/api/wan-rapid-fastmove'
const DEFAULT_ENGINE_NAME = 'rapid_fastmove'
const DEFAULT_PAGE_TITLE = 'V1'
const OAUTH_REDIRECT_URL = getOAuthRedirectUrl()
const SHOP_URL = 'https://gettoken.uk/purchage/'
const BOARD_URL = 'https://civitai.uk/'
const MAX_PROMPT_LENGTH = 1000
const DEFAULT_DURATION_SECONDS: DurationSeconds = 6
const FIXED_CFG = 1
const FIXED_MAX_LONG_SIDE = 768
const FIXED_MIN_SIDE = 256
const FIXED_SIZE_MULTIPLE = 64
const FIXED_STEPS = 4
const QUALITY_PRESETS: readonly QualityPreset[] = [
  { key: 'low', label: '速度優先', fps: 8, ticketCost: 0 },
  { key: 'medium', label: '安定重視', fps: 10, ticketCost: 1 },
  { key: 'high', label: '解像度優先', fps: 12, ticketCost: 2 },
] as const
const DEFAULT_QUALITY_INDEX = 1
const DEFAULT_IMAGE_INPUT_ID = 'fastmove-image-file'
const durationTicketCostMap: Record<DurationSeconds, number> = {
  6: 1,
  8: 2,
  10: 3,
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
      reject(new Error('画像リサイズに失敗しました。'))
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
  if (value.startsWith('data:') || value.startsWith('http') || value.startsWith('blob:')) return value
  const ext = filename?.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'webm'
      ? 'video/webm'
      : ext === 'mov'
      ? 'video/quicktime'
      : ext === 'gif'
      ? 'image/gif'
      : 'video/mp4'
  return `data:${mime};base64,${value}`
}

const extractVideoList = (payload: any) => {
  const output = payload?.output ?? payload?.result ?? payload
  const nested = output?.output ?? output?.result ?? output?.data ?? payload?.output?.output ?? payload?.result?.output

  const listCandidates = [
    output?.videos,
    output?.outputs,
    output?.gifs,
    output?.images,
    payload?.videos,
    payload?.gifs,
    payload?.images,
    nested?.videos,
    nested?.outputs,
    nested?.gifs,
    nested?.images,
    nested?.data,
  ]

  for (const candidate of listCandidates) {
    if (!Array.isArray(candidate)) continue
    const normalized = candidate
      .map((item: any) => normalizeVideo(item?.video ?? item?.data ?? item?.url ?? item, item?.filename))
      .filter(Boolean) as string[]
    if (normalized.length) return normalized
  }

  const singleCandidates = [
    output?.video,
    output?.output_video,
    output?.output_base64,
    output?.url,
    payload?.video,
    payload?.output_video,
    payload?.output_base64,
    payload?.url,
    nested?.video,
    nested?.output_video,
    nested?.output_base64,
    nested?.url,
  ]

  for (const candidate of singleCandidates) {
    const normalized = normalizeVideo(candidate)
    if (normalized) return [normalized]
  }

  return []
}

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

const extractJobId = (payload: any) =>
  payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const isSuccessStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('complete') || normalized.includes('success') || normalized.includes('finished')
}

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
  if (!value) return 'エラーが発生しました。'
  if (typeof value === 'object') {
    const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
    const picked = maybe.error ?? maybe.message ?? maybe.detail
    if (typeof picked === 'string' && picked) {
      const trimmed = picked.trim()
      return shouldMaskErrorMessage(trimmed) ? GENERIC_RETRY_MESSAGE : trimmed
    }
    if (value instanceof Error && value.message) {
      const trimmed = value.message.trim()
      return shouldMaskErrorMessage(trimmed) ? GENERIC_RETRY_MESSAGE : trimmed
    }
  }
  const raw = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value)
  const trimmed = raw.trim()
  if (!trimmed) return 'エラーが発生しました。'
  return shouldMaskErrorMessage(trimmed) ? GENERIC_RETRY_MESSAGE : trimmed
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

const pickVideoMime = (value: string) => {
  const match = value.match(/^data:([^;]+);base64,/)
  return match?.[1] || 'video/mp4'
}

export function FastMove({
  apiEndpoint = DEFAULT_API_ENDPOINT,
  engineName = DEFAULT_ENGINE_NAME,
  pageTitle = DEFAULT_PAGE_TITLE,
  activeNav = 'fastmove',
  imageInputId = DEFAULT_IMAGE_INPUT_ID,
  resultFilePrefix = 'fastmove-result',
}: FastMoveProps = {}) {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null)
  const [sourceImagePreview, setSourceImagePreview] = useState('')
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [qualityIndex, setQualityIndex] = useState(DEFAULT_QUALITY_INDEX)
  const [durationSeconds, setDurationSeconds] = useState<DurationSeconds>(DEFAULT_DURATION_SECONDS)
  const [isRunning, setIsRunning] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [resultVideo, setResultVideo] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [ticketCount, setTicketCount] = useState<number | null>(null)
  const [ticketStatus, setTicketStatus] = useState<TicketStatus>('idle')
  const [ticketMessage, setTicketMessage] = useState('')
  const [bonusStatus, setBonusStatus] = useState<BonusStatus>('idle')
  const [bonusCanClaim, setBonusCanClaim] = useState(false)
  const [bonusNextEligibleAt, setBonusNextEligibleAt] = useState<string | null>(null)
  const [bonusClaiming, setBonusClaiming] = useState(false)
  const [bonusMessage, setBonusMessage] = useState('')
  const [bonusNowMs, setBonusNowMs] = useState(() => Date.now())
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const runIdRef = useRef(0)

  const accessToken = session?.access_token ?? ''
  const selectedQuality = QUALITY_PRESETS[qualityIndex] ?? QUALITY_PRESETS[DEFAULT_QUALITY_INDEX]
  const canGenerate = Boolean(sourceImageFile && prompt.trim().length > 0 && !isRunning)
  const durationTicketCost = durationTicketCostMap[durationSeconds]
  const totalTicketCost = selectedQuality.ticketCost + durationTicketCost
  const durationHelpText = '1枚の画像から6秒・8秒・10秒の動画を生成できます。'

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
          setTicketMessage('認証に失敗しました。ログインし直してください。')
          setSession(null)
        } else {
          setTicketMessage(normalizeErrorMessage(data?.error || 'トークン残高の取得に失敗しました。'))
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
      setBonusMessage(normalizeErrorMessage(data?.error || 'ログインボーナス状態の取得に失敗しました。'))
      return
    }
    const nextTickets = Number(data?.tickets)
    if (Number.isFinite(nextTickets)) {
      setTicketCount(nextTickets)
    }
    setBonusStatus('idle')
    setBonusCanClaim(Boolean(data?.canClaim))
    setBonusNextEligibleAt(typeof data?.nextEligibleAt === 'string' ? data.nextEligibleAt : null)
  }, [])

  const formatTimeUntilClaim = useCallback(
    (value: string | null) => {
      if (!value) return ''
      const nextMs = new Date(value).getTime()
      if (!Number.isFinite(nextMs)) return ''
      const diffMs = nextMs - bonusNowMs
      if (diffMs <= 0) return '今すぐ受け取れます'
      const totalMinutes = Math.ceil(diffMs / 60_000)
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      if (hours > 0) return `次回まで 約${hours}時間${minutes}分`
      return `次回まで 約${minutes}分`
    },
    [bonusNowMs],
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
      setStatusMessage('ログインに失敗しました。再度お試しください。')
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
        setStatusMessage('ログインに失敗しました。再度お試しください。')
        return
      }
      const cleaned = new URL(window.location.href)
      cleaned.searchParams.delete('code')
      cleaned.searchParams.delete('state')
      window.history.replaceState({}, document.title, cleaned.toString())
    })
  }, [])

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
    if (!accessToken) {
      setTicketStatus('idle')
      setTicketCount(null)
      setTicketMessage('')
      setBonusStatus('idle')
      setBonusCanClaim(false)
      setBonusNextEligibleAt(null)
      setBonusClaiming(false)
      setBonusMessage('')
      return
    }
    void fetchTickets(accessToken)
    void fetchDailyBonus(accessToken)
  }, [accessToken, fetchDailyBonus, fetchTickets])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBonusNowMs(Date.now())
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])

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

  const submitJob = useCallback(async (token: string): Promise<JobSubmitResult> => {
    if (!sourceImageFile) {
      throw new Error('画像を選択してください。')
    }

    const imageSize = await getImageSize(sourceImageFile)
    const dims = toVideoDimensions(imageSize.width, imageSize.height)
    const imageDataUrl = await fileToResizedPngDataUrl(sourceImageFile, dims.width, dims.height)
    const targetFrameCount = selectedQuality.fps * durationSeconds + 1
    const stabilizedPrompt = `${prompt.trim()}, keep same person identity, keep same face, keep same camera distance, no zoom in`
    const stabilizedNegative = [negativePrompt.trim(), 'zoom in, close-up, crop, face distortion, identity change']
      .filter(Boolean)
      .join(', ')

    const input: Record<string, unknown> = {
      engine: engineName,
      mode: 'i2v',
      image: imageDataUrl,
      image_name: 'input.png',
      prompt: stabilizedPrompt,
      negative_prompt: stabilizedNegative,
      width: dims.width,
      height: dims.height,
      fps: selectedQuality.fps,
      seconds: durationSeconds,
      num_frames: targetFrameCount,
      steps: FIXED_STEPS,
      cfg: FIXED_CFG,
      seed: 0,
      randomize_seed: true,
      worker_mode: 'comfyui',
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    const res = await fetch(apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(normalizeErrorMessage(extractErrorMessage(data) || '生成リクエストに失敗しました。'))
    }

    const videos = extractVideoList(data)
    if (videos.length) return { videos }

    const jobId = extractJobId(data)
    if (!jobId) throw new Error('ジョブIDの取得に失敗しました。')
    return { jobId: String(jobId) }
  }, [apiEndpoint, durationSeconds, engineName, negativePrompt, prompt, selectedQuality.fps, sourceImageFile])

  const pollJob = useCallback(async (jobId: string, token: string, runId: number): Promise<PollResult> => {
    for (let i = 0; i < 180; i += 1) {
      if (runIdRef.current !== runId) {
        return { status: 'cancelled', videos: [] }
      }

      const headers: Record<string, string> = {}
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }

      const query = new URLSearchParams({
        id: jobId,
        engine: engineName,
      })

      const res = await fetch(`${apiEndpoint}?${query.toString()}`, { headers })
      const data = await res.json().catch(() => ({}))

      if (res.status === 524 || res.status === 522 || res.status === 504) {
        await wait(1000)
        continue
      }

      if (!res.ok) {
        throw new Error(normalizeErrorMessage(extractErrorMessage(data) || '進捗確認に失敗しました。'))
      }

      const status = String(data?.status || data?.state || '').toLowerCase()
      const statusError = extractErrorMessage(data)
      if (statusError || isFailureStatus(status)) {
        throw new Error(normalizeErrorMessage(statusError || '生成に失敗しました。'))
      }

      const videos = extractVideoList(data)
      if (videos.length) {
        return { status: 'done', videos }
      }

      if (isSuccessStatus(status)) {
        throw new Error('生成は完了しましたが、動画を取得できませんでした。')
      }

      await wait(1000)
    }

    throw new Error('生成がタイムアウトしました。')
  }, [apiEndpoint, engineName])

  const handleGenerate = useCallback(async () => {
    if (isRunning) return
    if (!session || !accessToken) {
      setStatusMessage('先にログインしてください。')
      return
    }
    if (!sourceImageFile) {
      setStatusMessage('画像を選択してください。')
      return
    }
    if (!prompt.trim()) {
      setStatusMessage('プロンプトを入力してください。')
      return
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      setStatusMessage(`プロンプトは ${MAX_PROMPT_LENGTH} 文字以内にしてください。`)
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setIsRunning(true)
    setStatusMessage(`${pageTitle}ジョブを送信しています...`)
    setErrorMessage(null)
    setResultVideo(null)

    try {
      const submitted = await submitJob(accessToken)
      if (runIdRef.current !== runId) return

      if ('videos' in submitted && submitted.videos.length) {
        setResultVideo(submitted.videos[0])
        setStatusMessage('生成が完了しました。')
        return
      }

      if (!('jobId' in submitted)) {
        throw new Error('ジョブIDの取得に失敗しました。')
      }
      const polled = await pollJob(submitted.jobId, accessToken, runId)
      if (runIdRef.current !== runId) return
      if (polled.status === 'done' && polled.videos.length) {
        setResultVideo(polled.videos[0])
        setStatusMessage('生成が完了しました。')
      }
    } catch (error) {
      const message = normalizeErrorMessage(error)
      setStatusMessage(message)
      setErrorMessage(message)
    } finally {
      if (runIdRef.current === runId) {
        setIsRunning(false)
        if (accessToken) {
          void fetchTickets(accessToken)
        }
      }
    }
  }, [accessToken, durationSeconds, fetchTickets, isRunning, pageTitle, pollJob, prompt, session, sourceImageFile, submitJob])

  const handleGoogleSignIn = useCallback(async () => {
    const authConfigured = await ensureAuthConfigured()
    if (!authConfigured || !supabase || !isAuthConfigured) {
      window.alert('認証設定の準備ができていません。')
      return
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: OAUTH_REDIRECT_URL,
        queryParams: { prompt: 'select_account' },
      },
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
  }, [])

  const handleDownload = useCallback(async () => {
    if (!resultVideo) return
    const filename = `${resultFilePrefix}.mp4`
    try {
      let blob: Blob
      if (resultVideo.startsWith('data:')) {
        blob = dataUrlToBlob(resultVideo, pickVideoMime(resultVideo))
      } else if (resultVideo.startsWith('http') || resultVideo.startsWith('blob:')) {
        const response = await fetch(resultVideo)
        blob = await response.blob()
      } else {
        blob = base64ToBlob(resultVideo, 'video/mp4')
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      window.location.assign(resultVideo)
    }
  }, [resultFilePrefix, resultVideo])

  const handleSignOut = useCallback(async () => {
    if (!supabase) return
    setIsMobileMenuOpen(false)
    await signOutSafely()
    setSession(null)
    setTicketCount(null)
    setTicketStatus('idle')
    setTicketMessage('')
    setBonusStatus('idle')
    setBonusCanClaim(false)
    setBonusNextEligibleAt(null)
    setBonusClaiming(false)
    setBonusMessage('')
  }, [])

  const handleClaimDailyBonus = useCallback(async () => {
    if (!session || !accessToken || bonusClaiming) return
    setBonusClaiming(true)
    setBonusMessage('')
    const res = await fetch('/api/daily_bonus', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      setBonusStatus('error')
      setBonusMessage(normalizeErrorMessage(data?.error || 'ログインボーナスの受け取りに失敗しました。'))
      setBonusClaiming(false)
      return
    }

    const granted = Boolean(data?.granted)
    const nextEligibleAt = typeof data?.nextEligibleAt === 'string' ? data.nextEligibleAt : null
    const nextTickets = Number(data?.ticketsLeft)
    if (Number.isFinite(nextTickets)) {
      setTicketCount(nextTickets)
    }
    setBonusNextEligibleAt(nextEligibleAt)
    setBonusCanClaim(false)
    setBonusStatus('idle')

    if (granted) {
      const awardedRaw = Number(data?.awarded)
      const awarded = Number.isFinite(awardedRaw) ? Math.max(1, Math.floor(awardedRaw)) : 3
      setBonusMessage(`ログインボーナスを受け取りました。+${awarded}トークン`)
    } else {
      setBonusMessage(nextEligibleAt ? formatTimeUntilClaim(nextEligibleAt) : 'まだ受け取れません。')
    }

    await fetchDailyBonus(accessToken)
    setBonusClaiming(false)
  }, [accessToken, bonusClaiming, fetchDailyBonus, formatTimeUntilClaim, session])

  const qualityDescription = useMemo(
    () => `${selectedQuality.label} / ${durationSeconds}秒`,
    [durationSeconds, selectedQuality],
  )

  if (!authReady) {
    return <div className='fastmove-shell fastmove-shell--loading' />
  }

  if (!session) {
    return (
      <div className='fastmove-shell fastmove-shell--guest'>
        <GuestIntro mode='video' onSignIn={handleGoogleSignIn} />
      </div>
    )
  }

  return (
    <div className='fastmove-shell'>
      <header className='fastmove-top'>
        <div>
          <p>{pageTitle}生成</p>
          <h1>画像からダイナミックな動画を生成</h1>
        </div>
        <button
          type='button'
          className={`fastmove-menu-toggle${isMobileMenuOpen ? ' is-open' : ''}`}
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-expanded={isMobileMenuOpen}
          aria-label='メニューを開閉'
        >
          <span />
          <span />
          <span />
        </button>
        <div className={`fastmove-top__actions${isMobileMenuOpen ? ' is-open' : ''}`}>
          <a href='/fastmove' className={`fastmove-link${activeNav === 'fastmove' ? ' is-active' : ''}`} onClick={() => setIsMobileMenuOpen(false)}>V1</a>
          <a href='/smoothmix' className={`fastmove-link${activeNav === 'smoothmix' ? ' is-active' : ''}`} onClick={() => setIsMobileMenuOpen(false)}>V2</a>
          <a href='/video-remix' className='fastmove-link' onClick={() => setIsMobileMenuOpen(false)}>V3</a>
          <a href='/video' className='fastmove-link' onClick={() => setIsMobileMenuOpen(false)}>V4</a>
          <a href='/lipsync' className='fastmove-link' onClick={() => setIsMobileMenuOpen(false)}>LipSync</a>
          <a href='/video?mode=edit' className='fastmove-link' onClick={() => setIsMobileMenuOpen(false)}>Edit</a>
          <a href={SHOP_URL} className='fastmove-link' target='_blank' rel='noopener noreferrer' onClick={() => setIsMobileMenuOpen(false)}>ショップ</a>
          <a href={BOARD_URL} className='fastmove-link' target='_blank' rel='noopener noreferrer' onClick={() => setIsMobileMenuOpen(false)}>掲示板</a>
          <button type='button' className='fastmove-ghost' onClick={handleSignOut}>ログアウト</button>
        </div>
        <button
          type='button'
          className={`fastmove-menu-backdrop${isMobileMenuOpen ? ' is-open' : ''}`}
          onClick={() => setIsMobileMenuOpen(false)}
          aria-label='メニューを閉じる'
        />
      </header>

      <section className='fastmove-account-row'>
        <div className='fastmove-account-user'>
          <strong>{session.user?.email ?? 'ログイン中'}</strong>
          <span>ログイン中</span>
        </div>
        <div className='fastmove-account-side'>
          <div className={`fastmove-account-coins ${ticketStatus === 'error' ? 'is-error' : ''}`}>
            {ticketStatus === 'loading' && 'トークン確認中...'}
            {ticketStatus !== 'loading' && `保有トークン数 ${ticketCount ?? 0}枚`}
            {ticketStatus === 'error' && ticketMessage ? ` / ${ticketMessage}` : ''}
          </div>
          <div className='fastmove-bonus'>
            <button
              type='button'
              className='fastmove-bonus-button'
              onClick={handleClaimDailyBonus}
              disabled={bonusClaiming || bonusStatus === 'loading' || !bonusCanClaim}
            >
              {bonusClaiming ? '受け取り中...' : 'ログインボーナス'}
            </button>
            <small className='fastmove-bonus-hint'>
              {bonusStatus === 'loading' && '状態確認中...'}
              {bonusStatus !== 'loading' && bonusCanClaim && '24時間に1回受け取れます（受け取り可能）'}
              {bonusStatus !== 'loading' && !bonusCanClaim && bonusNextEligibleAt && formatTimeUntilClaim(bonusNextEligibleAt)}
              {bonusStatus !== 'loading' && !bonusCanClaim && !bonusNextEligibleAt && '24時間に1回受け取れます'}
            </small>
            {bonusMessage && <small className='fastmove-bonus-msg'>{bonusMessage}</small>}
          </div>
        </div>
      </section>

      <main className='video-studio-layout fastmove-grid'>
        <section className='studio-block--input fastmove-card'>
          <h2>入力設定</h2>
          <p className='fastmove-status'>{durationHelpText}</p>

          <label className='fastmove-field'>
            <span>素材画像</span>
            <input
              id={imageInputId}
              className='fastmove-file__native'
              type='file'
              accept='image/*'
              onChange={(event) => setSourceImageFile(event.target.files?.[0] ?? null)}
              disabled={isRunning}
            />
            <label
              htmlFor={imageInputId}
              className={`fastmove-file-picker ${sourceImageFile ? 'is-selected' : ''} ${isRunning ? 'is-disabled' : ''}`.trim()}
            >
              <span className='fastmove-file-picker__badge'>画像</span>
              <span className='fastmove-file-picker__title'>{sourceImageFile ? '画像を変更' : '画像を選択'}</span>
              <span className='fastmove-file-picker__meta'>JPG / PNG / WEBP</span>
            </label>
            <small>{sourceImageFile ? sourceImageFile.name : '画像を選択してください'}</small>
          </label>

          {sourceImagePreview && (
            <div className='fastmove-preview'>
              <img src={sourceImagePreview} alt='Source preview' />
            </div>
          )}

          <label className='fastmove-field'>
            <span>プロンプト</span>
            <textarea
              rows={5}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={MAX_PROMPT_LENGTH}
              placeholder='指示を入力'
              disabled={isRunning}
            />
            <small>{`${prompt.length}/${MAX_PROMPT_LENGTH}`}</small>
          </label>

          <label className='fastmove-field'>
            <span>ネガティブプロンプト（任意）</span>
            <textarea
              rows={3}
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
              disabled={isRunning}
            />
          </label>

          <label className='fastmove-field fastmove-field--compact'>
            <span>画質プリセット</span>
            <div className='fastmove-quality'>
              {QUALITY_PRESETS.map((preset, index) => (
                <button
                  key={preset.key}
                  type='button'
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

          <label className='fastmove-field fastmove-field--compact'>
            <span>長さ</span>
            <div className='fastmove-quality'>
              <button
                type='button'
                className={`fastmove-quality__btn${durationSeconds === 6 ? ' is-active' : ''}`}
                onClick={() => setDurationSeconds(6)}
                disabled={isRunning}
              >
                6s
              </button>
              <button
                type='button'
                className={`fastmove-quality__btn${durationSeconds === 8 ? ' is-active' : ''}`}
                onClick={() => setDurationSeconds(8)}
                disabled={isRunning}
              >
                8s
              </button>
              <button
                type='button'
                className={`fastmove-quality__btn${durationSeconds === 10 ? ' is-active' : ''}`}
                onClick={() => setDurationSeconds(10)}
                disabled={isRunning}
              >
                10s
              </button>
            </div>
          </label>

          <div className='fastmove-cost'>
            <strong>{`消費トークン: ${totalTicketCost}枚`}</strong>
            <small>{`内訳: 画質 ${selectedQuality.ticketCost}枚 + 長さ ${durationTicketCost}枚`}</small>
          </div>

          <div className='fastmove-actions'>
            <button type='button' className='fastmove-primary' onClick={handleGenerate} disabled={!canGenerate}>
              {isRunning ? '生成中...' : `動画を生成（${totalTicketCost}トークン）`}
            </button>
            <button
              type='button'
              className='fastmove-ghost'
              onClick={() => {
                setPrompt('')
                setNegativePrompt('')
                setStatusMessage('')
                setErrorMessage(null)
              }}
              disabled={isRunning || (!prompt && !negativePrompt)}
            >
              クリア
            </button>
          </div>

          {statusMessage && <p className='fastmove-status'>{statusMessage}</p>}
        </section>

        <section className='studio-block--output fastmove-card'>
          <div className='fastmove-output-head'>
            <h2>生成結果</h2>
            {resultVideo && (
              <button type='button' className='fastmove-ghost' onClick={handleDownload}>ダウンロード</button>
            )}
          </div>

          <div className='fastmove-output'>
            {isRunning ? (
              <div className='fastmove-loading'>
                <div className='fastmove-loading__dots' aria-hidden='true'>
                  <span />
                  <span />
                  <span />
                </div>
                <p>生成しています</p>
              </div>
            ) : resultVideo ? (
              <video src={resultVideo} controls playsInline preload='metadata' />
            ) : (
              <p>生成した動画がここに表示されます。</p>
            )}
          </div>

          {errorMessage && <p className='fastmove-error'>{errorMessage}</p>}
        </section>
      </main>
    </div>
  )
}
