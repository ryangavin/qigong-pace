import { describe, expect, it } from 'vitest'
import { buildReference, Follower, type Reference } from './follower'
import { DEMO_MOVES, referenceFromMove, sample, type BodyKey, type Move } from './moves'
import {
  cleanTrack,
  computeFeatures,
  distance,
  JOINTS,
  SEGMENTS,
  type Features,
  type Joint,
  type Pose,
  type Posture,
} from './skeleton'

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

// The follower tests use the app's original "Holding up the sky": the times
// below (arms rising 1.5–8.5s, held overhead to 11s) refer to its keys.
const key = (t: number, lArm: number, lElbow: number, rArm: number, rElbow: number, sink: number): BodyKey => ({
  t,
  lArm,
  lElbow,
  rArm,
  rElbow,
  sink,
})
const LIFT: Move = {
  id: 'lift-sky-original',
  name: 'Holding up the sky',
  set: 'Ba Duan Jin',
  tier: 1,
  cue: '',
  postures: ['standing', 'seated'],
  keys: [
    key(0, 12, 70, 12, 70, 0),
    key(1.5, 12, 70, 12, 70, 0),
    key(5, 90, 5, 90, 5, 0),
    key(8.5, 168, 25, 168, 25, 0),
    key(11, 168, 25, 168, 25, 0),
    key(14.5, 90, 0, 90, 0, 0.55),
    key(18, 12, 70, 12, 70, 0.2),
    key(20, 12, 70, 12, 70, 0),
  ],
}

const lift = referenceFromMove(LIFT)
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

  it('runs a video hold at real time despite tracker jitter', () => {
    // A video of the move: every frame jitters, and is smoothed as an imported video is.
    const jitter = rng(8)
    const track = lift.poses.map((p) => {
      const out = {} as Pose
      for (const j of JOINTS) out[j] = { x: p[j].x + jitter() * 0.01, y: p[j].y + jitter() * 0.01, v: 0.95 }
      return out
    })
    const video = buildReference('video', lift.fps, lift.aspect, cleanTrack(track))
    const f = new Follower(video)
    const rand = rng(9)
    for (let i = 0; i < 30; i++) f.update(noisy(video.poses[0], rand), DT)
    let learner = 0
    const top = Math.round(8.5 * video.fps)
    while (f.pos < top - 2) {
      learner = Math.min(top, learner + video.fps * DT)
      f.update(noisy(lift.poses[Math.round(learner)], rand), DT)
    }
    const start = f.pos
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[top], rand), DT)
    expect((f.pos - start) / video.fps).toBeGreaterThan(0.7)
    expect((f.pos - start) / video.fps).toBeLessThan(1.4)
  })

  it('runs a hold through to its end while the learner holds for its full length', () => {
    const f = new Follower(lift)
    const rand = rng(11)
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[0], rand), DT)
    let learner = 0
    const top = Math.round(8.5 * lift.fps)
    const end = Math.round(11 * lift.fps)
    while (f.pos < top - 2) {
      learner = Math.min(top, learner + lift.fps * DT)
      f.update(noisy(lift.poses[Math.round(learner)], rand), DT)
    }
    for (let t = 0; t < 2.5; t += DT) f.update(noisy(lift.poses[top], rand), DT)
    expect(f.pos).toBeGreaterThan(end - 0.35 * lift.fps)
  })

  it('reaches done while the learner holds the final rest pose', () => {
    const f = new Follower(lift)
    const rand = rng(12)
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[0], rand), DT)
    const last = lift.poses.length - 1
    let learner = 0
    for (let t = 0; t < 40 && f.state !== 'done'; t += DT) {
      learner = Math.min(last, learner + lift.fps * DT)
      f.update(noisy(lift.poses[Math.round(learner)], rand), DT)
    }
    expect(f.state).toBe('done')
  })

  it('waits when the learner is lost', () => {
    const f = new Follower(lift)
    const rand = rng(6)
    for (let i = 0; i < 30; i++) f.update(noisy(lift.poses[0], rand), DT)
    const before = f.pos
    // Separating heaven and earth, one arm up: nowhere near the start of Holding up the sky.
    const other = referenceFromMove(DEMO_MOVES.find((m) => m.id === 'separate')!)
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
  const seated = referenceFromMove(LIFT, 'seated')

  it('offers a built-in move seated unless it needs the legs', () => {
    // The catalog's "partial" seated moves.
    const standingOnly = ['shaking', 'three-plates', 'chui', 'pluck-star', 'deer-antlers']
    for (const m of DEMO_MOVES) {
      expect(m.postures).toEqual(standingOnly.includes(m.id) ? ['standing'] : ['standing', 'seated'])
    }
  })

  it('gives seated moves a cue without the legs', () => {
    for (const m of DEMO_MOVES) {
      if (!m.postures.includes('seated')) continue
      expect(m.seatedCue ?? m.cue).not.toMatch(/sink|squat|stance|weight|knee/i)
    }
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

describe('Built-in moves', () => {
  it('have unique ids, and a tier 2 move says what the front view loses', () => {
    expect(new Set(DEMO_MOVES.map((m) => m.id)).size).toBe(DEMO_MOVES.length)
    for (const m of DEMO_MOVES) {
      // He is tier 2 in the catalog but loses nothing from the front.
      if (m.tier === 2 && m.id !== 'he') expect(m.lost).toBeTruthy()
      if (m.tier === 1) expect(m.lost).toBeUndefined()
    }
  })

  it('jump between two keys that share a time', () => {
    const at = (t: number, lArm: number) => ({ t, lArm, lElbow: 0, rArm: 0, rElbow: 0, sink: 0 })
    const keys = [at(0, 0), at(1, 90), at(1, -270), at(2, -270)]
    expect(sample(keys, 1).lArm).toBe(90)
    expect(sample(keys, 1.001).lArm).toBeCloseTo(-270, 3)
    for (let t = 0; t <= 2; t += 1 / 60) expect(Number.isFinite(sample(keys, t).lArm)).toBe(true)
    // And a catalog move that relies on it draws finite poses throughout.
    const lifted = referenceFromMove(DEMO_MOVES.find((m) => m.id === 'lift-sky')!)
    for (const p of lifted.poses) for (const j of JOINTS) expect(Number.isFinite(p[j].x + p[j].y)).toBe(true)
  })

  // Standing, some moves change slowly and subtly (a few degrees of arm, or the
  // legs alone), so their motion is under `holdMotion`. The teacher must still
  // not pull ahead of a slow learner there.
  const cases = DEMO_MOVES.flatMap((m) => m.postures.map((p) => [m.id, p] as const))

  const follows = (id: string, posture: Posture, speed = 0.5) => {
    const ref = referenceFromMove(DEMO_MOVES.find((m) => m.id === id)!, posture)
    const learnerSees = posture === 'seated' ? seatedLearner : noisy
    const f = new Follower(ref)
    const rand = rng(21)
    let learner = 0
    let worst = 0
    const seconds = 2 + ref.poses.length / ref.fps / speed + 3
    for (let t = 0; t < seconds; t += DT) {
      if (f.state === 'following') learner = Math.min(ref.poses.length - 1, learner + speed * ref.fps * DT)
      f.update(learnerSees(ref.poses[Math.round(learner)], rand), DT)
      if (learner > 0) worst = Math.max(worst, distance(ref.feats[Math.round(learner)], ref.feats[f.frame]))
    }
    expect(f.state).toBe('done')
    expect(worst).toBeLessThan(0.1)
  }

  it.each(cases)('%s can be followed %s at half speed to the end', (id, p) => follows(id, p))
  // Its 3.5–6s stretch barely moves the arms: the default move, slower still.
  it('lift-sky can be followed standing at quarter speed to the end', () => follows('lift-sky', 'standing', 0.25))
})
