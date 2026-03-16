import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { GuestIntro } from '../components/GuestIntro'
import { getOAuthRedirectUrl } from '../lib/oauthRedirect'
import { ensureAuthConfigured, isAuthConfigured, signOutSafely, supabase } from '../lib/supabaseClient'
import './lipsync.css'

type JobSubmitResult =
  | { video: string; usageId?: string }
  | { audio: GeneratedAudio; usageId?: string }
  | { jobId: string; usageId?: string }

type GeneratedAudio = {
  base64: string
  ext: string
}

type PollResult =
  | { status: 'done'; value: string | GeneratedAudio }
  | { status: 'cancelled' }

type ProgressStage = 'idle' | 'audio' | 'video'
type TicketStatus = 'idle' | 'loading' | 'error'
type BonusStatus = 'idle' | 'loading' | 'error'
type SoVitsPreset = {
  id: string
  label: string
  refAudioExt: string
  refText: string
}

const API_ENDPOINT = '/api/lipsync'
const OAUTH_REDIRECT_URL = getOAuthRedirectUrl()
const SHOP_URL = 'https://gettoken.uk/purchage/'
const MAX_TEXT_LENGTH = 100
const LIPSYNC_BASE_REQUIRED_TICKETS = 2
const LIPSYNC_LONG_TEXT_REQUIRED_TICKETS = 3
const LIPSYNC_LONG_TEXT_THRESHOLD = 60
const MAX_VIDEO_MB = 80
const MAX_REF_VIDEO_MB = 20
const MAX_REF_AUDIO_MB = 5
const MAX_TTS_AUDIO_SECONDS = 30
const MIN_VIDEO_SECONDS = 3
const DEFAULT_PADS = 4
const DEFAULT_FACE_MODE = 0
const DEFAULT_RESIZE_FACTOR = 1
const DEFAULT_TARGET_FACE_INDEX = 0
const DEFAULT_FACE_ID_THRESHOLD = 0.45
const DEFAULT_W2L_BLENDING = 10
const MIN_W2L_BLENDING = 1
const MAX_W2L_BLENDING = 10
const W2L_BLENDING_STEP = 1
const DEFAULT_SOVITS_SPEECH_RATE = 1.2
const MIN_SOVITS_SPEECH_RATE = 1
const MAX_SOVITS_SPEECH_RATE = 2
const SOVITS_SPEECH_RATE_STEP = 0.05
const DEFAULT_SOVITS_TEMPERATURE = 1
const MIN_SOVITS_TEMPERATURE = 1
const MAX_SOVITS_TEMPERATURE = 2
const SOVITS_TEMPERATURE_STEP = 0.05
const DEFAULT_SOVITS_FRAGMENT_INTERVAL = 0.08
const MIN_REF_AUDIO_SECONDS = 3
const MAX_REF_AUDIO_SECONDS = 10
const REF_AUDIO_DURATION_RANGE_ERROR = 'Reference audio is outside the 3-10 second range, please choose another one!'
const DEFAULT_GENERATED_AUDIO_MIX_VOLUME = 1
const DEFAULT_ORIGINAL_AUDIO_MIX_VOLUME = 0.9
const MIN_AUDIO_MIX_VOLUME = 0
const MAX_AUDIO_MIX_VOLUME = 2
const AUDIO_MIX_VOLUME_STEP = 0.05
const TTS_TOO_LONG_POPUP_MESSAGE = '生成エラーです。参考音声、セリフのいずれかに問題があります。修正して再度生成してください。'
const AUTO_TRIM_GENERATED_AUDIO_MIN_SILENCE_SECONDS = 1
const AUTO_TRIM_GENERATED_AUDIO_SILENCE_THRESHOLD = 0.01
const AUTO_TRIM_GENERATED_AUDIO_PADDING_SECONDS = 0.03
const PRESET_REF_TEXT_PRIORITY_SEAT = '優先席付近では、携帯電話はマナーモードにしていただくか、電源をお切りください'
const PRESET_REF_TEXT_ONNANOKO2 =
  'お兄さんに会うことがモチベーションになってるんです。お兄さんに会うことがモチベーションになってるんです。'
const PRESET_REF_TEXT_ONNANOKO3 =
  'ちょっと難しそうだけど、頑張ってみよう。'
const PRESET_REF_TEXT_ONNANOKO4 =
  '付き合いたいなら100万円か。付き合いたいなら100万円か。'
const PRESET_REF_TEXT_ONNANOKO5 = '写真部として、美しい風景を撮りに行こうじゃないか。'
const PRESET_REF_TEXT_YANDERE = 'お兄さんって一人暮らし？お嫁さんや彼女とかいる？'
const PRESET_REF_TEXT_AEGI = 'だって…だってぇ～…ヒック'
const SOVITS_PRESETS: SoVitsPreset[] = [
  {
    id: 'onnanoko1',
    label: '女の子１',
    refAudioExt: '.mp3',
    refText: PRESET_REF_TEXT_PRIORITY_SEAT,
  },
  {
    id: 'onnanoko2',
    label: '女の子２',
    refAudioExt: '.wav',
    refText: PRESET_REF_TEXT_ONNANOKO2,
  },
  {
    id: 'onnanoko3',
    label: '女の子３',
    refAudioExt: '.wav',
    refText: PRESET_REF_TEXT_ONNANOKO3,
  },
  {
    id: 'onnanoko4',
    label: '女の子４',
    refAudioExt: '.wav',
    refText: PRESET_REF_TEXT_ONNANOKO4,
  },
  {
    id: 'onnanoko5',
    label: '低音女の子',
    refAudioExt: '.mp3',
    refText: PRESET_REF_TEXT_ONNANOKO5,
  },
  {
    id: 'yandere1',
    label: 'ヤンデレ',
    refAudioExt: '.mp3',
    refText: PRESET_REF_TEXT_YANDERE,
  },
  {
    id: 'aegi1',
    label: '喘ぎ声',
    refAudioExt: '.mp3',
    refText: PRESET_REF_TEXT_AEGI,
  },
]
const DEFAULT_SOVITS_PRESET_ID = SOVITS_PRESETS[0]?.id ?? ''
const VIDEO_INPUT_ID = 'lipsync-video-file'
const AUDIO_INPUT_ID = 'lipsync-audio-file'
const REF_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.m4v'])

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const resolveRequiredTickets = (text: string) => {
  const length = String(text ?? '').trim().length
  return length >= LIPSYNC_LONG_TEXT_THRESHOLD ? LIPSYNC_LONG_TEXT_REQUIRED_TICKETS : LIPSYNC_BASE_REQUIRED_TICKETS
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read file.'))
    reader.readAsDataURL(file)
  })

const stripDataUrl = (value: string) => {
  const comma = value.indexOf(',')
  if (value.startsWith('data:') && comma !== -1) return value.slice(comma + 1)
  return value
}

const normalizeAudioExt = (value: unknown, fallback = '.wav') => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return fallback
  const withDot = raw.startsWith('.') ? raw : `.${raw}`
  if (!/^\.[a-z0-9]{1,8}$/.test(withDot)) return fallback
  return withDot
}

const inferAudioExtFromFile = (file: File) => {
  const lowerName = String(file.name || '').toLowerCase()
  if (lowerName.endsWith('.wav')) return '.wav'
  if (lowerName.endsWith('.mp3')) return '.mp3'
  if (lowerName.endsWith('.m4a')) return '.m4a'
  if (lowerName.endsWith('.aac')) return '.aac'
  if (lowerName.endsWith('.ogg')) return '.ogg'
  if (lowerName.endsWith('.flac')) return '.flac'

  const type = String(file.type || '').toLowerCase()
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3'
  if (type.includes('wav')) return '.wav'
  if (type.includes('aac')) return '.aac'
  if (type.includes('ogg')) return '.ogg'
  if (type.includes('flac')) return '.flac'
  if (type.includes('mp4')) return '.m4a'
  return '.wav'
}

const getFileExt = (name: string, fallback: string) => {
  const trimmed = String(name || '').trim().toLowerCase()
  if (!trimmed.includes('.')) return fallback
  const ext = trimmed.slice(trimmed.lastIndexOf('.'))
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return fallback
  return ext
}

const getFileBaseName = (name: string, fallback: string) => {
  const trimmed = String(name || '').trim()
  if (!trimmed) return fallback
  const base = trimmed.replace(/\.[^.]+$/, '').trim()
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || fallback
}

const isVideoReferenceFile = (file: File) => {
  const mime = String(file.type || '').toLowerCase()
  if (mime.startsWith('video/')) return true
  return REF_VIDEO_EXTENSIONS.has(getFileExt(file.name, '').toLowerCase())
}

const getAudioContext = () => {
  const Ctor = window.AudioContext || (window as any).webkitAudioContext
  if (!Ctor) {
    throw new Error('Web Audio API is not supported in this browser.')
  }
  return new Ctor()
}

const arrayBufferToBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

const audioBufferToWav = (audioBuffer: AudioBuffer) => {
  const numberOfChannels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const bytesPerSample = 2
  const blockAlign = numberOfChannels * bytesPerSample
  const dataLength = audioBuffer.length * blockAlign
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let i = 0; i < audioBuffer.length; i += 1) {
    for (let ch = 0; ch < numberOfChannels; ch += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]))
      const pcm = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff)
      view.setInt16(offset, pcm, true)
      offset += 2
    }
  }

  return buffer
}

const getBlobAudioDurationSeconds = async (blob: Blob) => {
  const audioContext = getAudioContext()
  try {
    const srcArrayBuffer = await blob.arrayBuffer()
    const decoded = await audioContext.decodeAudioData(srcArrayBuffer.slice(0))
    const duration = Number(decoded.duration)
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Failed to decode audio duration.')
    }
    return duration
  } finally {
    try {
      await audioContext.close()
    } catch {
      // ignore close errors
    }
  }
}

const trimLongSilenceFromGeneratedAudio = async (
  blob: Blob,
  options?: { minSilenceSeconds?: number; silenceThreshold?: number; keepPaddingSeconds?: number },
) => {
  const audioContext = getAudioContext()
  try {
    const srcArrayBuffer = await blob.arrayBuffer()
    const decoded = await audioContext.decodeAudioData(srcArrayBuffer.slice(0))
    const sampleRate = decoded.sampleRate
    const totalSamples = decoded.length
    const originalSeconds = Number(decoded.duration)
    if (!Number.isFinite(originalSeconds) || originalSeconds <= 0 || totalSamples <= 0) {
      return {
        blob,
        trimmed: false,
        originalSeconds: 0,
        outputSeconds: 0,
        removedSeconds: 0,
      }
    }

    const minSilenceSeconds = Math.max(0.1, Number(options?.minSilenceSeconds ?? AUTO_TRIM_GENERATED_AUDIO_MIN_SILENCE_SECONDS))
    const silenceThreshold = Math.max(0.0001, Number(options?.silenceThreshold ?? AUTO_TRIM_GENERATED_AUDIO_SILENCE_THRESHOLD))
    const keepPaddingSeconds = Math.max(0, Number(options?.keepPaddingSeconds ?? AUTO_TRIM_GENERATED_AUDIO_PADDING_SECONDS))
    const minSilenceSamples = Math.max(1, Math.floor(minSilenceSeconds * sampleRate))
    const keepPaddingSamples = Math.max(0, Math.floor(keepPaddingSeconds * sampleRate))

    const channels: Float32Array[] = []
    for (let ch = 0; ch < decoded.numberOfChannels; ch += 1) {
      channels.push(decoded.getChannelData(ch))
    }
    if (!channels.length) {
      return {
        blob,
        trimmed: false,
        originalSeconds,
        outputSeconds: originalSeconds,
        removedSeconds: 0,
      }
    }

    const intervals: Array<[number, number]> = []
    let start = -1
    for (let i = 0; i < totalSamples; i += 1) {
      let amplitude = 0
      for (let ch = 0; ch < channels.length; ch += 1) {
        const sample = Math.abs(channels[ch][i] || 0)
        if (sample > amplitude) amplitude = sample
      }
      const audible = amplitude >= silenceThreshold
      if (audible) {
        if (start === -1) start = i
      } else if (start !== -1) {
        intervals.push([start, i])
        start = -1
      }
    }
    if (start !== -1) intervals.push([start, totalSamples])

    if (!intervals.length) {
      return {
        blob,
        trimmed: false,
        originalSeconds,
        outputSeconds: originalSeconds,
        removedSeconds: 0,
      }
    }

    const padded: Array<[number, number]> = []
    for (const [rawStart, rawEnd] of intervals) {
      const nextStart = Math.max(0, rawStart - keepPaddingSamples)
      const nextEnd = Math.min(totalSamples, rawEnd + keepPaddingSamples)
      const last = padded[padded.length - 1]
      if (!last || nextStart > last[1]) {
        padded.push([nextStart, nextEnd])
      } else if (nextEnd > last[1]) {
        last[1] = nextEnd
      }
    }

    const keepRanges: Array<[number, number]> = []
    let removedSamples = 0
    let cursor = 0
    for (const [rangeStart, rangeEnd] of padded) {
      if (rangeStart > cursor) {
        const silenceLen = rangeStart - cursor
        if (silenceLen >= minSilenceSamples) {
          removedSamples += silenceLen
        } else {
          keepRanges.push([cursor, rangeStart])
        }
      }
      keepRanges.push([rangeStart, rangeEnd])
      cursor = rangeEnd
    }
    if (cursor < totalSamples) {
      const tailSilenceLen = totalSamples - cursor
      if (tailSilenceLen >= minSilenceSamples) {
        removedSamples += tailSilenceLen
      } else {
        keepRanges.push([cursor, totalSamples])
      }
    }

    if (removedSamples <= 0 || !keepRanges.length) {
      return {
        blob,
        trimmed: false,
        originalSeconds,
        outputSeconds: originalSeconds,
        removedSeconds: 0,
      }
    }

    let keptSamples = 0
    for (const [rangeStart, rangeEnd] of keepRanges) {
      keptSamples += Math.max(0, rangeEnd - rangeStart)
    }
    if (keptSamples <= 0 || keptSamples >= totalSamples) {
      return {
        blob,
        trimmed: false,
        originalSeconds,
        outputSeconds: originalSeconds,
        removedSeconds: 0,
      }
    }

    const outputBuffer = audioContext.createBuffer(decoded.numberOfChannels, keptSamples, sampleRate)
    for (let ch = 0; ch < decoded.numberOfChannels; ch += 1) {
      const source = decoded.getChannelData(ch)
      const target = outputBuffer.getChannelData(ch)
      let offset = 0
      for (const [rangeStart, rangeEnd] of keepRanges) {
        const chunk = source.subarray(rangeStart, rangeEnd)
        target.set(chunk, offset)
        offset += chunk.length
      }
    }

    const wavBuffer = audioBufferToWav(outputBuffer)
    const trimmedBlob = new Blob([wavBuffer], { type: 'audio/wav' })
    const removedSeconds = removedSamples / sampleRate
    return {
      blob: trimmedBlob,
      trimmed: true,
      originalSeconds,
      outputSeconds: outputBuffer.duration,
      removedSeconds,
    }
  } finally {
    try {
      await audioContext.close()
    } catch {
      // ignore close errors
    }
  }
}

const prepareReferenceAudioForTts = async (blob: Blob) => {
  const audioContext = getAudioContext()
  try {
    const srcArrayBuffer = await blob.arrayBuffer()
    const decoded = await audioContext.decodeAudioData(srcArrayBuffer.slice(0))
    const durationSeconds = Number(decoded.duration)
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('Failed to decode reference audio.')
    }
    const wavBuffer = audioBufferToWav(decoded)
    return {
      base64: arrayBufferToBase64(wavBuffer),
      ext: '.wav',
      durationSeconds,
    }
  } finally {
    try {
      await audioContext.close()
    } catch {
      // ignore close errors
    }
  }
}

const pickAudioMimeFromExt = (ext: string) => {
  const normalized = normalizeAudioExt(ext, '.wav')
  if (normalized === '.mp3') return 'audio/mpeg'
  if (normalized === '.m4a' || normalized === '.aac') return 'audio/mp4'
  if (normalized === '.ogg') return 'audio/ogg'
  if (normalized === '.flac') return 'audio/flac'
  return 'audio/wav'
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

const extractErrorMessage = (payload: any) =>
  payload?.error ||
  payload?.message ||
  payload?.output?.error ||
  payload?.result?.error ||
  payload?.output?.output?.error ||
  payload?.result?.output?.error

const extractJobId = (payload: any) =>
  payload?.id || payload?.jobId || payload?.job_id || payload?.output?.id

const extractUsageId = (payload: any) =>
  payload?.usage_id || payload?.usageId || payload?.output?.usage_id || payload?.result?.usage_id

const isFailureStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('cancel')
}

const isSuccessStatus = (status: string) => {
  const normalized = status.toLowerCase()
  return normalized.includes('complete') || normalized.includes('success') || normalized.includes('finished')
}

const GENERIC_RETRY_MESSAGE = 'エラーです。やり直してください。'

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
    const nested = pickNestedMessage(parsed)
    return nested || ''
  } catch {
    return ''
  }
}

const shouldMaskTechnicalError = (value: string) => {
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
    lowered.includes('serverless') ||
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

const rewriteUiMessage = (value: string) => {
  const text = String(value || '').trim()
  if (!text) return GENERIC_RETRY_MESSAGE

  const normalized = text
    .replace(/gpt[-_ ]?sovits/gi, '音声生成')
    .replace(/wav2lip/gi, '動画生成')
    .replace(/sovits/gi, '音声生成')
    .replace(/\bTTS\b/gi, '音声生成')
    .replace(/LipSync/gi, '動画生成')
    .replace(/RunPod/gi, 'サーバー')
    .replace(/codeformer/gi, '補正処理')
    .replace(/gfpgan/gi, '補正処理')
    .replace(/restoreformer/gi, '補正処理')
    .replace(/gpen/gi, '補正処理')
    .replace(/onnx/gi, '推論処理')

  const exactMap: Record<string, string> = {
    'Request failed.': 'リクエストに失敗しました。',
    'Invalid request body.': 'リクエスト形式が不正です。',
    'Invalid input.': '入力内容が不正です。',
    'id is required.': 'ジョブIDが必要です。',
    'Failed to poll TTS status.': '音声生成の進捗確認に失敗しました。',
    'TTS generation failed.': '音声生成に失敗しました。',
    'TTS completed but no audio was returned.': '音声生成は完了しましたが、音声データを受け取れませんでした。',
    'Timed out while waiting for TTS generation.': '音声生成がタイムアウトしました。',
    'Failed to poll LipSync status.': '動画生成の進捗確認に失敗しました。',
    'LipSync generation failed.': '動画生成に失敗しました。',
    'LipSync completed but no video was returned.': '動画生成は完了しましたが、動画データを受け取れませんでした。',
    'Timed out while waiting for LipSync generation.': '動画生成がタイムアウトしました。',
    'Job id was not returned by API.': 'ジョブIDの取得に失敗しました。',
    'Failed to get generated audio from TTS.': '生成音声の取得に失敗しました。',
    'LipSync submission failed.': '動画生成ジョブの送信に失敗しました。',
    'No video output was returned.': '生成動画の取得に失敗しました。',
    'Reference audio is outside the 3-10 second range, please choose another one!': '参考音声の長さは3〜10秒にしてください。',
    'Authentication is required.': 'ログインが必要です。',
    'Authentication failed.': '認証に失敗しました。',
    'Googleログインのみ利用できます。': 'この機能はGoogleログインのみ利用できます。',
    'No tickets remaining.': 'トークンが不足しています。',
    'No tickets available.': 'トークン情報の取得に失敗しました。',
    'Please sign in first.': '先にログインしてください。',
    'Please select a source video.': '素材動画を選択してください。',
    'Please enter dialogue text.': 'セリフを入力してください。',
    'Preparing uploaded reference audio...': 'アップロード音声を準備中...',
    'Loading preset reference audio...': 'プリセット音声を読み込み中...',
    'Failed to fetch preset reference audio.': 'プリセット参考音声の取得に失敗しました。',
    'RunPod status check failed.': 'ステータス確認に失敗しました。',
    'Failed to fetch': '通信に失敗しました。時間をおいて再度お試しください。',
    'NetworkError when attempting to fetch resource.': '通信に失敗しました。時間をおいて再度お試しください。',
    'Load failed': '通信に失敗しました。時間をおいて再度お試しください。',
    'no healthy upstream': 'サーバーが混み合っています。時間をおいて再度お試しください。',
    'Service Temporarily Unavailable': 'サーバーが混み合っています。時間をおいて再度お試しください。',
    'text is required.': 'セリフを入力してください。',
    'ref_text is required.': '参考音声の文字起こしテキストを入力してください。',
    'Lipsync stage requires a valid tts_usage_id.': 'Please start from TTS generation in the same session.',
    'text is too long. Max 30 characters.': 'セリフは30文字以内にしてください。',
    'text is too long. Max 100 characters.': 'セリフは100文字以内にしてください。',
    'ref_audio is too long. Max 20 seconds.': '参考音声は20秒以内にしてください。',
    'ref_audio is too large.': '参考音声ファイルが大きすぎます。',
    'audio is too large.': '音声ファイルが大きすぎます。',
    'video is too large.': '動画ファイルが大きすぎます。',
    'audio_url must be a public https URL.': '音声URLの形式が不正です。',
    'video_url must be a public https URL.': '動画URLの形式が不正です。',
    'ref_audio_url must be a public https URL.': '参考音声URLの形式が不正です。',
    'Input exceeds RunPod 10MiB limit. Configure MEDIA_BUCKET binding (or R2_* env vars), or use a shorter video.':
      '入力データが大きすぎます。動画または音声を短くして再度お試しください。',
    'RunPod payload exceeded 10MiB. Configure MEDIA_BUCKET binding (or R2_* env vars) so video is sent via R2 URL.':
      '入力データが大きすぎます。動画または音声を短くして再度お試しください。',
    'Submitting voice clone (custom reference)...': '音声生成を開始しています...',
    'Submitting voice clone (preset)...': '音声生成を開始しています...',
    'Waiting for TTS output...': '音声生成中...',
    'Submitting LipSync job...': '動画生成を開始しています...',
    'Waiting for LipSync output...': '動画生成中...',
    'Done.': '生成が完了しました。',
    Ready: '59文字以下は2枚、60文字以上は3枚消費です',
  }

  return exactMap[normalized] || normalized
}

const normalizeErrorMessage = (value: unknown) => {
  if (!value) return GENERIC_RETRY_MESSAGE

  let raw = ''
  if (typeof value === 'object') {
    const nested = pickNestedMessage(value)
    if (nested) raw = nested
    else {
      const maybe = value as { error?: unknown; message?: unknown; detail?: unknown }
      const picked = maybe.error ?? maybe.message ?? maybe.detail
      if (typeof picked === 'string' && picked) raw = picked
      else if (value instanceof Error && value.message) raw = value.message
      else raw = String(value)
    }
  } else {
    raw = typeof value === 'string' ? value : value instanceof Error ? value.message : String(value)
  }

  let text = String(raw || '').trim()
  if (!text || text === '[object Object]') return GENERIC_RETRY_MESSAGE
  const extracted = tryExtractMessageFromJson(text)
  if (extracted) {
    text = extracted.trim()
  }

  const rewritten = rewriteUiMessage(text).trim()
  if (!rewritten) return GENERIC_RETRY_MESSAGE
  if (shouldMaskTechnicalError(text) || shouldMaskTechnicalError(rewritten) || rewritten.length > 300) {
    return GENERIC_RETRY_MESSAGE
  }
  return rewritten
}

const isTtsTooLongError = (value: string) =>
  value.includes(TTS_TOO_LONG_POPUP_MESSAGE) ||
  value.toLowerCase().includes('generated audio is too long')

const dataUrlToAudio = (value: string): GeneratedAudio | null => {
  const match = value.match(/^data:audio\/([^;]+);base64,(.*)$/i)
  if (!match) return null
  const subtype = String(match[1] || '').toLowerCase()
  const extMap: Record<string, string> = {
    wav: '.wav',
    'x-wav': '.wav',
    wave: '.wav',
    mp3: '.mp3',
    mpeg: '.mp3',
    ogg: '.ogg',
    flac: '.flac',
    aac: '.aac',
    xm4a: '.m4a',
    mp4: '.m4a',
  }
  return {
    base64: match[2] || '',
    ext: normalizeAudioExt(extMap[subtype] || '.wav'),
  }
}

const extractGeneratedAudio = (payload: any): GeneratedAudio | null => {
  const output = payload?.output ?? payload?.result ?? payload
  const nested = output?.output ?? output?.result ?? output?.data ?? payload?.output?.output ?? payload?.result?.output
  const filenameCandidates = [
    output?.filename,
    output?.audio_filename,
    nested?.filename,
    nested?.audio_filename,
    payload?.filename,
    payload?.audio_filename,
  ]

  const pickExt = () => {
    const file = filenameCandidates.find((item) => typeof item === 'string' && item.trim()) as string | undefined
    if (!file) return '.wav'
    const ext = file.split('.').pop() || ''
    return normalizeAudioExt(ext ? `.${ext}` : '.wav')
  }

  const candidates = [
    output?.data,
    output?.audio,
    output?.audio_base64,
    output?.output_base64,
    payload?.data,
    payload?.audio,
    payload?.audio_base64,
    payload?.output_base64,
    nested?.data,
    nested?.audio,
    nested?.audio_base64,
    nested?.output_base64,
  ]

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    const raw = candidate.trim()
    if (raw.startsWith('http')) continue
    if (raw.startsWith('data:')) {
      const converted = dataUrlToAudio(raw)
      if (converted && converted.base64) return converted
      continue
    }
    const stripped = stripDataUrl(raw)
    if (stripped) {
      return { base64: stripped, ext: pickExt() }
    }
  }

  return null
}

const extractVideoList = (payload: any) => {
  const output = payload?.output ?? payload?.result ?? payload
  const nested = output?.output ?? output?.result ?? output?.data ?? payload?.output?.output ?? payload?.result?.output

  const listCandidates = [
    output?.videos,
    output?.outputs,
    output?.data,
    output?.gifs,
    payload?.videos,
    payload?.outputs,
    payload?.data,
    payload?.gifs,
    nested?.videos,
    nested?.outputs,
    nested?.data,
    nested?.gifs,
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

export function LipSync() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [customAudioFile, setCustomAudioFile] = useState<File | null>(null)
  const [customAudioSourceFile, setCustomAudioSourceFile] = useState<File | null>(null)
  const [isPreparingCustomAudio, setIsPreparingCustomAudio] = useState(false)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [videoPreview, setVideoPreview] = useState('')
  const [dialogue, setDialogue] = useState('')
  const [referenceTranscript, setReferenceTranscript] = useState('')
  const [sovitsPresetId, setSovitsPresetId] = useState(DEFAULT_SOVITS_PRESET_ID)
  const [sovitsSpeechRate, setSovitsSpeechRate] = useState(DEFAULT_SOVITS_SPEECH_RATE)
  const [emotionParameter, setEmotionParameter] = useState(DEFAULT_SOVITS_TEMPERATURE)
  const [w2lBlending, setW2lBlending] = useState(DEFAULT_W2L_BLENDING)
  const [keepOriginalAudio, setKeepOriginalAudio] = useState(true)
  const [generatedAudioMixVolume, setGeneratedAudioMixVolume] = useState(DEFAULT_GENERATED_AUDIO_MIX_VOLUME)
  const [originalAudioMixVolume, setOriginalAudioMixVolume] = useState(DEFAULT_ORIGINAL_AUDIO_MIX_VOLUME)
  const [isRunning, setIsRunning] = useState(false)
  const [progressStage, setProgressStage] = useState<ProgressStage>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
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
  const runIdRef = useRef(0)
  const customAudioInputRef = useRef<HTMLInputElement | null>(null)

  const accessToken = session?.access_token ?? ''
  const requiredTickets = resolveRequiredTickets(dialogue)
  const isTokenInsufficient = ticketCount !== null && ticketCount < requiredTickets
  const selectedSovitsPreset = SOVITS_PRESETS.find((preset) => preset.id === sovitsPresetId) ?? SOVITS_PRESETS[0]
  const maxDialogueLength = MAX_TEXT_LENGTH
  const customAudioPreviewFile = customAudioSourceFile ?? customAudioFile
  const customAudioPreviewName = customAudioPreviewFile?.name ?? ''
  const customAudioPreviewSizeMb = customAudioPreviewFile ? (customAudioPreviewFile.size / 1024 / 1024).toFixed(2) : ''
  const customAudioSourceIsVideo = Boolean(customAudioSourceFile && isVideoReferenceFile(customAudioSourceFile))
  const customAudioPreviewMeta = isPreparingCustomAudio
    ? '動画から参考音声を抽出中...'
    : customAudioPreviewFile
    ? customAudioSourceIsVideo
      ? `${customAudioPreviewSizeMb} MB / 生成時に音声抽出します`
      : `${customAudioPreviewSizeMb} MB / 参考音声として使用`
    : ''

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

  useEffect(() => {
    if (!videoFile) {
      setVideoPreview('')
      setVideoDuration(null)
      return
    }

    const url = URL.createObjectURL(videoFile)
    let cancelled = false
    setVideoPreview(url)

    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      if (cancelled) return
      const duration = Number(probe.duration)
      setVideoDuration(Number.isFinite(duration) && duration > 0 ? duration : null)
    }
    probe.onerror = () => {
      if (cancelled) return
      setVideoDuration(null)
    }
    probe.src = url

    return () => {
      cancelled = true
      probe.src = ''
      URL.revokeObjectURL(url)
    }
  }, [videoFile])

  const convertReferenceMediaToAudioFile = useCallback(
    async (file: File) => {
      if (!isVideoReferenceFile(file)) return file

      const audioContext = getAudioContext()
      const outputExt = '.wav'
      const baseName = getFileBaseName(file.name, 'reference_audio')

      try {
        const srcArrayBuffer = await file.arrayBuffer()
        const decoded = await audioContext.decodeAudioData(srcArrayBuffer.slice(0))
        if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
          throw new Error('Failed to decode reference video audio.')
        }
        const wavBuffer = audioBufferToWav(decoded)
        return new File([wavBuffer], `${baseName}${outputExt}`, { type: 'audio/wav' })
      } finally {
        try {
          await audioContext.close()
        } catch {
          // ignore close errors
        }
      }
    },
    [],
  )

  const handleCustomAudioChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0] ?? null
      if (!selectedFile) {
        setCustomAudioFile(null)
        setCustomAudioSourceFile(null)
        setIsPreparingCustomAudio(false)
        return
      }

      setCustomAudioSourceFile(selectedFile)
      const selectedIsVideo = isVideoReferenceFile(selectedFile)
      setIsPreparingCustomAudio(false)
      const maxRefMb = selectedIsVideo ? MAX_REF_VIDEO_MB : MAX_REF_AUDIO_MB
      const fileSizeMb = selectedFile.size / (1024 * 1024)
      if (fileSizeMb > maxRefMb) {
        event.target.value = ''
        setCustomAudioFile(null)
        setCustomAudioSourceFile(null)
        setIsPreparingCustomAudio(false)
        setStatusMessage(`参考ファイルが大きすぎます（最大 ${maxRefMb}MB）。`)
        return
      }

      setCustomAudioFile(selectedIsVideo ? null : selectedFile)
      setErrorMessage(null)
      setStatusMessage('')
      return
    },
    [],
  )

  const handleClearCustomAudio = useCallback(() => {
    setCustomAudioFile(null)
    setCustomAudioSourceFile(null)
    setIsPreparingCustomAudio(false)
    if (customAudioInputRef.current) {
      customAudioInputRef.current.value = ''
    }
  }, [])

  const submitJob = useCallback(
    async (stage: 'tts' | 'lipsync', input: Record<string, unknown>, token: string): Promise<JobSubmitResult> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input: { ...input, stage } }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(normalizeErrorMessage(extractErrorMessage(data) || 'Request failed.'))
      }
      const usageId = String(extractUsageId(data) || '').trim() || undefined

      if (stage === 'tts') {
        const audio = extractGeneratedAudio(data)
        if (audio) return { audio, usageId }
      } else {
        const videos = extractVideoList(data)
        if (videos.length) return { video: videos[0], usageId }
      }

      const jobId = extractJobId(data)
      if (!jobId) {
        throw new Error('Job id was not returned by API.')
      }

      return { jobId: String(jobId), usageId }
    },
    [],
  )

  const pollTts = useCallback(
    async (jobId: string, token: string, runId: number, usageId?: string): Promise<PollResult> => {
      for (let i = 0; i < 360; i += 1) {
        if (runIdRef.current !== runId) {
          return { status: 'cancelled' }
        }

        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`

        const params = new URLSearchParams({
          stage: 'tts',
          id: jobId,
          usage_id: usageId || `lipsync:tts:${jobId}`,
        })
        const res = await fetch(`${API_ENDPOINT}?${params.toString()}`, { headers })
        const data = await res.json().catch(() => ({}))

        if (res.status === 524 || res.status === 522 || res.status === 504) {
          await wait(1200)
          continue
        }

        if (!res.ok) {
          throw new Error(normalizeErrorMessage(extractErrorMessage(data) || 'Failed to poll TTS status.'))
        }

        const status = String(data?.status || data?.state || '').toLowerCase()
        const statusError = extractErrorMessage(data)
        if (statusError || isFailureStatus(status)) {
          throw new Error(normalizeErrorMessage(statusError || 'TTS generation failed.'))
        }

        const audio = extractGeneratedAudio(data)
        if (audio) {
          return { status: 'done', value: audio }
        }

        if (isSuccessStatus(status)) {
          throw new Error('TTS completed but no audio was returned.')
        }

        await wait(1500)
      }

      throw new Error('Timed out while waiting for TTS generation.')
    },
    [],
  )

  const pollLipSync = useCallback(
    async (jobId: string, token: string, runId: number, usageId?: string): Promise<PollResult> => {
      for (let i = 0; i < 420; i += 1) {
        if (runIdRef.current !== runId) {
          return { status: 'cancelled' }
        }

        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`

        const params = new URLSearchParams({
          stage: 'lipsync',
          id: jobId,
          usage_id: usageId || `lipsync:lipsync:${jobId}`,
        })
        const res = await fetch(`${API_ENDPOINT}?${params.toString()}`, { headers })
        const data = await res.json().catch(() => ({}))

        if (res.status === 524 || res.status === 522 || res.status === 504) {
          await wait(1200)
          continue
        }

        if (!res.ok) {
          throw new Error(normalizeErrorMessage(extractErrorMessage(data) || 'Failed to poll LipSync status.'))
        }

        const status = String(data?.status || data?.state || '').toLowerCase()
        const statusError = extractErrorMessage(data)
        if (statusError || isFailureStatus(status)) {
          throw new Error(normalizeErrorMessage(statusError || 'LipSync generation failed.'))
        }

        const videos = extractVideoList(data)
        if (videos.length) {
          return { status: 'done', value: videos[0] }
        }

        if (isSuccessStatus(status)) {
          throw new Error('LipSync completed but no video was returned.')
        }

        await wait(1500)
      }

      throw new Error('Timed out while waiting for LipSync generation.')
    },
    [],
  )

  const handleGenerate = useCallback(async () => {
    if (isRunning) return
    if (!session || !accessToken) {
      setStatusMessage('先にログインしてください。')
      return
    }
    if (!videoFile) {
      setStatusMessage('素材動画を選択してください。')
      return
    }
    if (videoDuration !== null && videoDuration < MIN_VIDEO_SECONDS) {
      setStatusMessage(`動画は ${MIN_VIDEO_SECONDS} 秒以上にしてください。`)
      return
    }
    const sizeMb = videoFile.size / (1024 * 1024)
    if (sizeMb > MAX_VIDEO_MB) {
      setStatusMessage(`動画ファイルが大きすぎます（最大 ${MAX_VIDEO_MB}MB）。`)
      return
    }
    const useUploadedAudio = Boolean(customAudioSourceFile)
    const trimmedDialogue = dialogue.trim()
    const selectedPresetId = String(selectedSovitsPreset?.id || '').trim().toLowerCase()
    const presetReferenceTranscript = useUploadedAudio ? '' : String(selectedSovitsPreset?.refText || '').trim()
    const trimmedReferenceTranscript = useUploadedAudio ? referenceTranscript.trim() : presetReferenceTranscript
    if (!trimmedDialogue) {
      setStatusMessage('セリフを入力してください。')
      return
    }
    if (!trimmedReferenceTranscript) {
      setStatusMessage('参考音声の文字起こしテキストを入力してください。')
      return
    }
    if (dialogue.length > maxDialogueLength) {
      setStatusMessage(`セリフは ${maxDialogueLength} 文字以内にしてください。`)
      return
    }
    const requiredTicketCount = resolveRequiredTickets(trimmedDialogue)
    if (ticketCount !== null && ticketCount < requiredTicketCount) {
      setStatusMessage(`トークン不足です。生成には${requiredTicketCount}枚必要です。`)
      return
    }
    if (useUploadedAudio) {
      const sourceIsVideo = Boolean(customAudioSourceFile && isVideoReferenceFile(customAudioSourceFile))
      const maxRefMb = sourceIsVideo ? MAX_REF_VIDEO_MB : MAX_REF_AUDIO_MB
      const audioSizeMb = customAudioSourceFile ? customAudioSourceFile.size / (1024 * 1024) : 0
      if (audioSizeMb > maxRefMb) {
        setStatusMessage(`参考ファイルが大きすぎます（最大 ${maxRefMb}MB）。`)
        return
      }
    }
    if (!useUploadedAudio && !selectedSovitsPreset?.id) {
      setStatusMessage('音声プリセットが設定されていません。')
      return
    }

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    setIsRunning(true)
    setProgressStage('audio')
    setErrorMessage(null)
    setResultVideo(null)

    try {
      const sourceVideoData = await fileToDataUrl(videoFile)
      let referenceAudioBlob: Blob | null = null
      let referenceAudioName = 'ref_audio.wav'

      const ttsInput: Record<string, unknown> = {
        text: trimmedDialogue,
        auto_prompt_text: false,
        ref_text: trimmedReferenceTranscript,
        ref_audio_source: useUploadedAudio ? 'upload' : 'preset',
        preset_ref_id: useUploadedAudio ? undefined : selectedPresetId,
        temperature: Number(emotionParameter.toFixed(2)),
        speed_factor: Number(sovitsSpeechRate.toFixed(2)),
        fragment_interval: DEFAULT_SOVITS_FRAGMENT_INTERVAL,
      }
      if (useUploadedAudio && customAudioSourceFile) {
        let preparedCustomAudio = customAudioSourceFile
        if (isVideoReferenceFile(customAudioSourceFile)) {
          setIsPreparingCustomAudio(true)
          setStatusMessage('参考動画から音声を抽出中...')
          preparedCustomAudio = await convertReferenceMediaToAudioFile(customAudioSourceFile)
          setStatusMessage('動画から参考音声を抽出しました。')
        } else {
          setStatusMessage('アップロード音声を準備中...')
        }

        referenceAudioBlob = preparedCustomAudio
        const refExt = inferAudioExtFromFile(preparedCustomAudio)
        referenceAudioName = preparedCustomAudio.name || `custom_ref${refExt}`
        setCustomAudioFile(preparedCustomAudio)
      } else {
        if (!selectedPresetId) {
          throw new Error('音声プリセットが設定されていません。')
        }
        setStatusMessage('プリセット音声を使用します...')
      }

      if (referenceAudioBlob) {
        setStatusMessage('参考音声の長さを確認中...')
        const preparedRefAudio = await prepareReferenceAudioForTts(referenceAudioBlob)
        const referenceAudioDuration = Number(preparedRefAudio.durationSeconds.toFixed(3))
        if (referenceAudioDuration < MIN_REF_AUDIO_SECONDS || referenceAudioDuration > MAX_REF_AUDIO_SECONDS) {
          throw new Error(REF_AUDIO_DURATION_RANGE_ERROR)
        }
        ttsInput.ref_audio = preparedRefAudio.base64
        ttsInput.ref_audio_ext = preparedRefAudio.ext
        ttsInput.ref_audio_name = referenceAudioName.replace(/\.[^/.]+$/, '') + preparedRefAudio.ext
        ttsInput.ref_audio_duration_seconds = referenceAudioDuration
      }

      setStatusMessage('音声生成を開始しています...')
      const ttsSubmitted = await submitJob('tts', ttsInput, accessToken)
      if (runIdRef.current !== runId) return
      const ttsUsageId = String(ttsSubmitted.usageId || ('jobId' in ttsSubmitted ? `lipsync:tts:${ttsSubmitted.jobId}` : '')).trim()
      if (!ttsUsageId) {
        throw new Error('Failed to verify TTS usage id.')
      }

      let generatedAudio: GeneratedAudio | null = null
      if ('audio' in ttsSubmitted) {
        generatedAudio = ttsSubmitted.audio
      } else if ('jobId' in ttsSubmitted) {
        setStatusMessage('音声生成中...')
        const ttsPolled = await pollTts(ttsSubmitted.jobId, accessToken, runId, ttsSubmitted.usageId)
        if (ttsPolled.status === 'cancelled') return
        generatedAudio = ttsPolled.value as GeneratedAudio
      }

      if (!generatedAudio?.base64) {
        throw new Error('Failed to get generated audio from TTS.')
      }

      let generatedAudioBlob = base64ToBlob(
        generatedAudio.base64,
        pickAudioMimeFromExt(generatedAudio.ext),
      )
      let generatedAudioBase64 = generatedAudio.base64
      let generatedAudioExt = normalizeAudioExt(generatedAudio.ext, '.wav')

      let generatedAudioDuration = await getBlobAudioDurationSeconds(generatedAudioBlob)
      try {
        setStatusMessage('生成音声を調整中...')
        const trimmedAudio = await trimLongSilenceFromGeneratedAudio(generatedAudioBlob, {
          minSilenceSeconds: AUTO_TRIM_GENERATED_AUDIO_MIN_SILENCE_SECONDS,
          silenceThreshold: AUTO_TRIM_GENERATED_AUDIO_SILENCE_THRESHOLD,
          keepPaddingSeconds: AUTO_TRIM_GENERATED_AUDIO_PADDING_SECONDS,
        })
        generatedAudioDuration = Number(trimmedAudio.outputSeconds.toFixed(3))
        if (trimmedAudio.trimmed) {
          generatedAudioBlob = trimmedAudio.blob
          generatedAudioExt = '.wav'
          const trimmedArrayBuffer = await generatedAudioBlob.arrayBuffer()
          generatedAudioBase64 = arrayBufferToBase64(trimmedArrayBuffer)
          setStatusMessage(
            `生成音声の無音区間を調整しました（${trimmedAudio.originalSeconds.toFixed(2)}秒 -> ${trimmedAudio.outputSeconds.toFixed(2)}秒）。`,
          )
        }
      } catch {
        generatedAudioDuration = await getBlobAudioDurationSeconds(generatedAudioBlob)
      }

      if (generatedAudioDuration >= MAX_TTS_AUDIO_SECONDS) {
        window.alert(TTS_TOO_LONG_POPUP_MESSAGE)
        setStatusMessage(TTS_TOO_LONG_POPUP_MESSAGE)
        setErrorMessage(TTS_TOO_LONG_POPUP_MESSAGE)
        return
      }

      setStatusMessage('動画生成を開始しています...')
      setProgressStage('video')
      const lipSyncSubmitted = await submitJob(
        'lipsync',
          {
            video: sourceVideoData,
            video_name: videoFile.name || 'input.mp4',
            dialogue_length: trimmedDialogue.length,
            audio: generatedAudioBase64,
            audio_ext: generatedAudioExt,
            audio_duration_seconds: Number(generatedAudioDuration.toFixed(3)),
            tts_usage_id: ttsUsageId,
          blending: w2lBlending,
          denoise: false,
          face_occluder: true,
          face_mask: true,
          pads: DEFAULT_PADS,
          face_mode: DEFAULT_FACE_MODE,
          resize_factor: DEFAULT_RESIZE_FACTOR,
          target_face_index: DEFAULT_TARGET_FACE_INDEX,
          face_id_threshold: DEFAULT_FACE_ID_THRESHOLD,
          keep_original_audio: keepOriginalAudio,
          generated_audio_mix_volume: Number(generatedAudioMixVolume.toFixed(2)),
          original_audio_mix_volume: Number(originalAudioMixVolume.toFixed(2)),
        },
        accessToken,
      )
      if (runIdRef.current !== runId) return

      if ('video' in lipSyncSubmitted) {
        setResultVideo(lipSyncSubmitted.video)
        setStatusMessage('生成が完了しました。')
        return
      }

      if (!('jobId' in lipSyncSubmitted)) {
        throw new Error('LipSync submission failed.')
      }

      setStatusMessage('動画生成中...')
      const lipSyncPolled = await pollLipSync(
        lipSyncSubmitted.jobId,
        accessToken,
        runId,
        lipSyncSubmitted.usageId,
      )
      if (lipSyncPolled.status === 'cancelled') return

      const finalVideo = String(lipSyncPolled.value || '')
      if (!finalVideo) {
        throw new Error('No video output was returned.')
      }

      setResultVideo(finalVideo)
      setStatusMessage('生成が完了しました。')
    } catch (error) {
      const message = normalizeErrorMessage(error)
      if (isTtsTooLongError(message)) {
        window.alert(TTS_TOO_LONG_POPUP_MESSAGE)
      }
      setStatusMessage(message)
      setErrorMessage(message)
    } finally {
      setIsPreparingCustomAudio(false)
      if (runIdRef.current === runId) {
        setIsRunning(false)
        setProgressStage('idle')
        if (accessToken) {
          void fetchTickets(accessToken)
        }
      }
    }
  }, [
    accessToken,
    dialogue,
    maxDialogueLength,
    referenceTranscript,
    isRunning,
    pollLipSync,
    pollTts,
    selectedSovitsPreset,
    sovitsSpeechRate,
    emotionParameter,
    w2lBlending,
    keepOriginalAudio,
    generatedAudioMixVolume,
    originalAudioMixVolume,
    ticketCount,
    session,
    submitJob,
    fetchTickets,
    customAudioSourceFile,
    convertReferenceMediaToAudioFile,
    videoDuration,
    videoFile,
  ])

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
    const filename = 'lipsync-result.mp4'
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
  }, [resultVideo])

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

  if (!authReady) {
    return <div className='lipsync-shell lipsync-shell--loading' />
  }

  if (!session) {
    return (
      <div className='lipsync-shell lipsync-shell--guest'>
        <GuestIntro mode='video' onSignIn={handleGoogleSignIn} />
      </div>
    )
  }

  return (
    <div className='lipsync-shell'>
      <header className='lipsync-top'>
        <div className='lipsync-top__title'>
          <p>リップシンク生成</p>
          <h1>動画と音声から自然な口パク動画を生成</h1>
        </div>
        <button
          type='button'
          className={'lipsync-menu-toggle' + (isMobileMenuOpen ? ' is-open' : '')}
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-expanded={isMobileMenuOpen}
          aria-label='メニューを開閉'
        >
          <span />
          <span />
          <span />
        </button>
        <div className={'lipsync-top__actions' + (isMobileMenuOpen ? ' is-open' : '')}>
          <a href='/video' className='lipsync-link' onClick={() => setIsMobileMenuOpen(false)}>Video</a>
          <a href='/video?mode=edit' className='lipsync-link' onClick={() => setIsMobileMenuOpen(false)}>Edit</a>
          <a href='/lipsync' className='lipsync-link is-active' onClick={() => setIsMobileMenuOpen(false)}>LipSync</a>
          <a href={SHOP_URL} className='lipsync-link' target='_blank' rel='noopener noreferrer' onClick={() => setIsMobileMenuOpen(false)}>ショップ</a>
          <a href='https://civitai.uk/' className='lipsync-link' target='_blank' rel='noopener noreferrer' onClick={() => setIsMobileMenuOpen(false)}>プロンプト一覧</a>
          <button type='button' className='lipsync-ghost' onClick={handleSignOut}>ログアウト</button>
        </div>
        <button
          type='button'
          className={'lipsync-menu-backdrop' + (isMobileMenuOpen ? ' is-open' : '')}
          onClick={() => setIsMobileMenuOpen(false)}
          aria-label='メニューを閉じる'
        />
      </header>

      <section className='lipsync-account-row'>
        <div className='lipsync-account-user'>
          <strong>{session.user?.email ?? 'ログイン中'}</strong>
          <span>ログイン中</span>
        </div>
        <div className='lipsync-account-side'>
          <div className={`lipsync-account-coins ${ticketStatus === 'error' ? 'is-error' : ''}`}>
            {ticketStatus === 'loading' && 'トークン確認中...'}
            {ticketStatus !== 'loading' && `保有トークン数 ${ticketCount ?? 0}枚`}
            {ticketStatus === 'error' && ticketMessage ? ` / ${ticketMessage}` : ''}
          </div>
          <div className='lipsync-bonus'>
            <button
              type='button'
              className='lipsync-bonus-button'
              onClick={handleClaimDailyBonus}
              disabled={bonusClaiming || bonusStatus === 'loading' || !bonusCanClaim}
            >
              {bonusClaiming ? '受け取り中...' : 'ログインボーナス'}
            </button>
            <small className='lipsync-bonus-hint'>
              {bonusStatus === 'loading' && '状態確認中...'}
              {bonusStatus !== 'loading' && bonusCanClaim && '24時間に1回受け取れます（受け取り可能）'}
              {bonusStatus !== 'loading' && !bonusCanClaim && bonusNextEligibleAt && formatTimeUntilClaim(bonusNextEligibleAt)}
              {bonusStatus !== 'loading' && !bonusCanClaim && !bonusNextEligibleAt && '24時間に1回受け取れます'}
            </small>
            {bonusMessage && <small className='lipsync-bonus-msg'>{bonusMessage}</small>}
          </div>
        </div>
      </section>

      <main className='lipsync-grid'>
        <section className='lipsync-card'>
          <h2>入力設定</h2>

          <div className='lipsync-field'>
            <span>素材動画</span>
            <input
              id={VIDEO_INPUT_ID}
              className='lipsync-file__native'
              type='file'
              accept='video/mp4,video/webm,video/quicktime,video/x-matroska'
              onChange={(event) => setVideoFile(event.target.files?.[0] ?? null)}
              disabled={isRunning}
            />
            <label
              htmlFor={VIDEO_INPUT_ID}
              className={`lipsync-file-picker ${videoFile ? 'is-selected' : ''} ${isRunning ? 'is-disabled' : ''}`.trim()}
            >
              <span className='lipsync-file-picker__badge'>動画</span>
              <span className='lipsync-file-picker__title'>{videoFile ? '動画を変更' : '動画を選択'}</span>
              <span className='lipsync-file-picker__meta'>MP4 / WEBM / MOV / MKV</span>
            </label>
            <small>
              {videoFile
                ? `${videoFile.name} (${(videoFile.size / 1024 / 1024).toFixed(2)} MB)${
                    videoDuration !== null ? ` / ${videoDuration.toFixed(2)}秒` : ''
                  }`
                : `最大 ${MAX_VIDEO_MB}MB / 最短 ${MIN_VIDEO_SECONDS}秒`}
            </small>
          </div>

          <div className='lipsync-field'>
            <span>参考音声（設定するとプリセットは使用されません）</span>
            <input
              id={AUDIO_INPUT_ID}
              ref={customAudioInputRef}
              className='lipsync-file__native'
              type='file'
              accept='audio/*,video/mp4,video/webm,video/quicktime,video/x-matroska,.wav,.mp3,.m4a,.aac,.ogg,.flac,.mp4,.webm,.mov,.mkv'
              onChange={handleCustomAudioChange}
              disabled={isRunning}
            />
            <label
              htmlFor={AUDIO_INPUT_ID}
              className={`lipsync-file-picker ${customAudioPreviewFile ? 'is-selected' : ''} ${isRunning ? 'is-disabled' : ''}`.trim()}
            >
              <span className='lipsync-file-picker__badge'>音声/動画</span>
              <span className='lipsync-file-picker__title'>
                {customAudioPreviewFile ? 'ファイルを変更' : 'ファイルを選択'}
              </span>
              <span className='lipsync-file-picker__meta'>WAV / MP3 / M4A / AAC / OGG / FLAC / MP4 / WEBM / MOV / MKV</span>
            </label>
            {customAudioPreviewFile && (
              <div className='lipsync-ref-preview'>
                <button
                  type='button'
                  className='lipsync-ref-preview__remove'
                  onClick={handleClearCustomAudio}
                  aria-label='参考音声を削除'
                >
                  ×
                </button>
                <span className='lipsync-ref-preview__icon' aria-hidden='true'>
                  ♪
                </span>
                <div className='lipsync-ref-preview__body'>
                  <strong className='lipsync-ref-preview__name'>{customAudioPreviewName}</strong>
                  <small className='lipsync-ref-preview__meta'>{customAudioPreviewMeta}</small>
                </div>
              </div>
            )}
          </div>

          {customAudioSourceFile ? (
            <label className='lipsync-field'>
              <span>参考音声の文字起こし（必須）</span>
              <textarea
                rows={3}
                value={referenceTranscript}
                onChange={(event) => setReferenceTranscript(event.target.value)}
                placeholder='参考音声で実際に話している内容をそのまま入力してください'
                disabled={isRunning}
              />
              <small>空欄では生成できません。</small>
            </label>
          ) : (
            <div className='lipsync-field'>
              <span>参考音声の文字起こし</span>
              <small>
                {selectedSovitsPreset?.label
                  ? `プリセット「${selectedSovitsPreset.label}」が選択されています。参考テキストは内部で自動設定されます。`
                  : 'プリセットが未選択です。'}
              </small>
            </div>
          )}

          {videoPreview && (
            <div className='lipsync-preview'>
              <video src={videoPreview} controls muted playsInline preload='metadata' />
            </div>
          )}

          <label className='lipsync-field'>
            <span>音声プリセット</span>
            <select
              value={sovitsPresetId}
              onChange={(event) => setSovitsPresetId(event.target.value)}
              disabled={isRunning}
            >
              {SOVITS_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
            <small>
              {customAudioSourceFile
                ? '参考音声をアップロード済みのため、プリセットは使用しません。'
                : selectedSovitsPreset?.label
                ? `現在のプリセット: ${selectedSovitsPreset.label}`
                : 'プリセットが未選択です。'}
            </small>
          </label>

          <label className='lipsync-field'>
            <span>話速</span>
            <input
              type='range'
              min={MIN_SOVITS_SPEECH_RATE}
              max={MAX_SOVITS_SPEECH_RATE}
              step={SOVITS_SPEECH_RATE_STEP}
              value={sovitsSpeechRate}
              onChange={(event) =>
                setSovitsSpeechRate(
                  Math.max(
                    MIN_SOVITS_SPEECH_RATE,
                    Math.min(MAX_SOVITS_SPEECH_RATE, Number(event.target.value) || DEFAULT_SOVITS_SPEECH_RATE),
                  ),
                )
              }
              disabled={isRunning}
            />
            <small>{`x${sovitsSpeechRate.toFixed(2)}（1.00-2.00）`}</small>
          </label>

          <label className='lipsync-field'>
            <span>感情パラメータ</span>
            <input
              type='range'
              min={MIN_SOVITS_TEMPERATURE}
              max={MAX_SOVITS_TEMPERATURE}
              step={SOVITS_TEMPERATURE_STEP}
              value={emotionParameter}
              onChange={(event) =>
                setEmotionParameter(
                  Math.max(
                    MIN_SOVITS_TEMPERATURE,
                    Math.min(MAX_SOVITS_TEMPERATURE, Number(event.target.value) || DEFAULT_SOVITS_TEMPERATURE),
                  ),
                )
              }
              disabled={isRunning}
            />
            <small>{`${emotionParameter.toFixed(2)}（1.00-2.00）`}</small>
            <small>数値が小さいと安定するが棒読みになりがち。上げると感情的になるが崩れやすくなります。</small>
          </label>

          <label className='lipsync-field'>
            <span>口元ブレンド</span>
            <input
              type='range'
              min={MIN_W2L_BLENDING}
              max={MAX_W2L_BLENDING}
              step={W2L_BLENDING_STEP}
              value={w2lBlending}
              onChange={(event) =>
                setW2lBlending(
                  Math.max(
                    MIN_W2L_BLENDING,
                    Math.min(MAX_W2L_BLENDING, Number(event.target.value) || DEFAULT_W2L_BLENDING),
                  ),
                )
              }
              disabled={isRunning}
            />
            <small>{`${w2lBlending.toFixed(0)}（1-10）`}</small>
          </label>

          <label className='lipsync-field'>
            <span>セリフ</span>
            <textarea
              rows={6}
              value={dialogue}
              onChange={(event) => setDialogue(event.target.value)}
              maxLength={maxDialogueLength}
              placeholder='キャラクターに喋らせたいセリフを入力してください'
              disabled={isRunning}
            />
            <small>{`${dialogue.length}/${maxDialogueLength}`}</small>
          </label>

          <div className='lipsync-field'>
            <span>元動画の音声を残す</span>
            <div className='lipsync-toggle-row'>
              <input
                id='lipsync-keep-original-audio'
                className='lipsync-toggle-check'
                type='checkbox'
                checked={keepOriginalAudio}
                onChange={(event) => setKeepOriginalAudio(event.target.checked)}
                disabled={isRunning}
              />
              <label htmlFor='lipsync-keep-original-audio' className='lipsync-toggle-label'>
                {keepOriginalAudio ? 'オン' : 'オフ'}
              </label>
            </div>
            <small className='lipsync-toggle-hint'>
              {keepOriginalAudio
                ? '生成音声と元動画の音声をミックスします。'
                : '生成音声のみを使用します。'}
            </small>
          </div>

          <label className='lipsync-field'>
            <span>生成音声の音量</span>
            <input
              type='range'
              min={MIN_AUDIO_MIX_VOLUME}
              max={MAX_AUDIO_MIX_VOLUME}
              step={AUDIO_MIX_VOLUME_STEP}
              value={generatedAudioMixVolume}
              onChange={(event) =>
                setGeneratedAudioMixVolume(
                  Math.max(
                    MIN_AUDIO_MIX_VOLUME,
                    Math.min(MAX_AUDIO_MIX_VOLUME, Number(event.target.value) || DEFAULT_GENERATED_AUDIO_MIX_VOLUME),
                  ),
                )
              }
              disabled={isRunning}
            />
            <small>{generatedAudioMixVolume.toFixed(2)}（0.00-2.00）</small>
          </label>

          <label className='lipsync-field'>
            <span>元動画音声の音量</span>
            <input
              type='range'
              min={MIN_AUDIO_MIX_VOLUME}
              max={MAX_AUDIO_MIX_VOLUME}
              step={AUDIO_MIX_VOLUME_STEP}
              value={originalAudioMixVolume}
              onChange={(event) =>
                setOriginalAudioMixVolume(
                  Math.max(
                    MIN_AUDIO_MIX_VOLUME,
                    Math.min(MAX_AUDIO_MIX_VOLUME, Number(event.target.value) || DEFAULT_ORIGINAL_AUDIO_MIX_VOLUME),
                  ),
                )
              }
              disabled={isRunning || !keepOriginalAudio}
            />
            <small>
              {keepOriginalAudio
                ? `${originalAudioMixVolume.toFixed(2)}（0.00-2.00）`
                : '「元動画の音声を残す」がオフのときは無効です。'}
            </small>
          </label>

          <div className='lipsync-actions'>
            <button
              type='button'
              className='lipsync-primary'
              onClick={handleGenerate}
              disabled={isRunning || isPreparingCustomAudio || isTokenInsufficient}
            >
              {isRunning ? '生成中...' : isTokenInsufficient ? 'トークン不足' : '動画を生成'}
            </button>
            <button
              type='button'
              className='lipsync-ghost'
              onClick={() => {
                setDialogue('')
                setReferenceTranscript('')
                handleClearCustomAudio()
                setStatusMessage('')
                setProgressStage('idle')
                setErrorMessage(null)
              }}
              disabled={isRunning || (!dialogue && !referenceTranscript && !customAudioFile && !customAudioSourceFile)}
            >
              クリア
            </button>
          </div>
          <small className='lipsync-generate-note'>59文字以下は2トークン、60文字以上は3トークン消費</small>

          {(progressStage !== 'idle' || statusMessage) && (
            <p className='lipsync-status'>
              {progressStage === 'audio'
                ? '音声生成中...'
                : progressStage === 'video'
                ? '動画生成中...'
                : rewriteUiMessage(statusMessage)}
            </p>
          )}
        </section>

        <section className='lipsync-card'>
          <div className='lipsync-output-head'>
            <h2>生成結果</h2>
            {resultVideo && (
              <button type='button' className='lipsync-ghost' onClick={handleDownload}>ダウンロード</button>
            )}
          </div>

          <div className='lipsync-output'>
            {isRunning ? (
              <div className='lipsync-loading'>
                <div className='lipsync-loading__dots' aria-hidden='true'>
                  <span />
                  <span />
                  <span />
                </div>
                <p>{progressStage === 'audio' ? '音声生成中...' : '動画生成中...'}</p>
              </div>
            ) : resultVideo ? (
              <video src={resultVideo} controls playsInline preload='metadata' />
            ) : (
              <p>生成した動画がここに表示されます。</p>
            )}
          </div>

          <section className='lipsync-tips'>
            <h3>リップシンクのコツ</h3>
            <ul>
              <li>エラーが出た場合は、セリフやプリセットを変更して再度生成してみてください。</li>
              <li>参考音声はノイズや雑音がなく、クリアな人物の声で3秒から10秒の音声を使用してください。</li>
              <li>文字起こしテキストは必須です。プリセット利用時は内部で自動設定、アップロード時は参考音声の内容をそのまま入力してください。</li>
              <li>参考音声の質が悪いと、正しい日本語ボイスを生成できません。</li>
              <li>口元ブレンドを上げると画質は良くなりますが、顔が変わりやすくなります。</li>
              <li>セリフは短く区切るほど安定しやすいです（最大100文字）。</li>
              <li>消費トークンは59文字以下で2枚、60文字以上で3枚です。</li>
              <li>参考音声は3秒以上10秒以下でないと生成できません。</li>
            </ul>
          </section>

          {errorMessage && <p className='lipsync-error'>{rewriteUiMessage(errorMessage)}</p>}
        </section>
      </main>
    </div>
  )
}
