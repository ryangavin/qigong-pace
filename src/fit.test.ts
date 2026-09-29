import { describe, expect, it } from 'vitest'
import {
  BodyFit,
  Calibration,
  differs,
  fitOnto,
  inPosture,
  measureBody,
  PARTS,
  retarget,
  SETTLE_SEC,
  TYPICAL_BODY,
  type Proportions,
} from './fit'
import { Follower, fitReference, type Reference } from './follower'
import { DEMO_MOVES, FIGURE_BODY, referenceFromMove } from './moves'
import { beadFrame, handPath, holdAt, lockOn, nearness, palmsAt } from './primary/guidance'
import { SimStudent } from './sim'
import {
  bodyScale,
  computeFeatures,
  HAND_PER_FOREARM,
  JOINTS,
  palmCentre,
  poseFromLandmarks,
  type LandmarkLike,
  type Pose,
  type Posture,
  type Pt,
} from './skeleton'

const DT = 1 / 30

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296 - 0.5
  }
}

/** A learner built unlike the teacher: arms of 1.15 torso lengths (the figure's are 1.38), narrower shoulders. */
const LEARNER: Proportions = { ...TYPICAL_BODY, upperArm: 0.62, forearm: 0.53, hand: 0.13, shoulders: 0.7 }

const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y)
const pt = (x: number, y: number, v = 1): Pt => ({ x, y, v })

describe('palmCentre', () => {
  const wrist = pt(1, 1)
  const elbow = pt(1, 0.8)

  it('is the middle of the wrist and the index and pinky knuckles', () => {
    const p = palmCentre(wrist, elbow, pt(0.97, 1.09), pt(1.03, 1.06))
    expect(p.x).toBeCloseTo(1)
    expect(p.y).toBeCloseTo(1.05)
  })

  it('falls back along the forearm when the fingers are unseen, and to the wrist without the elbow', () => {
    const p = palmCentre(wrist, elbow, pt(0.5, 0.5, 0.1), pt(0.6, 0.5, 0.1))
    expect(p.x).toBeCloseTo(1)
    expect(p.y).toBeCloseTo(1 + 0.2 * HAND_PER_FOREARM)
    expect(palmCentre(wrist, { ...elbow, v: 0.1 })).toEqual({ x: 1, y: 1, v: 1 })
  })

  it('blends between the two as the fingers come into view, and is as visible as the wrist', () => {
    const index = pt(0.97, 1.09, 0.5)
    const pinky = pt(1.03, 1.06, 0.5)
    const p = palmCentre({ ...wrist, v: 0.8 }, elbow, index, pinky)
    expect(p.y).toBeCloseTo((1.05 + 1 + 0.2 * HAND_PER_FOREARM) / 2)
    expect(p.v).toBe(0.8)
  })

  it('is read from MediaPipe landmarks on the screen side of each hand', () => {
    const lm: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))
    // Anatomical left arm (the screen left once mirrored): elbow 13, wrist 15, pinky 17, index 19.
    lm[13] = { x: 0.7, y: 0.5, visibility: 0.9 }
    lm[15] = { x: 0.7, y: 0.6, visibility: 0.9 }
    lm[17] = { x: 0.68, y: 0.66, visibility: 0.9 }
    lm[19] = { x: 0.72, y: 0.69, visibility: 0.9 }
    const p = poseFromLandmarks(lm, { aspect: 1, flipX: true, facingAway: false })
    expect(p.lWrist.x).toBeCloseTo(0.3)
    expect(p.lPalm.x).toBeCloseTo(0.3)
    expect(p.lPalm.y).toBeCloseTo(0.65)
  })

  it('reads a pose with only the body landmarks, the palm along the forearm', () => {
    const lm: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))
    lm[13] = { x: 0.3, y: 0.5, visibility: 0.9 }
    lm[15] = { x: 0.3, y: 0.6, visibility: 0.9 }
    const p = poseFromLandmarks(lm.slice(0, 17), { aspect: 1, flipX: false, facingAway: false })
    expect(p.rPalm.y).toBeCloseTo(0.6 + 0.1 * HAND_PER_FOREARM)
  })
})

const lift = referenceFromMove(DEMO_MOVES.find((m) => m.id === 'lift-sky')!)
const bow = referenceFromMove(DEMO_MOVES.find((m) => m.id === 'draw-bow')!)

describe('retarget', () => {
  it('leaves a body on its own proportions as it is', () => {
    for (const p of [lift.poses[0], lift.poses[250], bow.poses[240]]) {
      const q = retarget(p, FIGURE_BODY, FIGURE_BODY, 'standing')
      for (const j of JOINTS) {
        expect(q[j].x).toBeCloseTo(p[j].x, 9)
        expect(q[j].y).toBeCloseTo(p[j].y, 9)
      }
    }
  })

  it("keeps the teacher's directions and roots and takes the lengths from the new body", () => {
    const p = lift.poses[250]
    const q = retarget(p, FIGURE_BODY, LEARNER, 'standing')
    const T = bodyScale(p)
    expect(bodyScale(q)).toBeCloseTo(T, 9)
    expect(q.lHip.x + q.rHip.x).toBeCloseTo(p.lHip.x + p.rHip.x, 9)
    expect(len(q.lShoulder, q.rShoulder)).toBeCloseTo(LEARNER.shoulders * T, 9)
    for (const [a, b, part] of [
      ['lShoulder', 'lElbow', 'upperArm'],
      ['rElbow', 'rWrist', 'forearm'],
      ['lWrist', 'lPalm', 'hand'],
    ] as const) {
      expect(len(q[a], q[b])).toBeCloseTo(LEARNER[part] * T, 9)
      const u = Math.atan2(p[b].y - p[a].y, p[b].x - p[a].x)
      const v = Math.atan2(q[b].y - q[a].y, q[b].x - q[a].x)
      expect(v).toBeCloseTo(u, 9)
    }
  })

  it('keeps a foreshortened segment as foreshortened, and never makes one longer than whole', () => {
    // Sunk into horse stance, the figure's thighs come forward and read short.
    const p = bow.poses[Math.round(8.5 * bow.fps)]
    const q = retarget(p, FIGURE_BODY, LEARNER, 'standing')
    const T = bodyScale(p)
    const share = len(p.lHip, p.lKnee) / (FIGURE_BODY.thigh * T)
    expect(share).toBeLessThan(0.8)
    expect(len(q.lHip, q.lKnee) / (LEARNER.thigh * T)).toBeCloseTo(share, 9)
    // A tracked arm a little longer than the measured whole is taken as whole.
    const long = { ...p, lElbow: { ...p.lElbow, x: p.lShoulder.x - 1.2 * FIGURE_BODY.upperArm * T, y: p.lShoulder.y } }
    const r = retarget(long, FIGURE_BODY, LEARNER, 'standing')
    expect(len(r.lShoulder, r.lElbow)).toBeCloseTo(LEARNER.upperArm * T, 9)
  })

  it('stays rooted at the shoulders when seated', () => {
    const seated = referenceFromMove(DEMO_MOVES[0], 'seated')
    const p = seated.poses[200]
    const to = inPosture(LEARNER, 'seated')
    const q = retarget(p, seated.teacherBody, to, 'seated')
    expect(q.lShoulder.x).toBeCloseTo(p.lShoulder.x, 9)
    expect(q.rShoulder.y).toBeCloseTo(p.rShoulder.y, 9)
    expect(len(q.lShoulder, q.lElbow)).toBeCloseTo(to.upperArm * bodyScale(p, 'seated'), 9)
  })
})

/** The move performed by a body of `body`'s proportions, over frames `from`, with tracker noise. */
function performed(ref: Reference, body: Proportions, rand: () => number, noise = 0.006): Pose[] {
  const to = inPosture(body, ref.posture)
  return ref.teacher.map((p) => {
    const q = retarget(p, ref.teacherBody, to, ref.posture)
    const out = {} as Pose
    for (const j of JOINTS) out[j] = { x: q[j].x + rand() * noise, y: q[j].y + rand() * noise, v: 0.95 }
    return out
  })
}

describe('Calibration', () => {
  const near = (a: Proportions, b: Proportions, parts: readonly (keyof Proportions)[], tol: number) => {
    for (const p of parts) expect(Math.abs(a[p] / b[p] - 1), p).toBeLessThan(tol)
  }

  it("measures a learner's proportions through noise", () => {
    const poses = performed(lift, LEARNER, rng(1))
    const c = new Calibration('standing')
    for (const p of poses.slice(0, 300)) c.add(p)
    near(c.proportions(), LEARNER, ['upperArm', 'forearm', 'shoulders', 'thigh', 'shin'], 0.05)
  })

  it('is not fooled by limbs foreshortened toward the camera, nor by bowing', () => {
    const rand = rng(2)
    const poses = performed(lift, LEARNER, rand)
    const c = new Calibration('standing')
    poses.slice(0, 300).forEach((p, i) => {
      const q = { ...p }
      if (i % 5 < 2) {
        // Two frames in five, an arm reaches toward the camera and reads short.
        const k = 0.5 + 0.4 * (rand() + 0.5)
        for (const s of ['l', 'r'] as const) {
          const sh = q[`${s}Shoulder`]
          for (const j of [`${s}Elbow`, `${s}Wrist`, `${s}Palm`] as const) {
            q[j] = { x: sh.x + (q[j].x - sh.x) * k, y: sh.y + (q[j].y - sh.y) * k, v: q[j].v }
          }
        }
      }
      if (i % 7 === 3) {
        // Now and then a bow: the torso reads short, so every length would look long against it.
        const hy = (q.lHip.y + q.rHip.y) / 2
        for (const j of ['head', 'lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist', 'lPalm', 'rPalm'] as const) {
          q[j] = { ...q[j], y: hy + (q[j].y - hy) * 0.7 }
        }
      }
      c.add(q)
    })
    near(c.proportions(), LEARNER, ['upperArm', 'forearm', 'hand', 'shoulders'], 0.05)
  })

  it('measures only the upper body seated, in its seated units', () => {
    const seated = referenceFromMove(DEMO_MOVES[0], 'seated')
    const rand = rng(3)
    const c = new Calibration('seated')
    for (const p of performed(seated, LEARNER, rand).slice(0, 300)) {
      // The legs are out of the picture, and MediaPipe guesses wildly.
      c.add({ ...p, lKnee: pt(0.1, 1.4, 0.9), lAnkle: pt(1.3, 0.2, 0.9) })
    }
    const got = c.proportions()
    const want = inPosture(LEARNER, 'seated')
    near(got, want, ['upperArm', 'forearm'], 0.05)
    expect(got.shoulders).toBeCloseTo(want.shoulders, 9)
    expect(got.thigh).toBe(inPosture(TYPICAL_BODY, 'seated').thigh)
    expect(c.count('thigh')).toBe(0)
  })

  it('reads the built-in figure as drawn', () => {
    near(measureBody(lift.poses, 'standing'), FIGURE_BODY, ['upperArm', 'forearm', 'hand', 'shoulders', 'neck'], 0.01)
  })

  it('settles after a few seconds of practice, not while waiting', () => {
    const fit = new BodyFit('standing')
    const poses = performed(lift, LEARNER, rng(4))
    let refits = 0
    for (let i = 0; i < 200; i++) if (fit.update(poses[0], false, DT)) refits++
    expect(fit.settled).toBe(false)
    expect(refits).toBeGreaterThan(0)
    let i = 0
    for (; !fit.settled && i < 600; i++) if (fit.update(poses[i], true, DT)) refits++
    expect(i * DT).toBeGreaterThanOrEqual(SETTLE_SEC - 1e-6)
    expect(i * DT).toBeLessThan(SETTLE_SEC + 0.5)
    // Refitted only as the measure moved on, not every frame.
    expect(refits).toBeLessThan(15)
    const settledBody = { ...fit.body }
    for (const p of poses.slice(0, 60)) expect(fit.update({ ...p, lElbow: pt(0, 0) }, true, DT)).toBe(false)
    expect(differs(fit.body, settledBody, 0)).toBe(false)
    for (const part of PARTS) expect(Number.isFinite(fit.body[part])).toBe(true)
  })
})

/**
 * A learner who does what the view asks: puts each palm into its light. Their
 * body is `LEARNER`, moving through the teacher's move at their own pace (frame
 * `u`); each arm reaches for the bead the view shows for that moment, bending
 * the elbow the teacher's way, or stretching toward it when it is out of reach.
 */
function reachingLearner(ref: Reference, u: number, rand: () => number): Pose {
  const posture = ref.posture
  const body = inPosture(LEARNER, posture)
  const own = retarget(ref.teacher[Math.round(u)], ref.teacherBody, body, posture)
  const fitted = ref.poses[Math.round(u)]
  const light = fitOnto(fitted, own, posture)(fitted)
  const T = bodyScale(own, posture)
  const out = { ...own }
  for (const s of ['l', 'r'] as const) {
    const S = own[`${s}Shoulder`]
    const P = light[`${s}Palm`]
    const a = body.upperArm * T
    const b = (body.forearm + body.hand) * T
    const d0 = len(S, P)
    const ux = (P.x - S.x) / d0
    const uy = (P.y - S.y) / d0
    const d = Math.min(a + b - 1e-9, Math.max(Math.abs(a - b) + 1e-9, d0))
    const bend = Math.acos((a * a + d * d - b * b) / (2 * a * d))
    const e = light[`${s}Elbow`]
    const turn = Math.sign(ux * (e.y - S.y) - uy * (e.x - S.x)) || 1
    const c = Math.cos(bend * turn)
    const sn = Math.sin(bend * turn)
    const E = pt(S.x + a * (ux * c - uy * sn), S.y + a * (ux * sn + uy * c))
    const palm = pt(S.x + ux * d, S.y + uy * d)
    const k = body.forearm / (body.forearm + body.hand)
    out[`${s}Elbow`] = E
    out[`${s}Wrist`] = pt(E.x + (palm.x - E.x) * k, E.y + (palm.y - E.y) * k)
    out[`${s}Palm`] = palm
  }
  for (const j of JOINTS) out[j] = { x: out[j].x + rand() * 0.006, y: out[j].y + rand() * 0.006, v: 0.95 }
  return out
}

/**
 * Practise `move` at half speed the way the app does: measure the learner,
 * refit the teacher as the measure moves on, follow, and check each palm
 * against its light as the primary view would.
 */
function practise(id: string, posture: Posture, learner: 'reaching' | 'copying') {
  const teacher = referenceFromMove(DEMO_MOVES.find((m) => m.id === id)!, posture)
  const fit = new BodyFit(posture)
  let ref = fitReference(teacher, fit.body)
  const f = new Follower(ref)
  const sim = new SimStudent({ speed: 0.5, body: LEARNER })
  const rand = rng(9)
  let u = 0
  let startedAt = -1
  const locked = { l: false, r: false }
  const off = { l: 0, r: 0 }
  let frames = 0
  let lost = 0
  let t = 0
  const limit = 3 + (2 * teacher.poses.length) / teacher.fps + 5
  for (; t < limit && f.state !== 'done'; t += DT) {
    let pose: Pose
    if (learner === 'copying') pose = sim.step(f, DT)
    else {
      if (f.state === 'following') u = Math.min(teacher.poses.length - 1, u + 0.5 * teacher.fps * DT)
      pose = reachingLearner(ref, u, rand)
    }
    if (fit.update(pose, f.state === 'following', DT)) {
      ref = fitReference(teacher, fit.body)
      f.ref = ref
    }
    f.update(computeFeatures(pose, posture), DT)
    if (f.state !== 'following') continue
    if (startedAt < 0) startedAt = t
    frames++
    if (f.lost) lost++
    const place = fitOnto(ref.poses[Math.round(f.pos)], pose, posture)
    const hold = holdAt(ref, f.pos, f.opts.holdMotion)
    const bead = beadFrame(ref, f.pos, 0.5, hold)
    const from = Math.max(0, f.pos - 0.5 * ref.fps)
    const behind = handPath(ref, from, (bead - from) / ref.fps, place)
    const at = palmsAt(ref, bead, place)
    for (const side of ['l', 'r'] as const) {
      const near = nearness(pose[`${side}Palm`], [...behind[side], at[side]], bodyScale(pose, posture))
      locked[side] = lockOn(locked[side], near)
      if (!locked[side]) off[side]++
    }
  }
  return { f, fit, startedAt, frames, lost, off }
}

const BA_DUAN_JIN = DEMO_MOVES.filter((m) => m.set === 'Ba Duan Jin').map((m) => m.id)
const OTHERS = ['rainbow', 'wild-goose', 'separate-clouds', 'pestle-2']

describe('a learner built unlike the teacher', () => {
  it.each([...BA_DUAN_JIN, ...OTHERS])('who puts their palms into the lights follows %s to the end', (id) => {
    const r = practise(id, 'standing', 'reaching')
    expect(r.startedAt).toBeGreaterThanOrEqual(0)
    expect(r.startedAt).toBeLessThan(1.5)
    expect(r.f.state).toBe('done')
    expect(r.fit.settled).toBe(true)
    expect(r.lost).toBe(0)
    expect(r.off).toEqual({ l: 0, r: 0 })
  })

  it.each(BA_DUAN_JIN)('who copies the shape follows %s to the end, locked on throughout', (id) => {
    const r = practise(id, 'standing', 'copying')
    expect(r.f.state).toBe('done')
    expect(r.lost).toBe(0)
    expect(r.off).toEqual({ l: 0, r: 0 })
  })

  it.each(['lift-sky', 'separate'])('follows %s seated too', (id) => {
    const r = practise(id, 'seated', 'reaching')
    expect(r.f.state).toBe('done')
    expect(r.lost).toBe(0)
    expect(r.off).toEqual({ l: 0, r: 0 })
  })

  it('is measured close to their true proportions by the end', () => {
    const { fit } = practise('lift-sky', 'standing', 'reaching')
    for (const p of ['upperArm', 'forearm', 'shoulders'] as const) expect(Math.abs(fit.body[p] / LEARNER[p] - 1), p).toBeLessThan(0.05)
  })
})

describe('fitOnto', () => {
  it("puts every bead within the learner's reach, from their own shoulders", () => {
    for (const id of [...BA_DUAN_JIN, ...OTHERS]) {
      const teacher = referenceFromMove(DEMO_MOVES.find((m) => m.id === id)!)
      const ref = fitReference(teacher, LEARNER)
      const rand = rng(5)
      // The learner a little smaller in the picture and elsewhere in it.
      const own = performed(teacher, LEARNER, rand, 0).map((p) => {
        const q = {} as Pose
        for (const j of JOINTS) q[j] = { x: p[j].x * 0.8 + 0.1, y: p[j].y * 0.8 + 0.05, v: 1 }
        return q
      })
      ref.poses.forEach((fitted, i) => {
        const learner = own[Math.max(0, i - 10)]
        const placed = fitOnto(fitted, learner, 'standing')(fitted)
        const reach = (LEARNER.upperArm + LEARNER.forearm + LEARNER.hand) * bodyScale(learner)
        for (const s of ['l', 'r'] as const) {
          expect(placed[`${s}Shoulder`].x).toBeCloseTo(learner[`${s}Shoulder`].x, 9)
          expect(len(learner[`${s}Shoulder`], placed[`${s}Palm`])).toBeLessThanOrEqual(reach + 1e-9)
        }
      })
    }
  })
})
