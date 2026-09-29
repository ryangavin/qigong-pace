import { describe, expect, it } from 'vitest'
import { Follower } from '../follower'
import { DEMO_MOVES, referenceFromMove } from '../moves'
import { SimStudent } from '../sim'
import { alignment, alignPoseTo, computeFeatures, coverView, JOINTS, segmentErrors, SEGMENTS } from '../skeleton'
import { handPath, matchOf } from './guidance'

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

  it('follows the wrists over the next stretch of the move', () => {
    const from = 30
    const path = handPath(ref, from, 1.5, same)
    // 1.5 s at 20 samples a second, plus the starting point.
    expect(path.l).toHaveLength(31)
    expect(path.r).toHaveLength(31)
    expect(path.l[0]).toEqual(ref.poses[from].lWrist)
    expect(path.r.at(-1)).toEqual(ref.poses[from + 45].rWrist)
  })

  it('stops at the end of the move', () => {
    const n = ref.poses.length
    const path = handPath(ref, n - 10, 1.5, same)
    expect(path.l.at(-1)).toEqual(ref.poses[n - 1].lWrist)
    expect(path.l.length).toBeLessThan(10)
  })

  it('carries the path onto the learner the same way the ghost is', () => {
    const teacher = ref.poses[60]
    const learner = alignPoseTo(ref.poses[0], { ...ref.poses[0], lHip: { x: 0.2, y: 0.5, v: 1 } })
    const place = alignment(teacher, learner)
    const ghost = alignPoseTo(teacher, learner)
    const path = handPath(ref, 60, 1, place)
    expect(path.l[0].x).toBeCloseTo(ghost.lWrist.x)
    expect(path.l[0].y).toBeCloseTo(ghost.lWrist.y)
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
