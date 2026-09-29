import { inPosture, TYPICAL_BODY, type Proportions } from '../fit'
import { DEMO_ASPECT } from '../moves'
import { landmarksFromPose, type RawLandmark } from '../session'
import { JOINTS, type Joint, type Pose, type Posture } from '../skeleton'
import { skippedTask, TaskTake, type CalibrationRecording } from './recording'
import { PROMPT_SEC, SETTLE_SEC, shapeOn, tasksFor, type CalibrationTask, type TaskId, type TaskShape } from './tasks'

// A simulated learner doing the calibration, for working without a webcam
// (`calibrate.html?sim`) and for the tests: a body of known proportions that
// moves into each task's shape a moment after it is asked, holds it with a
// tracker-like shiver, and follows the moving tasks a little behind.

export interface CalibrationSimOptions {
  /** Its proportions, standing, in torso lengths (typical by default). */
  body?: Proportions
  /** Width / height of its camera image (16/9 by default). */
  aspect?: number
  /**
   * How much larger it looks than the built-in figure would, as if nearer the
   * camera; scaled about a point low in the frame, so its hands leave the top first.
   */
  zoom?: number
  /** The highest it can raise its arms, in degrees from hanging (180 overhead). */
  maxRaise?: number
  /** Drop a landmark (the tracker loses it) at `t` seconds into a task. */
  drop?: (joint: Joint, task: TaskId, t: number) => boolean
}

/** Seconds after the prompt appears that it starts to move, and how long it takes to get there. */
const REACT_SEC = 1
const REACH_SEC = 1.6
/** How far behind a moving task it follows. */
const FOLLOW_SEC = 0.25

const smoothstep = (u: number) => u * u * (3 - 2 * u)

export class CalibrationSim {
  readonly body: Proportions
  readonly aspect: number
  readonly zoom: number
  readonly maxRaise: number
  private seed = 7
  private dropFn?: CalibrationSimOptions['drop']

  constructor(opts: CalibrationSimOptions = {}) {
    this.body = opts.body ?? TYPICAL_BODY
    this.aspect = opts.aspect ?? 16 / 9
    this.zoom = opts.zoom ?? 1
    this.maxRaise = opts.maxRaise ?? 180
    this.dropFn = opts.drop
  }

  private jitter() {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296
    return (this.seed / 4294967296 - 0.5) * 0.006
  }

  private limit(shape: TaskShape): TaskShape {
    const m = this.maxRaise
    const cap = (a: number) => (a <= 180 ? Math.min(a, m) : Math.max(a, 360 - m))
    return { ...shape, key: { ...shape.key, lArm: cap(shape.key.lArm), rArm: cap(shape.key.rArm) } }
  }

  /** Its body making `shape`, placed in its camera's frame. */
  private make(shape: TaskShape, posture: Posture): Pose {
    const p = shapeOn(this.limit(shape), inPosture(this.body, posture), posture)
    const dx = (this.aspect - DEMO_ASPECT) / 2
    const cx = this.aspect / 2
    const cy = 0.75
    const out = {} as Pose
    for (const j of JOINTS) {
      const q = p[j]
      out[j] = { x: cx + (q.x + dx - cx) * this.zoom, y: cy + (q.y - cy) * this.zoom, v: 1 }
    }
    return out
  }

  /** Where it is `t` seconds after `task`'s prompt appeared, before any shiver. */
  pose(task: CalibrationTask, t: number, posture: Posture): Pose {
    const rest = this.make(tasksFor(posture)[0].shape(0, posture), posture)
    const capture = t - PROMPT_SEC - SETTLE_SEC
    const target = this.make(task.shape(task.moving ? Math.max(0, capture - FOLLOW_SEC) : 0, posture), posture)
    const k = smoothstep(Math.min(1, Math.max(0, (t - REACT_SEC) / REACH_SEC)))
    const out = {} as Pose
    for (const j of JOINTS) {
      const a = rest[j]
      const b = target[j]
      out[j] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, v: 1 }
    }
    return out
  }

  /**
   * The raw landmarks a mirrored webcam would give for it `t` seconds into
   * `task`: shivering a little, and a landmark outside the picture (or dropped)
   * barely visible, as MediaPipe reports one.
   */
  landmarks(task: CalibrationTask, t: number, posture: Posture): RawLandmark[] {
    const p = this.pose(task, t, posture)
    const pose = {} as Pose
    for (const j of JOINTS) {
      const x = p[j].x + this.jitter()
      const y = p[j].y + this.jitter()
      const inside = x >= 0 && x <= this.aspect && y >= 0 && y <= 1
      const dropped = this.dropFn?.(j, task.id, t) ?? false
      pose[j] = { x, y, v: inside && !dropped ? 0.95 : 0.1 }
    }
    return landmarksFromPose(pose, this.aspect)
  }
}

/**
 * The simulated learner the URL asks for, as the primary view builds its
 * simulated student: `?arms=` (shoulder to wrist) and `?shoulders=` in torso
 * lengths (typically 1.15 and 0.8), `?zoom=` (1.3 brings it near enough that
 * its hands leave the top) and `?reach=` (the highest it raises its arms, in
 * degrees; 180 overhead).
 */
export function simFromParams(params: URLSearchParams): CalibrationSimOptions {
  const body = { ...TYPICAL_BODY }
  const arms = Number(params.get('arms'))
  if (arms > 0) {
    const k = arms / (body.upperArm + body.forearm)
    body.upperArm *= k
    body.forearm *= k
    body.hand *= k
  }
  const shoulders = Number(params.get('shoulders'))
  if (shoulders > 0) body.shoulders = shoulders
  const zoom = Number(params.get('zoom'))
  const reach = Number(params.get('reach'))
  return { body, zoom: zoom > 0 ? zoom : 1, maxRaise: reach > 0 ? reach : 180 }
}

export interface SimulateOptions {
  posture?: Posture
  sim?: CalibrationSim
  /** Tasks the learner skips. */
  skip?: TaskId[]
  /** Detections a second (about 30, a little uneven like a real camera). */
  fps?: number
}

/** A whole calibration by the simulated learner, as the page would record it. */
export function simulateCalibration(opts: SimulateOptions = {}): CalibrationRecording {
  const posture = opts.posture ?? 'standing'
  const sim = opts.sim ?? new CalibrationSim()
  const gap = 1000 / (opts.fps ?? 30)
  const tasks = tasksFor(posture).map((task) => {
    if (opts.skip?.includes(task.id)) return skippedTask(task.id, 1)
    const take = new TaskTake(task.id, 0)
    const settle = PROMPT_SEC * 1000
    const capture = settle + SETTLE_SEC * 1000
    const end = capture + task.captureSec * 1000
    take.settling(settle)
    take.capturing(capture)
    for (let i = 0, now = 0; now <= end; i++, now += gap + (i % 3) - 1) take.add(sim.landmarks(task, now / 1000, posture), now)
    return take.finish(end)
  })
  return { posture, aspect: sim.aspect, tasks }
}
