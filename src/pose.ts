import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { MaskData } from './energy/layer'
import { MaskReader } from './maskReader'
import type { LandmarkLike } from './skeleton'

// Keep in step with the @mediapipe/tasks-vision version in package.json.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

let fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | undefined

export interface PoseTrackerOptions {
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
        baseOptions: { modelAssetPath: MODEL, delegate },
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
