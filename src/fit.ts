import { alignment, bodyScale, jointOf, JOINTS, SHOULDERS_PER_TORSO, type Pose, type Posture, type Pt, type Segment } from './skeleton'

// Fitting the teacher to the learner's own body. People are not built like
// the teacher (the built-in figure's arms are 1.38 torso lengths; as MediaPipe
// measures real people they are nearer 1.15), so a teacher simply scaled to
// the learner's torso puts targets beyond their reach and makes their true
// shape read as a mismatch. Instead the learner's segment lengths are measured
// as they practise, and the teacher's pose is redrawn on a body of those
// proportions: each segment keeps the teacher's direction (and how
// foreshortened it is) and takes its length from the learner.

export const PARTS = ['upperArm', 'forearm', 'hand', 'shoulders', 'hips', 'torso', 'neck', 'thigh', 'shin'] as const
export type Part = (typeof PARTS)[number]

/**
 * A body's segment lengths in its posture's body lengths (`bodyScale`): torso
 * lengths standing, so `torso` is 1; seated, the shoulder width stands in for
 * the torso, so `shoulders` is 0.84 (`SHOULDERS_PER_TORSO`). `hand` runs from
 * the wrist to the centre of the palm; `shoulders` and `hips` are full widths;
 * `neck` runs from between the shoulders to the nose.
 */
export type Proportions = Record<Part, number>

/**
 * A typical adult as MediaPipe measures one, standing, from segment lengths as
 * fractions of height (Drillis and Contini, as tabled by Winter): shoulder
 * 0.818, hip 0.530, knee 0.285 and ankle 0.039 high, so a torso of 0.288;
 * upper arm 0.186 and forearm 0.146, so arms of 1.15 torso lengths. The
 * shoulder landmarks sit at the joints, inside the shoulders' breadth, and the
 * hip landmarks nearer the hip joints than the hips' breadth.
 */
export const TYPICAL_BODY: Proportions = {
  upperArm: 0.645,
  forearm: 0.505,
  hand: 0.135,
  shoulders: 0.8,
  hips: 0.4,
  torso: 1,
  neck: 0.35,
  thigh: 0.85,
  shin: 0.855,
}

/** Standing proportions (torso lengths) in `posture`'s body lengths. */
export function inPosture(p: Proportions, posture: Posture): Proportions {
  if (posture === 'standing') return { ...p }
  const k = SHOULDERS_PER_TORSO / p.shoulders
  const out = {} as Proportions
  for (const part of PARTS) out[part] = p[part] * k
  return out
}

type End = Segment['a']
const MEASURES: Record<Part, { ends: [End, End][]; lower: boolean }> = {
  upperArm: { ends: [['lShoulder', 'lElbow'], ['rShoulder', 'rElbow']], lower: false },
  forearm: { ends: [['lElbow', 'lWrist'], ['rElbow', 'rWrist']], lower: false },
  hand: { ends: [['lWrist', 'lPalm'], ['rWrist', 'rPalm']], lower: false },
  shoulders: { ends: [['lShoulder', 'rShoulder']], lower: false },
  hips: { ends: [['lHip', 'rHip']], lower: true },
  torso: { ends: [['midHip', 'midShoulder']], lower: true },
  neck: { ends: [['midShoulder', 'head']], lower: false },
  thigh: { ends: [['lHip', 'lKnee'], ['rHip', 'rKnee']], lower: true },
  shin: { ends: [['lKnee', 'lAnkle'], ['rKnee', 'rAnkle']], lower: true },
}
const ARMS: Part[] = ['upperArm', 'forearm', 'hand']

/** Both ends must be seen at least this well for a length to count. */
const MIN_V = 0.6
/** Frames over which the body's full size is judged (about 3 s). */
const WINDOW = 90
/** A frame counts only when its body length is within this of the recent full size (not bowed or turned). */
const FULL = 0.9
/** The share of samples a length is taken at: high, since foreshortening only ever shortens, but not the very top, which is noise. */
const PERCENTILE = 0.9
/**
 * The hand is short beside tracker noise (a few pixels on a hand of a few
 * dozen), which lengthens it at a high percentile by a tenth or more; it is
 * taken lower. An error there moves a light by a hundredth of a torso length.
 */
const HAND_PERCENTILE = 0.75
const MIN_SAMPLES = 12
const KEEP = 900
/** Seconds of practice after which the measure is settled. */
export const SETTLE_SEC = 5

function percentile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(q * (s.length - 1))]
}

/**
 * Measures a body's proportions from its tracked poses over time. Each length
 * is taken relative to the body length in the same frame, only in frames where
 * that body length is near its recent full size, and pooled over both sides.
 * A length is its 90th percentile: foreshortening (an arm reaching toward the
 * camera) only ever shortens, while tracker noise both lengthens and shortens.
 * Seated, only the upper body is measured.
 */
export class Calibration {
  private samples = new Map<Part, number[]>(PARTS.map((p) => [p, []]))
  private scales: number[] = []
  /** Seconds of practice measured so far. */
  practised = 0

  constructor(readonly posture: Posture) {}

  /** The part the body is measured by, fixed by definition. */
  private get unit(): Part {
    return this.posture === 'standing' ? 'torso' : 'shoulders'
  }

  /** Settled once it has measured a few seconds of practice, with the arms seen. */
  get settled(): boolean {
    return this.practised >= SETTLE_SEC && ARMS.every((p) => this.samples.get(p)!.length >= MIN_SAMPLES)
  }

  /** How many lengths of `part` have been measured. */
  count(part: Part): number {
    return this.samples.get(part)!.length
  }

  add(p: Pose, practising = false, dt = 0) {
    const scale = this.scaleOf(p)
    if (!scale) return
    if (practising) this.practised += dt
    this.scales.push(scale)
    if (this.scales.length > WINDOW) this.scales.shift()
    if (scale < FULL * percentile(this.scales, PERCENTILE)) return
    for (const part of PARTS) {
      const m = MEASURES[part]
      if (part === this.unit || (this.posture === 'seated' && m.lower)) continue
      const list = this.samples.get(part)!
      for (const [ea, eb] of m.ends) {
        const a = jointOf(p, ea)
        const b = jointOf(p, eb)
        if (Math.min(a.v, b.v) < MIN_V) continue
        list.push(Math.hypot(b.x - a.x, b.y - a.y) / scale)
      }
      if (list.length > KEEP) list.splice(0, list.length - KEEP)
    }
  }

  /** The body as measured so far; parts not yet seen enough are typical. */
  proportions(): Proportions {
    const typical = inPosture(TYPICAL_BODY, this.posture)
    const out = { ...typical }
    for (const part of PARTS) {
      const list = this.samples.get(part)!
      if (part === this.unit || list.length < MIN_SAMPLES) continue
      // Far from any real body is a tracking fault, not a person.
      const q = part === 'hand' ? HAND_PERCENTILE : PERCENTILE
      out[part] = Math.min(1.6 * typical[part], Math.max(0.6 * typical[part], percentile(list, q)))
    }
    return out
  }

  private scaleOf(p: Pose): number {
    const seen = (...js: (keyof Pose)[]) => js.every((j) => p[j].v >= MIN_V)
    if (this.posture === 'seated') return seen('lShoulder', 'rShoulder') ? bodyScale(p, 'seated') : 0
    return seen('lShoulder', 'rShoulder', 'lHip', 'rHip') ? bodyScale(p, 'standing') : 0
  }
}

/** A body measured from a whole recorded move, such as a teacher's video. */
export function measureBody(poses: Pose[], posture: Posture): Proportions {
  const c = new Calibration(posture)
  for (const p of poses) c.add(p)
  return c.proportions()
}

/** Whether any part differs by more than `tol` (a share of its length). */
export function differs(a: Proportions, b: Proportions, tol: number): boolean {
  return PARTS.some((p) => Math.abs(a[p] / b[p] - 1) > tol)
}

/** Refit while the measure changes by more than this, until it settles. */
const REFIT = 0.03

/**
 * The learner's body as the teacher is fitted to it: measured through the
 * opening-pose wait and the first seconds of practice, then settled.
 * `update` says when `body` has moved on enough that the teacher's move
 * should be fitted again (`fitReference`); once settled it stays.
 */
export class BodyFit {
  readonly cal: Calibration
  body: Proportions
  private final = false

  constructor(readonly posture: Posture) {
    this.cal = new Calibration(posture)
    this.body = this.cal.proportions()
  }

  get settled() {
    return this.final
  }

  update(p: Pose, practising: boolean, dt: number): boolean {
    if (this.final) return false
    this.cal.add(p, practising, dt)
    const next = this.cal.proportions()
    const settled = this.cal.settled
    const changed = differs(next, this.body, settled ? 0 : REFIT)
    this.final = settled
    if (changed) this.body = next
    return changed
  }
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) })

/**
 * The pose `p` of a body with proportions `from`, redrawn on a body with
 * proportions `to`. Each segment keeps its direction and how foreshortened it
 * is (its length over its full length, never more than whole), and takes its
 * full length from `to`. It stays rooted where `p` is (its hips standing, its
 * shoulders seated) and at `p`'s size, so features compare like for like.
 */
export function retarget(p: Pose, from: Proportions, to: Proportions, posture: Posture): Pose {
  const unit = bodyScale(p, posture)
  const along = (a: Pt, b: Pt, start: Pt, part: Part, v = b.v): Pt => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return { x: start.x, y: start.y, v }
    const full = from[part] * unit
    const k = (Math.min(1, len / full) * to[part] * unit) / len
    return { x: start.x + dx * k, y: start.y + dy * k, v }
  }
  const ms = mid(p.lShoulder, p.rShoulder)
  const mh = mid(p.lHip, p.rHip)
  const standing = posture === 'standing'
  const ms2 = standing ? along(mh, ms, mh, 'torso', ms.v) : ms
  const mh2 = standing ? mh : along(ms, mh, ms, 'torso', mh.v)
  // A width, laid either side of its middle.
  const across = (l: Pt, r: Pt, centre: Pt, part: Part): [Pt, Pt] => {
    const half = along(l, r, { x: 0, y: 0, v: 1 }, part)
    return [
      { x: centre.x - half.x / 2, y: centre.y - half.y / 2, v: l.v },
      { x: centre.x + half.x / 2, y: centre.y + half.y / 2, v: r.v },
    ]
  }
  const [lShoulder, rShoulder] = across(p.lShoulder, p.rShoulder, ms2, 'shoulders')
  const [lHip, rHip] = across(p.lHip, p.rHip, mh2, 'hips')
  const out = { lShoulder, rShoulder, lHip, rHip, head: along(ms, p.head, ms2, 'neck') } as Pose
  for (const s of ['l', 'r'] as const) {
    const elbow = along(p[`${s}Shoulder`], p[`${s}Elbow`], out[`${s}Shoulder`], 'upperArm')
    const wrist = along(p[`${s}Elbow`], p[`${s}Wrist`], elbow, 'forearm')
    out[`${s}Elbow`] = elbow
    out[`${s}Wrist`] = wrist
    out[`${s}Palm`] = along(p[`${s}Wrist`], p[`${s}Palm`], wrist, 'hand')
    const knee = along(p[`${s}Hip`], p[`${s}Knee`], out[`${s}Hip`], 'thigh')
    out[`${s}Knee`] = knee
    out[`${s}Ankle`] = along(p[`${s}Knee`], p[`${s}Ankle`], knee, 'shin')
  }
  return out
}

const ARM_JOINTS = {
  l: ['lShoulder', 'lElbow', 'lWrist', 'lPalm'],
  r: ['rShoulder', 'rElbow', 'rWrist', 'rPalm'],
} as const

/**
 * Lays a teacher already fitted to the learner's proportions (`fitReference`)
 * on the learner as they stand now: moved and scaled by the hips and torso (the
 * shoulders seated) as `alignment` does, then each arm moved to start from the
 * learner's own shoulder. So each of `anchor`'s palms is within the learner's
 * reach. It returns the move as a function, so other frames of the teacher's
 * move can follow the same body.
 */
export function fitOnto(anchor: Pose, learner: Pose, posture: Posture): (p: Pose) => Pose {
  const move = alignment(anchor, learner, posture)
  const shift = (side: 'l' | 'r') => {
    const own = learner[`${side}Shoulder`]
    if (own.v < 0.35) return { x: 0, y: 0 }
    const at = move(anchor[`${side}Shoulder`])
    return { x: own.x - at.x, y: own.y - at.y }
  }
  const dl = shift('l')
  const dr = shift('r')
  return (p) => {
    const out = {} as Pose
    for (const j of JOINTS) out[j] = move(p[j])
    for (const [side, d] of [['l', dl], ['r', dr]] as const) {
      for (const j of ARM_JOINTS[side]) out[j] = { x: out[j].x + d.x, y: out[j].y + d.y, v: out[j].v }
    }
    return out
  }
}
