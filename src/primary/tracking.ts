import type { Pose, Posture, Pt } from '../skeleton'

// Gentle words for when the camera can't see the learner well. Pure, so it can
// be tested: `TrackingHints.update` is given the (filtered) learner each frame
// and says what, if anything, to show. Nothing is said while tracking is fine,
// and a trouble has to last a moment before it's mentioned, so a passing flicker
// never interrupts.

export type TrackingTrouble = 'lost' | 'close' | 'hands'

export const TRACKING_HINTS: Record<TrackingTrouble, Record<Posture, string>> = {
  lost: { standing: 'Step into the light.', seated: 'Step into the light.' },
  close: { standing: 'Step back a little.', seated: 'Sit back a little.' },
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
}

export const DEFAULT_TRACKING_HINTS: TrackingHintOptions = {
  seen: 0.5,
  after: 1,
  clearAfter: 0.6,
  maxHeight: 0.92,
  maxShoulders: 0.5,
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
  if (posture === 'standing') {
    const pts = Object.values(pose).filter(seen)
    const top = Math.min(...pts.map((p) => p.y))
    const bottom = Math.max(...pts.map((p) => p.y))
    const hips = seen(pose.lHip) || seen(pose.rHip)
    const ankles = seen(pose.lAnkle) || seen(pose.rAnkle)
    if (bottom - top > opts.maxHeight || (hips && !ankles) || !hips) return 'close'
  } else {
    const w = Math.hypot(pose.lShoulder.x - pose.rShoulder.x, pose.lShoulder.y - pose.rShoulder.y)
    if (w > opts.maxShoulders * aspect) return 'close'
  }
  if (!inFrame(pose.lWrist) || !inFrame(pose.rWrist)) return 'hands'
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
