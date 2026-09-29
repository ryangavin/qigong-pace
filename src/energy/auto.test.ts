import { describe, expect, it } from 'vitest'
import { poseAt, type BodyKey } from '../moves'
import type { QiFrame } from '../qi'
import { createAutoQi } from './auto'

const DT = 1 / 30
const key = (k: Partial<BodyKey> = {}): BodyKey => ({ t: 0, lArm: 12, lElbow: 70, rArm: 12, rElbow: 70, sink: 0, ...k })

/** Play keys `from` to `to` over `sec` seconds and return the last frame. */
function play(from: Partial<BodyKey>, to: Partial<BodyKey>, sec: number, level?: number): QiFrame {
  const auto = createAutoQi({ rampSec: 60 })
  const a = key(from)
  const b = key(to)
  let f!: QiFrame
  const n = Math.round(sec / DT)
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const k = { ...a }
    for (const j of ['lArm', 'lElbow', 'rArm', 'rElbow', 'sink'] as const) k[j] = a[j] + (b[j] - a[j]) * u
    f = auto.update(poseAt(k), DT, level)
  }
  return f
}

describe('createAutoQi', () => {
  it('builds qi over the ramp, unless the level is given', () => {
    const auto = createAutoQi({ rampSec: 60 })
    const p = poseAt(key())
    let f = auto.update(p, 0)
    expect(f.level).toBe(0)
    for (let t = 0; t < 30; t += DT) f = auto.update(p, DT)
    expect(f.level).toBeGreaterThan(0.4)
    expect(f.level).toBeLessThan(0.6)
    for (let t = 0; t < 31; t += DT) f = auto.update(p, DT)
    expect(f.level).toBe(1)
    expect(auto.update(p, DT, 0.25).level).toBe(0.25)
    auto.reset()
    expect(auto.update(p, 0).level).toBe(0)
  })

  it('reads opening as the in-breath and closing as the out-breath', () => {
    expect(play({}, { lArm: 90, rArm: 90, lElbow: 0, rElbow: 0 }, 2, 1).breath).toBeGreaterThan(0.3)
    expect(play({ lArm: 90, rArm: 90, lElbow: 0, rElbow: 0 }, {}, 2, 1).breath).toBeLessThan(-0.3)
  })

  it('sends the current to the fingertips when reaching out, and back when drawing in', () => {
    const out = play({ lElbow: 120, rElbow: 120, lArm: 40, rArm: 40 }, { lElbow: 0, rElbow: 0, lArm: 80, rArm: 80 }, 2, 1)
    expect(out.armFlow.l).toBeGreaterThan(0.3)
    expect(out.armFlow.r).toBeGreaterThan(0.3)
    const back = play({ lElbow: 0, rElbow: 0, lArm: 80, rArm: 80 }, { lElbow: 120, rElbow: 120, lArm: 40, rArm: 40 }, 2, 1)
    expect(back.armFlow.l).toBeLessThan(-0.3)
    expect(back.armFlow.r).toBeLessThan(-0.3)
  })

  it('finds a field between palms held close and level, not between arms flung wide', () => {
    const holding = play({ lArm: 35, lElbow: 150, rArm: 35, rElbow: 150 }, { lArm: 35, lElbow: 150, rArm: 35, rElbow: 150 }, 1, 1)
    const wide = play({ lArm: 90, lElbow: 0, rArm: 90, rElbow: 0 }, { lArm: 90, lElbow: 0, rArm: 90, rElbow: 0 }, 1, 1)
    expect(holding.palmField).toBeGreaterThan(0.5)
    expect(wide.palmField).toBe(0)
  })
})
