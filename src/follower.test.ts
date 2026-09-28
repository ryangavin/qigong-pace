import { describe, expect, it } from 'vitest'
import { Follower, type Reference } from './follower'
import { DEMO_MOVES, referenceFromMove } from './moves'
import { computeFeatures, distance, JOINTS, SEGMENTS, type Features, type Joint, type Pose } from './skeleton'

const DT = 1 / 30

// Deterministic noise so a failing run can be replayed.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296 - 0.5
  }
}

function noisy(p: Pose, rand: () => number, amount = 0.006): Features {
  const out = {} as Pose
  for (const j of JOINTS) out[j] = { x: p[j].x + rand() * amount, y: p[j].y + rand() * amount, v: 0.95 }
  return computeFeatures(out)
}

/** A learner who performs the move at `speed(t)` × the original, starting in the opening pose. */
function simulate(ref: Reference, speed: (t: number) => number, seconds: number) {
  const f = new Follower(ref)
  const rand = rng(7)
  let learner = 0
  const log: { t: number; learner: number; pos: number; gap: number }[] = []
  for (let t = 0; t < seconds; t += DT) {
    if (f.state === 'following') learner = Math.min(ref.poses.length - 1, learner + speed(t) * ref.fps * DT)
    f.update(noisy(ref.poses[Math.round(learner)], rand), DT)
    const gap = distance(ref.feats[Math.round(learner)], ref.feats[f.frame])
    log.push({ t, learner, pos: f.pos, gap })
  }
  return { f, log }
}

const lift = referenceFromMove(DEMO_MOVES[0])
const moving = (ref: Reference, i: number) => ref.motion[Math.round(i)] > 0.08

describe('Follower', () => {
  it('waits for the opening pose before starting', () => {
    const f = new Follower(lift)
    const rand = rng(1)
    const armsUp = lift.poses[Math.round(9 * lift.fps)]
    for (let i = 0; i < 90; i++) f.update(noisy(armsUp, rand), DT)
    expect(f.state).toBe('waiting')
    expect(f.pos).toBe(0)
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[0], rand), DT)
    expect(f.state).toBe('following')
  })

  it.each([0.25, 0.5, 1, 2])('keeps up with a learner moving at %s× speed', (speed) => {
    const seconds = 2 + (lift.poses.length / lift.fps) / speed + 3
    const { f, log } = simulate(lift, () => speed, seconds)
    expect(f.state).toBe('done')
    // What the learner sees: the teacher's shape (before lead) stays close to their own.
    for (const s of log) {
      if (s.learner > 0) expect(s.gap).toBeLessThan(speed <= 1 ? 0.1 : 0.15)
    }
    // And at a steady pace the teacher is at most a third of a second behind.
    if (speed <= 1) {
      for (const s of log) {
        if (s.learner > 0 && moving(lift, s.learner)) {
          expect(Math.abs(s.pos - s.learner) / lift.fps).toBeLessThan(0.35)
        }
      }
    }
  })

  it('stops when the learner stops mid-movement', () => {
    const ref = lift
    const f = new Follower(ref)
    const rand = rng(3)
    for (let i = 0; i < 30; i++) f.update(noisy(ref.poses[0], rand), DT)
    // Learner rises to halfway up (frame ~ 3.3s) at half speed, then freezes for 5s.
    let learner = 0
    const stopAt = Math.round(3.3 * ref.fps)
    while (learner < stopAt) {
      learner = Math.min(stopAt, learner + 0.5 * ref.fps * DT)
      f.update(noisy(ref.poses[Math.round(learner)], rand), DT)
    }
    const posAtStop = f.pos
    for (let i = 0; i < 150; i++) f.update(noisy(ref.poses[stopAt], rand), DT)
    expect(f.pos - posAtStop).toBeLessThan(0.3 * ref.fps)
    expect(Math.abs(f.pos - stopAt)).toBeLessThan(0.3 * ref.fps)
  })

  it('does not follow a learner going backwards', () => {
    const f = new Follower(lift)
    const rand = rng(4)
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[0], rand), DT)
    const at = Math.round(4 * lift.fps)
    for (let i = 0; i <= at; i += 0.5) f.update(noisy(lift.poses[Math.round(i)], rand), DT)
    const high = f.pos
    for (let i = at; i > 0; i -= 0.5) {
      f.update(noisy(lift.poses[Math.round(i)], rand), DT)
      expect(f.pos).toBeGreaterThanOrEqual(high)
    }
    expect(f.pos - high).toBeLessThan(0.3 * lift.fps)
  })

  it('runs a hold at real time while the learner holds the shape', () => {
    // Holding up the sky holds overhead from 8.5s to 11s.
    const f = new Follower(lift)
    const rand = rng(5)
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[0], rand), DT)
    let learner = 0
    const top = Math.round(8.5 * lift.fps)
    while (f.pos < top - 2) {
      learner = Math.min(top, learner + lift.fps * DT)
      f.update(noisy(lift.poses[Math.round(learner)], rand), DT)
    }
    const start = f.pos
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[top], rand), DT)
    // One second of holding moves the teacher about one second through the hold.
    expect((f.pos - start) / lift.fps).toBeGreaterThan(0.7)
    expect((f.pos - start) / lift.fps).toBeLessThan(1.4)
  })

  it('waits when the learner is lost', () => {
    const f = new Follower(lift)
    const rand = rng(6)
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[0], rand), DT)
    const before = f.pos
    // Separating heaven and earth, one arm up: nowhere near the start of Holding up the sky.
    const other = referenceFromMove(DEMO_MOVES[1])
    for (let i = 0; i < 90; i++) f.update(noisy(other.poses[Math.round(6 * other.fps)], rand), DT)
    expect(f.lost).toBe(true)
    expect(f.pos - before).toBeLessThan(0.3 * lift.fps)
  })
})

// A learner at a desk: the camera sees them from the waist up. MediaPipe still
// guesses at the hips and legs, below the frame and with low visibility.
const LOWER: Joint[] = ['lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle']

function seatedLearner(p: Pose, rand: () => number, amount = 0.006): Features {
  const out = {} as Pose
  for (const j of JOINTS) out[j] = { x: p[j].x + rand() * amount, y: p[j].y + rand() * amount, v: 0.95 }
  for (const j of LOWER) out[j] = { x: p[j].x + rand() * 0.2, y: 1.1 + rand() * 0.2, v: 0.1 }
  return computeFeatures(out, 'seated')
}

describe('Seated practice', () => {
  const seated = referenceFromMove(DEMO_MOVES[0], 'seated')

  it('offers every built-in move both ways', () => {
    for (const m of DEMO_MOVES) expect(m.postures).toEqual(['standing', 'seated'])
  })

  it('draws the teacher seated, without sinking', () => {
    expect(seated.posture).toBe('seated')
    const hipY = seated.poses[0].lHip.y
    for (const p of seated.poses) expect(p.lHip.y).toBeCloseTo(hipY, 6)
    // Thighs toward the viewer read short: far less hip-to-knee drop than standing.
    const standing = lift.poses[0]
    const s = seated.poses[0]
    expect(s.lKnee.y - s.lHip.y).toBeLessThan(0.4 * (standing.lKnee.y - standing.lHip.y))
  })

  it('ignores the hips and legs and does not measure the body by them', () => {
    const p = seated.poses[Math.round(6 * seated.fps)]
    const moved = { ...p, lHip: { x: 0.1, y: 1.3, v: 0.1 }, rHip: { x: 1.2, y: 1.5, v: 0.1 } }
    const a = computeFeatures(p, 'seated')
    const b = computeFeatures(moved, 'seated')
    expect(Array.from(b.vec)).toEqual(Array.from(a.vec))
    SEGMENTS.forEach((s, i) => {
      if (s.lower) expect(a.vis[i]).toBe(0)
      else expect(a.vis[i]).toBeGreaterThan(0)
    })
  })

  it('leaves standing features as they were', () => {
    const p = lift.poses[Math.round(6 * lift.fps)]
    expect(Array.from(computeFeatures(p, 'standing').vec)).toEqual(Array.from(computeFeatures(p).vec))
    expect(lift.posture).toBe('standing')
  })

  it('starts when the learner takes the opening pose', () => {
    const f = new Follower(seated)
    const rand = rng(11)
    const armsUp = seated.poses[Math.round(9 * seated.fps)]
    for (let i = 0; i < 90; i++) f.update(seatedLearner(armsUp, rand), DT)
    expect(f.state).toBe('waiting')
    for (let i = 0; i < 30; i++) f.update(seatedLearner(seated.poses[0], rand), DT)
    expect(f.state).toBe('following')
  })

  it.each([0.5, 1])('follows a learner moving at %s× speed to the end', (speed) => {
    const f = new Follower(seated)
    const rand = rng(12)
    let learner = 0
    const seconds = 2 + seated.poses.length / seated.fps / speed + 3
    for (let t = 0; t < seconds; t += DT) {
      if (f.state === 'following') learner = Math.min(seated.poses.length - 1, learner + speed * seated.fps * DT)
      f.update(seatedLearner(seated.poses[Math.round(learner)], rand), DT)
      if (learner > 0) expect(distance(seated.feats[Math.round(learner)], seated.feats[f.frame])).toBeLessThan(0.1)
    }
    expect(f.state).toBe('done')
  })

  it('runs a hold at real time while the learner holds the shape', () => {
    const f = new Follower(seated)
    const rand = rng(13)
    for (let i = 0; i < 30; i++) f.update(seatedLearner(seated.poses[0], rand), DT)
    let learner = 0
    const top = Math.round(8.5 * seated.fps)
    while (f.pos < top - 2) {
      learner = Math.min(top, learner + seated.fps * DT)
      f.update(seatedLearner(seated.poses[Math.round(learner)], rand), DT)
    }
    const start = f.pos
    for (let i = 0; i < 30; i++) f.update(seatedLearner(seated.poses[top], rand), DT)
    expect((f.pos - start) / seated.fps).toBeGreaterThan(0.7)
    expect((f.pos - start) / seated.fps).toBeLessThan(1.4)
  })
})
