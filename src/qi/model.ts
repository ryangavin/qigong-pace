import type { Follower, Reference } from '../follower'
import { bodyScale, type Pose, type Posture } from '../skeleton'
import { at, qiTrack, type QiTrack } from './track'

// The qi model: turns practice into energy values for the qi view. Pure
// numbers, no drawing. Each value stands for a sensation practitioners report
// (docs/sensations.md), and rises under the conditions in which they report
// it: slow, smooth, in-step practice, never speed.

export type QiRegion = 'dantian' | 'lPalm' | 'rPalm' | 'lArm' | 'rArm' | 'spine' | 'crown' | 'lFoot' | 'rFoot'

export const QI_REGIONS: readonly QiRegion[] = ['dantian', 'lPalm', 'rPalm', 'lArm', 'rArm', 'spine', 'crown', 'lFoot', 'rFoot']

export interface QiFrame {
  /** Overall qi gathered this session, 0..1. Builds slowly, eases down slowly, never drops abruptly. */
  level: number
  /** Breath phase implied by the movement, -1 (full exhale, closing/sinking) .. 1 (full inhale, opening/rising). */
  breath: number
  /** Per-region charge, 0..1. */
  regions: Record<QiRegion, number>
  /** Strength of the field between the palms, 0..1: high when the palms face each other at a small distance and move slowly. */
  palmField: number
  /** How smoothly and closely the learner is moving in step right now, 0..1. */
  flow: number
  /** Direction energy streams along each arm right now: 1 toward the fingertips, -1 toward the body, 0 still. */
  armFlow: { l: number; r: number }
}

/** A frame with nothing gathered: the start of a session. */
export const quietFrame = (): QiFrame => ({
  level: 0,
  breath: 0,
  regions: Object.fromEntries(QI_REGIONS.map((r) => [r, 0])) as Record<QiRegion, number>,
  palmField: 0,
  flow: 0,
  armFlow: { l: 0, r: 0 },
})

const clamp01 =(x: number) => Math.min(1, Math.max(0, x))
const smoothstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a))
  return u * u * (3 - 2 * u)
}
/** Move `cur` toward `target` with time constant `tau`. */
const ease = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau))

/**
 * A store that fills while `input` (0..1) is high and drains while it is low:
 * fills toward 1 at `input / tauIn`, drains at `(1 - input) / tauOut`. It
 * settles where the two balance, so steady half-hearted input holds it part
 * full, and it can never change by more than dt / min(tau) in a frame.
 */
const charge = (c: number, input: number, dt: number, tauIn: number, tauOut: number) =>
  clamp01(c + dt * ((input * (1 - c)) / tauIn - ((1 - input) * c) / tauOut))

// Session level: at steady good flow (0.8) it is about half full after three
// minutes and settles near 0.83; with no flow it halves in about 3.5 minutes.
const LEVEL_FILL_SEC = 240
const LEVEL_DRAIN_SEC = 300

// Per region [fill, drain] seconds. The dantian "stores": it fills slowly and
// keeps its charge. Arm currents are momentary: they follow the movement.
const TAU: Record<QiRegion, [number, number]> = {
  dantian: [8, 30],
  lPalm: [6, 15],
  rPalm: [6, 15],
  lArm: [1.5, 3],
  rArm: [1.5, 3],
  spine: [4, 10],
  crown: [6, 15],
  lFoot: [8, 25],
  rFoot: [8, 25],
}

/** Faster than the teacher's own speed earns less: at 1.5× flow is about half, at 2× under a third. */
const speedFactor = (pace: number) => (pace <= 1 ? 1 : Math.exp(-1.2 * (pace - 1)))

// Rates below are "per second of the learner's time".
const BREATH_RATE_FULL = 0.5 // breath phase per second that counts as fully opening or closing
const REACH_RATE_FULL = 0.3 // body lengths per second that counts as a full stream along the arm

export interface QiInput {
  follower: Follower
  /** The learner's pose in image units, or null when nobody is tracked. */
  pose: Pose | null
  /** Seconds since the last update. */
  dt: number
}

/**
 * Stateful qi model. Call `update` once per frame with the same follower the
 * app uses; the frame it returns is also kept in `frame`.
 *
 * Dynamics, in short (docs/sensations.md has the reasoning):
 * - flow: closeness to the teacher × steadiness of pace × slowness, and zero
 *   when lost, when nobody is tracked, or when stopped where the teacher moves.
 *   A hold held still counts fully.
 * - level: a slow store fed by flow (minutes), drained gently without it.
 * - breath: the teacher's movement at the learner's position (opening and
 *   rising is inhale, closing and sinking is exhale; long holds breathe slowly).
 * - palms: fill with in-step practice and with the palm field.
 * - arms: carry a current while a hand moves away from (out) or toward (in) the dantian.
 * - dantian: fills in holds, while closing and sinking; keeps its charge.
 * - feet: fill with sinking, exhaling and holds; always 0 seated.
 * - crown: fills while rising and opening, with hands overhead, a little in holds.
 * - spine: lights with the breath moving up or down it, and when both ends are charged.
 * Every region also glows a little with the session level.
 */
export class QiModel {
  frame: QiFrame = quietFrame()

  private ref: Reference | null = null
  private track: QiTrack | null = null
  private lastPos = 0
  private lastPace = 0
  private jerk = 0
  private breathRate = 0
  private reachRate = { l: 0, r: 0 }
  private charges = Object.fromEntries(QI_REGIONS.map((r) => [r, 0])) as Record<QiRegion, number>
  // Smoothed wrist positions and speed, for the palm field.
  private wrists: { lx: number; ly: number; rx: number; ry: number } | null = null
  private handSpeed = 0

  /** Start a new session: everything back to zero. */
  reset() {
    Object.assign(this, new QiModel())
  }

  update({ follower: f, pose, dt }: QiInput): QiFrame {
    if (dt <= 0) return this.frame
    if (f.ref !== this.ref) {
      // A new move keeps the session's level and charges; only the move's own tracking restarts.
      this.ref = f.ref
      this.track = qiTrack(f.ref)
      this.lastPos = f.pos
      this.lastPace = f.pace
    }
    const track = this.track as QiTrack
    const posture = f.ref.posture
    const out = this.frame

    // How far the learner moved through the move this frame. Going back
    // (a loop starting over, a reset) counts as no movement.
    const from = f.pos >= this.lastPos ? this.lastPos : f.pos
    this.lastPos = f.pos

    // ---- flow ----
    this.jerk = ease(this.jerk, Math.abs(f.pace - this.lastPace) / dt, dt, 0.5)
    this.lastPace = f.pace
    let flowTarget = 0
    const lostAt = f.opts.matchThreshold * f.opts.lostFactor
    const closeness = Number.isFinite(f.distance) ? clamp01(1 - f.distance / lostAt) : 0
    if (pose && f.state === 'waiting') {
      // Standing in the opening pose, gathering before the move: a little flow.
      flowTarget = 0.4 * closeness
    } else if (pose && f.state === 'following' && !f.lost) {
      const steadiness = Math.exp(-this.jerk / 1.5)
      // Where the teacher moves, a learner who has stopped isn't practising; in a hold, stillness is the practice.
      const active = f.inHold ? 1 : smoothstep(0.03, 0.2, f.pace)
      flowTarget = closeness * steadiness * speedFactor(f.pace) * active
    }
    out.flow = ease(out.flow, flowTarget, dt, 0.5)
    const flow = out.flow
    const holding = f.state === 'following' && !f.lost && f.inHold

    // ---- level ----
    out.level = charge(out.level, flow, dt, LEVEL_FILL_SEC, LEVEL_DRAIN_SEC)

    // ---- breath and the directions energy moves ----
    out.breath = ease(out.breath, at(track.breath, f.pos), dt, 0.2)
    this.breathRate = ease(this.breathRate, (at(track.breath, f.pos) - at(track.breath, from)) / dt, dt, 0.3)
    const breathDir = Math.max(-1, Math.min(1, this.breathRate / BREATH_RATE_FULL))
    const inhale = Math.max(0, breathDir)
    const exhale = Math.max(0, -breathDir)
    this.reachRate.l = ease(this.reachRate.l, (at(track.reachL, f.pos) - at(track.reachL, from)) / dt, dt, 0.25)
    this.reachRate.r = ease(this.reachRate.r, (at(track.reachR, f.pos) - at(track.reachR, from)) / dt, dt, 0.25)
    out.armFlow.l = Math.tanh(this.reachRate.l / REACH_RATE_FULL)
    out.armFlow.r = Math.tanh(this.reachRate.r / REACH_RATE_FULL)

    // ---- palm field ----
    out.palmField = ease(out.palmField, pose ? this.palmFieldOf(pose, posture, dt) : 0, dt, 0.3)
    if (!pose) this.wrists = null

    // ---- regions ----
    const sink = at(track.sink, f.pos)
    const lift = at(track.lift, f.pos)
    const hold = holding ? 1 : 0
    const c = this.charges
    const fill = (r: QiRegion, input: number) => {
      c[r] = charge(c[r], clamp01(input), dt, TAU[r][0], TAU[r][1])
    }
    fill('lPalm', 0.6 * flow + 0.6 * out.palmField + 0.3 * flow * Math.max(0, out.armFlow.l))
    fill('rPalm', 0.6 * flow + 0.6 * out.palmField + 0.3 * flow * Math.max(0, out.armFlow.r))
    fill('lArm', flow * Math.abs(out.armFlow.l))
    fill('rArm', flow * Math.abs(out.armFlow.r))
    fill('dantian', flow * (0.7 * hold + 0.7 * exhale + 0.4 * sink))
    fill('crown', flow * (0.6 * inhale + 0.4 * lift + 0.3 * hold))
    fill('spine', 0.5 * flow * Math.abs(breathDir) + 0.8 * Math.min(c.dantian, c.crown))
    if (posture === 'standing') {
      const feet = flow * (0.6 * sink + 0.5 * exhale + 0.5 * hold)
      fill('lFoot', feet)
      fill('rFoot', feet)
    } else {
      c.lFoot = 0
      c.rFoot = 0
    }
    for (const r of QI_REGIONS) out.regions[r] = 1 - (1 - c[r]) * (1 - 0.3 * out.level)
    if (posture === 'seated') {
      out.regions.lFoot = 0
      out.regions.rFoot = 0
    }
    return out
  }

  /**
   * The "qi ball" between the palms. The camera can't see which way the palms
   * face, so it reads the forearms: both pointing in toward the midline, the
   * wrists level with each other and held up between the hips and the head,
   * close together, and moving slowly.
   */
  private palmFieldOf(p: Pose, posture: Posture, dt: number): number {
    const s = bodyScale(p, posture)
    const w = this.wrists
    const k = w ? 1 - Math.exp(-dt / 0.08) : 1
    const next = {
      lx: w ? w.lx + (p.lWrist.x - w.lx) * k : p.lWrist.x,
      ly: w ? w.ly + (p.lWrist.y - w.ly) * k : p.lWrist.y,
      rx: w ? w.rx + (p.rWrist.x - w.rx) * k : p.rWrist.x,
      ry: w ? w.ry + (p.rWrist.y - w.ry) * k : p.rWrist.y,
    }
    if (w) {
      const v = (Math.hypot(next.lx - w.lx, next.ly - w.ly) + Math.hypot(next.rx - w.rx, next.ry - w.ry)) / 2 / s / dt
      this.handSpeed = ease(this.handSpeed, v, dt, 0.3)
    }
    this.wrists = next

    const inward = (ex: number, ey: number, wx: number, wy: number, side: -1 | 1) => {
      const len = Math.hypot(wx - ex, wy - ey)
      return len > 1e-6 ? (-side * (wx - ex)) / len : 0
    }
    // side: -1 for the screen-left arm, whose inward direction is +x.
    const facing = smoothstep(
      0.2,
      0.7,
      Math.min(
        inward(p.lElbow.x, p.lElbow.y, p.lWrist.x, p.lWrist.y, -1),
        inward(p.rElbow.x, p.rElbow.y, p.rWrist.x, p.rWrist.y, 1),
      ),
    )
    const shoulderY = (p.lShoulder.y + p.rShoulder.y) / 2
    const below = (Math.max(p.lWrist.y, p.rWrist.y) - shoulderY) / s
    const above = (shoulderY - Math.min(p.lWrist.y, p.rWrist.y)) / s
    // Hands held up in front of the body: not hanging past the hips, not far overhead.
    const height = (1 - smoothstep(0.6, 0.95, below)) * (1 - smoothstep(0.6, 1, above))
    const level = 1 - smoothstep(0.15, 0.5, Math.abs(p.lWrist.y - p.rWrist.y) / s)
    const gap = Math.hypot(p.lWrist.x - p.rWrist.x, p.lWrist.y - p.rWrist.y) / s
    const near = 1 - smoothstep(0.5, 1.6, gap)
    // Tracker jitter reads as about 0.1 body lengths per second; a slow opening is 0.1–0.3.
    const slow = 1 / (1 + (this.handSpeed / 0.5) ** 2)
    const seen = clamp01((Math.min(p.lWrist.v, p.rWrist.v, p.lElbow.v, p.rElbow.v) - 0.3) / 0.4)
    return facing * height * level * near * slow * seen
  }
}
