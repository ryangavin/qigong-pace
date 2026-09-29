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

describe('LandmarkFilter outliers', () => {
  // A person as MediaPipe gives them (33 landmarks, unmirrored image units): shoulders
  // `w` apart about `cx`, hips a torso below, wrists wherever the arms are.
  interface Body {
    cx?: number
    y?: number
    w?: number
    torso?: number
    hipVis?: number
    wrists?: [number, number, number, number]
    swap?: boolean
  }
  const body = ({ cx = 0.5, y = 0.45, w = 0.15, torso = 0.25, hipVis = 0.9, wrists, swap = false }: Body = {}) => {
    const out = Array.from({ length: 33 }, () => ({ x: cx, y: y - 0.1, visibility: 0.95 }))
    const s = swap ? -1 : 1
    out[11] = { x: cx + (s * w) / 2, y, visibility: 0.99 }
    out[12] = { x: cx - (s * w) / 2, y, visibility: 0.99 }
    const [lx, ly, rx, ry] = wrists ?? [cx + w, y + 0.2, cx - w, y + 0.2]
    out[15] = { x: lx, y: ly, visibility: 0.95 }
    out[16] = { x: rx, y: ry, visibility: 0.95 }
    out[23] = { x: cx + w / 3, y: y + torso, visibility: hipVis }
    out[24] = { x: cx - w / 3, y: y + torso, visibility: hipVis }
    return out
  }
  const width = (lm: { x: number; y: number }[]) => Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y)
  const T = 1000 / 30

  /** A filter that has watched `b` for a second. */
  const settled = (b: Body = {}) => {
    const f = new LandmarkFilter()
    for (let i = 0; i < 30; i++) f.update(body(b), i * T)
    return f
  }

  it('passes over a detection whose shoulders collapse, holding the pose', () => {
    // Arms overhead, MediaPipe sometimes squeezes the shoulders to a third for a frame.
    const f = settled()
    const out = f.update(body({ w: 0.05, wrists: [0.2, 0.2, 0.25, 0.2] }), 30 * T)!
    expect(f.rejected).toBe(1)
    expect(width(out)).toBeCloseTo(0.15, 3)
    expect(out[15].x).toBeCloseTo(0.65, 3)
    expect(out[11].visibility).toBeCloseTo(0.99)
  })

  it('passes over a detection with the sides swapped, or the body teleported', () => {
    const f = settled()
    f.update(body({ swap: true, w: 0.12 }), 30 * T)
    expect(f.rejected).toBe(1)
    f.update(body(), 31 * T)
    f.update(body({ cx: 0.75 }), 32 * T)
    expect(f.rejected).toBe(2)
    const out = f.update(body(), 33 * T)!
    expect(f.rejected).toBe(2)
    expect((out[11].x + out[12].x) / 2).toBeCloseTo(0.5, 3)
  })

  it('stretches of the torso count only when the hips are well seen', () => {
    const f = settled()
    f.update(body({ torso: 0.4 }), 30 * T)
    expect(f.rejected).toBe(1)
    // Seated, the hips are out of frame and MediaPipe's guesses at them wander freely.
    const g = settled({ hipVis: 0.5 })
    g.update(body({ torso: 0.4, hipVis: 0.5 }), 30 * T)
    expect(g.rejected).toBe(0)
  })

  it('keeps up with fast but real movement', () => {
    const f = new LandmarkFilter()
    let out: ReturnType<LandmarkFilter['update']> = null
    for (let i = 0; i < 60; i++) {
      // Swaying half a shoulder width a second, leaning in (2% bigger a frame), hands flung wide and back.
      const k = i / 30
      const cx = 0.5 + 0.075 * Math.sin(2 * Math.PI * k)
      const w = 0.15 * 1.02 ** Math.min(i, 20)
      const a = Math.sin(4 * Math.PI * k)
      out = f.update(body({ cx, w, wrists: [cx + w + 0.3 * a, 0.3, cx - w - 0.3 * a, 0.3] }), i * T)
    }
    expect(f.rejected).toBe(0)
    expect(width(out!)).toBeCloseTo(0.15 * 1.02 ** 20, 2)
  })

  it('holds through a flicker of bad detections among good ones', () => {
    // The owner's session: arms overhead, collapsed and swapped shoulders came and went for a few frames.
    const f = settled()
    const bad = [body({ w: 0.06 }), body({ swap: true, w: 0.1 }), body({ w: 0.09 }), body({ swap: true, w: 0.11 })]
    let t = 30
    for (const b of [bad[0], body(), bad[1], bad[2], body(), bad[3], bad[0], bad[1], body()]) {
      const out = f.update(b, t++ * T)!
      expect(width(out)).toBeGreaterThan(0.14)
      expect(out[11].x).toBeGreaterThan(out[12].x)
    }
    expect(f.rejected).toBe(6)
  })

  it('takes a real change once it lasts, starting afresh there', () => {
    // Someone sits down much nearer the camera: the body is suddenly twice the size, and stays so.
    const f = settled()
    const near = body({ w: 0.3, torso: 0.5 })
    let out = f.update(near, 30 * T)!
    expect(width(out)).toBeCloseTo(0.15, 3)
    out = f.update(near, 31 * T)!
    out = f.update(near, 32 * T)!
    expect(width(out)).toBeCloseTo(0.3, 3)
    expect(f.rejected).toBe(2)
    // And from there it follows as usual.
    out = f.update(near, 33 * T)!
    expect(f.rejected).toBe(2)
    expect(width(out)).toBeCloseTo(0.3, 3)
  })
})

describe('RateMeter', () => {
  it('settles on the rate of ticks', () => {
    const r = new RateMeter()
    for (let i = 0; i < 150; i++) r.tick((i * 1000) / 30)
    expect(r.hz).toBeCloseTo(30, 0)
  })
})
