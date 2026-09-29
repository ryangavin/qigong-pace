import { torsoLength, type Pose, type Pt } from '../skeleton'
import type { EnergyView } from './types'

// The learner's body as the energy shaders see it: tapered capsules for the
// limbs and trunk, and the points qi gathers at, in "screen units" (y runs 0..1
// down the canvas, x runs 0..width/height across it).

/** How each capsule's current runs; the shaders switch on it. */
export const CAP_KIND = { trunk: 0, lArm: 1, rArm: 2, leg: 3, head: 4 } as const

export const MAX_CAPS = 14

export const POINTS = ['dantian', 'lPalm', 'rPalm', 'lTip', 'rTip', 'crown', 'lFoot', 'rFoot'] as const
export type BodyPoint = (typeof POINTS)[number]

export interface BodyGeometry {
  /** Torso length in screen units; the shaders size everything by it. */
  T: number
  /** Per capsule: ax, ay, bx, by. */
  caps: Float32Array
  /** Per capsule: radius at a, radius at b, weight 0..1 (how surely it's seen), kind. */
  capInfo: Float32Array
  /**
   * Per capsule: how far its start is along its chain (hip to crown, shoulder
   * to fingertip, hip to ankle), so a stream can run on across the joints.
   */
  chain: Float32Array
  count: number
  /** x, y per entry of POINTS. */
  points: Float32Array
}

// MediaPipe reports ~0.1-0.3 for joints outside the frame; treat that as unseen (as skeleton.ts does).
const confidence = (v: number) => Math.min(1, Math.max(0, (v - 0.3) / 0.4))

type V2 = [number, number]

export function emptyGeometry(): BodyGeometry {
  return {
    T: 0,
    caps: new Float32Array(MAX_CAPS * 4),
    capInfo: new Float32Array(MAX_CAPS * 4),
    chain: new Float32Array(MAX_CAPS),
    count: 0,
    points: new Float32Array(POINTS.length * 2),
  }
}

/**
 * Lay the pose out on a canvas `cssH` CSS pixels tall. Hands aren't tracked,
 * so palms and fingertips are extended along the forearm.
 */
export function bodyGeometry(p: Pose, view: EnergyView, cssH: number, out = emptyGeometry()): BodyGeometry {
  const at = (q: Pt): V2 => [(view.ox + q.x * view.s) / cssH, (view.oy + q.y * view.s) / cssH]
  const T = (torsoLength(p) * view.s) / cssH
  const midOf = (a: V2, b: V2): V2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const along = (a: V2, dir: V2, k: number): V2 => [a[0] + dir[0] * k * T, a[1] + dir[1] * k * T]
  const unit = (from: V2, to: V2, fallback: V2): V2 => {
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const l = Math.hypot(dx, dy)
    return l > 1e-6 ? [dx / l, dy / l] : fallback
  }

  const sh = midOf(at(p.lShoulder), at(p.rShoulder))
  const hip = midOf(at(p.lHip), at(p.rHip))
  const up = unit(hip, sh, [0, -1])
  const head = at(p.head)
  const conf = (...q: Pt[]) => confidence(Math.min(...q.map((x) => x.v)))

  let n = 0
  let chain = 0
  // `start` begins a new chain.
  const cap = (a: V2, b: V2, ra: number, rb: number, weight: number, kind: number, start = false) => {
    if (start) chain = 0
    out.caps.set([a[0], a[1], b[0], b[1]], n * 4)
    out.capInfo.set([ra * T, rb * T, weight, kind], n * 4)
    out.chain[n] = chain
    chain += Math.hypot(b[0] - a[0], b[1] - a[1])
    n++
  }
  // The trunk is kept whenever the shoulders are seen: seated, the hips are
  // often out of frame, but MediaPipe's estimate of them is good enough here.
  const shoulders = conf(p.lShoulder, p.rShoulder)
  cap(hip, sh, 0.3, 0.38, shoulders, CAP_KIND.trunk, true)
  cap(sh, head, 0.14, 0.13, conf(p.head) * shoulders, CAP_KIND.head)
  cap(along(head, up, -0.05), along(head, up, 0.25), 0.26, 0.26, conf(p.head), CAP_KIND.head)

  const tips: V2[] = []
  const palms: V2[] = []
  for (const side of ['l', 'r'] as const) {
    const s = at(p[`${side}Shoulder`])
    const e = at(p[`${side}Elbow`])
    const w = at(p[`${side}Wrist`])
    const dir = unit(e, w, [0, 1])
    const palm = along(w, dir, 0.2)
    const tip = along(w, dir, 0.45)
    const kind = side === 'l' ? CAP_KIND.lArm : CAP_KIND.rArm
    cap(s, e, 0.13, 0.11, conf(p[`${side}Shoulder`], p[`${side}Elbow`]), kind, true)
    cap(e, w, 0.11, 0.08, conf(p[`${side}Elbow`], p[`${side}Wrist`]), kind)
    cap(w, tip, 0.08, 0.05, conf(p[`${side}Wrist`]), kind)
    palms.push(palm)
    tips.push(tip)
  }
  const feet: V2[] = []
  for (const side of ['l', 'r'] as const) {
    const h = at(p[`${side}Hip`])
    const k = at(p[`${side}Knee`])
    const a = at(p[`${side}Ankle`])
    cap(h, k, 0.17, 0.13, conf(p[`${side}Hip`], p[`${side}Knee`]), CAP_KIND.leg, true)
    cap(k, a, 0.12, 0.08, conf(p[`${side}Knee`], p[`${side}Ankle`]), CAP_KIND.leg)
    feet.push([a[0], a[1] + 0.06 * T])
  }
  out.count = n
  out.T = T

  const pts: Record<BodyPoint, V2> = {
    dantian: [hip[0] + (sh[0] - hip[0]) * 0.18, hip[1] + (sh[1] - hip[1]) * 0.18],
    lPalm: palms[0],
    rPalm: palms[1],
    lTip: tips[0],
    rTip: tips[1],
    crown: along(head, up, 0.42),
    lFoot: feet[0],
    rFoot: feet[1],
  }
  POINTS.forEach((k, i) => out.points.set(pts[k], i * 2))
  return out
}
