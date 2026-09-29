import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { MaskData } from './energy/layer'
import { MaskReader } from './maskReader'
import type { LandmarkLike } from './skeleton'

// Keep in step with the @mediapipe/tasks-vision version in package.json.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

/**
 * MediaPipe's pose models, smallest to largest. `heavy` places wrists and
 * hands more accurately at a few times the cost of `full`; `lite` is quicker
 * and looser. `full` is the default; `?model=heavy` (or `lite`) on either page
 * tries another.
 */
export const POSE_MODELS = ['lite', 'full', 'heavy'] as const
export type PoseModel = (typeof POSE_MODELS)[number]

const modelUrl = (m: PoseModel) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/1/pose_landmarker_${m}.task`

/** The model named by `?model=`, or `full`. */
export function modelFromParams(params: URLSearchParams): PoseModel {
  const m = params.get('model') as PoseModel
  return POSE_MODELS.includes(m) ? m : 'full'
}

let fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | undefined

/**
 * Open the front camera for pose tracking. 1280×720 at 30 fps is plenty: the
 * model sees a 256-pixel square either way, and the picture is shown full
 * screen. Where a camera won't give that (or rejects the constraints outright),
 * take whatever it offers.
 */
export async function openCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
        facingMode: 'user',
      },
      audio: false,
    })
  } catch (e) {
    // Denied, or no camera at all: asking again won't help.
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'NotFoundError')) throw e
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
  }
}

/**
 * Call `fn` once for each new frame of `video`, with the time it was captured
 * (on the `performance.now()` clock). Uses `requestVideoFrameCallback` where the
 * browser has it, and otherwise checks for a new frame on each animation frame.
 * Returns a function that stops it.
 */
export function eachVideoFrame(video: HTMLVideoElement, fn: (timeMs: number) => void): () => void {
  let stopped = false
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    let id = 0
    const step = (now: number, meta: VideoFrameCallbackMetadata) => {
      if (stopped) return
      fn(meta.captureTime ?? now)
      id = video.requestVideoFrameCallback(step)
    }
    id = video.requestVideoFrameCallback(step)
    return () => {
      stopped = true
      video.cancelVideoFrameCallback(id)
    }
  }
  let last = -1
  const poll = (now: number) => {
    if (stopped) return
    if (video.readyState >= 2 && video.currentTime !== last) {
      last = video.currentTime
      fn(now)
    }
    requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)
  return () => {
    stopped = true
  }
}

export interface PoseTrackerOptions {
  /** Which pose model to run (`full`). */
  model?: PoseModel
  /**
   * Also segment the person, for the energy layer's silhouette. The mask is
   * shrunk to `maskWidth` pixels across (256) and read every `maskEvery`
   * frames (1). Measured on an M1 Max in Chrome at 1280×720, GPU delegate:
   * the segmentation adds no measurable time to detection (about 20 ms either
   * way), and reading the mask back costs about 0.8 ms a frame (see MaskReader).
   */
  segmentation?: boolean
  maskEvery?: number
  maskWidth?: number
  /** Mirror the mask, to match poses read with `flipX`. */
  flipX?: boolean
}

/** One tracked stream of frames. MediaPipe needs each stream's timestamps to only ever increase. */
export class PoseTracker {
  private last = 0
  private frames = 0
  /** The latest person mask (with `segmentation`), or null when no one is seen. */
  mask: MaskData | null = null
  /** Milliseconds the last mask read took, for measuring its cost. */
  maskMs = 0
  private masks: MaskReader | null = null

  private constructor(
    private landmarker: PoseLandmarker,
    private opts: PoseTrackerOptions,
  ) {}

  static async create(opts: PoseTrackerOptions = {}): Promise<PoseTracker> {
    fileset ??= FilesetResolver.forVisionTasks(WASM)
    const files = await fileset
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: modelUrl(opts.model ?? 'full'), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        outputSegmentationMasks: !!opts.segmentation,
      })
    try {
      return new PoseTracker(await make('GPU'), opts)
    } catch {
      return new PoseTracker(await make('CPU'), opts)
    }
  }

  detect(source: HTMLVideoElement | HTMLCanvasElement, timeMs: number): LandmarkLike[] | null {
    const ts = Math.max(this.last + 1, Math.round(timeMs))
    this.last = ts
    let landmarks: LandmarkLike[] | null = null
    // The callback form: the mask is read in place, without MediaPipe copying it first.
    this.landmarker.detectForVideo(source, ts, (result) => {
      landmarks = result.landmarks[0] ?? null
      const m = result.segmentationMasks?.[0]
      if (!landmarks || !m) {
        this.mask = null
        return
      }
      if (this.frames++ % (this.opts.maskEvery ?? 1) !== 0 && this.mask) return
      const start = performance.now()
      this.masks ??= new MaskReader(this.opts.maskWidth ?? 256, !!this.opts.flipX)
      this.mask = this.masks.read(m)
      this.maskMs = performance.now() - start
    })
    return landmarks
  }

  close() {
    this.landmarker.close()
  }
}
