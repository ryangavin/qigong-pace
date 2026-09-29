import type { Reference } from '../follower'
import {
  bodyScale,
  jointOf,
  segmentCounts,
  SEGMENTS,
  toPx,
  type Joint,
  type Pose,
  type Posture,
  type Pt,
  type View,
} from '../skeleton'

// The teacher as a soft body of light laid over the learner: warm white at the
// core, pale gold in the halo.
const CORE = [255, 244, 222]
const HALO = [242, 204, 142]
const rgba = (c: number[], a: number) => `rgba(${c.join(', ')}, ${a})`
/** Light of colour `c` at strength `a`, as an opaque colour over black. */
const light = (c: number[], a: number) => `rgb(${c.map((v) => Math.round(v * Math.min(1, Math.max(0, a)))).join(', ')})`

/** How well one limb matches, 0..1, from its mismatch: whole within the threshold, gone by 2.5× it. */
export function matchOf(err: number, threshold: number): number {
  const u = Math.min(1, Math.max(0, (err - threshold) / (1.5 * threshold)))
  return 1 - u * u * (3 - 2 * u)
}

/**
 * Where each hand goes over the next `secs` of the move from frame `from`,
 * moved by `place` onto the learner's body. Sampled about 20 times a second.
 */
export function handPath(ref: Reference, from: number, secs: number, place: (p: Pt) => Pt): { l: Pt[]; r: Pt[] } {
  const last = Math.min(ref.poses.length - 1, from + secs * ref.fps)
  const stepBy = Math.max(1, ref.fps / 20)
  const l: Pt[] = []
  const r: Pt[] = []
  for (let i = from; i <= last + 1e-6; i += stepBy) {
    const p = ref.poses[Math.round(i)]
    l.push(place(p.lWrist))
    r.push(place(p.rWrist))
  }
  return { l, r }
}

export interface GuidanceFrame {
  view: View
  /** The teacher at the lead frame, already aligned to the learner's body. */
  ghost: Pose
  /** The learner, or null when no one is seen. */
  learner: Pose | null
  /** Per-segment mismatch between the learner and the teacher where the learner should be. */
  errs: Float32Array | null
  threshold: number
  posture: Posture
  trail: { l: Pt[]; r: Pt[] }
  /** Overall strength of the ghost, 0..1: it fades in when someone is seen. */
  presence: number
  /**
   * The session's qi, 0..1. As it builds the ghost's body grows subtler and
   * lets the energy carry the feeling; the hands and their way ahead stay clear.
   */
  qi: number
  dt: number
  /** Seconds, for the breathing. */
  time: number
}

interface Mote {
  seg: number
  /** Where along the limb, 0..1. */
  u: number
  age: number
  life: number
  sway: number
}

// A joint fuses with the learner's by the mean match of the limbs that meet
// there; shoulders and hips hold the ghost where alignment put it.
const FUSING: Joint[] = ['lElbow', 'rElbow', 'lWrist', 'rWrist', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle']
const MAX_MOTES = 90
const smoothstep = (u: number) => u * u * (3 - 2 * u)

/** Draws the guidance overlay and keeps its per-limb memory (matches, flashes, motes) from frame to frame. */
export class Guidance {
  private match = new Float32Array(SEGMENTS.length).fill(0.5)
  private flash = new Float32Array(SEGMENTS.length)
  private fused = new Uint8Array(SEGMENTS.length)
  private motes: Mote[] = []
  private halo = document.createElement('canvas')
  private core = document.createElement('canvas')
  private shadeSmall = document.createElement('canvas')
  private sprite = makeSprite()
  private seed = 7

  constructor(private reducedMotion: () => boolean) {}

  private rand() {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296
    return this.seed / 4294967296
  }

  /**
   * Everything is light over black: the canvas is screened over the room
   * below, so black leaves it untouched and overlapping limbs never pile up
   * into bright knots at the joints.
   */
  draw(ctx: CanvasRenderingContext2D, f: GuidanceFrame, shade?: CanvasRenderingContext2D) {
    const { width: w, height: h } = ctx.canvas
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    const calm = this.reducedMotion()
    this.remember(f)

    const T = bodyScale(f.ghost, f.posture) * f.view.s
    const breath = calm ? 0.9 : 0.82 + 0.18 * Math.sin((f.time * 2 * Math.PI) / 6.5)
    const body = this.fuse(f)
    const a = breath * f.presence
    // With qi gathered the energy fills the body, so the ghost's own body
    // steps back (its wide halo most), while the hands and the trails, the
    // way ahead, keep their light and sharpen a little.
    const qi = Math.min(1, Math.max(0, f.qi))
    const bodyHalo = 1 - 0.7 * qi
    const bodyCore = 1 - 0.35 * qi
    const lead = 1 + 0.25 * qi

    // The body is drawn small and scaled up: the upscale softens it, and one
    // blur per layer is far cheaper than blurring every limb.
    const halo = this.layer(this.halo, w, h, 0.25)
    const core = this.layer(this.core, w, h, 0.5)
    this.paintBody(halo, f, body, T * 0.5, a * 0.28 * bodyHalo, HALO)
    this.paintTrail(halo, f, T * 0.16, a * 0.6)
    this.paintBody(core, f, body, T * 0.1, a * 0.32 * bodyCore, CORE)
    this.paintTrail(core, f, T * 0.05, a * 0.7 * lead)

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.filter = `blur(${Math.round(T * 0.16)}px)`
    ctx.drawImage(this.halo, 0, 0, w, h)
    ctx.filter = `blur(${Math.max(1, Math.round(T * 0.04))}px)`
    ctx.drawImage(this.core, 0, 0, w, h)
    ctx.filter = 'none'
    // The hands lead, each with a small orb.
    for (const j of ['lWrist', 'rWrist'] as const) {
      const [x, y] = toPx(f.view, body[j])
      this.glow(ctx, x, y, T * 0.26, 0.45 * a)
      this.glow(ctx, x, y, T * 0.08, 0.8 * a * lead)
    }
    if (!calm) this.drawMotes(ctx, f, body, T)
    ctx.restore()
    if (shade) this.paintShade(shade, f, body, T, qi)
  }

  /**
   * A soft dusk under the hands and their way ahead, drawn on a canvas that
   * sits between the energy and the ghost and is not screened: where the
   * energy burns brightest it is dimmed a little there, so the guide still
   * reads against it. Only as strong as the gathered qi calls for.
   */
  private paintShade(ctx: CanvasRenderingContext2D, f: GuidanceFrame, body: Pose, T: number, qi: number) {
    const { width: w, height: h } = ctx.canvas
    ctx.clearRect(0, 0, w, h)
    const strength = 0.5 * smoothstep(Math.min(1, qi / 0.6)) * f.presence
    if (strength < 0.01) return
    const k = 0.25
    const small = this.shadeSmall
    const cw = Math.max(1, Math.round(w * k))
    const ch = Math.max(1, Math.round(h * k))
    if (small.width !== cw || small.height !== ch) {
      small.width = cw
      small.height = ch
    }
    const s = small.getContext('2d')!
    s.setTransform(1, 0, 0, 1, 0, 0)
    s.clearRect(0, 0, cw, ch)
    s.setTransform(k, 0, 0, k, 0, 0)
    // Opaque here, faded as a whole below, so overlaps never pile up darker.
    s.strokeStyle = s.fillStyle = '#030408'
    s.lineCap = 'round'
    s.lineJoin = 'round'
    s.lineWidth = T * 0.3
    for (const path of [f.trail.l, f.trail.r]) {
      if (path.length < 2) continue
      s.beginPath()
      for (const p of path) s.lineTo(...toPx(f.view, p))
      s.stroke()
    }
    for (const j of ['lWrist', 'rWrist'] as const) {
      const [x, y] = toPx(f.view, body[j])
      s.beginPath()
      s.arc(x, y, T * 0.28, 0, Math.PI * 2)
      s.fill()
    }
    ctx.save()
    ctx.globalAlpha = strength
    ctx.filter = `blur(${Math.round(T * 0.14)}px)`
    ctx.drawImage(small, 0, 0, w, h)
    ctx.restore()
  }

  /** Ease each limb's match, and flash the ones that have just come into the shape. */
  private remember(f: GuidanceFrame) {
    const ease = 1 - Math.exp(-f.dt / 0.25)
    const fade = Math.exp(-f.dt / 0.7)
    SEGMENTS.forEach((_, i) => {
      const seen = f.learner && f.errs
      const target = seen ? matchOf(f.errs![i], f.threshold) : 0.4
      this.match[i] += (target - this.match[i]) * ease
      this.flash[i] *= fade
      if (!this.fused[i] && this.match[i] > 0.75) {
        this.fused[i] = 1
        this.flash[i] = 1
      } else if (this.fused[i] && this.match[i] < 0.55) {
        this.fused[i] = 0
      }
    })
  }

  /** The ghost with its matching limbs drawn onto the learner's own. */
  private fuse(f: GuidanceFrame): Pose {
    if (!f.learner) return f.ghost
    const out = { ...f.ghost }
    for (const j of FUSING) {
      let sum = 0
      let n = 0
      SEGMENTS.forEach((s, i) => {
        if ((s.a === j || s.b === j) && segmentCounts(i, f.posture)) {
          sum += this.match[i]
          n++
        }
      })
      if (!n || f.learner[j].v < 0.35) continue
      const k = 0.6 * (sum / n) * f.presence
      const g = f.ghost[j]
      const l = f.learner[j]
      out[j] = { x: g.x + (l.x - g.x) * k, y: g.y + (l.y - g.y) * k, v: g.v }
    }
    return out
  }

  private layer(c: HTMLCanvasElement, w: number, h: number, k: number) {
    const cw = Math.max(1, Math.round(w * k))
    const ch = Math.max(1, Math.round(h * k))
    if (c.width !== cw || c.height !== ch) {
      c.width = cw
      c.height = ch
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cw, ch)
    ctx.setTransform(k, 0, 0, k, 0, 0)
    // Where limbs overlap the brighter wins, rather than the two adding up.
    ctx.globalCompositeOperation = 'lighten'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    return ctx
  }

  private paintBody(
    ctx: CanvasRenderingContext2D,
    f: GuidanceFrame,
    p: Pose,
    width: number,
    alpha: number,
    tint: number[],
  ) {
    const px = (q: Pt) => toPx(f.view, q)
    const color = (a: number) => light(tint, a)
    // The trunk, shoulders to hips (seated, to the chest): one soft rounded
    // volume rather than an outline.
    ctx.fillStyle = ctx.strokeStyle = color(alpha * 0.55)
    ctx.lineWidth = width
    ctx.beginPath()
    if (f.posture === 'standing') {
      for (const j of ['lShoulder', 'rShoulder', 'rHip', 'lHip'] as const) ctx.lineTo(...px(p[j]))
    } else {
      const drop = bodyScale(p, 'seated') * 0.5
      for (const j of ['lShoulder', 'rShoulder'] as const) ctx.lineTo(...px(p[j]))
      for (const j of ['rShoulder', 'lShoulder'] as const) ctx.lineTo(...px({ ...p[j], y: p[j].y + drop }))
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    SEGMENTS.forEach((s, i) => {
      if (!s.draw || !segmentCounts(i, f.posture) || s.name === 'shoulders' || s.name === 'hips') return
      const m = f.learner ? this.match[i] : 0.4
      ctx.strokeStyle = color(alpha * (0.45 + 0.4 * m + 0.8 * this.flash[i]))
      ctx.beginPath()
      ctx.moveTo(...px(jointOf(p, s.a)))
      ctx.lineTo(...px(jointOf(p, s.b)))
      ctx.stroke()
    })
    const [hx, hy] = px(p.head)
    ctx.fillStyle = color(alpha * 0.8)
    ctx.beginPath()
    ctx.arc(hx, hy, Math.max(width * 0.6, bodyScale(p, f.posture) * f.view.s * 0.2), 0, Math.PI * 2)
    ctx.fill()
  }

  /** Comet tails where the hands go next: widest at the hand, thinning and fading ahead. */
  private paintTrail(ctx: CanvasRenderingContext2D, f: GuidanceFrame, width: number, alpha: number) {
    for (const path of [f.trail.l, f.trail.r]) {
      for (let i = 1; i < path.length; i++) {
        const u = 1 - i / path.length
        ctx.strokeStyle = light(HALO, alpha * u * u)
        ctx.lineWidth = Math.max(0.5, width * u)
        ctx.beginPath()
        ctx.moveTo(...toPx(f.view, path[i - 1]))
        ctx.lineTo(...toPx(f.view, path[i]))
        ctx.stroke()
      }
    }
  }

  /** Motes rise from the learner's limbs that are off and drift to the ghost's. */
  private drawMotes(ctx: CanvasRenderingContext2D, f: GuidanceFrame, ghost: Pose, T: number) {
    const learner = f.learner
    if (learner && f.presence > 0.3) {
      SEGMENTS.forEach((s, i) => {
        if (!s.draw || !segmentCounts(i, f.posture) || this.match[i] > 0.5) return
        if (Math.min(jointOf(learner, s.a).v, jointOf(learner, s.b).v) < 0.35) return
        const rate = 3 * (1 - this.match[i] / 0.5)
        if (this.motes.length < MAX_MOTES && this.rand() < rate * f.dt) {
          this.motes.push({ seg: i, u: 0.25 + 0.75 * this.rand(), age: 0, life: 1.4 + this.rand(), sway: this.rand() - 0.5 })
        }
      })
    }
    this.motes = this.motes.filter((m) => (m.age += f.dt) < m.life)
    if (!learner) return
    for (const m of this.motes) {
      const s = SEGMENTS[m.seg]
      const along = (p: Pose) => {
        const a = jointOf(p, s.a)
        const b = jointOf(p, s.b)
        return { x: a.x + (b.x - a.x) * m.u, y: a.y + (b.y - a.y) * m.u }
      }
      const from = along(learner)
      const to = along(ghost)
      const t = m.age / m.life
      const k = smoothstep(t)
      // A slight sideways arc, so they drift rather than slide.
      const dx = to.x - from.x
      const dy = to.y - from.y
      const bow = Math.sin(t * Math.PI) * m.sway * 0.35
      const x = from.x + dx * k - dy * bow
      const y = from.y + dy * k + dx * bow
      const [px, py] = toPx(f.view, { x, y, v: 1 })
      this.glow(ctx, px, py, T * 0.06, 0.75 * Math.sin(t * Math.PI) * f.presence)
    }
  }

  private glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
    if (alpha <= 0.01 || r <= 0) return
    ctx.globalAlpha = Math.min(1, alpha)
    ctx.drawImage(this.sprite, x - r, y - r, r * 2, r * 2)
    ctx.globalAlpha = 1
  }
}

/** A soft round light, drawn once and stamped wherever a glow is needed. */
function makeSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, rgba(CORE, 1))
  g.addColorStop(0.35, rgba(HALO, 0.45))
  g.addColorStop(1, rgba(HALO, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return c
}
