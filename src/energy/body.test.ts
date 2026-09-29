import { describe, expect, it } from 'vitest'
import { DEMO_ASPECT, poseAt, type BodyKey } from '../moves'
import { containView, torsoLength, type Pose } from '../skeleton'
import { bodyGeometry, CAP_KIND, POINTS } from './body'

const key = (k: Partial<BodyKey> = {}): BodyKey => ({ t: 0, lArm: 12, lElbow: 70, rArm: 12, rElbow: 70, sink: 0, ...k })
const view = (w: number, h: number) => ({ ...containView(w, h, DEMO_ASPECT), aspect: DEMO_ASPECT })
const point = (g: ReturnType<typeof bodyGeometry>, name: (typeof POINTS)[number]) => {
  const i = POINTS.indexOf(name)
  return [g.points[i * 2], g.points[i * 2 + 1]] as const
}

describe('bodyGeometry', () => {
  it('lays the pose out in screen units, sized by the torso', () => {
    const p = poseAt(key())
    // A wide canvas letterboxes the image: it's centred, and y still runs 0..1.
    const v = view(1600, 600)
    const g = bodyGeometry(p, v, 600)
    expect(g.T).toBeCloseTo(torsoLength(p), 5)
    const [dx, dy] = point(g, 'dantian')
    const hipX = (p.lHip.x + p.rHip.x) / 2
    expect(dx).toBeCloseTo((v.ox + hipX * v.s) / 600, 5)
    // Just above the hips, well below the shoulders.
    const hipY = (p.lHip.y + p.rHip.y) / 2
    const shY = (p.lShoulder.y + p.rShoulder.y) / 2
    expect(dy).toBeLessThan(hipY)
    expect(dy).toBeGreaterThan(hipY - (hipY - shY) * 0.3)
  })

  it('extends palms and fingertips along the forearm', () => {
    const p = poseAt(key({ lArm: 90, lElbow: 0 }))
    const g = bodyGeometry(p, view(800, 600), 600)
    const [px, py] = point(g, 'lPalm')
    const [tx, ty] = point(g, 'lTip')
    // Arm held out straight to the left: the hand carries on leftward at wrist height.
    expect(px).toBeLessThan(p.lWrist.x)
    expect(tx).toBeLessThan(px)
    expect(py).toBeCloseTo(p.lWrist.y, 5)
    expect(ty).toBeCloseTo(p.lWrist.y, 5)
  })

  it('runs each chain on across its joints', () => {
    const p = poseAt(key({ rArm: 60, rElbow: 30 }))
    const g = bodyGeometry(p, view(800, 600), 600)
    const arm = [...Array(g.count).keys()].filter((i) => g.capInfo[i * 4 + 3] === CAP_KIND.rArm)
    expect(arm).toHaveLength(3)
    const upper = Math.hypot(p.rElbow.x - p.rShoulder.x, p.rElbow.y - p.rShoulder.y)
    expect(g.chain[arm[0]]).toBe(0)
    expect(g.chain[arm[1]]).toBeCloseTo(upper, 5)
  })

  it('gives unseen limbs no weight but keeps the trunk', () => {
    const seen = poseAt(key())
    const p: Pose = { ...seen }
    for (const j of ['lKnee', 'rKnee', 'lAnkle', 'rAnkle'] as const) p[j] = { ...seen[j], v: 0.1 }
    const g = bodyGeometry(p, view(800, 600), 600)
    const weightOf = (kind: number) =>
      [...Array(g.count).keys()].filter((i) => g.capInfo[i * 4 + 3] === kind).map((i) => g.capInfo[i * 4 + 2])
    expect(weightOf(CAP_KIND.leg)).toEqual([0, 0, 0, 0])
    expect(weightOf(CAP_KIND.trunk)).toEqual([1])
  })
})
