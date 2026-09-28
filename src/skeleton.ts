// Poses live in "image units": y runs 0..1 top to bottom, x runs 0..aspect left
// to right, so distances are the same horizontally and vertically.
//
// Sides are *screen* sides, not anatomical ones. The learner copies what they
// see, like following a teacher in a mirror, so "l" means "the arm on the left
// of the screen" for both the teacher and the (mirrored) learner.

export const JOINTS = [
  'head',
  'lShoulder',
  'rShoulder',
  'lElbow',
  'rElbow',
  'lWrist',
  'rWrist',
  'lHip',
  'rHip',
  'lKnee',
  'rKnee',
  'lAnkle',
  'rAnkle',
] as const

export type Joint = (typeof JOINTS)[number]
export interface Pt {
  x: number
  y: number
  /** Visibility, 0..1. */
  v: number
}
export type Pose = Record<Joint, Pt>

export interface LandmarkLike {
  x: number
  y: number
  visibility?: number
}

// MediaPipe pose landmark indices, anatomical sides.
const MP = {
  nose: 0,
  shoulder: [11, 12],
  elbow: [13, 14],
  wrist: [15, 16],
  hip: [23, 24],
  knee: [25, 26],
  ankle: [27, 28],
} as const

export interface LandmarkOptions {
  /** Width / height of the image the landmarks came from. */
  aspect: number
  /** Mirror horizontally (true for a selfie webcam view). */
  flipX: boolean
  /** The person has their back to the camera. */
  facingAway: boolean
}

export function poseFromLandmarks(lm: LandmarkLike[], opts: LandmarkOptions): Pose {
  // Facing the camera, a person's anatomical right is on the left of the
  // unmirrored image. Mirroring or turning around each swap that once.
  const leftIsAnatomicalLeft = opts.flipX !== opts.facingAway
  const pt = (i: number): Pt => {
    const p = lm[i]
    const x = opts.flipX ? 1 - p.x : p.x
    return { x: x * opts.aspect, y: p.y, v: p.visibility ?? 1 }
  }
  const side = (pair: readonly [number, number]): [Pt, Pt] =>
    leftIsAnatomicalLeft ? [pt(pair[0]), pt(pair[1])] : [pt(pair[1]), pt(pair[0])]
  const [lShoulder, rShoulder] = side(MP.shoulder)
  const [lElbow, rElbow] = side(MP.elbow)
  const [lWrist, rWrist] = side(MP.wrist)
  const [lHip, rHip] = side(MP.hip)
  const [lKnee, rKnee] = side(MP.knee)
  const [lAnkle, rAnkle] = side(MP.ankle)
  return {
    head: pt(MP.nose),
    lShoulder,
    rShoulder,
    lElbow,
    rElbow,
    lWrist,
    rWrist,
    lHip,
    rHip,
    lKnee,
    rKnee,
    lAnkle,
    rAnkle,
  }
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) })

/**
 * How the learner practises. Seated, only the upper body is in the camera
 * frame (a laptop on a desk, a chair): anything that needs the hips or legs is
 * left out of the comparison, and the body is measured by its shoulders.
 */
export type Posture = 'standing' | 'seated'
export const POSTURES: readonly Posture[] = ['standing', 'seated']

export interface Segment {
  name: string
  a: Joint | 'midShoulder' | 'midHip'
  b: Joint | 'midShoulder' | 'midHip'
  /** How much this segment counts when comparing shapes. Arms lead in qi gong. */
  weight: number
  /** Drawn as part of the skeleton overlay. */
  draw: boolean
  /** Needs the hips or legs, so seated practice ignores it. */
  lower: boolean
}

export const SEGMENTS: Segment[] = [
  { name: 'lUpperArm', a: 'lShoulder', b: 'lElbow', weight: 1, draw: true, lower: false },
  { name: 'lForearm', a: 'lElbow', b: 'lWrist', weight: 1, draw: true, lower: false },
  { name: 'rUpperArm', a: 'rShoulder', b: 'rElbow', weight: 1, draw: true, lower: false },
  { name: 'rForearm', a: 'rElbow', b: 'rWrist', weight: 1, draw: true, lower: false },
  { name: 'lThigh', a: 'lHip', b: 'lKnee', weight: 0.6, draw: true, lower: true },
  { name: 'lShin', a: 'lKnee', b: 'lAnkle', weight: 0.4, draw: true, lower: true },
  { name: 'rThigh', a: 'rHip', b: 'rKnee', weight: 0.6, draw: true, lower: true },
  { name: 'rShin', a: 'rKnee', b: 'rAnkle', weight: 0.4, draw: true, lower: true },
  { name: 'torso', a: 'midHip', b: 'midShoulder', weight: 0.5, draw: false, lower: true },
  { name: 'shoulders', a: 'lShoulder', b: 'rShoulder', weight: 0.5, draw: true, lower: false },
  { name: 'hips', a: 'lHip', b: 'rHip', weight: 0.2, draw: true, lower: true },
  { name: 'neck', a: 'midShoulder', b: 'head', weight: 0.3, draw: false, lower: false },
]

const SEG_COUNT = SEGMENTS.length

/** Whether segment `i` takes part in matching for this posture. */
export const segmentCounts = (i: number, posture: Posture) => posture === 'standing' || !SEGMENTS[i].lower

export interface Features {
  /** Segment vectors divided by torso length, [dx0, dy0, dx1, dy1, ...]. */
  vec: Float32Array
  /** Per-segment confidence, 0..1. */
  vis: Float32Array
}

function jointOf(p: Pose, j: Segment['a']): Pt {
  if (j === 'midShoulder') return mid(p.lShoulder, p.rShoulder)
  if (j === 'midHip') return mid(p.lHip, p.rHip)
  return p[j]
}

export function torsoLength(p: Pose): number {
  const s = mid(p.lShoulder, p.rShoulder)
  const h = mid(p.lHip, p.rHip)
  const t = Math.hypot(s.x - h.x, s.y - h.y)
  if (t > 1e-3) return t
  return Math.max(1e-3, 2 * Math.hypot(p.lShoulder.x - p.rShoulder.x, p.lShoulder.y - p.rShoulder.y))
}

// Shoulder width in torso lengths (the built-in figure's proportion), so a
// seated body measured by its shoulders comes out in the same units.
const SHOULDERS_PER_TORSO = 0.84

/**
 * The length features are measured in: torso length standing; seated, the
 * hips may be out of frame, so the shoulder width stands in for it.
 */
export function bodyScale(p: Pose, posture: Posture = 'standing'): number {
  if (posture === 'standing') return torsoLength(p)
  const w = Math.hypot(p.lShoulder.x - p.rShoulder.x, p.lShoulder.y - p.rShoulder.y)
  return Math.max(1e-3, w / SHOULDERS_PER_TORSO)
}

// MediaPipe reports ~0.1-0.3 for joints outside the frame; treat that as unseen.
const confidence = (v: number) => Math.min(1, Math.max(0, (v - 0.3) / 0.4))

/**
 * Shape of the body, independent of where it stands in the frame and how big
 * it is: each limb as a vector scaled by torso length. Keeping length (rather
 * than unit directions) lets an arm reaching toward the camera, which looks
 * short, read differently from one held out to the side. Seated, the segments
 * that need the hips or legs are left at zero with no confidence.
 */
export function computeFeatures(p: Pose, posture: Posture = 'standing'): Features {
  const scale = bodyScale(p, posture)
  const vec = new Float32Array(SEG_COUNT * 2)
  const vis = new Float32Array(SEG_COUNT)
  SEGMENTS.forEach((s, i) => {
    if (!segmentCounts(i, posture)) return
    const a = jointOf(p, s.a)
    const b = jointOf(p, s.b)
    vec[i * 2] = (b.x - a.x) / scale
    vec[i * 2 + 1] = (b.y - a.y) / scale
    vis[i] = confidence(Math.min(a.v, b.v))
  })
  return { vec, vis }
}

/** Per-segment mismatch (0 = identical), in torso lengths. */
export function segmentErrors(a: Features, b: Features, out = new Float32Array(SEG_COUNT)): Float32Array {
  for (let i = 0; i < SEG_COUNT; i++) {
    out[i] = Math.hypot(a.vec[i * 2] - b.vec[i * 2], a.vec[i * 2 + 1] - b.vec[i * 2 + 1])
  }
  return out
}

/** Weighted mean segment mismatch over the segments both poses can see. */
export function distance(a: Features, b: Features): number {
  let num = 0
  let den = 0
  for (let i = 0; i < SEG_COUNT; i++) {
    const w = SEGMENTS[i].weight * Math.min(a.vis[i], b.vis[i])
    if (w <= 0) continue
    num += w * Math.hypot(a.vec[i * 2] - b.vec[i * 2], a.vec[i * 2 + 1] - b.vec[i * 2 + 1])
    den += w
  }
  return den > 0.5 ? num / den : Infinity
}

/** Fill frames with no detection from their neighbours, then smooth out tracker jitter. */
export function cleanTrack(track: (Pose | null)[], radius = 2): Pose[] {
  const firstSeen = track.findIndex((p) => p !== null)
  if (firstSeen < 0) return []
  const filled: Pose[] = []
  let last = track[firstSeen] as Pose
  for (const p of track) {
    if (p) last = p
    filled.push(last)
  }
  return filled.map((_, i) => {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(filled.length - 1, i + radius)
    const out = {} as Pose
    for (const j of JOINTS) {
      let x = 0
      let y = 0
      let v = 0
      for (let k = lo; k <= hi; k++) {
        x += filled[k][j].x
        y += filled[k][j].y
        v += filled[k][j].v
      }
      const n = hi - lo + 1
      out[j] = { x: x / n, y: y / n, v: v / n }
    }
    return out
  })
}

/**
 * Move and scale `p` so its hips and torso length line up with `target`.
 * Seated, it lines up the shoulders instead.
 */
export function alignPoseTo(p: Pose, target: Pose, posture: Posture = 'standing'): Pose {
  const s = bodyScale(target, posture) / bodyScale(p, posture)
  const anchor = (q: Pose) => (posture === 'standing' ? mid(q.lHip, q.rHip) : mid(q.lShoulder, q.rShoulder))
  const from = anchor(p)
  const to = anchor(target)
  const out = {} as Pose
  for (const j of JOINTS) {
    out[j] = { x: to.x + (p[j].x - from.x) * s, y: to.y + (p[j].y - from.y) * s, v: p[j].v }
  }
  return out
}

export interface View {
  ox: number
  oy: number
  /** Pixels per image unit (i.e. the drawn image height). */
  s: number
}

export const toPx = (view: View, p: Pt) => [view.ox + p.x * view.s, view.oy + p.y * view.s] as const

/** Fit an image of `aspect` inside a w×h box, centred. */
export function containView(w: number, h: number, aspect: number): View & { w: number; h: number } {
  const dw = Math.min(w, h * aspect)
  const dh = dw / aspect
  return { ox: (w - dw) / 2, oy: (h - dh) / 2, s: dh, w: dw, h: dh }
}

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  p: Pose,
  view: View,
  colorFor: (segment: number) => string,
  width: number,
  /** Seated leaves out the hips and legs, which aren't being matched. */
  posture: Posture = 'standing',
) {
  ctx.lineCap = 'round'
  ctx.lineWidth = width
  SEGMENTS.forEach((s, i) => {
    if (!s.draw || !segmentCounts(i, posture)) return
    const a = jointOf(p, s.a)
    const b = jointOf(p, s.b)
    if (Math.min(a.v, b.v) < 0.35) return
    const [ax, ay] = toPx(view, a)
    const [bx, by] = toPx(view, b)
    ctx.strokeStyle = colorFor(i)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  })
  if (posture === 'standing') {
    const ms = jointOf(p, 'midShoulder')
    const mh = jointOf(p, 'midHip')
    ctx.globalAlpha *= 0.5
    ctx.strokeStyle = colorFor(SEGMENTS.findIndex((s) => s.name === 'torso'))
    ctx.beginPath()
    ctx.moveTo(...toPx(view, ms))
    ctx.lineTo(...toPx(view, mh))
    ctx.stroke()
    ctx.globalAlpha /= 0.5
  }
  if (p.head.v >= 0.35) {
    const [hx, hy] = toPx(view, p.head)
    ctx.fillStyle = colorFor(SEGMENTS.findIndex((s) => s.name === 'neck'))
    ctx.beginPath()
    ctx.arc(hx, hy, width * 1.4, 0, Math.PI * 2)
    ctx.fill()
  }
}
