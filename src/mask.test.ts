import { describe, expect, it } from 'vitest'
import { shrinkMask } from './mask'

// A 40×20 mask with the person filling the left quarter of the image.
const W = 40
const H = 20
const leftQuarter = Float32Array.from({ length: W * H }, (_, i) => (i % W < W / 4 ? 1 : 0))

describe('shrinkMask', () => {
  it('shrinks to about the width asked for, keeping the aspect', () => {
    const m = shrinkMask(leftQuarter, W, H, 10, false)
    expect(m.width).toBe(10)
    expect(m.height).toBe(5)
    expect(m.data.length).toBe(50)
  })

  it('keeps the person where they are, as bytes', () => {
    const m = shrinkMask(leftQuarter, W, H, 8, false)
    const row = Array.from(m.data.slice(0, m.width))
    expect(row.slice(0, 2)).toEqual([255, 255])
    expect(row.slice(2).every((v) => v === 0)).toBe(true)
  })

  it('mirrors the mask to lie like a mirrored pose', () => {
    const m = shrinkMask(leftQuarter, W, H, 8, true)
    const row = Array.from(m.data.slice(0, m.width))
    expect(row.slice(-2)).toEqual([255, 255])
    expect(row.slice(0, -2).every((v) => v === 0)).toBe(true)
  })

  it('clamps confidences and reuses the output', () => {
    const noisy = Float32Array.from({ length: W * H }, (_, i) => (i % 2 ? 1.4 : -0.2))
    const a = shrinkMask(noisy, W, H, 40, false)
    expect(Math.max(...a.data)).toBe(255)
    expect(Math.min(...a.data)).toBe(0)
    const b = shrinkMask(leftQuarter, W, H, 40, false, a)
    expect(b.data).toBe(a.data)
  })
})
