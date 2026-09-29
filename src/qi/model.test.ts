import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, Follower, type Reference } from '../follower'
import { DEMO_MOVES, poseAt, referenceFromMove } from '../moves'
import { computeFeatures, JOINTS, type Pose, type Posture } from '../skeleton'
import { QiModel, type QiFrame } from './model'
import { qiTrack } from './track'

const DT = 1 / 30

// Deterministic noise so a failing run can be replayed (as in follower.test.ts).
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296 - 0.5
  }
}

function noisy(p: Pose, rand: () => number, amount = 0.006): Pose {
  const out = {} as Pose
  for (const j of JOINTS) out[j] = { x: p[j].x + rand() * amount, y: p[j].y + rand() * amount, v: 0.95 }
  return out
}

const move = (id: string, posture: Posture = 'standing') => referenceFromMove(DEMO_MOVES.find((m) => m.id === id)!, posture)

interface Sample {
  t: number
  pos: number
  q: QiFrame
}

/**
 * A learner who performs the move at `speed(t)` × the original, looping, and
 * the qi model watching them. `seeing(t)`, when given, replaces what the
 * learner shows the camera (another pose, or nobody).
 */
class Session {
  f: Follower
  qi = new QiModel()
  learner = 0
  reps = 0
  t = 0
  rand = rng(7)
  log: Sample[] = []

  constructor(
    public ref: Reference,
    loop = true,
  ) {
    this.f = new Follower(ref, { ...DEFAULT_OPTIONS, loop })
  }

  run(seconds: number, speed: number, seeing?: (learner: Pose) => Pose | null) {
    const n = this.ref.poses.length
    for (let end = this.t + seconds; this.t < end; this.t += DT) {
      // Start over with the teacher when it loops.
      if (this.f.reps > this.reps) {
        this.reps = this.f.reps
        this.learner = 0
      }
      if (this.f.state === 'following') this.learner = Math.min(n - 1, this.learner + speed * this.ref.fps * DT)
      const shown = this.ref.poses[Math.round(this.learner)]
      const seen = seeing ? seeing(shown) : shown
      const pose = seen && noisy(seen, this.rand)
      this.f.update(pose && computeFeatures(pose, this.ref.posture), DT)
      const q = this.qi.update({ follower: this.f, pose, dt: DT })
      this.log.push({ t: this.t, pos: this.f.pos, q: structuredClone(q) })
    }
    return this
  }

  get q() {
    return this.qi.frame
  }
}

const maxStep = (log: Sample[], key: (q: QiFrame) => number) => {
  let worst = 0
  for (let i = 1; i < log.length; i++) worst = Math.max(worst, Math.abs(key(log[i].q) - key(log[i - 1].q)))
  return worst
}

describe('Qi level', () => {
  it('rises with sustained in-step practice and never jumps', () => {
    const s = new Session(move('open-close-chest')).run(60, 0.5)
    const at60 = s.q.level
    s.run(60, 0.5)
    const at120 = s.q.level
    s.run(60, 0.5)
    expect(at60).toBeGreaterThan(0.1)
    expect(at120).toBeGreaterThan(at60 + 0.05)
    expect(s.q.level).toBeGreaterThan(at120 + 0.03)
    expect(s.q.level).toBeLessThan(0.9)
    expect(maxStep(s.log, (q) => q.level)).toBeLessThan(0.001)
  })

  it('eases down gently when the learner is lost', () => {
    const s = new Session(move('open-close-chest')).run(120, 0.5)
    const built = s.q.level
    // One arm up, one down: nowhere in this move.
    const elsewhere = move('separate').poses[Math.round(6 * 30)]
    const lostAt = s.log.length
    s.run(20, 0.5, () => elsewhere)
    expect(s.f.lost).toBe(true)
    expect(s.q.flow).toBeLessThan(0.05)
    expect(s.q.level).toBeLessThan(built)
    expect(s.q.level).toBeGreaterThan(0.85 * built)
    expect(maxStep(s.log.slice(lostAt), (q) => q.level)).toBeLessThan(0.001)
  })

  it('eases down gently when the learner stops mid-movement or leaves', () => {
    const ref = move('open-close-chest')
    const s = new Session(ref).run(120, 0.5)
    // Carry on to the middle of the opening (5.5s), where the teacher is moving, and stop there.
    while (s.learner < 5.5 * ref.fps) s.run(DT, 0.5)
    expect(ref.motion[s.f.frame]).toBeGreaterThan(DEFAULT_OPTIONS.holdMotion)
    const built = s.q.level
    s.run(20, 0)
    expect(s.f.lost).toBe(false)
    expect(s.q.flow).toBeLessThan(0.05)
    expect(s.q.level).toBeLessThan(built)
    expect(s.q.level).toBeGreaterThan(0.85 * built)
    // Nobody in front of the camera.
    const before = s.q.level
    s.run(20, 0, () => null)
    expect(s.q.level).toBeLessThan(before)
    expect(s.q.level).toBeGreaterThan(0.85 * before)
  })

  it('builds less for a fast learner than for a slow one', () => {
    const slow = new Session(move('open-close-chest')).run(120, 0.5)
    const fast = new Session(move('open-close-chest')).run(120, 2)
    expect(fast.f.reps).toBeGreaterThan(slow.f.reps)
    expect(slow.q.level).toBeGreaterThan(1.3 * fast.q.level)
  })
})

describe('Palm field', () => {
  const field = (p: Pose) => {
    const qi = new QiModel()
    const f = new Follower(move('open-close-chest'))
    const rand = rng(3)
    for (let i = 0; i < 60; i++) qi.update({ follower: f, pose: noisy(p, rand), dt: DT })
    return qi.frame.palmField
  }
  const arms = (lArm: number, lElbow: number, sink = 0) => poseAt({ t: 0, lArm, lElbow, rArm: lArm, rElbow: lElbow, sink })

  it('is strong for palms facing close together at the chest', () => {
    expect(field(arms(30, 150))).toBeGreaterThan(0.7)
    // Hugging the tree: the arms round, the palms a little apart.
    expect(field(arms(35, 150, 0.25))).toBeGreaterThan(0.7)
  })

  it('is weak for arms at the sides, spread wide, or hands resting low', () => {
    expect(field(arms(5, 0))).toBeLessThan(0.05)
    expect(field(arms(90, 0))).toBeLessThan(0.05)
    expect(field(arms(12, 70))).toBeLessThan(0.1)
  })

  it('weakens when the hands move fast', () => {
    // Opening and closing at the chest, once every 8 seconds or twice a second.
    const mean = (hz: number) => {
      const qi = new QiModel()
      const f = new Follower(move('open-close-chest'))
      const rand = rng(4)
      let sum = 0
      for (let i = 0; i < 120; i++) {
        const u = 0.5 - 0.5 * Math.cos(i * DT * 2 * Math.PI * hz)
        qi.update({ follower: f, pose: noisy(arms(30 + 45 * u, 150), rand), dt: DT })
        if (i >= 60) sum += qi.frame.palmField
      }
      return sum / 60
    }
    expect(mean(1 / 8)).toBeGreaterThan(0.6)
    expect(mean(2)).toBeLessThan(0.5 * mean(1 / 8))
  })
})

describe('Breath', () => {
  it('inhales while opening and exhales while closing in Opening and closing at the chest', () => {
    // Keys: open 4–7s, close 7–10s, open 10–13s, close 13–16s.
    const ref = move('open-close-chest')
    const s = new Session(ref, false).run(30, 1)
    const near = (sec: number) => s.log.reduce((a, b) => (Math.abs(b.pos - sec * ref.fps) < Math.abs(a.pos - sec * ref.fps) ? b : a))
    const breath = (sec: number) => near(sec).q.breath
    expect(breath(7.3)).toBeGreaterThan(0.7)
    expect(breath(10.3)).toBeLessThan(-0.7)
    expect(breath(13.3)).toBeGreaterThan(0.7)
    expect(breath(5)).toBeLessThan(breath(6.5))
    expect(breath(8)).toBeGreaterThan(breath(9.5))
    // The track itself turns exactly at the keys.
    const track = qiTrack(ref).breath
    expect(track[7 * ref.fps]).toBeCloseTo(1, 1)
    expect(track[10 * ref.fps]).toBeCloseTo(-1, 1)
  })

  it('inhales rising and exhales lowering in Holding up the sky', () => {
    const ref = move('lift-sky')
    const track = qiTrack(ref).breath
    // Hands rise up the front (3.5–8.5s), then open out and float down the sides (10.5–17s).
    const b = (sec: number) => track[Math.round(sec * ref.fps)]
    expect(b(3.5)).toBeLessThan(-0.5)
    for (let sec = 3.5; sec < 8; sec += 0.5) expect(b(sec + 0.5)).toBeGreaterThan(b(sec))
    expect(b(8.4)).toBeGreaterThan(0.4)
    for (let sec = 12.5; sec < 16; sec += 0.5) expect(b(sec + 0.5)).toBeLessThan(b(sec))
    expect(b(16)).toBeLessThan(-0.8)
  })

  it('breathes slowly on its own through a long standing hold', () => {
    const ref = move('hug-tree')
    const track = qiTrack(ref).breath
    const hold = Array.from(track.slice(8 * ref.fps, 22 * ref.fps))
    expect(Math.max(...hold) - Math.min(...hold)).toBeGreaterThan(0.8)
  })
})

describe('Regions', () => {
  it('charge the dantian during a hold', () => {
    // Standing post holds from 5s to 25s.
    const ref = move('hug-tree')
    const s = new Session(ref, false)
    while (s.f.pos < 6 * ref.fps) s.run(DT, 1)
    const early = s.q.regions.dantian
    while (s.f.pos < 20 * ref.fps) s.run(DT, 1)
    expect(s.f.inHold).toBe(true)
    expect(s.q.regions.dantian).toBeGreaterThan(early + 0.2)
    expect(s.q.regions.dantian).toBeGreaterThan(0.5)
    expect(s.q.palmField).toBeGreaterThan(0.5)
  })

  it('stay dark for a learner who is lost', () => {
    const ref = move('hug-tree')
    const elsewhere = move('separate').poses[Math.round(6 * 30)]
    const s = new Session(ref, false).run(2, 1)
    s.run(18, 1, () => elsewhere)
    expect(s.q.regions.dantian).toBeLessThan(0.1)
  })

  it('charge the feet standing, and never seated', () => {
    const standing = new Session(move('open-close')).run(40, 0.5)
    expect(Math.max(standing.q.regions.lFoot, standing.q.regions.rFoot)).toBeGreaterThan(0.2)
    const seated = new Session(move('open-close', 'seated')).run(40, 0.5)
    expect(seated.q.flow).toBeGreaterThan(0.3)
    for (const s of seated.log) {
      expect(s.q.regions.lFoot).toBe(0)
      expect(s.q.regions.rFoot).toBe(0)
    }
  })

  it('stream along the arms outward while opening and inward while gathering', () => {
    // Opening and closing (wide): arms open 1.5–4.5s, fold back to the belly 4.5–8s.
    const ref = move('open-close')
    const s = new Session(ref, false).run(12, 1)
    const near = (sec: number) => s.log.reduce((a, b) => (Math.abs(b.pos - sec * ref.fps) < Math.abs(a.pos - sec * ref.fps) ? b : a))
    expect(near(3).q.armFlow.l).toBeGreaterThan(0.5)
    expect(near(3).q.armFlow.r).toBeGreaterThan(0.5)
    expect(near(6.5).q.armFlow.l).toBeLessThan(-0.5)
    expect(near(6.5).q.armFlow.r).toBeLessThan(-0.5)
  })

  it('keep every value in range', () => {
    const s = new Session(move('lift-sky')).run(60, 0.7)
    for (const { q } of s.log) {
      for (const v of [q.level, q.palmField, q.flow, ...Object.values(q.regions)]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
      for (const v of [q.breath, q.armFlow.l, q.armFlow.r]) {
        expect(v).toBeGreaterThanOrEqual(-1)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
