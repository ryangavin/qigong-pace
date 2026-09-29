import { Calibration, PARTS, type Part, type Proportions } from '../fit'
import { DEFAULT_OPTIONS } from '../follower'
import { decodeFrame } from '../session'
import { LandmarkFilter } from '../smoothing'
import {
  bodyScale,
  computeFeatures,
  distance,
  JOINTS,
  poseFromLandmarks,
  type Features,
  type Joint,
  type Pose,
  type Posture,
  type Pt,
} from '../skeleton'
import type { CalibrationRecording, RecordedTask } from './recording'
import { shapeOn, taskById, type TaskId } from './tasks'

// Measuring the learner from a calibration's recording: their body, how far
// they reach, where the camera loses them, how much the tracking shivers and
// lags, how the picture frames them, and how each task's shape came out. Pure:
// it runs on the raw landmarks alone, through the same filter the pages use,
// so a downloaded file measures the same again.
//
// Units: "torso lengths" are the body lengths the app measures by (`bodyScale`:
// the torso standing; seated, the shoulder width / 0.84); image units are frame
// heights, with x mirrored as the learner sees themselves (screen left is left).

/** Below this visibility a landmark counts as unseen, as the landmark filter has it. */
const SEEN = 0.5
/** Near an edge, as a share of the frame: a landmark lost there left the picture. */
const EDGE = 0.04
/** Samples either side of the moving average a shiver is measured from (about half a second in all). */
const SHIVER_HALF = 7
/** Settled: the moving joints within this (torso lengths) of where they then held, for this long. */
const SETTLED = 0.1
const REACHED_SEC = 0.3
/** Sectors of the reach envelope, each this many degrees, clockwise from straight up. */
export const SECTOR_DEG = 30
const SECTORS = 360 / SECTOR_DEG
/** At most this many dropout places are kept per joint and task. */
const MAX_AT = 12

export type Edge = 'top' | 'bottom' | 'left' | 'right' | 'inside'

/** How well the tracker saw a joint. */
export interface JointSeen {
  /** Share of detections where it was seen (visibility ≥ 0.5; no one found counts as unseen). */
  seen: number
  /** Mean raw visibility. */
  v: number
  /** Times it went from seen to unseen. */
  drops: number
  /** Where it was last seen before each drop: [x, y] as shares of the frame's width and height, and the edge it was at. */
  at: [number, number, Edge][]
}

/** How far a palm went from its own shoulder, in torso lengths: `out` away from the body's midline, `in` across it. */
export interface Reach {
  up: number
  down: number
  out: number
  in: number
  far: number
}

export interface Jitter {
  /**
   * The shiver of each joint held still: the RMS distance from its own
   * half-second moving average, in frame heights, raw and filtered.
   */
  joints: Partial<Record<Joint, [number, number]>>
  /** The median over the joints seen, in frame heights and in torso lengths. */
  raw: number
  filtered: number
  rawTorso: number
  filteredTorso: number
}

export interface Framing {
  /** The seen body's box, as shares of the frame (x across, y down). */
  top: number
  bottom: number
  left: number
  right: number
  /** The body's height as a share of the frame's. */
  height: number
  /** The middle of the shoulders across the frame, 0.5 centred. */
  centre: number
  /** Torso lengths of picture above the shoulders. */
  headroom: number
  /** Joints unseen or outside the picture while still. */
  cropped: Joint[]
}

/** How closely the learner made the task's shape (distance as the follower measures it, torso lengths). */
export interface Match {
  /** Median over the capture. */
  distance: number | null
  /** Share of the capture within the follower's match threshold. */
  within: number
}

/** Numbers only some tasks have. */
export interface TaskDetail {
  jitter?: Jitter
  framing?: Framing
  /** Overhead: the highest palm above its shoulder (torso lengths), the highest palm in the frame (share from the top), and the share of the capture with both palms seen in the picture. */
  aboveShoulders?: number
  topY?: number
  inFrame?: number
  /** Out to the sides: the widest palm to palm, and how far the palms sat below the shoulders (torso lengths). */
  span?: Span
  level?: number
  /** Palms together, on the belly: palm to palm, and how far below the shoulders the palms were (torso lengths). */
  gap?: number
  height?: number
  /** Reaching forward: the palm's apparent distance from the shoulder as a share of the arm's length. */
  foreshortening?: number
  /** Knees bent: how far the hips dropped (torso lengths) and the smallest knee angle seen, in degrees (180 straight). */
  hipDrop?: number
  kneeAngle?: number
  /** Moving: the filter's lag behind the raw palms (ms), how far it trails them (torso lengths), their median speed (torso lengths a second), and the shiver while moving (torso lengths, raw and filtered). */
  lagMs?: number
  trail?: number
  speed?: number
  shiver?: [number, number]
}

export interface Span {
  torso: number
  shoulders: number
  /** Frame heights (image units). */
  frame: number
}

export interface TaskMeasures {
  id: TaskId
  status: 'done' | 'skipped'
  attempts: number
  seconds: number
  frames: number
  /** Share of detections that found someone. */
  found: number
  /** Detections a second. */
  hz: number
  match: Match | null
  /** Seconds from the prompt until the learner settled into the shape they then held (not for the moving tasks). */
  settledAfter: number | null
  joints: Record<Joint, JointSeen>
  /** Segment lengths measured from this task alone (posture's body lengths), where seen enough. */
  lengths: Partial<Proportions>
  /** Each palm's reach over the capture. */
  reach: { l: Reach | null; r: Reach | null }
  detail: TaskDetail
}

export interface Envelope {
  /** Furthest each palm was seen from its own shoulder in each sector (torso lengths; null where never), over the tasks that reach. */
  l: (number | null)[]
  r: (number | null)[]
  /** Each palm's reach, in torso lengths, shoulder widths and frame heights. */
  torso: { l: Reach | null; r: Reach | null }
  shoulders: { l: Reach | null; r: Reach | null }
  frame: { l: Reach | null; r: Reach | null }
}

export interface Measurements {
  /** The units in frame heights: a torso length (as `bodyScale` has it) and the shoulder width, held still. */
  units: { torso: number; shoulders: number }
  /** The learner held still (each joint's median, filtered, image units), or over everything if that was skipped. */
  still: Pose | null
  /** Segment lengths (`Proportions`, the posture's body lengths), as `src/fit.ts` measures them, over every task. */
  body: Proportions
  /** How many lengths of each part were measured. */
  counts: Record<Part, number>
  /** Shoulder to palm, in the posture's body lengths. */
  arm: number
  detection: { hz: number; found: number }
  joints: Record<Joint, JointSeen>
  envelope: Envelope
  /** From the overhead task (see `TaskDetail`); null inside where the palms were never seen. */
  overhead: { aboveShoulders: number | null; topY: number | null; inFrame: number } | null
  /** From the task out to the sides. */
  span: Span | null
  jitter: Jitter | null
  framing: Framing | null
  /** Where the hands were lost: counts at each edge, and the lowest a hand was raised (torso lengths above its shoulder) when lost at the top. */
  handsLeave: Record<Edge, number> & { topAbove: number | null }
  /** From moving through water (or the arm circles). */
  lag: { ms: number; trail: number } | null
  tasks: TaskMeasures[]
}

// ---- Samples -----------------------------------------------------------------

export type Phase = 'prompt' | 'settle' | 'capture'

export interface Sample {
  /** Seconds from the task's prompt. */
  t: number
  phase: Phase
  raw: Pose | null
  /** Through the landmark filter, as the pages have it. */
  pose: Pose | null
}

/** A task's recording decoded, each detection read raw and through a fresh `LandmarkFilter`. */
export function samplesOf(task: RecordedTask, aspect: number): Sample[] {
  const filter = new LandmarkFilter()
  const opts = { aspect, flipX: true, facingAway: false }
  const ph = task.phases
  return task.frames.map((f) => {
    const { t, landmarks } = decodeFrame(f)
    const lm = filter.update(landmarks, t)
    const phase: Phase = !ph || t >= ph.capture ? 'capture' : t >= ph.settle ? 'settle' : 'prompt'
    return {
      t: t / 1000,
      phase,
      raw: landmarks ? poseFromLandmarks(landmarks, opts) : null,
      pose: lm ? poseFromLandmarks(lm, opts) : null,
    }
  })
}

// ---- Helpers -------------------------------------------------------------------

const seen = (p: Pt | undefined) => !!p && p.v >= SEEN
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) })
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null)

/** Each joint's median place and visibility over `poses`. */
export function medianPose(poses: Pose[]): Pose | null {
  if (!poses.length) return null
  const out = {} as Pose
  for (const j of JOINTS) {
    out[j] = {
      x: median(poses.map((p) => p[j].x))!,
      y: median(poses.map((p) => p[j].y))!,
      v: median(poses.map((p) => p[j].v))!,
    }
  }
  return out
}

function edgeOf(p: Pt, aspect: number): Edge {
  const x = p.x / aspect
  const d: [Edge, number][] = [
    ['top', p.y],
    ['bottom', 1 - p.y],
    ['left', x],
    ['right', 1 - x],
  ]
  d.sort((a, b) => a[1] - b[1])
  return d[0][1] < EDGE ? d[0][0] : 'inside'
}

const round3 = (x: number) => Math.round(x * 1000) / 1000

interface Drop {
  joint: Joint
  /** The raw pose where it was last seen. */
  last: Pose
  edge: Edge
}

function jointsSeen(samples: Sample[], aspect: number, drops: Drop[] = []): Record<Joint, JointSeen> {
  const out = {} as Record<Joint, JointSeen>
  for (const j of JOINTS) {
    let n = 0
    let vSum = 0
    let dropsN = 0
    const at: JointSeen['at'] = []
    let last: Pose | null = null
    for (const s of samples) {
      const p = s.raw?.[j]
      vSum += p?.v ?? 0
      if (seen(p)) {
        n++
        last = s.raw
      } else if (last) {
        dropsN++
        const edge = edgeOf(last[j], aspect)
        drops.push({ joint: j, last, edge })
        if (at.length < MAX_AT) at.push([round3(last[j].x / aspect), round3(last[j].y), edge])
        last = null
      }
    }
    const count = samples.length || 1
    out[j] = { seen: n / count, v: vSum / count, drops: dropsN, at }
  }
  return out
}

function mergeJoints(all: Record<Joint, JointSeen>[], weights: number[]): Record<Joint, JointSeen> {
  const out = {} as Record<Joint, JointSeen>
  const total = weights.reduce((a, b) => a + b, 0) || 1
  for (const j of JOINTS) {
    let s = 0
    let v = 0
    let drops = 0
    const at: JointSeen['at'] = []
    all.forEach((js, i) => {
      s += js[j].seen * weights[i]
      v += js[j].v * weights[i]
      drops += js[j].drops
      at.push(...js[j].at)
    })
    out[j] = { seen: s / total, v: v / total, drops, at: at.slice(0, MAX_AT) }
  }
  return out
}

const SIDES = ['l', 'r'] as const
type Side = (typeof SIDES)[number]
const palmOf = (p: Pose, s: Side) => p[`${s}Palm`]
const shoulderOf = (p: Pose, s: Side) => p[`${s}Shoulder`]
/** Screen-left is outward for the screen-left hand. */
const outward = (s: Side, dx: number) => (s === 'l' ? -dx : dx)

function reachOf(poses: Pose[], side: Side, unit: number): Reach | null {
  const up: number[] = []
  const out: number[] = []
  const far: number[] = []
  for (const p of poses) {
    const palm = palmOf(p, side)
    const sh = shoulderOf(p, side)
    if (!seen(palm) || !seen(sh)) continue
    up.push((sh.y - palm.y) / unit)
    out.push(outward(side, palm.x - sh.x) / unit)
    far.push(dist(palm, sh) / unit)
  }
  if (!far.length) return null
  return {
    up: Math.max(0, ...up),
    down: Math.max(0, ...up.map((u) => -u)),
    out: Math.max(0, ...out),
    in: Math.max(0, ...out.map((o) => -o)),
    far: Math.max(...far),
  }
}

/** The sector (clockwise from straight up, on screen) that `to` lies in from `from`. */
export function sectorOf(from: Pt, to: Pt): number {
  const deg = (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI
  return Math.floor((((deg % 360) + 360) % 360) / SECTOR_DEG) % SECTORS
}

function sectorsOf(poses: Pose[], side: Side, unit: number): (number | null)[] {
  const out: (number | null)[] = new Array(SECTORS).fill(null)
  for (const p of poses) {
    const palm = palmOf(p, side)
    const sh = shoulderOf(p, side)
    if (!seen(palm) || !seen(sh)) continue
    const i = sectorOf(sh, palm)
    const d = dist(palm, sh) / unit
    out[i] = Math.max(out[i] ?? 0, d)
  }
  return out
}

/** The RMS distance of a track from its own moving average (the shiver without the sway). */
function shiverOf(track: Pt[]): number | null {
  if (track.length < 2 * SHIVER_HALF + 1) return null
  let sum = 0
  let n = 0
  for (let i = SHIVER_HALF; i < track.length - SHIVER_HALF; i++) {
    let x = 0
    let y = 0
    for (let k = i - SHIVER_HALF; k <= i + SHIVER_HALF; k++) {
      x += track[k].x
      y += track[k].y
    }
    const m = 2 * SHIVER_HALF + 1
    sum += (track[i].x - x / m) ** 2 + (track[i].y - y / m) ** 2
    n++
  }
  return Math.sqrt(sum / n)
}

function jitterOf(samples: Sample[], unit: number): Jitter | null {
  const joints: Jitter['joints'] = {}
  const raws: number[] = []
  const filtered: number[] = []
  for (const j of JOINTS) {
    const both = samples.filter((s) => seen(s.raw?.[j]) && s.pose)
    const r = shiverOf(both.map((s) => s.raw![j]))
    const f = shiverOf(both.map((s) => s.pose![j]))
    if (r === null || f === null) continue
    joints[j] = [r, f]
    raws.push(r)
    filtered.push(f)
  }
  const r = median(raws)
  const f = median(filtered)
  if (r === null || f === null) return null
  return { joints, raw: r, filtered: f, rawTorso: r / unit, filteredTorso: f / unit }
}

function framingOf(samples: Sample[], aspect: number, unit: number, posture: Posture): Framing | null {
  const still = medianPose(samples.flatMap((s) => (s.raw ? [s.raw] : [])))
  if (!still) return null
  const inside = (p: Pt) => seen(p) && p.x >= 0 && p.x <= aspect && p.y >= 0 && p.y <= 1
  const pts = JOINTS.map((j) => still[j]).filter(inside)
  if (!pts.length) return null
  const top = Math.min(...pts.map((p) => p.y))
  const bottom = Math.max(...pts.map((p) => p.y))
  const ms = mid(still.lShoulder, still.rShoulder)
  // Seated, the legs are expected to be out of the picture.
  const cropped = JOINTS.filter((j) => !inside(still[j]))
  return {
    top,
    bottom,
    left: Math.min(...pts.map((p) => p.x)) / aspect,
    right: Math.max(...pts.map((p) => p.x)) / aspect,
    height: bottom - top,
    centre: ms.x / aspect,
    headroom: ms.y / unit,
    cropped: posture === 'seated' ? cropped.filter((j) => !/Hip|Knee|Ankle/.test(j)) : cropped,
  }
}

/** How far the filtered palms trail the raw ones while moving. */
function lagOf(samples: Sample[], unit: number): Pick<TaskDetail, 'lagMs' | 'trail' | 'speed' | 'shiver'> {
  const out: Pick<TaskDetail, 'lagMs' | 'trail' | 'speed' | 'shiver'> = {}
  const gaps: number[] = []
  for (let i = 1; i < samples.length; i++) gaps.push(samples[i].t - samples[i - 1].t)
  const gap = median(gaps) ?? 1 / 30
  const cost: number[] = []
  const trails: number[] = []
  const speeds: number[] = []
  const shivers: [number, number][] = []
  for (const side of SIDES) {
    const j = `${side}Palm` as const
    const ok = (s: Sample | undefined) => !!s && seen(s.raw?.[j]) && !!s.pose
    for (let k = 0; k <= 12; k++) {
      let sum = 0
      let n = 0
      for (let i = k; i < samples.length; i++) {
        if (!ok(samples[i]) || !ok(samples[i - k])) continue
        sum += dist(samples[i].pose![j], samples[i - k].raw![j])
        n++
      }
      cost[k] = (cost[k] ?? 0) + (n ? sum / n : Infinity)
    }
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]
      const b = samples[i]
      if (!ok(a) || !ok(b)) continue
      trails.push(dist(b.pose![j], b.raw![j]) / unit)
      if (b.t > a.t) speeds.push(dist(b.raw![j], a.raw![j]) / unit / (b.t - a.t))
    }
    const run = samples.filter(ok)
    const r = shiverOf(run.map((s) => s.raw![j]))
    const f = shiverOf(run.map((s) => s.pose![j]))
    if (r !== null && f !== null) shivers.push([r / unit, f / unit])
  }
  let best = 0
  for (let k = 1; k < cost.length; k++) if (cost[k] < cost[best]) best = k
  if (Number.isFinite(cost[best])) {
    // A parabola through the best shift and its neighbours, for a lag finer than a frame.
    let k = best
    if (best > 0 && best < cost.length - 1 && Number.isFinite(cost[best - 1]) && Number.isFinite(cost[best + 1])) {
      const d = cost[best - 1] - 2 * cost[best] + cost[best + 1]
      if (d > 0) k += (cost[best - 1] - cost[best + 1]) / (2 * d)
    }
    out.lagMs = Math.max(0, k * gap * 1000)
  }
  const trail = median(trails)
  if (trail !== null) out.trail = trail
  const speed = median(speeds)
  if (speed !== null) out.speed = speed
  if (shivers.length) out.shiver = [median(shivers.map((s) => s[0]))!, median(shivers.map((s) => s[1]))!]
  return out
}

function kneeAngle(p: Pose, s: Side): number | null {
  const hip = p[`${s}Hip`]
  const knee = p[`${s}Knee`]
  const ankle = p[`${s}Ankle`]
  if (!seen(hip) || !seen(knee) || !seen(ankle)) return null
  const a = Math.atan2(hip.y - knee.y, hip.x - knee.x)
  const b = Math.atan2(ankle.y - knee.y, ankle.x - knee.x)
  let d = Math.abs(a - b) * (180 / Math.PI)
  if (d > 180) d = 360 - d
  return d
}

// ---- Matching the task's shape ------------------------------------------------

function matchOf(id: TaskId, samples: Sample[], body: Proportions, posture: Posture, captureAt: number): Match | null {
  const task = taskById(id)
  if (!task?.matched) return null
  const threshold = DEFAULT_OPTIONS.matchThreshold
  const fixed = task.moving ? null : computeFeatures(shapeOn(task.shape(0, posture), body, posture), posture)
  const target = (t: number): Features =>
    fixed ?? computeFeatures(shapeOn(task.shape(Math.max(0, t - captureAt), posture), body, posture), posture)
  const ds: number[] = []
  let within = 0
  let captured = 0
  for (const s of samples) {
    if (!s.pose || s.phase !== 'capture') continue
    const d = distance(computeFeatures(s.pose, posture), target(s.t))
    captured++
    if (Number.isFinite(d)) ds.push(d)
    if (d < threshold) within++
  }
  return { distance: median(ds), within: captured ? within / captured : 0 }
}

/**
 * Seconds from the prompt until the learner settled: the moving joints (the
 * arms; the hips too when bending the knees) came within `SETTLED` torso
 * lengths of where they then held through the capture, and stayed a moment.
 */
function settledAfter(id: TaskId, samples: Sample[], unit: number): number | null {
  const task = taskById(id)
  if (!task || task.moving) return null
  const held = medianPose(samples.flatMap((s) => (s.phase === 'capture' && s.pose ? [s.pose] : [])))
  if (!held) return null
  const joints: Joint[] = ['lElbow', 'rElbow', 'lPalm', 'rPalm', ...(id === 'knees' ? (['lHip', 'rHip'] as const) : [])]
  let since: number | null = null
  for (const s of samples) {
    const p = s.pose
    const js = p ? joints.filter((j) => seen(p[j]) && seen(held[j])) : []
    const e = js.length ? js.reduce((sum, j) => sum + dist(p![j], held[j]), 0) / js.length / unit : Infinity
    if (e < SETTLED) {
      since ??= s.t
      if (s.t - since >= REACHED_SEC) return since
    } else since = null
  }
  return null
}

// ---- The whole calibration ---------------------------------------------------------

const EMPTY_EDGES = (): Record<Edge, number> => ({ top: 0, bottom: 0, left: 0, right: 0, inside: 0 })

/** Everything measured from a calibration's recording. */
export function measure(rec: CalibrationRecording): Measurements {
  const { posture, aspect } = rec
  const done = rec.tasks.filter((t) => t.status === 'done')
  const samples = new Map<TaskId, Sample[]>(done.map((t) => [t.id, samplesOf(t, aspect)]))
  const captureOf = (id: TaskId) => (samples.get(id) ?? []).filter((s) => s.phase === 'capture')
  const posesOf = (ss: Sample[]) => ss.flatMap((s) => (s.pose ? [s.pose] : []))
  const all = [...samples.values()].flat()

  // The units, held still (or, if that was skipped, over everything).
  const unitFrom = (ss: Sample[]) => {
    const scale = median(
      posesOf(ss)
        .filter((p) => seen(p.lShoulder) && seen(p.rShoulder) && (posture === 'seated' || (seen(p.lHip) && seen(p.rHip))))
        .map((p) => bodyScale(p, posture)),
    )
    const shoulders = median(
      posesOf(ss)
        .filter((p) => seen(p.lShoulder) && seen(p.rShoulder))
        .map((p) => dist(p.lShoulder, p.rShoulder)),
    )
    return { scale, shoulders }
  }
  let u = unitFrom(captureOf('still'))
  if (u.scale === null || u.shoulders === null) u = unitFrom(all)
  const unit = u.scale ?? 0.2
  const shoulderUnit = u.shoulders ?? unit * 0.8

  // The body, as the practice pages measure it, over every task.
  const cal = new Calibration(posture)
  for (const p of posesOf(all)) cal.add(p)
  const body = cal.proportions()
  const counts = {} as Record<Part, number>
  for (const part of PARTS) counts[part] = cal.count(part)
  const arm = body.upperArm + body.forearm + body.hand

  const drops: Drop[] = []
  const tasks: TaskMeasures[] = rec.tasks.map((task) => {
    const ss = samples.get(task.id)
    const found = ss ? ss.filter((s) => s.raw).length : 0
    const seconds = ss && ss.length > 1 ? ss[ss.length - 1].t - ss[0].t : 0
    const base = {
      id: task.id,
      status: task.status,
      attempts: task.attempts,
      seconds,
      frames: ss?.length ?? 0,
      found: ss?.length ? found / ss.length : 0,
      hz: seconds > 0 ? (ss!.length - 1) / seconds : 0,
    }
    if (!ss) {
      return { ...base, match: null, settledAfter: null, joints: jointsSeen([], aspect), lengths: {}, reach: { l: null, r: null }, detail: {} }
    }
    const capture = ss.filter((s) => s.phase === 'capture')
    const poses = posesOf(capture)
    const own = new Calibration(posture)
    for (const p of posesOf(ss)) own.add(p)
    const measured = own.proportions()
    const lengths: Partial<Proportions> = {}
    for (const part of PARTS) if (own.count(part) >= 12) lengths[part] = measured[part]
    return {
      ...base,
      match: matchOf(task.id, ss, body, posture, (task.phases?.capture ?? 0) / 1000),
      settledAfter: settledAfter(task.id, ss, unit),
      joints: jointsSeen(ss, aspect, drops),
      lengths,
      reach: { l: reachOf(poses, 'l', unit), r: reachOf(poses, 'r', unit) },
      detail: detailOf(task.id, ss, capture, { aspect, unit, shoulderUnit, arm, posture }),
    }
  })

  // Where the hands were lost.
  const handsLeave = { ...EMPTY_EDGES(), topAbove: null as number | null }
  for (const d of drops) {
    if (d.joint !== 'lWrist' && d.joint !== 'rWrist') continue
    handsLeave[d.edge]++
    const side = d.joint[0] as Side
    const sh = shoulderOf(d.last, side)
    if (d.edge === 'top' && seen(sh)) {
      const above = (sh.y - d.last[d.joint].y) / unit
      handsLeave.topAbove = Math.min(handsLeave.topAbove ?? Infinity, above)
    }
  }

  // The reach envelope, from the tasks that ask for it.
  const reaching = done.filter((t) => taskById(t.id)?.reach).flatMap((t) => posesOf(captureOf(t.id)))
  const torso = { l: reachOf(reaching, 'l', unit), r: reachOf(reaching, 'r', unit) }
  const scaled = (k: number) => ({
    l: torso.l && scaleReach(torso.l, k),
    r: torso.r && scaleReach(torso.r, k),
  })
  const envelope: Envelope = {
    l: sectorsOf(reaching, 'l', unit),
    r: sectorsOf(reaching, 'r', unit),
    torso,
    shoulders: scaled(unit / shoulderUnit),
    frame: scaled(unit),
  }

  const byId = (id: TaskId) => tasks.find((t) => t.id === id && t.status === 'done')
  const oh = byId('overhead')?.detail
  const moving = byId('water')?.detail.lagMs !== undefined ? byId('water')!.detail : byId('circles')?.detail
  const weights = tasks.map((t) => t.frames)
  return {
    units: { torso: unit, shoulders: shoulderUnit },
    still: medianPose(posesOf(captureOf('still'))) ?? medianPose(posesOf(all)),
    body,
    counts,
    arm,
    detection: {
      hz: median(tasks.filter((t) => t.hz > 0).map((t) => t.hz)) ?? 0,
      found: all.length ? all.filter((s) => s.raw).length / all.length : 0,
    },
    joints: mergeJoints(
      tasks.map((t) => t.joints),
      weights,
    ),
    envelope,
    overhead: oh ? { aboveShoulders: oh.aboveShoulders ?? null, topY: oh.topY ?? null, inFrame: oh.inFrame ?? 0 } : null,
    span: byId('sides')?.detail.span ?? null,
    jitter: byId('still')?.detail.jitter ?? null,
    framing: byId('still')?.detail.framing ?? null,
    handsLeave,
    lag: moving?.lagMs !== undefined ? { ms: moving.lagMs, trail: moving.trail ?? 0 } : null,
    tasks,
  }
}

function scaleReach(r: Reach, k: number): Reach {
  return { up: r.up * k, down: r.down * k, out: r.out * k, in: r.in * k, far: r.far * k }
}

interface Context {
  aspect: number
  unit: number
  shoulderUnit: number
  arm: number
  posture: Posture
}

function detailOf(id: TaskId, all: Sample[], capture: Sample[], c: Context): TaskDetail {
  const poses = capture.flatMap((s) => (s.pose ? [s.pose] : []))
  const both = poses.filter((p) => seen(p.lPalm) && seen(p.rPalm) && seen(p.lShoulder) && seen(p.rShoulder))
  const palmsBelow = (p: Pose) => (mid(p.lPalm, p.rPalm).y - mid(p.lShoulder, p.rShoulder).y) / c.unit
  switch (id) {
    case 'still': {
      const out: TaskDetail = {}
      const jitter = jitterOf(capture, c.unit)
      if (jitter) out.jitter = jitter
      const framing = framingOf(capture, c.aspect, c.unit, c.posture)
      if (framing) out.framing = framing
      return out
    }
    case 'overhead': {
      const above: number[] = []
      const top: number[] = []
      for (const p of poses) {
        for (const s of SIDES) {
          const palm = palmOf(p, s)
          const sh = shoulderOf(p, s)
          if (!seen(palm) || !seen(sh)) continue
          above.push((sh.y - palm.y) / c.unit)
          top.push(palm.y)
        }
      }
      const inside = (p: Pt) => seen(p) && p.x >= 0 && p.x <= c.aspect && p.y >= 0 && p.y <= 1
      const inFrame = capture.filter((s) => s.raw && inside(s.raw.lPalm) && inside(s.raw.rPalm)).length
      const out: TaskDetail = { inFrame: capture.length ? inFrame / capture.length : 0 }
      if (above.length) out.aboveShoulders = Math.max(...above)
      if (top.length) out.topY = Math.min(...top)
      return out
    }
    case 'sides': {
      const w = max(both.map((p) => Math.abs(p.rPalm.x - p.lPalm.x)))
      const level = median(both.map((p) => (p.lPalm.y - p.lShoulder.y + p.rPalm.y - p.rShoulder.y) / 2 / c.unit))
      const out: TaskDetail = {}
      if (w !== null) out.span = { torso: w / c.unit, shoulders: w / c.shoulderUnit, frame: w }
      if (level !== null) out.level = level
      return out
    }
    case 'palms':
    case 'belly': {
      const gap = median(both.map((p) => dist(p.lPalm, p.rPalm) / c.unit))
      const height = median(both.map(palmsBelow))
      const out: TaskDetail = {}
      if (gap !== null) out.gap = gap
      if (height !== null) out.height = height
      return out
    }
    case 'forward': {
      const k = median(
        poses.flatMap((p) =>
          SIDES.flatMap((s) =>
            seen(palmOf(p, s)) && seen(shoulderOf(p, s)) ? [dist(palmOf(p, s), shoulderOf(p, s)) / (c.arm * c.unit)] : [],
          ),
        ),
      )
      return k === null ? {} : { foreshortening: k }
    }
    case 'knees': {
      const hips = (ss: Sample[]) =>
        ss.flatMap((s) => (s.pose && seen(s.pose.lHip) && seen(s.pose.rHip) ? [mid(s.pose.lHip, s.pose.rHip).y] : []))
      // Before moving, the hips stood where they stand.
      const start = median(hips(all.filter((s) => s.t < 0.8)))
      const low = max(hips(capture))
      const angles = poses.flatMap((p) => SIDES.flatMap((s) => kneeAngle(p, s) ?? []))
      const out: TaskDetail = {}
      if (start !== null && low !== null) out.hipDrop = Math.max(0, (low - start) / c.unit)
      if (angles.length) out.kneeAngle = Math.min(...angles)
      return out
    }
    case 'circles':
    case 'water':
      return lagOf(capture, c.unit)
  }
}
