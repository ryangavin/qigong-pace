import type { Reference } from '../follower'
import {
  bodyScale,
  jointOf,
  JOINTS,
  segmentCounts,
  SEGMENTS,
  toPx,
  type Pose,
  type Posture,
  type Pt,
  type View,
} from '../skeleton'

// Each hand has its own light: warm for the screen-left hand, cool for the
// screen-right. Both are near white at the core, so they read over every
// energy palette; the tint is carried by the glow, the chevrons and the rings.
type Side = 'l' | 'r'
const TINTS: Record<Side, { core: number[]; glow: number[] }> = {
  l: { core: [255, 241, 216], glow: [255, 184, 96] },
  r: { core: [224, 243, 255], glow: [104, 190, 255] },
}
/** The teacher's faint outline. */
const OUTLINE = [255, 244, 222]
/** Dark laid under every bright line, so it reads over bright energy as well as the dim room. */
const CASING = [4, 5, 9]
const rgba = (c: number[], a: number) => `rgba(${c.join(', ')}, ${Math.min(1, Math.max(0, a))})`
const clamp01 = (u: number) => Math.min(1, Math.max(0, u))
const smoothstep = (u: number) => u * u * (3 - 2 * u)

/** Sizes in device pixels, from the body's length `T` on screen, never below a few CSS pixels (`u`). */
const sizes = (T: number, u: number) => ({
  /** The path's bright core. */
  core: Math.max(2.5 * u, T * 0.016),
  bead: Math.max(6 * u, T * 0.045),
  /** The ring on the learner's hand. */
  ring: Math.max(12 * u, T * 0.09),
  /** The ring around a bead that fills over a hold. */
  hold: Math.max(15 * u, T * 0.12),
})

/** How well one limb matches, 0..1, from its mismatch: whole within the threshold, gone by 2.5× it. */
export function matchOf(err: number, threshold: number): number {
  const u = clamp01((err - threshold) / (1.5 * threshold))
  return 1 - smoothstep(u)
}

/** The teacher's pose (as fitted to the learner, `ref.poses`) at fractional frame `i`, between the frames either side. */
export function poseBetween(ref: Reference, i: number): Pose {
  const n = ref.poses.length - 1
  const c = Math.min(n, Math.max(0, i))
  const a = Math.floor(c)
  const t = c - a
  const p = ref.poses[a]
  if (!t) return p
  const q = ref.poses[Math.min(n, a + 1)]
  const out = {} as Pose
  for (const j of JOINTS) {
    const u = p[j]
    const v = q[j]
    out[j] = { x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t, v: u.v + (v.v - u.v) * t }
  }
  return out
}

/** The teacher's palms at fractional frame `i`, laid by `place` on the learner (`fitOnto`). */
export function palmsAt(ref: Reference, i: number, place: (p: Pose) => Pose): { l: Pt; r: Pt } {
  const p = place(poseBetween(ref, i))
  return { l: p.lPalm, r: p.rPalm }
}

/**
 * Where each palm goes over the next `secs` of the move from frame `from`
 * (fractional), laid by `place` on the learner's body. Sampled 20 times a
 * second, always ending exactly where the stretch ends.
 */
export function handPath(ref: Reference, from: number, secs: number, place: (p: Pose) => Pose): { l: Pt[]; r: Pt[] } {
  const last = Math.min(ref.poses.length - 1, from + Math.max(0, secs) * ref.fps)
  const stepBy = ref.fps / 20
  const l: Pt[] = []
  const r: Pt[] = []
  const add = (i: number) => {
    const w = palmsAt(ref, i, place)
    l.push(w.l)
    r.push(w.r)
  }
  let i = from
  for (; i <= last + 1e-6; i += stepBy) add(i)
  if (i - stepBy < last - 1e-6) add(last)
  return { l, r }
}

/**
 * The still stretch of the move around frame `i`, where the teacher holds a
 * shape (as the follower reads it: motion under `holdMotion`), or null where
 * the teacher is moving or the stillness is shorter than `minSec`.
 */
export function holdAt(ref: Reference, i: number, holdMotion: number, minSec = 0.8): { start: number; end: number } | null {
  const n = ref.motion.length
  const f = Math.min(n - 1, Math.max(0, Math.round(i)))
  if (ref.motion[f] >= holdMotion) return null
  let start = f
  while (start > 0 && ref.motion[start - 1] < holdMotion) start--
  let end = f
  while (end < n - 1 && ref.motion[end + 1] < holdMotion) end++
  return (end - start) / ref.fps < minSec ? null : { start, end }
}

/** How far through `hold` the learner at `pos` is, 0..1. */
export const holdProgress = (hold: { start: number; end: number }, pos: number) =>
  clamp01((pos - hold.start) / Math.max(1, hold.end - hold.start))

/**
 * The frame where each hand should be now: `leadSec` of the move ahead of
 * the learner at `pos`, but never past the end of a hold they are in, so the
 * bead stays put while they hold.
 */
export function beadFrame(ref: Reference, pos: number, leadSec: number, hold: { end: number } | null): number {
  const lead = Math.min(ref.poses.length - 1, pos + leadSec * ref.fps)
  return hold ? Math.min(lead, Math.max(pos, hold.end)) : lead
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2) : 0
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
}

/**
 * How near a hand is to where it should be, 0..1, measured to the nearest
 * point of `way` (the stretch from where the learner is in the move up to the
 * bead, so a hand a moment behind its bead still counts): whole within 0.3
 * body lengths (`body`, in the same units), gone by 0.9.
 */
export function nearness(hand: Pt, way: Pt[], body: number): number {
  let d = Infinity
  if (way.length === 1) d = Math.hypot(hand.x - way[0].x, hand.y - way[0].y)
  for (let i = 1; i < way.length; i++) d = Math.min(d, distToSegment(hand, way[i - 1], way[i]))
  if (!Number.isFinite(d)) return 0
  return 1 - smoothstep(clamp01((d / body - 0.3) / 0.6))
}

/**
 * Whether any of `points` (image units) falls outside what a `view` of a
 * `w`×`h` box shows, or within `margin` (pixels) of its edge: a bead or path
 * there can't be reached in the picture, so the learner is asked to step back.
 */
export function outOfView(points: Pt[], view: View, w: number, h: number, margin: number): boolean {
  return points.some((p) => {
    const [x, y] = toPx(view, p)
    return x < margin || x > w - margin || y < margin || y > h - margin
  })
}

/** Whether a hand is locked on to its bead, with some give so it doesn't flicker at the edge. */
export const lockOn = (locked: boolean, near: number) => (locked ? near > 0.4 : near > 0.75)

export interface GuidanceMix {
  /** How strongly the hands' paths show, 0..1. The beads and hand rings are always whole. */
  pathStrength: number
  /** How far ahead the paths reach, in seconds of the move. */
  pathSeconds: number
  /** The energy layer's strength, 0..1. */
  energyStrength: number
}

/**
 * Learning first, energy second. From how well the learner knows the move,
 * `reps` whole repetitions of it and `flow` (0..1, how well they have been
 * tracking lately): at first the way ahead is shown in full and the energy
 * only glimmers; as the move is learned and followed smoothly the energy
 * grows, and the paths shorten and soften.
 */
export function guidanceMix(reps: number, flow: number): GuidanceMix {
  const known = (1 - 0.5 ** Math.max(0, reps)) * clamp01(flow)
  return {
    pathStrength: 1 - 0.3 * known,
    pathSeconds: 3 - 1.5 * known,
    energyStrength: 0.12 + 0.48 * known,
  }
}

export interface GuidanceFrame {
  view: View
  /** Device pixels per CSS pixel, for line widths. */
  dpr: number
  /** The teacher where the beads are, fitted to the learner's body and laid on it: drawn as a faint outline. */
  shape: Pose
  /** The learner, or null when no one is seen. */
  learner: Pose | null
  posture: Posture
  /** Each hand's path from about where the learner is in the move up to its bead: the stretch falling away. */
  behind: { l: Pt[]; r: Pt[] }
  /** Each hand's path from its bead on, the way to trace. */
  ahead: { l: Pt[]; r: Pt[] }
  /** Where each hand should be now. */
  bead: { l: Pt; r: Pt }
  /** How far through a hold (or the opening shape) the learner is, 0..1; null when not holding. */
  hold: number | null
  /** Before the move begins: the opening shape is shown more clearly. */
  waiting: boolean
  /** Overall strength, 0..1: it fades in when someone is seen. */
  presence: number
  /** From `guidanceMix`. */
  pathStrength: number
  dt: number
  /** Seconds, for the flow along the paths and the pulse of a hold. */
  time: number
}

interface Hand {
  /** The bead, eased so it glides rather than jumps when a hold ends. */
  bead: Pt | null
  locked: boolean
  /** The lock eased, 0..1, for the ring filling. */
  lock: number
  near: number
}

/**
 * Draws the guidance overlay: for each hand a bright path to trace, a bead
 * where the hand should be now and a ring on the learner's own hand that
 * locks on to it; behind them, the teacher's shape as a faint outline.
 */
export class Guidance {
  private hands: Record<Side, Hand> = {
    l: { bead: null, locked: false, lock: 0, near: 0 },
    r: { bead: null, locked: false, lock: 0, near: 0 },
  }

  constructor(private reducedMotion: () => boolean) {}

  /**
   * Drawn with ordinary alpha, not screened: each bright line sits on a thin
   * dark casing, so it stays crisp over bright energy as well as the dark room.
   */
  draw(ctx: CanvasRenderingContext2D, f: GuidanceFrame) {
    const { width: w, height: h } = ctx.canvas
    ctx.clearRect(0, 0, w, h)
    this.remember(f)
    if (f.presence < 0.01) return
    const T = bodyScale(f.shape, f.posture) * f.view.s
    const u = f.dpr
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    this.drawShape(ctx, f, T, u)
    for (const side of ['l', 'r'] as const) {
      const a = f.pathStrength * f.presence
      // What's behind the bead falls away toward the hand; ahead fades out at its far end.
      this.drawPath(ctx, f, f.behind[side], side, (t) => 0.4 * a * t * t, T, u, false)
      const hold = f.hold !== null && !f.waiting ? 0.55 : 1
      this.drawPath(ctx, f, f.ahead[side], side, (t) => a * hold * (1 - smoothstep(clamp01((t - 0.55) / 0.45))), T, u, true)
    }
    for (const side of ['l', 'r'] as const) this.drawHand(ctx, f, side, T, u)
    for (const side of ['l', 'r'] as const) this.drawBead(ctx, f, side, T, u)
    ctx.restore()
  }

  /** Ease each bead and each hand's lock. */
  private remember(f: GuidanceFrame) {
    const glide = 1 - Math.exp(-f.dt / 0.08)
    const settle = 1 - Math.exp(-f.dt / 0.15)
    for (const side of ['l', 'r'] as const) {
      const hand = this.hands[side]
      const to = f.bead[side]
      hand.bead = hand.bead ? { x: hand.bead.x + (to.x - hand.bead.x) * glide, y: hand.bead.y + (to.y - hand.bead.y) * glide, v: to.v } : to
      const palm = f.learner?.[side === 'l' ? 'lPalm' : 'rPalm']
      hand.near =
        palm && palm.v >= 0.35 ? nearness(palm, [...f.behind[side], hand.bead], bodyScale(f.learner!, f.posture)) : 0
      hand.locked = lockOn(hand.locked, hand.near)
      hand.lock += ((hand.locked ? 1 : 0) - hand.lock) * settle
    }
  }

  /** The teacher's limbs as a faint thin outline: there to show the shape, never to trace. */
  private drawShape(ctx: CanvasRenderingContext2D, f: GuidanceFrame, T: number, u: number) {
    const p = f.shape
    const px = (q: Pt) => toPx(f.view, q)
    const a = f.presence * (f.waiting ? 0.5 : 0.24)
    const width = Math.max(1.2 * u, T * 0.007)
    const trace = () => {
      ctx.beginPath()
      SEGMENTS.forEach((s, i) => {
        if (!s.draw || !segmentCounts(i, f.posture)) return
        ctx.moveTo(...px(jointOf(p, s.a)))
        ctx.lineTo(...px(jointOf(p, s.b)))
      })
      const [hx, hy] = px(p.head)
      const r = bodyScale(p, f.posture) * f.view.s * 0.2
      ctx.moveTo(hx + r, hy)
      ctx.arc(hx, hy, r, 0, Math.PI * 2)
    }
    trace()
    ctx.strokeStyle = rgba(CASING, a * 0.8)
    ctx.lineWidth = width + 2 * u
    ctx.stroke()
    ctx.strokeStyle = rgba(OUTLINE, a)
    ctx.lineWidth = width
    ctx.stroke()
  }

  /**
   * One hand's path: a dark casing, a soft tinted glow and a thin bright core,
   * stroked a segment at a time so each can fade by `alpha(t)`, t running 0..1
   * along the path. With `flow`, chevrons drift along it in the direction of travel.
   */
  private drawPath(
    ctx: CanvasRenderingContext2D,
    f: GuidanceFrame,
    path: Pt[],
    side: Side,
    alpha: (t: number) => number,
    T: number,
    u: number,
    flow: boolean,
  ) {
    if (path.length < 2) return
    const tint = TINTS[side]
    const pts = path.map((p) => toPx(f.view, p))
    const { core } = sizes(T, u)
    const passes = [
      { color: CASING, width: core + 4 * u, k: 0.6 },
      { color: tint.glow, width: core * 4, k: 0.28 },
      { color: tint.core, width: core, k: 1 },
    ]
    // Butt ends, so the segments meet without overlapping into brighter dots.
    ctx.lineCap = 'butt'
    for (const pass of passes) {
      ctx.lineWidth = pass.width
      for (let i = 1; i < pts.length; i++) {
        const a = alpha((i - 0.5) / (pts.length - 1)) * pass.k
        if (a < 0.01) continue
        ctx.strokeStyle = rgba(pass.color, a)
        ctx.beginPath()
        ctx.moveTo(...pts[i - 1])
        ctx.lineTo(...pts[i])
        ctx.stroke()
      }
    }
    ctx.lineCap = 'round'
    if (!flow) return

    // Chevrons, evenly spaced along the path's length, drifting forward.
    const lens = [0]
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    const total = lens.at(-1)!
    const gap = Math.max(22 * u, T * 0.2)
    if (total < gap) return
    const drift = this.reducedMotion() ? 0.5 : ((f.time * 0.9) % 1 + 1) % 1
    const size = Math.max(4 * u, T * 0.032)
    let j = 1
    for (let s = gap * (0.5 + drift); s < total; s += gap) {
      while (j < pts.length - 1 && lens[j] < s) j++
      const seg = lens[j] - lens[j - 1] || 1
      const k = (s - lens[j - 1]) / seg
      const [ax, ay] = pts[j - 1]
      const [bx, by] = pts[j]
      const x = ax + (bx - ax) * k
      const y = ay + (by - ay) * k
      const d = Math.hypot(bx - ax, by - ay) || 1
      const dx = (bx - ax) / d
      const dy = (by - ay) / d
      const a = alpha(s / total)
      if (a < 0.02) continue
      const wing = (sgn: number) => [x - dx * size + -dy * size * 0.8 * sgn, y - dy * size + dx * size * 0.8 * sgn] as const
      ctx.beginPath()
      ctx.moveTo(...wing(1))
      ctx.lineTo(x, y)
      ctx.lineTo(...wing(-1))
      ctx.strokeStyle = rgba(CASING, a * 0.6)
      ctx.lineWidth = core + 3 * u
      ctx.stroke()
      ctx.strokeStyle = rgba(tint.glow, a)
      ctx.lineWidth = core * 0.9
      ctx.stroke()
    }
  }

  /** The learner's own hand as a ring: filled and glowing when on its bead, tethered to it when off. */
  private drawHand(ctx: CanvasRenderingContext2D, f: GuidanceFrame, side: Side, T: number, u: number) {
    const palm = f.learner?.[side === 'l' ? 'lPalm' : 'rPalm']
    const hand = this.hands[side]
    if (!palm || palm.v < 0.35 || !hand.bead) return
    const tint = TINTS[side]
    const [x, y] = toPx(f.view, palm)
    const { ring: R, bead: beadR } = sizes(T, u)
    const a = f.presence
    const lock = hand.lock

    // The way back, while the hand is off its path.
    const [bx, by] = toPx(f.view, hand.bead)
    const d = Math.hypot(bx - x, by - y)
    const off = (1 - lock) * (1 - hand.near * 0.6)
    if (d > R + beadR * 2 && off > 0.05) {
      const dx = (bx - x) / d
      const dy = (by - y) / d
      ctx.beginPath()
      ctx.moveTo(x + dx * R, y + dy * R)
      ctx.lineTo(bx - dx * beadR * 2, by - dy * beadR * 2)
      ctx.setLineDash([3 * u, 6 * u])
      ctx.strokeStyle = rgba(CASING, 0.35 * a * off)
      ctx.lineWidth = 3.5 * u
      ctx.stroke()
      ctx.strokeStyle = rgba(tint.glow, 0.85 * a * off)
      ctx.lineWidth = 2 * u
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (lock > 0.02) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, R * 2.2)
      g.addColorStop(0, rgba(tint.glow, 0.45 * lock * a))
      g.addColorStop(0.45, rgba(tint.glow, 0.28 * lock * a))
      g.addColorStop(1, rgba(tint.glow, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, R * 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(x, y, R, 0, Math.PI * 2)
    ctx.strokeStyle = rgba(CASING, 0.45 * a)
    ctx.lineWidth = 5 * u
    ctx.stroke()
    ctx.strokeStyle = rgba(lock > 0.5 ? tint.core : tint.glow, (0.75 + 0.25 * lock) * a)
    ctx.lineWidth = (2 + lock) * u
    ctx.stroke()
  }

  /** Where the hand should be now: a bright bead, pulsing in a hold with a ring that fills as it runs. */
  private drawBead(ctx: CanvasRenderingContext2D, f: GuidanceFrame, side: Side, T: number, u: number) {
    const bead = this.hands[side].bead
    if (!bead) return
    const tint = TINTS[side]
    const [x, y] = toPx(f.view, bead)
    const a = f.presence
    const holding = f.hold !== null
    const pulse = holding && !this.reducedMotion() ? 0.5 + 0.5 * Math.sin((f.time * 2 * Math.PI) / 2.4) : 0.5
    const r = sizes(T, u).bead * (holding ? 0.9 + 0.25 * pulse : 1)

    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4)
    g.addColorStop(0, rgba(tint.glow, 0.55 * a))
    g.addColorStop(0.35, rgba(tint.glow, 0.2 * a))
    g.addColorStop(1, rgba(tint.glow, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r * 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, r + 1.5 * u, 0, Math.PI * 2)
    ctx.fillStyle = rgba(CASING, 0.55 * a)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = rgba(tint.core, a)
    ctx.fill()

    if (holding) {
      // A thin ring around the bead that fills over the length of the hold.
      const R = sizes(T, u).hold
      const start = -Math.PI / 2
      ctx.beginPath()
      ctx.arc(x, y, R, 0, Math.PI * 2)
      ctx.strokeStyle = rgba(CASING, 0.4 * a)
      ctx.lineWidth = 4.5 * u
      ctx.stroke()
      ctx.strokeStyle = rgba(tint.glow, 0.3 * a)
      ctx.lineWidth = 1.5 * u
      ctx.stroke()
      if (f.hold! > 0.005) {
        ctx.beginPath()
        ctx.arc(x, y, R, start, start + 2 * Math.PI * f.hold!)
        ctx.strokeStyle = rgba(tint.core, a)
        ctx.lineWidth = 2.5 * u
        ctx.stroke()
      }
    }
  }
}
