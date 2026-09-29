import { DEFAULT_OPTIONS, type Reference } from '../follower'
import { bodyScale, type Pose, type Posture, type Pt } from '../skeleton'

// What the teacher's move implies at each frame, read once per reference from
// its poses: the breath the movement carries, how far each hand is from the
// dantian, how deep the knees are bent and how high the hands are raised.
// See docs/sensations.md for why each of these drives a region.

export interface QiTrack {
  /** Breath phase implied by the movement, -1 (full exhale) .. 1 (full inhale). */
  breath: Float32Array
  /** Each wrist's distance from the dantian, in body lengths. */
  reachL: Float32Array
  reachR: Float32Array
  /** Knee bend, 0 (standing tall) .. 1 (deepest sink in this move). Always 0 seated. */
  sink: Float32Array
  /** Hands raised overhead, 0 (at or below the shoulders) .. 1 (fully up). */
  lift: Float32Array
}

/**
 * How open and risen the body is, in body lengths. The Health Qigong rule is
 * to inhale while lifting and opening and exhale while lowering and closing,
 * so the breath follows this rising and falling.
 */
export function openness(p: Pose, posture: Posture): number {
  const s = bodyScale(p, posture)
  const shoulderY = (p.lShoulder.y + p.rShoulder.y) / 2
  // Hands rising above (or hanging below) the shoulders.
  const rise = (shoulderY - p.lWrist.y + shoulderY - p.rWrist.y) / 2 / s
  // Hands spreading apart. It counts for less than rising, so arms lowering
  // down the sides (spreading as they fall) still read as closing.
  const spread = Math.abs(p.lWrist.x - p.rWrist.x) / s
  // Standing up out of a sink lengthens the legs; sinking shortens them.
  const legs = posture === 'standing' ? (p.lAnkle.y - p.lHip.y + p.rAnkle.y - p.rHip.y) / 2 / s : 0
  return rise + 0.3 * spread + 2 * legs
}

/** Lower dantian: a little above the hips standing; seated, measured down from the shoulders. */
export function dantianPoint(p: Pose, posture: Posture): Pt {
  const sx = (p.lShoulder.x + p.rShoulder.x) / 2
  const sy = (p.lShoulder.y + p.rShoulder.y) / 2
  if (posture === 'seated') return { x: sx, y: sy + 0.85 * bodyScale(p, posture), v: 1 }
  const hx = (p.lHip.x + p.rHip.x) / 2
  const hy = (p.lHip.y + p.rHip.y) / 2
  return { x: hx + 0.15 * (sx - hx), y: hy + 0.15 * (sy - hy), v: 1 }
}

// Openness must move this far past a peak before the breath turns, so jitter
// in a video reference doesn't flip it.
const TURN_EPS = 0.08
// A run that opens or closes at least this much carries a whole inhale or
// exhale (Opening and closing at the chest swings about 0.25).
const FULL_SWING = 0.2
// A hold at least this long breathes on its own: movement no longer sets the breath.
const LONG_HOLD_SEC = 3
const HOLD_BREATH_PERIOD_SEC = 8
const HOLD_BREATH_DEPTH = 0.6
const HOLD_BLEND_SEC = 2

const smoothstep = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

/**
 * Breath phase from openness. The move is cut into runs between turning
 * points (where openness reverses by more than TURN_EPS); along an opening
 * run the breath goes to 1 in proportion to how far it has opened, along a
 * closing run to -1. A run under FULL_SWING moves it only part of the way,
 * so a small adjustment isn't a whole breath. Mapping by openness rather than time
 * keeps a short pause mid-run where it is: the breath is held, as the Health
 * Qigong texts describe for the stretch at the top of a move. Long holds
 * (standing post) have no movement to follow, so there the breath eases into
 * a slow natural cycle and back out before the hold ends.
 */
function breathTrack(o: Float32Array, motion: Float32Array, fps: number): Float32Array {
  const n = o.length
  const out = new Float32Array(n)
  if (n === 0) return out
  const turns = [0]
  let dir = 0
  let lo = 0
  let hi = 0
  let ext = 0
  for (let i = 1; i < n; i++) {
    if (dir === 0) {
      if (o[i] < o[lo]) lo = i
      if (o[i] > o[hi]) hi = i
      if (o[i] - o[lo] > TURN_EPS) {
        turns.push(lo)
        dir = 1
        ext = i
      } else if (o[hi] - o[i] > TURN_EPS) {
        turns.push(hi)
        dir = -1
        ext = i
      }
      continue
    }
    if (dir * (o[i] - o[ext]) >= 0) ext = i
    else if (dir * (o[ext] - o[i]) > TURN_EPS) {
      turns.push(ext)
      dir = -dir
      ext = i
    }
  }
  if (dir !== 0) turns.push(ext)
  turns.push(n - 1)
  if (turns.length === 2) return out // No opening or closing at all.
  // The first run starts from the far end of the breath: opening starts exhaled.
  const first = turns.findIndex((a, k) => k + 1 < turns.length && Math.abs(o[turns[k + 1]] - o[a]) > TURN_EPS)
  let b0 = first >= 0 && o[turns[first + 1]] > o[turns[first]] ? -1 : 1
  for (let k = 0; k + 1 < turns.length; k++) {
    const a = turns[k]
    const b = turns[k + 1]
    const swing = o[b] - o[a]
    // A full run takes the breath end to end; a small one moves it part of the way.
    // Before the first turn and after the last the body is settled: the breath holds.
    const settled = Math.abs(swing) <= TURN_EPS
    const end = settled
      ? b0
      : Math.abs(swing) >= FULL_SWING
        ? Math.sign(swing)
        : Math.max(-1, Math.min(1, b0 + (2 * swing) / FULL_SWING))
    for (let i = a; i <= b; i++) {
      const u = settled ? 0 : Math.min(1, Math.max(0, (o[i] - o[a]) / swing))
      out[i] = b0 + (end - b0) * u
    }
    b0 = end
  }

  // Long holds breathe on their own.
  const minHold = Math.round(LONG_HOLD_SEC * fps)
  const blend = HOLD_BLEND_SEC * fps
  for (let i = 0; i < n; ) {
    if (motion[i] >= DEFAULT_OPTIONS.holdMotion) {
      i++
      continue
    }
    let j = i
    while (j < n && motion[j] < DEFAULT_OPTIONS.holdMotion) j++
    const next = j
    // Motion is slight as the body eases into and out of a hold, and slow,
    // subtle movement reads as slight too: only where the body stays as open
    // as it is mid-way is it holding.
    const settled = o[(i + j) >> 1]
    while (i < j && Math.abs(o[i] - settled) > TURN_EPS / 4) i++
    while (j > i && Math.abs(o[j - 1] - settled) > TURN_EPS / 4) j--
    let still = true
    for (let f = i; f < j; f++) if (Math.abs(o[f] - settled) > TURN_EPS / 4) still = false
    if (still && j - i >= minHold && i > 0 && next < n) {
      const held = out[i]
      for (let f = i; f < j; f++) {
        const w = smoothstep(0, blend, f - i) * smoothstep(0, blend, j - f)
        const cycle = HOLD_BREATH_DEPTH * Math.sign(held || 1) * Math.cos((2 * Math.PI * (f - i)) / (HOLD_BREATH_PERIOD_SEC * fps))
        out[f] = (1 - w) * held + w * cycle
      }
    }
    i = next
  }
  return out
}

const tracks = new WeakMap<Reference, QiTrack>()

export function qiTrack(ref: Reference): QiTrack {
  const cached = tracks.get(ref)
  if (cached) return cached
  const n = ref.poses.length
  const posture = ref.posture
  const raw = new Float32Array(n)
  const reachL = new Float32Array(n)
  const reachR = new Float32Array(n)
  const legs = new Float32Array(n)
  const lift = new Float32Array(n)
  ref.poses.forEach((p, i) => {
    const s = bodyScale(p, posture)
    raw[i] = openness(p, posture)
    const d = dantianPoint(p, posture)
    reachL[i] = Math.hypot(p.lWrist.x - d.x, p.lWrist.y - d.y) / s
    reachR[i] = Math.hypot(p.rWrist.x - d.x, p.rWrist.y - d.y) / s
    legs[i] = posture === 'standing' ? (p.lAnkle.y - p.lHip.y + p.rAnkle.y - p.rHip.y) / 2 / s : 0
    const shoulderY = (p.lShoulder.y + p.rShoulder.y) / 2
    const up = (shoulderY - Math.min(p.lWrist.y, p.rWrist.y)) / s
    lift[i] = smoothstep(0, 1.2, up)
  })
  // Smooth openness over a short window so a jittery video reads as its movement.
  const r = Math.max(1, Math.round(0.15 * ref.fps))
  const o = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let cnt = 0
    for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) {
      sum += raw[k]
      cnt++
    }
    o[i] = sum / cnt
  }
  const tallest = legs.reduce((m, x) => Math.max(m, x), 0)
  // The deepest built-in sink shortens the legs by about 15%.
  const sink = legs.map((x) => (posture === 'standing' && tallest > 0 ? Math.min(1, (tallest - x) / (0.15 * tallest)) : 0))
  const track = { breath: breathTrack(o, ref.motion, ref.fps), reachL, reachR, sink, lift }
  tracks.set(ref, track)
  return track
}

/** Linear interpolation into a per-frame track at a fractional frame. */
export function at(a: Float32Array, pos: number): number {
  const n = a.length
  if (n === 0) return 0
  const p = Math.min(n - 1, Math.max(0, pos))
  const i = Math.floor(p)
  const j = Math.min(n - 1, i + 1)
  return a[i] + (a[j] - a[i]) * (p - i)
}
