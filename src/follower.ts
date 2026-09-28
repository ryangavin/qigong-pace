import { computeFeatures, distance, type Features, type Pose } from './skeleton'

/** A move to learn: the teacher's pose at a fixed frame rate. */
export interface Reference {
  name: string
  fps: number
  /** Width / height of the teacher's image. */
  aspect: number
  poses: Pose[]
  feats: Features[]
  /** How fast the teacher's shape is changing at each frame, per second. Near zero during holds. */
  motion: Float32Array
}

const LOOKAHEAD_SEC = 0.3

export function buildReference(name: string, fps: number, aspect: number, poses: Pose[]): Reference {
  const feats = poses.map(computeFeatures)
  const n = feats.length
  const k = Math.max(1, Math.round(LOOKAHEAD_SEC * fps))
  // Measured over a short look-ahead rather than frame to frame, so tracker
  // jitter in a video reference doesn't read as movement.
  const motion = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const j = Math.min(n - 1, i + k)
    motion[i] = j === i ? 0 : (distance(feats[i], feats[j]) * fps) / (j - i)
  }
  return { name, fps, aspect, poses, feats, motion }
}

export interface FollowerOptions {
  /** How far ahead of the current position to look for the learner's pose. */
  searchAheadSec: number
  /** Extra cost per second of skipping ahead; stops jumps to a later repetition that looks the same. */
  jumpPenaltyPerSec: number
  /** Time constant for easing the position toward where the learner is. */
  smoothingSec: number
  /** Fastest the teacher may move, as a multiple of the original speed. */
  maxRate: number
  /** Below this motion the teacher is holding still, and the hold plays at real time while the learner holds too. */
  holdMotion: number
  /** Mean segment mismatch (torso lengths) that counts as "in the pose". */
  matchThreshold: number
  /** Past matchThreshold × this, the learner is lost and the teacher waits. */
  lostFactor: number
  /** How long to hold the opening pose before the move begins. */
  startHoldSec: number
  loop: boolean
}

export const DEFAULT_OPTIONS: FollowerOptions = {
  searchAheadSec: 1.5,
  jumpPenaltyPerSec: 0.015,
  smoothingSec: 0.15,
  maxRate: 5,
  holdMotion: 0.08,
  matchThreshold: 0.22,
  lostFactor: 1.5,
  startHoldSec: 0.6,
  loop: false,
}

export type FollowState = 'waiting' | 'following' | 'done'

/**
 * Keeps the teacher in step with the learner.
 *
 * Each tick it looks a little way ahead in the teacher's move for the frame
 * whose shape best matches the learner, and eases toward it. It never goes
 * backwards: if the learner stops, the teacher stops; if they go back, the
 * teacher waits for them to come forward again. Where the teacher is holding
 * still, every frame looks alike, so instead the hold runs at real time while
 * the learner holds the shape too.
 */
export class Follower {
  state: FollowState = 'waiting'
  /** Fractional frame index the learner has reached. */
  pos = 0
  /** Learner's speed relative to the original, smoothed. */
  pace = 0
  /** Progress through the opening pose hold, 0..1. */
  startProgress = 0
  /** Mismatch between the learner and the teacher at `pos`. */
  distance = Infinity
  inHold = false
  lost = false
  reps = 0

  constructor(
    public ref: Reference,
    public opts: FollowerOptions = { ...DEFAULT_OPTIONS },
  ) {}

  get frame(): number {
    return Math.min(this.ref.feats.length - 1, Math.max(0, Math.round(this.pos)))
  }

  /** Frame to show the teacher at: `leadSec` of the move ahead of the learner, so they can see where to go. */
  displayFrame(leadSec: number): number {
    return Math.min(this.ref.feats.length - 1, this.pos + leadSec * this.ref.fps)
  }

  reset() {
    this.state = 'waiting'
    this.pos = 0
    this.pace = 0
    this.startProgress = 0
    this.distance = Infinity
    this.inHold = false
    this.lost = false
  }

  update(user: Features | null, dt: number) {
    if (dt <= 0) return
    const { ref, opts } = this
    const n = ref.feats.length
    const fps = ref.fps
    let step = 0

    if (!user || this.state === 'done') {
      this.easePace(0, dt)
      return
    }

    if (this.state === 'waiting') {
      this.distance = distance(user, ref.feats[0])
      if (this.distance < opts.matchThreshold) {
        this.startProgress = Math.min(1, this.startProgress + dt / opts.startHoldSec)
        if (this.startProgress >= 1) this.state = 'following'
      } else {
        this.startProgress = Math.max(0, this.startProgress - dt / opts.startHoldSec)
      }
      this.easePace(0, dt)
      return
    }

    const lo = Math.floor(this.pos)
    // A hold looks the same all the way through, so always search past its end:
    // a learner who cuts a hold short is found where they are.
    let holdEnd = this.frame
    while (holdEnd < n - 1 && ref.motion[holdEnd] < opts.holdMotion) holdEnd++
    const hi = Math.min(n - 1, Math.ceil(Math.max(this.pos, holdEnd) + opts.searchAheadSec * fps))
    let best = lo
    let bestCost = Infinity
    let bestDist = Infinity
    for (let i = lo; i <= hi; i++) {
      const d = distance(user, ref.feats[i])
      const c = d + (opts.jumpPenaltyPerSec * Math.max(0, i - this.pos)) / fps
      if (c < bestCost) {
        bestCost = c
        best = i
        bestDist = d
      }
    }
    this.distance = distance(user, ref.feats[this.frame])
    this.lost = bestDist > opts.matchThreshold * opts.lostFactor
    this.inHold = ref.motion[this.frame] < opts.holdMotion

    if (!this.lost && best > this.pos) {
      step = (best - this.pos) * (1 - Math.exp(-dt / opts.smoothingSec))
    }
    if (this.inHold && this.distance < opts.matchThreshold) {
      step = Math.max(step, dt * fps)
    }
    step = Math.min(step, opts.maxRate * fps * dt)
    this.pos += step
    this.easePace(step / (dt * fps), dt)

    if (this.pos >= n - 1.5) {
      this.reps++
      if (opts.loop) {
        this.pos = 0
      } else {
        this.pos = n - 1
        this.state = 'done'
      }
    }
  }

  private easePace(rate: number, dt: number) {
    this.pace += (rate - this.pace) * (1 - Math.exp(-dt / 0.6))
  }
}
