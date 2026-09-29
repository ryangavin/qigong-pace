import { measureBody, retarget, type Proportions } from './fit'
import { computeFeatures, distance, type Features, type Pose, type Posture } from './skeleton'

/** A move to learn: the teacher's pose at a fixed frame rate. */
export interface Reference {
  name: string
  fps: number
  /** Width / height of the teacher's image. */
  aspect: number
  /** How `feats` were measured; the learner's features must be measured the same way. */
  posture: Posture
  /** The teacher's move on the body it is compared with: the teacher's own, or the learner's once fitted. */
  poses: Pose[]
  feats: Features[]
  /** How fast the teacher's shape is changing at each frame, per second. Near zero during holds. */
  motion: Float32Array
  /** The proportions `poses` are drawn with. */
  body: Proportions
  /** The teacher's own move, as recorded or drawn: what the teacher looks like. */
  teacher: Pose[]
  /** The teacher's own proportions. */
  teacherBody: Proportions
}

const LOOKAHEAD_SEC = 0.3

/** A teacher's move. `teacherBody` is the teacher's proportions, measured from the poses if not given. */
export function buildReference(
  name: string,
  fps: number,
  aspect: number,
  poses: Pose[],
  posture: Posture = 'standing',
  teacherBody: Proportions = measureBody(poses, posture),
): Reference {
  return { name, fps, aspect, posture, ...shapeOf(poses, fps, posture), body: teacherBody, teacher: poses, teacherBody }
}

/**
 * The teacher's move redrawn on a body of proportions `body` (the learner's,
 * from a `BodyFit`), keeping the teacher's own shape, place and size: this is
 * what the learner is compared with and guided by.
 */
export function fitReference(ref: Reference, body: Proportions): Reference {
  const poses = ref.teacher.map((p) => retarget(p, ref.teacherBody, body, ref.posture))
  return { ...ref, ...shapeOf(poses, ref.fps, ref.posture), body }
}

function shapeOf(poses: Pose[], fps: number, posture: Posture) {
  const feats = poses.map((p) => computeFeatures(p, posture))
  const n = feats.length
  const k = Math.max(1, Math.round(LOOKAHEAD_SEC * fps))
  // Measured over a short look-ahead rather than frame to frame, so tracker
  // jitter in a video reference doesn't read as movement.
  const motion = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const j = Math.min(n - 1, i + k)
    motion[i] = j === i ? 0 : (distance(feats[i], feats[j]) * fps) / (j - i)
  }
  return { poses, feats, motion }
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

/** Slack on the hold check, so tracker noise in a true hold doesn't stall it. */
const HOLD_EPS = 0.005

// How still the learner is: their shape eased over a short and a longer time.
// Moving steadily, the two part by the speed × the difference of the times.
const STILL_FAST_SEC = 0.15
const STILL_SLOW_SEC = 0.6
/** Below this `stir` the learner counts as still. Above the teacher's `holdMotion`: tracked people sway. */
const STILL_STIR = 0.25
/** How long the learner holds the shape, still, while the teacher waits, before the teacher settles in with them. */
const SETTLE_SEC = 1
/** Teacher progress (s of the move) that counts as keeping up with the learner, so it isn't waiting on them. */
const SETTLE_PROGRESS_SEC = 0.15
/** How near a hold must be for a settled learner to be carried into it. */
const SETTLE_REACH_SEC = 0.5
/** How long a still stretch must last to count as a hold to carry a learner into. */
const SETTLE_HOLD_SEC = 0.5

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
 * the learner holds the shape too, unless the teacher a moment later pulls
 * away from them by more than half of how far the teacher itself moves. Slow,
 * subtle movement also reads as a hold; there the teacher pulls away, so it
 * keeps to the learner's pace. A hold at the very end always runs on to done.
 *
 * A learner whose shape is steadily a little off the teacher's can match the
 * way into a hold better than the hold, and the look-ahead can't tell that
 * from slow movement. So it also watches how still the learner is (`stir`):
 * once they have held the shape, still, for a second while the teacher waited
 * just short of a hold they already have the shape of, they are `settled`, and
 * the teacher carries on with them at real time to the hold's end, for as long
 * as they stay still and in the shape.
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
  /** How fast the learner's shape is changing, per second, eased; like the teacher's `motion`. */
  stir = 0
  /** The learner is holding the shape, still, and the teacher carries on with them into a hold and through it. */
  settled = false
  private fast: Float32Array | null = null
  private slow: Float32Array | null = null
  private settleSec = 0
  private settleFrom = 0
  /** While settled, the frame the hold being carried through ends at. */
  private settleUntil = 0

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
    this.stir = 0
    this.settled = false
    this.fast = null
    this.slow = null
    this.settleSec = 0
    this.settleFrom = 0
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
    this.easeStill(user, dt)

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
      // Slow or subtle movement can read as a hold too. Only run it at real
      // time unless the teacher a moment on pulls away from the learner by
      // more than half of how far the teacher itself moves in that moment.
      // Near the end of the move, always run on so a held final pose finishes.
      const ahead = this.frame + Math.max(1, Math.round(LOOKAHEAD_SEC * fps))
      const atEnd = ahead >= n - 1
      const a = Math.min(n - 1, ahead)
      const pull = distance(user, ref.feats[a]) - this.distance
      if (atEnd || pull <= 0.5 * distance(ref.feats[this.frame], ref.feats[a]) + HOLD_EPS) {
        step = Math.max(step, dt * fps)
      }
    }
    this.settle(user, lo, dt)
    // Settled, the teacher carries on into the hold and through it at real time, no faster.
    if (this.settled) step = dt * fps
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

  /** Whether the learner is `settled` (see the class comment), and until which frame. */
  private settle(user: Features, lo: number, dt: number) {
    const { ref, opts } = this
    const fps = ref.fps
    const n = ref.feats.length
    const release = () => {
      this.settled = false
      this.settleSec = 0
      this.settleFrom = this.pos
    }
    if (this.lost || this.stir >= STILL_STIR || this.distance >= opts.matchThreshold) return release()
    if (this.settled) {
      if (this.pos >= this.settleUntil) release()
      return
    }
    // The teacher kept up with them, so it wasn't waiting.
    let restart = this.pos - this.settleFrom > SETTLE_PROGRESS_SEC * fps
    // Or it has run on past a hold that a slow learner is still in: it is ahead, and must wait.
    if (ref.motion[this.frame] >= opts.holdMotion) {
      for (let i = Math.max(0, lo - Math.round(SETTLE_REACH_SEC * fps)); i < lo && !restart; i++) {
        restart = ref.motion[i] < opts.holdMotion && distance(user, ref.feats[i]) < this.distance
      }
    }
    if (restart) {
      this.settleSec = 0
      this.settleFrom = this.pos
    }
    this.settleSec += dt
    // Only just short of a hold: within a hold, or a slow stretch that reads as one, the hold rule judges.
    if (this.settleSec < SETTLE_SEC || ref.motion[this.frame] < opts.holdMotion) return
    const reach = Math.min(n - 1, this.frame + Math.round(SETTLE_REACH_SEC * fps))
    let start = this.frame
    while (start <= reach && ref.motion[start] >= opts.holdMotion) start++
    if (start > reach) return
    let end = start
    while (end < n - 1 && ref.motion[end] < opts.holdMotion) end++
    if (end - start < SETTLE_HOLD_SEC * fps || distance(user, ref.feats[start]) >= opts.matchThreshold) return
    this.settled = true
    this.settleUntil = end
  }

  /** Eases the learner's shape at two speeds; how far apart they are says how fast it is changing (`stir`). */
  private easeStill(user: Features, dt: number) {
    const v = user.vec
    if (!this.fast || !this.slow || this.fast.length !== v.length) {
      this.fast = Float32Array.from(v)
      this.slow = Float32Array.from(v)
      this.stir = 0
      return
    }
    const kf = 1 - Math.exp(-dt / STILL_FAST_SEC)
    const ks = 1 - Math.exp(-dt / STILL_SLOW_SEC)
    for (let i = 0; i < v.length; i++) {
      this.fast[i] += (v[i] - this.fast[i]) * kf
      this.slow[i] += (v[i] - this.slow[i]) * ks
    }
    const apart = distance({ vec: this.fast, vis: user.vis }, { vec: this.slow, vis: user.vis })
    this.stir = apart / (STILL_SLOW_SEC - STILL_FAST_SEC)
  }

  private easePace(rate: number, dt: number) {
    this.pace += (rate - this.pace) * (1 - Math.exp(-dt / 0.6))
  }
}
