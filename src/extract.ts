import type { PoseTracker } from './pose'
import type { LandmarkLike } from './skeleton'

// Turning a teacher's video into a move: step through it, track the teacher's
// pose on every frame and keep a small JPEG of each frame, so the video itself
// can be shown at any pace without seeking.

export const VIDEO_FPS = 15
const FRAME_WIDTH = 640

export interface VideoTeacher {
  name: string
  fps: number
  aspect: number
  /** Raw landmarks per frame, null where no one was found. */
  landmarks: (LandmarkLike[] | null)[]
  frames: FrameStore
}

export async function analyzeVideo(
  file: File,
  tracker: PoseTracker,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<VideoTeacher> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('This browser cannot play that video file.'))
    })
    const aspect = video.videoWidth / video.videoHeight
    const canvas = document.createElement('canvas')
    canvas.width = FRAME_WIDTH
    canvas.height = Math.round(FRAME_WIDTH / aspect)
    const ctx = canvas.getContext('2d')!
    const count = Math.floor(video.duration * VIDEO_FPS)
    const landmarks: (LandmarkLike[] | null)[] = []
    const blobs: Blob[] = []
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      await seek(video, i / VIDEO_FPS)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      landmarks.push(tracker.detect(canvas, (i * 1000) / VIDEO_FPS))
      blobs.push(await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.82)))
      onProgress((i + 1) / count)
    }
    return {
      name: file.name.replace(/\.[^.]+$/, ''),
      fps: VIDEO_FPS,
      aspect,
      landmarks,
      frames: new FrameStore(blobs),
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true })
    video.currentTime = t
  })
}

/** Decodes frames on demand and keeps the ones around the playhead. */
export class FrameStore {
  private cache = new Map<number, ImageBitmap>()
  private loading = new Set<number>()
  private shown: ImageBitmap | null = null

  constructor(private blobs: Blob[]) {}

  get length() {
    return this.blobs.length
  }

  /** The frame at `i` if it is ready, otherwise the last one shown. */
  get(i: number): ImageBitmap | null {
    i = Math.max(0, Math.min(this.blobs.length - 1, Math.round(i)))
    for (let k = i; k < Math.min(this.blobs.length, i + 8); k++) this.load(k)
    const hit = this.cache.get(i)
    if (hit) this.shown = hit
    this.evict(i)
    return this.shown
  }

  private load(i: number) {
    if (this.cache.has(i) || this.loading.has(i)) return
    this.loading.add(i)
    createImageBitmap(this.blobs[i]).then((bmp) => {
      this.loading.delete(i)
      this.cache.set(i, bmp)
    })
  }

  private evict(around: number) {
    if (this.cache.size <= 40) return
    const far = [...this.cache.keys()].sort((a, b) => Math.abs(b - around) - Math.abs(a - around))
    for (const k of far.slice(0, this.cache.size - 40)) {
      const bmp = this.cache.get(k)!
      if (bmp !== this.shown) bmp.close()
      this.cache.delete(k)
    }
  }
}
