import type { Pose, Posture, Pt } from '../skeleton'

// Gentle words for when the camera can't see the learner well. Pure, so it can
// be tested: `TrackingHints.update` is given the (filtered) learner each frame
// and says what, if anything, to show. Nothing is said while tracking is fine,
// and a trouble has to last a moment before it's mentioned, so a passing flicker
// never interrupts.
//
// Framing is checked against the posture. Standing needs the whole body, head to
// feet; seated needs the head and the hands resting in the lap, where every seated
// move starts and ends. When what's missing is below the picture, the words say how
// to bring it in (sit or step back, or tilt the camera down) rather than only what
// can't be seen.

export type TrackingTrouble = 'lost' | 'close' | 'low' | 'hands'

export const TRACKING_HINTS: Record<TrackingTrouble, Record<Posture, string>> = {
  lost: { standing: 'Step into the light.', seated: 'Step into the light.' },
  close: { standing: 'Step back a little.', seated: 'Sit back a little.' },
  // The body sits low in the picture: what the move needs at the bottom is below it.
  low: {
    standing: 'Step back or tilt the camera down, so your feet are in the light.',
    seated: 'Sit back or tilt the camera down, so your hands in your lap are in the light.',
  },
  hands: {
    standing: 'Keep your hands where the camera can see them.',
    seated: 'Keep your hands where the camera can see them.',
  },
}

export interface TrackingHintOptions {
  /** Below this visibility a joint counts as unseen. */
  seen: number
  /** How long a trouble lasts before it is mentioned, in seconds. */
  after: number
  /** How long it has to be gone before the words go. */
  clearAfter: number
  /** Standing, a body taller than this share of the frame is too close. */
  maxHeight: number
  /** Seated, shoulders wider than this share of the frame are too close. */
  maxShoulders: number
  /**
   * Seated, how far below the shoulders the hands rest in the lap, in shoulder
   * widths. Every seated move starts and ends there, so it must be in frame.
   */
  lap: number
  /** Standing, room above the head (share of the frame height) that says the camera could look lower. */
  headroom: number
}

export const DEFAULT_TRACKING_HINTS: TrackingHintOptions = {
  seen: 0.5,
  after: 1,
  clearAfter: 0.6,
  maxHeight: 0.92,
  maxShoulders: 0.5,
  // The built-in figure's rest is 1.25; people's hands rest lower, on the thighs (1.3–1.5 in the owner's sessions).
  lap: 1.5,
  headroom: 0.1,
}

export interface TrackingInput {
  /** The learner, or null when no one is found. */
  pose: Pose | null
  /** Width / height of the camera image the pose is in. */
  aspect: number
  posture: Posture
  dt: number
}

/** What's wrong with tracking this frame, most important first, or null. */
export function troubleOf(
  { pose, aspect, posture }: Omit<TrackingInput, 'dt'>,
  opts: TrackingHintOptions = DEFAULT_TRACKING_HINTS,
): TrackingTrouble | null {
  if (!pose) return 'lost'
  const seen = (p: Pt) => p.v >= opts.seen
  const inFrame = (p: Pt) => seen(p) && p.x >= 0 && p.x <= aspect && p.y >= 0 && p.y <= 1
  if (!seen(pose.lShoulder) && !seen(pose.rShoulder)) return 'lost'
  const hands = inFrame(pose.lWrist) && inFrame(pose.rWrist)
  if (posture === 'standing') {
    // The whole body, head to feet.
    const pts = Object.values(pose).filter(seen)
    const top = Math.min(...pts.map((p) => p.y))
    const bottom = Math.max(...pts.map((p) => p.y))
    const hips = seen(pose.lHip) || seen(pose.rHip)
    const ankles = inFrame(pose.lAnkle) || inFrame(pose.rAnkle)
    if (bottom - top > opts.maxHeight || !hips) return 'close'
    if (!ankles) return seen(pose.head) && pose.head.y > opts.headroom ? 'low' : 'close'
  } else {
    // Head to lap: the head in the picture, and the hands' resting place above its bottom edge.
    const w = Math.hypot(pose.lShoulder.x - pose.rShoulder.x, pose.lShoulder.y - pose.rShoulder.y)
    if (w > opts.maxShoulders * aspect || (seen(pose.head) && pose.head.y < 0)) return 'close'
    const shoulders = seen(pose.lShoulder) && seen(pose.rShoulder)
    const lapY = (pose.lShoulder.y + pose.rShoulder.y) / 2 + opts.lap * w
    if (!hands && shoulders && lapY > 1) return 'low'
  }
  if (!hands) return 'hands'
  return null
}

/** Keeps the tracking words steady: each trouble must last a moment to be said, and be gone a moment to be unsaid. */
export class TrackingHints {
  private trouble: TrackingTrouble | null = null
  private since = 0
  private shown: TrackingTrouble | null = null
  private clear = 0
  readonly opts: TrackingHintOptions

  constructor(opts: Partial<TrackingHintOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKING_HINTS, ...opts }
  }

  /** The trouble being mentioned now, or null. */
  update(input: TrackingInput): TrackingTrouble | null {
    const now = troubleOf(input, this.opts)
    if (now !== this.trouble) {
      this.trouble = now
      this.since = 0
    }
    this.since += input.dt
    if (now && this.since >= this.opts.after) {
      this.shown = now
      this.clear = 0
    } else if (this.shown && now !== this.shown) {
      this.clear += input.dt
      if (this.clear >= this.opts.clearAfter) this.shown = null
    } else this.clear = 0
    return this.shown
  }

  /** The words for the trouble being mentioned, or ''. */
  text(posture: Posture): string {
    return this.shown ? TRACKING_HINTS[this.shown][posture] : ''
  }

  reset() {
    this.trouble = null
    this.shown = null
    this.since = 0
    this.clear = 0
  }
}
