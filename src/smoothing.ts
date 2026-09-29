import type { LandmarkLike } from './skeleton'

// Temporal filtering of the learner's landmarks, so the tracker's frame-to-frame
// shiver doesn't reach the matching or the drawing. Poses and landmarks keep
// their shape here: this only works on the raw MediaPipe array, before
// `poseFromLandmarks`, so it covers every landmark (the hands' points too).

/**
 * The One Euro filter (Casiez, Roussel & Vogel, CHI 2012): a low-pass filter
 * whose cutoff rises with speed. Still, the cutoff sits at `minCutoff` and the
 * jitter is smoothed away; moving, it opens up by `beta` per unit of speed so
 * the lag stays small. Timestamps are real, so it behaves the same at any
 * frame rate.
 */
export interface OneEuroOptions {
  /** Cutoff when still, in Hz. Lower is steadier and laggier. */
  minCutoff: number
  /** How much the cutoff rises per unit of speed (units per second), in Hz. */
  beta: number
  /** Cutoff of the speed estimate, in Hz. */
  dCutoff: number
}

/**
 * Tuned for qi gong: slow, continuous movement in normalised image units
 * (0..1 across the frame). MediaPipe's landmarks shiver by about 0.003 to
 * 0.006 when someone stands still. At 0.6 Hz still, that jitter is cut to
 * about a quarter at 30 fps; a hand moving at a slow 0.1 to 0.3 frame
 * heights a second opens the cutoff to 1.4 to 3 Hz, a lag of 50 to 110 ms.
 * `beta` stays modest because the jitter's own speed also opens the cutoff.
 */
export const LANDMARK_FILTER: OneEuroOptions = { minCutoff: 0.6, beta: 8, dCutoff: 1 }

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0

  constructor(readonly opts: OneEuroOptions = LANDMARK_FILTER) {}

  /** Filter `value` sampled at `timeMs`. The first sample passes through. */
  filter(value: number, timeMs: number): number {
    if (this.x === null) {
      this.x = value
      this.dx = 0
      this.t = timeMs
      return value
    }
    const dt = (timeMs - this.t) / 1000
    if (dt <= 0) return this.x
    this.t = timeMs
    const d = (value - this.x) / dt
    this.dx += (d - this.dx) * alpha(this.opts.dCutoff, dt)
    const cutoff = this.opts.minCutoff + this.opts.beta * Math.abs(this.dx)
    this.x += (value - this.x) * alpha(cutoff, dt)
    return this.x
  }

  /** Forget the history, so the next sample starts afresh. */
  reset() {
    this.x = null
  }
}

export interface LandmarkFilterOptions {
  filter: OneEuroOptions
  /** Below this visibility a landmark is treated as lost. */
  minVisibility: number
  /** How long a lost landmark stays where it was last seen, at its last visibility. */
  holdMs: number
  /** Then how long its visibility takes to fade to what the tracker now says. */
  fadeMs: number
  /**
   * A detection whose shoulder width (or torso length, with the hips well
   * seen) differs from the filtered body's by more than this share is
   * implausible, as is one whose shoulders swap sides or jump by more than
   * `maxJump` shoulder widths in a thirtieth of a second: it is passed over as
   * if no one were found.
   */
  maxScaleChange: number
  maxJump: number
  /** This many implausible detections in a row that agree with each other are a real change, and are taken. */
  reacquireFrames: number
}

export const DEFAULT_LANDMARK_FILTER: LandmarkFilterOptions = {
  filter: LANDMARK_FILTER,
  // `confidence` in skeleton.ts counts 0.3 as unseen and 0.7 as sure; halfway is lost.
  minVisibility: 0.5,
  holdMs: 250,
  fadeMs: 500,
  // A body can't change size by a third in one frame; MediaPipe sometimes
  // collapses the shoulders or swaps the sides for a frame or two, arms overhead.
  maxScaleChange: 0.35,
  // Shifting the whole body quickly is about a tenth of a shoulder width a frame.
  maxJump: 0.5,
  reacquireFrames: 3,
}

// MediaPipe's shoulders and hips.
const L_SHOULDER = 11
const R_SHOULDER = 12
const L_HIP = 23
const R_HIP = 24
/** Hips must be this well seen to measure the torso by: out of frame, MediaPipe guesses them. */
const SURE = 0.8

type Pt2 = { x: number; y: number }
const dist = (a: Pt2, b: Pt2) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Pt2, b: Pt2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

/** The few points a detection's plausibility is judged by, or null if its shoulders aren't seen. */
interface Frame {
  ls: Pt2
  rs: Pt2
  /** Shoulder width. */
  w: number
  /** Torso length, when the hips are well seen. */
  torso: number | null
}

function frameOf(p: (i: number) => (Pt2 & { visibility?: number }) | null, minVisibility: number): Frame | null {
  const ls = p(L_SHOULDER)
  const rs = p(R_SHOULDER)
  if (!ls || !rs || (ls.visibility ?? 1) < minVisibility || (rs.visibility ?? 1) < minVisibility) return null
  const w = dist(ls, rs)
  if (w <= 1e-4) return null
  const lh = p(L_HIP)
  const rh = p(R_HIP)
  const hips = lh && rh && (lh.visibility ?? 1) >= SURE && (rh.visibility ?? 1) >= SURE
  return { ls, rs, w, torso: hips ? dist(midpoint(ls, rs), midpoint(lh, rh)) : null }
}

interface Track {
  x: OneEuro
  y: OneEuro
  /** Last good filtered position and visibility. */
  px: number
  py: number
  pv: number
  /** When it was last seen well, or -1 for never. */
  seen: number
}

/**
 * Filters a stream of MediaPipe landmark arrays: each coordinate through its
 * own One Euro filter. A landmark whose visibility drops below
 * `minVisibility` (or a whole frame with no one found) doesn't jump: it holds
 * its last good position for `holdMs`, then its visibility fades over
 * `fadeMs` to what the tracker reports. When it's seen again after longer
 * than the hold, its filter starts afresh rather than sweeping across from
 * the old place. Once no one has been found for the hold and the fade, the
 * result is null.
 *
 * A detection that can't be a body moving (its shoulders collapse, swap sides
 * or leap, or the torso stretches, from one frame to the next) is passed over
 * like a frame with no one found, so the last good pose holds. A few such
 * detections in a row that agree with each other are a real change (someone
 * new, or much nearer): those are taken, and the filters start afresh there.
 */
export class LandmarkFilter {
  private tracks: Track[] = []
  private lastFound = -Infinity
  /** The last implausible detection, how many agreeing ones have come in a row, and when. */
  private odd: Frame | null = null
  private oddCount = 0
  private oddTime = 0
  /** How many detections have been passed over as implausible. */
  rejected = 0
  readonly opts: LandmarkFilterOptions

  constructor(opts: Partial<LandmarkFilterOptions> = {}) {
    this.opts = { ...DEFAULT_LANDMARK_FILTER, ...opts }
  }

  update(lm: readonly LandmarkLike[] | null, timeMs: number): LandmarkLike[] | null {
    const { holdMs, fadeMs } = this.opts
    if (lm && this.implausible(lm, timeMs)) {
      this.rejected++
      lm = null
    }
    if (lm) this.lastFound = timeMs
    else if (timeMs - this.lastFound >= holdMs + fadeMs || !this.tracks.length) {
      this.reset()
      return null
    }
    const n = lm ? lm.length : this.tracks.length
    const out: LandmarkLike[] = new Array(n)
    for (let i = 0; i < n; i++) out[i] = this.step(i, lm?.[i] ?? null, timeMs)
    return out
  }

  private step(i: number, p: LandmarkLike | null, timeMs: number): LandmarkLike {
    const { holdMs, fadeMs, minVisibility } = this.opts
    let t = this.tracks[i]
    if (!t) {
      t = this.tracks[i] = {
        x: new OneEuro(this.opts.filter),
        y: new OneEuro(this.opts.filter),
        px: p?.x ?? 0,
        py: p?.y ?? 0,
        pv: 0,
        seen: -1,
      }
    }
    const v = p ? (p.visibility ?? 1) : 0
    if (p && v >= minVisibility) {
      if (t.seen < 0 || timeMs - t.seen > holdMs) {
        t.x.reset()
        t.y.reset()
      }
      t.px = t.x.filter(p.x, timeMs)
      t.py = t.y.filter(p.y, timeMs)
      t.pv = v
      t.seen = timeMs
      return { x: t.px, y: t.py, visibility: v }
    }
    // Lost: stay put, then let the visibility go.
    if (t.seen < 0) return { x: p?.x ?? t.px, y: p?.y ?? t.py, visibility: v }
    const since = timeMs - t.seen
    const k = Math.min(1, Math.max(0, (since - holdMs) / fadeMs))
    return { x: t.px, y: t.py, visibility: t.pv + (v - t.pv) * k }
  }

  /** Whether `lm` can't follow from the body filtered so far; a run of agreeing ones is taken as a real change. */
  private implausible(lm: readonly LandmarkLike[], timeMs: number): boolean {
    const raw = frameOf((i) => lm[i] ?? null, this.opts.minVisibility)
    const base = this.filtered(timeMs)
    if (!raw || !base || this.follows(raw, base, timeMs - this.lastFound)) {
      this.odd = null
      this.oddCount = 0
      return false
    }
    this.oddCount = this.odd && this.follows(raw, this.odd, timeMs - this.oddTime) ? this.oddCount + 1 : 1
    this.odd = raw
    this.oddTime = timeMs
    if (this.oddCount < this.opts.reacquireFrames) return true
    // A real change: start afresh there rather than sweeping across.
    this.reset()
    return false
  }

  /** Whether frame `b` could follow frame `a` after `ms`. */
  private follows(b: Frame, a: Frame, ms: number): boolean {
    const { maxScaleChange, maxJump } = this.opts
    if (Math.abs(b.w / a.w - 1) > maxScaleChange) return false
    if (a.torso !== null && b.torso !== null && Math.abs(b.torso / a.torso - 1) > maxScaleChange) return false
    // The shoulders swapped sides (the line between them turned more than a right angle).
    if ((b.rs.x - b.ls.x) * (a.rs.x - a.ls.x) + (b.rs.y - b.ls.y) * (a.rs.y - a.ls.y) <= 0) return false
    // A slow camera allows a longer jump; passed-over frames don't widen it further.
    const jump = maxJump * a.w * Math.min(2, Math.max(1, (ms * 30) / 1000))
    return dist(b.ls, a.ls) <= jump && dist(b.rs, a.rs) <= jump
  }

  /** The filtered body as it stands, if its shoulders were seen lately. */
  private filtered(timeMs: number): Frame | null {
    const { holdMs, minVisibility } = this.opts
    return frameOf((i) => {
      const t = this.tracks[i]
      if (!t || t.seen < 0 || timeMs - t.seen > holdMs) return null
      return { x: t.px, y: t.py, visibility: t.pv }
    }, minVisibility)
  }

  reset() {
    this.tracks = []
    this.lastFound = -Infinity
    this.odd = null
    this.oddCount = 0
  }
}

/** Counts how often something happens, as a rate in Hz eased over about a second. */
export class RateMeter {
  hz = 0
  private last = -1

  tick(timeMs: number) {
    if (this.last >= 0 && timeMs > this.last) {
      const dt = (timeMs - this.last) / 1000
      const k = 1 - Math.exp(-dt / 1)
      this.hz += (1 / dt - this.hz) * k
    }
    this.last = timeMs
  }
}
