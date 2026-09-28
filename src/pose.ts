import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { LandmarkLike } from './skeleton'

// Keep in step with the @mediapipe/tasks-vision version in package.json.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

let fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | undefined

/** One tracked stream of frames. MediaPipe needs each stream's timestamps to only ever increase. */
export class PoseTracker {
  private last = 0
  private constructor(private landmarker: PoseLandmarker) {}

  static async create(): Promise<PoseTracker> {
    fileset ??= FilesetResolver.forVisionTasks(WASM)
    const files = await fileset
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      })
    try {
      return new PoseTracker(await make('GPU'))
    } catch {
      return new PoseTracker(await make('CPU'))
    }
  }

  detect(source: HTMLVideoElement | HTMLCanvasElement, timeMs: number): LandmarkLike[] | null {
    const ts = Math.max(this.last + 1, Math.round(timeMs))
    this.last = ts
    const result = this.landmarker.detectForVideo(source, ts)
    return result.landmarks[0] ?? null
  }

  close() {
    this.landmarker.close()
  }
}
