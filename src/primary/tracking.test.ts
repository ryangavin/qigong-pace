import { describe, expect, it } from 'vitest'
import { DEMO_MOVES, referenceFromMove } from '../moves'
import { JOINTS, type Joint, type Pose, type Posture } from '../skeleton'
import { TrackingHints, troubleOf } from './tracking'

const DT = 1 / 30

const figure = (posture: Posture) => {
  const move = DEMO_MOVES.find((m) => m.postures.includes(posture))!
  const ref = referenceFromMove(move, posture)
  return { pose: ref.poses[0], aspect: ref.aspect }
}

/** `p` with some joints unseen. */
const hide = (p: Pose, ...joints: Joint[]): Pose => {
  const out = { ...p }
  for (const j of joints) out[j] = { ...p[j], v: 0.1 }
  return out
}

/** `p` scaled about its middle, as if the learner stepped toward the camera. */
const nearer = (p: Pose, s: number, aspect: number): Pose => {
  const out = {} as Pose
  for (const j of JOINTS) out[j] = { x: aspect / 2 + (p[j].x - aspect / 2) * s, y: 0.5 + (p[j].y - 0.5) * s, v: p[j].v }
  return out
}

describe('troubleOf', () => {
  const { pose, aspect } = figure('standing')
  const at = (p: Pose | null, posture: Posture = 'standing') => troubleOf({ pose: p, aspect, posture })

  it('finds nothing wrong with a whole body in view', () => {
    expect(at(pose)).toBeNull()
  })

  it('knows when no one is there', () => {
    expect(at(null)).toBe('lost')
    expect(at(hide(pose, 'lShoulder', 'rShoulder'))).toBe('lost')
  })

  it('asks a standing learner to step back when too close', () => {
    expect(at(hide(pose, 'lAnkle', 'rAnkle'))).toBe('close')
    expect(at(nearer(pose, 1.6, aspect))).toBe('close')
  })

  it('notices a hand out of sight or out of frame', () => {
    expect(at(hide(pose, 'lWrist'))).toBe('hands')
    expect(at({ ...pose, rWrist: { ...pose.rWrist, y: 1.05 } })).toBe('hands')
  })

  it('does not ask a seated learner for their ankles', () => {
    const seated = figure('seated')
    const p = hide(seated.pose, 'lAnkle', 'rAnkle', 'lKnee', 'rKnee')
    expect(troubleOf({ pose: p, aspect: seated.aspect, posture: 'seated' })).toBeNull()
    // Shoulders across 60% of the frame: a face right up to the laptop.
    const w = Math.abs(p.lShoulder.x - p.rShoulder.x)
    const close = nearer(p, (0.6 * seated.aspect) / w, seated.aspect)
    expect(troubleOf({ pose: close, aspect: seated.aspect, posture: 'seated' })).toBe('close')
  })
})

describe('TrackingHints', () => {
  const { pose, aspect } = figure('standing')
  const run = (hints: TrackingHints, p: Pose | null, seconds: number) => {
    let shown = null
    for (let t = 0; t < seconds; t += DT) shown = hints.update({ pose: p, aspect, posture: 'standing', dt: DT })
    return shown
  }

  it('say nothing while tracking is fine', () => {
    expect(run(new TrackingHints(), pose, 10)).toBeNull()
  })

  it('let a passing flicker go unmentioned', () => {
    const hints = new TrackingHints()
    expect(run(hints, hide(pose, 'rWrist'), 0.5)).toBeNull()
    expect(run(hints, pose, 1)).toBeNull()
  })

  it('mention a trouble that lasts, and let it go once it has passed', () => {
    const hints = new TrackingHints()
    expect(run(hints, hide(pose, 'rWrist'), 1.5)).toBe('hands')
    expect(hints.text('standing')).toMatch(/hands/)
    // Still said just after the hand comes back, then gone.
    expect(run(hints, pose, 0.3)).toBe('hands')
    expect(run(hints, pose, 1)).toBeNull()
    expect(hints.text('standing')).toBe('')
  })

  it('put losing the whole person first', () => {
    const hints = new TrackingHints()
    expect(run(hints, null, 1.5)).toBe('lost')
    expect(hints.text('standing')).toBe('Step into the light.')
  })
})
