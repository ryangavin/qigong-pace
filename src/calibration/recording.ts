import { encodeLandmarks, type RawLandmark } from '../session'
import type { Posture } from '../skeleton'
import type { TaskId } from './tasks'

// What the calibration keeps of each task: the raw MediaPipe landmarks of every
// detection, in the recorded session's frame format (`[ms, x, y, z, v × 33]`
// as integers, or `[ms]` when no one was found), timed from the moment the
// task's prompt appeared. Everything measured is computed from these alone,
// so a downloaded file can be measured again exactly.

/** When each phase began, in ms from the task's start (its prompt). */
export interface TaskPhases {
  settle: number
  capture: number
  end: number
}

export interface RecordedTask {
  id: TaskId
  /** `skipped` when the learner passed it by; it then has no frames. */
  status: 'done' | 'skipped'
  /** How many times it was begun (repeating it keeps only the last). */
  attempts: number
  phases: TaskPhases | null
  frames: number[][]
}

export interface CalibrationRecording {
  posture: Posture
  /** Width / height of the camera image the landmarks are normalised to. */
  aspect: number
  tasks: RecordedTask[]
}

/** Records one attempt at a task. `now` is in ms, from the clock the landmarks are timed by. */
export class TaskTake {
  private frames: number[][] = []
  private settle = -1
  private capture = -1

  constructor(
    readonly id: TaskId,
    private start: number,
    readonly attempts = 1,
  ) {}

  private at(now: number) {
    return Math.max(0, Math.round(now - this.start))
  }

  add(landmarks: readonly RawLandmark[] | null, now: number) {
    const t = this.at(now)
    this.frames.push(landmarks ? [t, ...encodeLandmarks(landmarks)] : [t])
  }

  /** The countdown began. */
  settling(now: number) {
    this.settle = this.at(now)
  }

  /** The capture began. */
  capturing(now: number) {
    this.capture = this.at(now)
  }

  finish(now: number): RecordedTask {
    const end = this.at(now)
    const settle = this.settle < 0 ? end : this.settle
    const capture = this.capture < 0 ? end : this.capture
    return { id: this.id, status: 'done', attempts: this.attempts, phases: { settle, capture, end }, frames: this.frames }
  }
}

export const skippedTask = (id: TaskId, attempts = 0): RecordedTask => ({
  id,
  status: 'skipped',
  attempts,
  phases: null,
  frames: [],
})
