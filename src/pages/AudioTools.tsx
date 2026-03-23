import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import './audioTools.css'

const MAX_VIDEO_MB = 120
const MIN_TRIM_SECONDS = 0.1
const FFMPEG_CORE_CANDIDATES = [
  {
    coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
    wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
  },
  {
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm',
  },
]

const formatSeconds = (value: number) => {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0)
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`
}

const getFileExt = (name: string, fallback: string) => {
  const trimmed = String(name || '').trim().toLowerCase()
  if (!trimmed.includes('.')) return fallback
  const ext = trimmed.slice(trimmed.lastIndexOf('.'))
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) return fallback
  return ext
}

const safeDeleteFile = async (ffmpeg: FFmpeg, filename: string) => {
  try {
    await ffmpeg.deleteFile(filename)
  } catch {
    // ignore cleanup errors
  }
}

const getAudioDuration = (blob: Blob) =>
  new Promise<number>((resolve) => {
    const audio = document.createElement('audio')
    const objectUrl = URL.createObjectURL(blob)
    const cleanup = () => {
      audio.src = ''
      URL.revokeObjectURL(objectUrl)
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const duration = Number(audio.duration)
      cleanup()
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 0)
    }
    audio.onerror = () => {
      cleanup()
      resolve(0)
    }
    audio.src = objectUrl
  })

const toUint8Array = (value: FileData) =>
  value instanceof Uint8Array ? value : new Uint8Array(value)

type FileData = Uint8Array | ArrayBuffer

export function AudioTools() {
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const [ffmpegLoading, setFfmpegLoading] = useState(false)
  const [ffmpegReady, setFfmpegReady] = useState(false)

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [sourceAudioBlob, setSourceAudioBlob] = useState<Blob | null>(null)
  const [sourceAudioUrl, setSourceAudioUrl] = useState('')
  const [trimmedAudioBlob, setTrimmedAudioBlob] = useState<Blob | null>(null)
  const [trimmedAudioUrl, setTrimmedAudioUrl] = useState('')

  const [audioDuration, setAudioDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)

  const [isConverting, setIsConverting] = useState(false)
  const [isTrimming, setIsTrimming] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const working = isConverting || isTrimming || ffmpegLoading
  const trimMax = Math.max(audioDuration, 0.1)
  const trimLength = Math.max(0, trimEnd - trimStart)
  const videoSizeText = useMemo(
    () => (videoFile ? `${(videoFile.size / 1024 / 1024).toFixed(2)} MB` : `Max ${MAX_VIDEO_MB}MB`),
    [videoFile],
  )

  useEffect(() => {
    if (!sourceAudioBlob) {
      setSourceAudioUrl('')
      return
    }
    const nextUrl = URL.createObjectURL(sourceAudioBlob)
    setSourceAudioUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [sourceAudioBlob])

  useEffect(() => {
    if (!trimmedAudioBlob) {
      setTrimmedAudioUrl('')
      return
    }
    const nextUrl = URL.createObjectURL(trimmedAudioBlob)
    setTrimmedAudioUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [trimmedAudioBlob])

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
      if (window.innerWidth > 900) setIsMobileMenuOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const ensureFfmpeg = useCallback(async () => {
    if (ffmpegRef.current && ffmpegReady) return ffmpegRef.current
    if (ffmpegLoading && ffmpegRef.current) return ffmpegRef.current

    setFfmpegLoading(true)
    setStatusMessage('Loading ffmpeg core...')
    let ffmpeg = ffmpegRef.current ?? new FFmpeg()
    ffmpegRef.current = ffmpeg

    try {
      let lastError: unknown = null
      for (const candidate of FFMPEG_CORE_CANDIDATES) {
        try {
          await ffmpeg.load(candidate)
          setFfmpegReady(true)
          return ffmpeg
        } catch (error) {
          lastError = error
          ffmpeg.terminate()
          ffmpeg = new FFmpeg()
          ffmpegRef.current = ffmpeg
        }
      }
      throw lastError ?? new Error('Failed to load ffmpeg core from all CDNs.')
    } finally {
      setFfmpegLoading(false)
    }
  }, [ffmpegLoading, ffmpegReady])

  const handleConvert = useCallback(async () => {
    if (!videoFile || working) return

    const sizeMb = videoFile.size / (1024 * 1024)
    if (sizeMb > MAX_VIDEO_MB) {
      setErrorMessage(`Video is too large. Max ${MAX_VIDEO_MB}MB.`)
      setStatusMessage('Validation error')
      return
    }

    setErrorMessage(null)
    setTrimmedAudioBlob(null)
    setIsConverting(true)

    let ffmpeg: FFmpeg | null = null
    const inputName = `input${getFileExt(videoFile.name, '.mp4')}`
    const outputName = 'converted.mp3'
    try {
      ffmpeg = await ensureFfmpeg()
      setStatusMessage('Converting to MP3...')
      await ffmpeg.writeFile(inputName, await fetchFile(videoFile))
      await ffmpeg.exec([
        '-i',
        inputName,
        '-vn',
        '-ac',
        '2',
        '-ar',
        '44100',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '192k',
        outputName,
      ])
      const data = toUint8Array(await ffmpeg.readFile(outputName) as FileData)
      const bytes = new Uint8Array(data.length)
      bytes.set(data)
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      const duration = await getAudioDuration(blob)
      setSourceAudioBlob(blob)
      setAudioDuration(duration)
      setTrimStart(0)
      setTrimEnd(duration > 0 ? duration : 0)
      setStatusMessage('MP3 converted.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatusMessage('Conversion failed')
    } finally {
      setIsConverting(false)
      if (ffmpeg) {
        await safeDeleteFile(ffmpeg, inputName)
        await safeDeleteFile(ffmpeg, outputName)
      }
    }
  }, [ensureFfmpeg, videoFile, working])

  const handleTrim = useCallback(async () => {
    if (!sourceAudioBlob || working) return
    if (trimLength < MIN_TRIM_SECONDS) {
      setErrorMessage(`Trim range must be at least ${MIN_TRIM_SECONDS.toFixed(1)} seconds.`)
      return
    }

    setErrorMessage(null)
    setIsTrimming(true)
    let ffmpeg: FFmpeg | null = null
    const inputName = 'source.mp3'
    const outputName = 'trimmed.mp3'
    try {
      ffmpeg = await ensureFfmpeg()
      setStatusMessage('Trimming MP3...')
      await ffmpeg.writeFile(inputName, await fetchFile(sourceAudioBlob))
      await ffmpeg.exec([
        '-ss',
        trimStart.toFixed(2),
        '-to',
        trimEnd.toFixed(2),
        '-i',
        inputName,
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '192k',
        outputName,
      ])
      const data = toUint8Array(await ffmpeg.readFile(outputName) as FileData)
      const bytes = new Uint8Array(data.length)
      bytes.set(data)
      setTrimmedAudioBlob(new Blob([bytes], { type: 'audio/mpeg' }))
      setStatusMessage('Trim complete.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setStatusMessage('Trim failed')
    } finally {
      setIsTrimming(false)
      if (ffmpeg) {
        await safeDeleteFile(ffmpeg, inputName)
        await safeDeleteFile(ffmpeg, outputName)
      }
    }
  }, [ensureFfmpeg, sourceAudioBlob, trimEnd, trimLength, trimStart, working])

  const downloadBlob = useCallback((blob: Blob | null, filename: string) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }, [])

  return (
    <div className='audio-tools-shell'>
      <header className='audio-tools-top'>
        <div>
          <p>Audio Tools</p>
          <h1>Video to MP3 + Trim</h1>
        </div>
        <button
          type='button'
          className={`audio-tools-menu-toggle${isMobileMenuOpen ? ' is-open' : ''}`}
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-expanded={isMobileMenuOpen}
          aria-label='メニューを開閉'
        >
          <span />
          <span />
          <span />
        </button>
        <div className={`audio-tools-top__actions${isMobileMenuOpen ? ' is-open' : ''}`}>
          <a href='/fastmove' className='audio-tools-link' onClick={() => setIsMobileMenuOpen(false)}>V1</a>
          <a href='/smoothmix' className='audio-tools-link' onClick={() => setIsMobileMenuOpen(false)}>V2</a>
          <a href='/video-remix' className='audio-tools-link' onClick={() => setIsMobileMenuOpen(false)}>V3</a>
          <a href='/video' className='audio-tools-link' onClick={() => setIsMobileMenuOpen(false)}>V4</a>
          <a href='/video?mode=edit' className='audio-tools-link' onClick={() => setIsMobileMenuOpen(false)}>Edit</a>
        </div>
        <button
          type='button'
          className={`audio-tools-menu-backdrop${isMobileMenuOpen ? ' is-open' : ''}`}
          onClick={() => setIsMobileMenuOpen(false)}
          aria-label='メニューを閉じる'
        />
      </header>

      <main className='audio-tools-grid'>
        <section className='audio-tools-card'>
          <h2>1) Convert</h2>
          <label className='audio-tools-field'>
            <span>Source video</span>
            <input
              type='file'
              accept='video/mp4,video/webm,video/quicktime,video/x-matroska'
              disabled={working}
              onChange={(event) => {
                setVideoFile(event.target.files?.[0] ?? null)
                setSourceAudioBlob(null)
                setTrimmedAudioBlob(null)
                setAudioDuration(0)
                setTrimStart(0)
                setTrimEnd(0)
                setErrorMessage(null)
              }}
            />
            <small>{videoFile ? `${videoFile.name} (${videoSizeText})` : videoSizeText}</small>
          </label>

          <button type='button' className='audio-tools-primary' disabled={!videoFile || working} onClick={handleConvert}>
            {isConverting ? 'Converting...' : 'Generate MP3'}
          </button>

          <p className='audio-tools-status'>{statusMessage}</p>
          {errorMessage && <p className='audio-tools-error'>{errorMessage}</p>}
        </section>

        <section className='audio-tools-card'>
          <h2>2) Trim</h2>
          <div className='audio-tools-audio'>
            {sourceAudioUrl ? (
              <>
                <audio src={sourceAudioUrl} controls preload='metadata' />
                <div className='audio-tools-meta'>
                  <small>Duration: {formatSeconds(audioDuration)}</small>
                  <button
                    type='button'
                    className='audio-tools-ghost'
                    onClick={() => downloadBlob(sourceAudioBlob, 'extracted-audio.mp3')}
                  >
                    Download MP3
                  </button>
                </div>
              </>
            ) : (
              <p>Convert a video first.</p>
            )}
          </div>

          <div className='audio-tools-field'>
            <span>Trim start: {formatSeconds(trimStart)}</span>
            <input
              type='range'
              min={0}
              max={trimMax}
              step={0.1}
              value={Math.min(trimStart, Math.max(0, trimEnd - MIN_TRIM_SECONDS))}
              disabled={!sourceAudioBlob || working}
              onChange={(event) => {
                const next = Number(event.target.value) || 0
                const clamped = Math.min(next, Math.max(0, trimEnd - MIN_TRIM_SECONDS))
                setTrimStart(clamped)
              }}
            />
          </div>

          <div className='audio-tools-field'>
            <span>Trim end: {formatSeconds(trimEnd)}</span>
            <input
              type='range'
              min={0}
              max={trimMax}
              step={0.1}
              value={Math.max(trimEnd, Math.min(trimMax, trimStart + MIN_TRIM_SECONDS))}
              disabled={!sourceAudioBlob || working}
              onChange={(event) => {
                const next = Number(event.target.value) || 0
                const clamped = Math.max(next, Math.min(trimMax, trimStart + MIN_TRIM_SECONDS))
                setTrimEnd(clamped)
              }}
            />
          </div>

          <small className='audio-tools-hint'>Trim length: {formatSeconds(trimLength)}</small>

          <button type='button' className='audio-tools-primary' disabled={!sourceAudioBlob || working} onClick={handleTrim}>
            {isTrimming ? 'Trimming...' : 'Trim MP3'}
          </button>

          <div className='audio-tools-audio'>
            {trimmedAudioUrl ? (
              <>
                <audio src={trimmedAudioUrl} controls preload='metadata' />
                <button
                  type='button'
                  className='audio-tools-ghost'
                  onClick={() => downloadBlob(trimmedAudioBlob, 'trimmed-audio.mp3')}
                >
                  Download Trimmed MP3
                </button>
              </>
            ) : (
              <p>Trimmed output will appear here.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
