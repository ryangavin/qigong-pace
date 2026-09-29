import { torsoLength, type Pose } from '../skeleton'
import type { QiFrame } from '../qi'

// A stand-in for the qi model, for the tuning harness: a rough QiFrame read
// off the body's motion. Opening and rising reads as the in-breath, reaching
// out sends the arms' current to the fingertips, and qi builds over a minute.

export interface AutoQiOptions {
  /** Seconds for `level` to ramp from 0 to 1. */
  rampSec: number
}

export interface AutoQi {
  /** Advance by `dt` seconds. `level` overrides the ramp when given. */
  update(pose: Pose, dt: number, level?: number): QiFrame
  reset(): void
}

const clamp = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x))
const smooth = (e0: number, e1: number, x: number) => {
  const u = clamp((x - e0) / (e1 - e0), 0, 1)
  return u * u * (3 - 2 * u)
}

/** How open the body is: hands raised above the belly and spread apart, in torso lengths. */
function openness(p: Pose, T: number) {
  const hipY = (p.lHip.y + p.rHip.y) / 2
  const raise = (hipY - p.lWrist.y + (hipY - p.rWrist.y)) / 2 / T
  const spread = Math.abs(p.rWrist.x - p.lWrist.x) / T
  return raise * 0.6 + spread * 0.5
}

/** How far each hand is from the body's centre line, in torso lengths. */
function reach(p: Pose, T: number) {
  const cx = (p.lShoulder.x + p.rShoulder.x + p.lHip.x + p.rHip.x) / 4
  const cy = (p.lShoulder.y + p.rShoulder.y + p.lHip.y + p.rHip.y) / 4
  return {
    l: Math.hypot(p.lWrist.x - cx, p.lWrist.y - cy) / T,
    r: Math.hypot(p.rWrist.x - cx, p.rWrist.y - cy) / T,
  }
}

export function createAutoQi(opts: AutoQiOptions = { rampSec: 60 }): AutoQi {
  let elapsed = 0
  let prev: { open: number; reach: { l: number; r: number } } | null = null
  let breath = 0
  let still = 0
  const arm = { l: 0, r: 0 }

  return {
    reset() {
      elapsed = 0
      prev = null
      breath = 0
      still = 0
      arm.l = 0
      arm.r = 0
    },
    update(p, dt, levelOverride) {
      elapsed += dt
      const T = torsoLength(p)
      const open = openness(p, T)
      const rc = reach(p, T)
      const k = dt > 0 ? 1 - Math.exp(-dt / 0.35) : 0
      if (prev && dt > 0) {
        const dOpen = (open - prev.open) / dt
        arm.l += (clamp(((rc.l - prev.reach.l) / dt) * 3) - arm.l) * k
        arm.r += (clamp(((rc.r - prev.reach.r) / dt) * 3) - arm.r) * k
        // While holding still, breathe slowly on a six-second cycle.
        const speed = Math.abs(dOpen)
        still += ((speed < 0.05 ? 1 : 0) - still) * (1 - Math.exp(-dt / 1.5))
        const moved = clamp(dOpen * 2.5)
        const rest = Math.sin((elapsed * 2 * Math.PI) / 6) * 0.5
        breath += (moved * (1 - still) + rest * still - breath) * k
      }
      prev = { open, reach: rc }

      const level = clamp(levelOverride ?? smooth(0, 1, elapsed / opts.rampSec), 0, 1)
      const hipY = (p.lHip.y + p.rHip.y) / 2
      const shY = (p.lShoulder.y + p.rShoulder.y) / 2
      const handsY = (p.lWrist.y + p.rWrist.y) / 2
      const overhead = smooth(0, 0.8, (shY - handsY) / T)
      const atBelly = 1 - smooth(0.2, 0.9, Math.abs(handsY - hipY) / T)
      const span = Math.hypot(p.rWrist.x - p.lWrist.x, p.rWrist.y - p.lWrist.y) / T
      // Hands close together at the same height read as palms facing.
      const tilt = Math.abs(p.rWrist.y - p.lWrist.y) / T
      const facing = smooth(2.6, 0.8, span) * (1 - smooth(0.3, 0.9, tilt))

      return {
        level,
        breath,
        flow: 0.85,
        palmField: facing * (0.3 + 0.7 * level),
        armFlow: { l: arm.l, r: arm.r },
        regions: {
          dantian: level * (0.6 + 0.4 * atBelly),
          lPalm: level * (0.5 + 0.5 * Math.abs(arm.l)),
          rPalm: level * (0.5 + 0.5 * Math.abs(arm.r)),
          lArm: level * (0.3 + 0.7 * Math.abs(arm.l)),
          rArm: level * (0.3 + 0.7 * Math.abs(arm.r)),
          spine: level * (0.4 + 0.6 * Math.max(breath, 0)),
          crown: level * (0.3 + 0.7 * overhead),
          lFoot: level * (0.6 + 0.4 * Math.max(-breath, 0)),
          rFoot: level * (0.6 + 0.4 * Math.max(-breath, 0)),
        },
      }
    },
  }
}
