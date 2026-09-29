import { describe, expect, it } from 'vitest'
import { fitOnto } from '../fit'
import { Follower, type Reference } from '../follower'
import { DEMO_MOVES, referenceFromMove } from '../moves'
import { SimStudent } from '../sim'
import {
  alignment,
  alignPoseTo,
  computeFeatures,
  coverView,
  JOINTS,
  segmentErrors,
  SEGMENTS,
  torsoLength,
} from '../skeleton'
import {
  beadFrame,
  guidanceMix,
  handPath,
  holdAt,
  holdProgress,
  lockOn,
  matchOf,
  nearness,
  outOfView,
  palmsAt,
} from './guidance'

const ref = referenceFromMove(DEMO_MOVES[0])

describe('matchOf', () => {
  it('is whole within the threshold and gone by 2.5× it', () => {
    expect(matchOf(0, 0.2)).toBe(1)
    expect(matchOf(0.2, 0.2)).toBe(1)
    expect(matchOf(0.5, 0.2)).toBe(0)
    expect(matchOf(0.9, 0.2)).toBe(0)
  })

  it('falls steadily in between', () => {
    const a = matchOf(0.25, 0.2)
    const b = matchOf(0.35, 0.2)
    const c = matchOf(0.45, 0.2)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
    expect(matchOf(0.35, 0.2)).toBeCloseTo(0.5)
  })
})

describe('handPath', () => {
  const same = <T>(p: T) => p

  it('follows the palms over the next stretch of the move', () => {
    const from = 30
    const path = handPath(ref, from, 1.5, same)
    // 1.5 s at 20 samples a second, plus the starting point.
    expect(path.l).toHaveLength(31)
    expect(path.r).toHaveLength(31)
    expect(path.l[0]).toEqual(ref.poses[from].lPalm)
    expect(path.r.at(-1)).toEqual(ref.poses[from + 45].rPalm)
  })

  it('stops at the end of the move', () => {
    const n = ref.poses.length
    const path = handPath(ref, n - 10, 1.5, same)
    expect(path.l.at(-1)).toEqual(ref.poses[n - 1].lPalm)
    expect(path.l.length).toBeLessThan(10)
  })

  it('carries the path onto the learner the same way the teacher is', () => {
    const teacher = ref.poses[60]
    const learner = alignPoseTo(ref.poses[0], { ...ref.poses[0], lHip: { x: 0.2, y: 0.5, v: 1 } })
    const place = fitOnto(teacher, learner, 'standing')
    const shape = place(teacher)
    const path = handPath(ref, 60, 1, place)
    expect(path.l[0].x).toBeCloseTo(shape.lPalm.x)
    expect(path.l[0].y).toBeCloseTo(shape.lPalm.y)
  })

  it('starts between frames where the learner is between them', () => {
    const path = handPath(ref, 30.5, 1, same)
    const a = ref.poses[30].rPalm
    const b = ref.poses[31].rPalm
    expect(path.r[0].x).toBeCloseTo((a.x + b.x) / 2)
    expect(path.r[0].y).toBeCloseTo((a.y + b.y) / 2)
  })

  it('ends exactly where the stretch ends, between samples too', () => {
    const path = handPath(ref, 30, 1.05, same)
    const end = palmsAt(ref, 30 + 1.05 * ref.fps, same)
    expect(path.l.at(-1)!.x).toBeCloseTo(end.l.x)
    expect(path.l.at(-1)!.y).toBeCloseTo(end.l.y)
  })

  it('keeps each hand on its own side of the screen, on a learner elsewhere and another size', () => {
    // The frame where the hands are furthest apart.
    let wide = 0
    ref.poses.forEach((p, i) => {
      const q = ref.poses[wide]
      if (p.rPalm.x - p.lPalm.x > q.rPalm.x - q.lPalm.x) wide = i
    })
    const learner = { ...ref.poses[0] }
    for (const j of JOINTS) learner[j] = { x: ref.poses[0][j].x * 0.6 + 0.9, y: ref.poses[0][j].y * 0.6 + 0.3, v: 1 }
    const place = fitOnto(ref.poses[wide], learner, 'standing')
    const path = handPath(ref, wide, 0, place)
    const mid = (learner.lHip.x + learner.rHip.x) / 2
    expect(path.l[0].x).toBeLessThan(mid)
    expect(path.r[0].x).toBeGreaterThan(mid)
    // Scaled with the learner: 0.6 of the teacher's reach.
    const reach = (p: { l: { x: number }[]; r: { x: number }[] }) => p.r[0].x - p.l[0].x
    expect(reach(path)).toBeCloseTo(0.6 * reach(handPath(ref, wide, 0, same)))
  })
})

// A stand-in reference for holds: moving, then still from frame 30 to 89, then
// moving again with a brief pause at 110..114.
const fps = 30
const motion = Float32Array.from({ length: 150 }, (_, i) => ((i >= 30 && i < 90) || (i >= 110 && i < 115) ? 0.01 : 0.5))
const held = { fps, motion, poses: Array.from({ length: 150 }, () => ref.poses[0]) } as unknown as Reference

describe('holds', () => {
  it('finds the whole still stretch around a frame', () => {
    expect(holdAt(held, 45, 0.08)).toEqual({ start: 30, end: 89 })
    expect(holdAt(held, 30, 0.08)).toEqual({ start: 30, end: 89 })
  })

  it('is no hold where the teacher moves, or only pauses', () => {
    expect(holdAt(held, 20, 0.08)).toBeNull()
    expect(holdAt(held, 112, 0.08)).toBeNull()
  })

  it('counts the hold through from its start to its end', () => {
    const hold = holdAt(held, 45, 0.08)!
    expect(holdProgress(hold, 30)).toBe(0)
    expect(holdProgress(hold, 59.5)).toBeCloseTo(0.5)
    expect(holdProgress(hold, 89)).toBe(1)
    expect(holdProgress(hold, 100)).toBe(1)
  })

  it('keeps the bead a little ahead, but still until a hold ends', () => {
    expect(beadFrame(held, 10, 0.5, null)).toBe(25)
    const hold = holdAt(held, 80, 0.08)
    expect(beadFrame(held, 40, 0.5, hold)).toBe(55)
    expect(beadFrame(held, 80, 0.5, hold)).toBe(89)
    expect(beadFrame(held, 145, 0.5, null)).toBe(149)
  })
})

describe('lock-on', () => {
  const way = [
    { x: 0, y: 0, v: 1 },
    { x: 1, y: 0, v: 1 },
  ]

  it('is whole on the way to the bead and fades off it', () => {
    expect(nearness({ x: 0.5, y: 0.1, v: 1 }, way, 1)).toBe(1)
    expect(nearness({ x: 1.2, y: 0, v: 1 }, way, 1)).toBe(1)
    const a = nearness({ x: 0.5, y: 0.45, v: 1 }, way, 1)
    const b = nearness({ x: 0.5, y: 0.7, v: 1 }, way, 1)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(0)
    expect(nearness({ x: 0.5, y: 0.95, v: 1 }, way, 1)).toBe(0)
  })

  it('scales with the body', () => {
    expect(nearness({ x: 0.5, y: 0.5, v: 1 }, way, 2)).toBe(1)
  })

  it('locks when near and lets go only once clearly off', () => {
    expect(lockOn(false, 0.7)).toBe(false)
    expect(lockOn(false, 0.8)).toBe(true)
    expect(lockOn(true, 0.5)).toBe(true)
    expect(lockOn(true, 0.3)).toBe(false)
  })

  it('holds a simulated student on, and lets its wandering hand go', () => {
    const f = new Follower(ref)
    const sim = new SimStudent({ wander: 1.5 })
    const locked = { l: false, r: false }
    const ever = { l: 0, r: 0 }
    const off = { l: 0, r: 0 }
    for (let i = 0; i < 30 * 12; i++) {
      const pose = sim.step(f, 1 / 30)
      f.update(computeFeatures(pose), 1 / 30)
      if (f.state !== 'following') continue
      const place = fitOnto(ref.poses[Math.round(f.pos)], pose, 'standing')
      const hold = holdAt(ref, f.pos, f.opts.holdMotion)
      const bead = beadFrame(ref, f.pos, 0.5, hold)
      const behind = handPath(ref, f.pos, (bead - f.pos) / ref.fps, place)
      const at = palmsAt(ref, bead, place)
      for (const side of ['l', 'r'] as const) {
        const near = nearness(pose[side === 'l' ? 'lPalm' : 'rPalm'], [...behind[side], at[side]], torsoLength(pose))
        locked[side] = lockOn(locked[side], near)
        ever[side]++
        if (!locked[side]) off[side]++
      }
    }
    expect(ever.l).toBeGreaterThan(100)
    expect(off.l).toBe(0)
    expect(off.r).toBeGreaterThan(10)
  })
})

describe('guidanceMix', () => {
  it('shows the whole way and barely any energy while the move is new', () => {
    for (const flow of [0, 0.5, 1]) {
      const m = guidanceMix(0, flow)
      expect(m.pathStrength).toBe(1)
      expect(m.pathSeconds).toBe(3)
      expect(m.energyStrength).toBeLessThan(0.2)
    }
  })

  it('lets the energy grow and the path step back as the move is learned and followed', () => {
    let prev = guidanceMix(0, 1)
    for (let reps = 1; reps <= 6; reps++) {
      const m = guidanceMix(reps, 1)
      expect(m.energyStrength).toBeGreaterThan(prev.energyStrength)
      expect(m.pathStrength).toBeLessThan(prev.pathStrength)
      expect(m.pathSeconds).toBeLessThan(prev.pathSeconds)
      prev = m
    }
    for (let flow = 0.1; flow <= 1; flow += 0.1) {
      const a = guidanceMix(2, flow - 0.1)
      const b = guidanceMix(2, flow)
      expect(b.energyStrength).toBeGreaterThan(a.energyStrength)
      expect(b.pathStrength).toBeLessThan(a.pathStrength)
    }
  })

  it('never lets the path go, nor the energy overwhelm', () => {
    const m = guidanceMix(100, 1)
    expect(m.pathStrength).toBeGreaterThanOrEqual(0.7)
    expect(m.pathSeconds).toBeGreaterThanOrEqual(1.5)
    expect(m.energyStrength).toBeLessThanOrEqual(0.6)
  })
})

describe('alignment', () => {
  it('moves every joint exactly as alignPoseTo does, standing and seated', () => {
    const p = ref.poses[40]
    const target = { ...ref.poses[90] }
    for (const j of JOINTS) target[j] = { x: target[j].x * 1.7 + 0.3, y: target[j].y * 1.7 - 0.2, v: 1 }
    for (const posture of ['standing', 'seated'] as const) {
      const aligned = alignPoseTo(p, target, posture)
      const move = alignment(p, target, posture)
      for (const j of JOINTS) expect(move(p[j])).toEqual(aligned[j])
    }
  })
})

describe('outOfView', () => {
  // A 4:3 picture filling a wide 1600×900 box: its top and bottom 150 px are cropped away.
  const view = coverView(1600, 900, 4 / 3)
  const at = (x: number, y: number) => ({ x, y, v: 1 })

  it('is false while every point shows, clear of the edge', () => {
    expect(outOfView([at(0.2, 0.2), at(1.2, 0.8)], view, 1600, 900, 10)).toBe(false)
  })

  it('sees a point in the cropped band, or beyond the picture, or at its very edge', () => {
    expect(outOfView([at(0.6, 0.1)], view, 1600, 900, 10)).toBe(true)
    expect(outOfView([at(-0.1, 0.5)], view, 1600, 900, 10)).toBe(true)
    expect(outOfView([at(1.33, 0.5)], view, 1600, 900, 10)).toBe(true)
    expect(outOfView([at(0.6, 0.13)], view, 1600, 900, 10)).toBe(true)
  })
})

describe('coverView', () => {
  it('fills a wide box with a 4:3 image, cropping top and bottom', () => {
    const v = coverView(1600, 900, 4 / 3)
    expect(v.s).toBe(1200)
    expect(v.ox).toBe(0)
    expect(v.oy).toBe(-150)
  })

  it('fills a tall box, cropping the sides', () => {
    const v = coverView(400, 800, 4 / 3)
    expect(v.s).toBe(800)
    expect(v.oy).toBe(0)
    expect(v.ox).toBeCloseTo((400 - 800 * (4 / 3)) / 2)
  })
})

describe('SimStudent', () => {
  it('keeps to the teacher without wander', () => {
    const f = new Follower(ref)
    const sim = new SimStudent()
    for (let i = 0; i < 200; i++) f.update(computeFeatures(sim.step(f, 1 / 30)), 1 / 30)
    expect(f.state).toBe('following')
    expect(f.lost).toBe(false)
    expect(sim.pos).toBeGreaterThan(0)
  })

  it('lets one forearm drift off with wander, while the rest keeps to the teacher', () => {
    const f = new Follower(ref)
    const sim = new SimStudent({ wander: 0.9 })
    const errs = new Float32Array(SEGMENTS.length)
    const fore = SEGMENTS.findIndex((s) => s.name === 'rForearm')
    const other = SEGMENTS.findIndex((s) => s.name === 'lForearm')
    let worst = 0
    let worstOther = 0
    for (let i = 0; i < 30 * 5; i++) {
      const pose = sim.step(f, 1 / 30)
      const feats = computeFeatures(pose)
      f.update(feats, 1 / 30)
      segmentErrors(feats, ref.feats[Math.round(sim.pos)], errs)
      worst = Math.max(worst, errs[fore])
      worstOther = Math.max(worstOther, errs[other])
    }
    expect(worst).toBeGreaterThan(2.5 * f.opts.matchThreshold)
    expect(worstOther).toBeLessThan(f.opts.matchThreshold)
  })
})
