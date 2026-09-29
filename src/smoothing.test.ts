import { describe, expect, it } from 'vitest'
import { LandmarkFilter, OneEuro, RateMeter } from './smoothing'

/** A repeatable noise source, so the tests don't flicker. */
function noise(seed = 1) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s / 2147483647) * 2 - 1
  }
}

const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

describe('OneEuro', () => {
  it('holds a noisy still signal steady', () => {
    const f = new OneEuro()
    const rand = noise()
    const raw: number[] = []
    const out: number[] = []
    for (let i = 0; i < 300; i++) {
      // MediaPipe-like jitter: about ±0.005 of the frame at 30 fps.
      const x = 0.5 + 0.005 * rand()
      raw.push(x)
      out.push(f.filter(x, (i * 1000) / 30))
    }
    // After a second of settling, the shiver is cut to well under a third.
    expect(std(out.slice(30))).toBeLessThan(std(raw.slice(30)) / 3)
  })

  it('keeps up with a slow ramp', () => {
    const f = new OneEuro()
    const speed = 0.15 // frame heights a second: an unhurried qi gong hand
    let out = 0
    for (let i = 0; i <= 90; i++) out = f.filter(speed * (i / 30), (i * 1000) / 30)
    const lagSec = (speed * 3 - out) / speed
    expect(lagSec).toBeGreaterThan(0)
    expect(lagSec).toBeLessThan(0.15)
  })

  it('behaves the same at any frame rate', () => {
    const at = (fps: number) => {
      const f = new OneEuro()
      let out = 0
      // A slow sway: 0.1 of the frame, once every four seconds, for three seconds.
      for (let i = 0; i <= 3 * fps; i++) {
        const t = i / fps
        out = f.filter(0.5 + 0.1 * Math.sin((2 * Math.PI * t) / 4), t * 1000)
      }
      return out
    }
    // Within 2% (and 5% at a struggling 15 fps) of the sway's size.
    expect(Math.abs(at(60) - at(30))).toBeLessThan(0.002)
    expect(Math.abs(at(15) - at(30))).toBeLessThan(0.005)
  })
})

describe('LandmarkFilter', () => {
  const lm = (x: number, visibility = 0.95) => [{ x, y: 0.5, visibility }]

  it('holds a landmark that drops out, then fades its visibility', () => {
    const f = new LandmarkFilter({ holdMs: 200, fadeMs: 400 })
    for (let t = 0; t <= 1000; t += 25) f.update(lm(0.4), t)
    const at = (t: number, x = 0.9) => f.update(lm(x, 0.1), t)![0]
    // Just lost: stays where it was, as sure as it was, even though the tracker jumped.
    let p = at(1100)
    expect(p.x).toBeCloseTo(0.4, 3)
    expect(p.visibility).toBeCloseTo(0.95)
    // Halfway through the fade.
    p = at(1000 + 200 + 200)
    expect(p.x).toBeCloseTo(0.4, 3)
    expect(p.visibility).toBeCloseTo((0.95 + 0.1) / 2, 2)
    // Faded to what the tracker says.
    p = at(2000)
    expect(p.x).toBeCloseTo(0.4, 3)
    expect(p.visibility).toBeCloseTo(0.1)
  })

  it('starts afresh where a long-lost landmark is seen again, without sweeping', () => {
    const f = new LandmarkFilter({ holdMs: 200, fadeMs: 400 })
    for (let t = 0; t <= 1000; t += 25) f.update(lm(0.2), t)
    for (let t = 1025; t <= 2000; t += 25) f.update(lm(0.2, 0.1), t)
    expect(f.update(lm(0.8), 2025)![0].x).toBeCloseTo(0.8)
  })

  it('carries a brief loss of the whole person, then lets go', () => {
    const f = new LandmarkFilter({ holdMs: 200, fadeMs: 400 })
    for (let t = 0; t <= 1000; t += 33) f.update(lm(0.3), t)
    const held = f.update(null, 1100)
    expect(held?.[0].x).toBeCloseTo(0.3, 3)
    expect(held?.[0].visibility).toBeCloseTo(0.95)
    expect(f.update(null, 1700)).toBeNull()
    // And the next person found starts fresh.
    expect(f.update(lm(0.7), 1733)![0].x).toBeCloseTo(0.7)
  })

  it('filters every landmark it is given', () => {
    const f = new LandmarkFilter()
    const rand = noise(7)
    const n = 33
    const xs: number[][] = Array.from({ length: n }, () => [])
    for (let i = 0; i < 120; i++) {
      const frame = Array.from({ length: n }, (_, j) => ({ x: j / n + 0.005 * rand(), y: 0.5, visibility: 0.9 }))
      const out = f.update(frame, (i * 1000) / 30)!
      expect(out).toHaveLength(n)
      if (i >= 30) out.forEach((p, j) => xs[j].push(p.x))
    }
    for (const s of xs) expect(std(s)).toBeLessThan(0.0025)
  })
})

describe('RateMeter', () => {
  it('settles on the rate of ticks', () => {
    const r = new RateMeter()
    for (let i = 0; i < 150; i++) r.tick((i * 1000) / 30)
    expect(r.hz).toBeCloseTo(30, 0)
  })
})
