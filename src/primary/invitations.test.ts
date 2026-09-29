import { describe, expect, it } from 'vitest'
import { quietFrame, type QiFrame, type QiRegion } from '../qi'
import { DEFAULT_INVITATION_OPTIONS, INVITATIONS, Invitations, type InvitationInput } from './invitations'

const DT = 1 / 30

type Shape = Partial<Omit<QiFrame, 'regions'>> & { regions?: Partial<Record<QiRegion, number>> }
const frame = ({ regions, ...rest }: Shape = {}): QiFrame => {
  const q = { ...quietFrame(), ...rest }
  q.regions = { ...q.regions, ...regions }
  return q
}

type Step = Partial<Omit<InvitationInput, 'dt' | 'q'>> & { q?: QiFrame | ((t: number) => QiFrame) }

/** Run `seconds` of frames and return what was on the line each frame. */
function run(inv: Invitations, seconds: number, step: Step = {}, from = { t: 0 }) {
  const shown: (string | null)[] = []
  for (let end = from.t + seconds; from.t < end; from.t += DT) {
    const q = typeof step.q === 'function' ? step.q(from.t) : (step.q ?? frame())
    const got = inv.update({
      q,
      dt: DT,
      practising: step.practising ?? true,
      inHold: step.inHold ?? false,
      standing: step.standing ?? true,
      repeated: step.repeated ?? true,
      busy: step.busy ?? false,
    })
    shown.push(got?.id ?? null)
  }
  return shown
}

const palms = frame({ palmField: 0.8, flow: 0.7 })
const firstAt = (shown: (string | null)[]) => shown.findIndex((s) => s !== null) * DT

describe('Invitations', () => {
  it('offer nothing in the first half minute of practice', () => {
    const inv = new Invitations()
    const shown = run(inv, 29, { q: palms })
    expect(shown.every((s) => s === null)).toBe(true)
    // Time spent not practising doesn't count toward it.
    const idle = new Invitations()
    run(idle, 60, { q: palms, practising: false })
    expect(run(idle, 20, { q: palms }).every((s) => s === null)).toBe(true)
  })

  it('wait until the move has been done through once', () => {
    const inv = new Invitations()
    expect(run(inv, 120, { q: palms, repeated: false }).every((s) => s === null)).toBe(true)
    // The first repetition ends: the practice before it counts toward the warm-up.
    expect(firstAt(run(inv, 10, { q: palms }))).toBeLessThan(0.5)
  })

  it('invite the palms to notice the ball when the palm field is strong', () => {
    const inv = new Invitations()
    run(inv, 30, { q: palms })
    const shown = run(inv, 5, { q: palms })
    expect(shown).toContain('palmBall')
    expect(inv.current?.text).toMatch(/palms/)
  })

  it('show one for a while, then leave the line quiet', () => {
    const inv = new Invitations()
    const shown = run(inv, 120, { q: palms })
    const on = shown.filter((s) => s !== null).length * DT
    expect(on).toBeGreaterThan(DEFAULT_INVITATION_OPTIONS.showSec - 0.1)
    // Only one invitation in two minutes, and never the same one twice.
    expect(on).toBeLessThan(DEFAULT_INVITATION_OPTIONS.showSec + 0.1)
  })

  it('offer each at most once every few minutes', () => {
    const inv = new Invitations()
    const shown = run(inv, 600, { q: palms })
    const starts: number[] = []
    shown.forEach((s, i) => {
      if (s === 'palmBall' && shown[i - 1] !== 'palmBall') starts.push(i * DT)
    })
    expect(starts.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(DEFAULT_INVITATION_OPTIONS.repeatSec - 0.1)
    }
  })

  it('keep a gap between two different invitations', () => {
    const inv = new Invitations()
    const both = frame({ palmField: 0.8, flow: 0.7, level: 0.7 })
    const shown = run(inv, 200, { q: both })
    const ids = shown.filter((s, i) => s !== null && s !== shown[i - 1])
    expect(ids).toEqual(['palmBall', 'edge'])
    const endFirst = shown.lastIndexOf('palmBall') * DT
    const startSecond = shown.indexOf('edge') * DT
    expect(startSecond - endFirst).toBeGreaterThanOrEqual(DEFAULT_INVITATION_OPTIONS.gapSec - 0.1)
  })

  it('never share the line with other words, and wait for a quiet moment after them', () => {
    const inv = new Invitations()
    run(inv, 25, { q: palms })
    // The move's cue is on the line: nothing may start.
    expect(run(inv, 10, { q: palms, busy: true }).every((s) => s === null)).toBe(true)
    const after = run(inv, 10, { q: palms })
    expect(firstAt(after)).toBeGreaterThanOrEqual(DEFAULT_INVITATION_OPTIONS.quietSec - 0.1)
    // A cue arriving ends the invitation at once.
    expect(inv.current).not.toBeNull()
    run(inv, DT, { q: palms, busy: true })
    expect(inv.current).toBeNull()
  })

  it('invite attention below the navel only in a sustained hold', () => {
    const charged = frame({ regions: { dantian: 0.7 }, flow: 0.8 })
    const moving = new Invitations()
    expect(run(moving, 90, { q: charged }).includes('dantian')).toBe(false)
    const holding = new Invitations()
    expect(run(holding, 90, { q: charged, inHold: true })).toContain('dantian')
  })

  it('invite rooting while sinking with charged feet, standing only', () => {
    // Breath closing from 1 to -1 over 4 s, then opening again.
    const sinking = (t: number) => {
      const u = (t % 8) / 4
      const breath = u < 1 ? 1 - 2 * u : -1 + 2 * (u - 1)
      return frame({ breath, flow: 0.7, regions: { lFoot: 0.6, rFoot: 0.6 } })
    }
    const standing = new Invitations()
    expect(run(standing, 90, { q: sinking })).toContain('rooting')
    const seated = new Invitations()
    expect(run(seated, 90, { q: sinking, standing: false }).includes('rooting')).toBe(false)
  })

  it('invite lengthening from the crown while rising', () => {
    const rising = (t: number) => {
      const u = (t % 8) / 4
      const breath = u < 1 ? -1 + 2 * u : 1 - 2 * (u - 1)
      return frame({ breath, flow: 0.7, regions: { crown: 0.7 } })
    }
    const inv = new Invitations()
    const shown = run(inv, 90, { q: rising })
    expect(shown).toContain('crown')
    // It starts while the breath is rising.
    const start = shown.indexOf('crown') * DT
    expect(start % 8).toBeLessThan(4)
  })

  it('stay quiet when nothing is gathered', () => {
    const inv = new Invitations()
    expect(run(inv, 300, { q: frame({ flow: 0.8, level: 0.2 }) }).every((s) => s === null)).toBe(true)
  })

  it('invite rather than assert', () => {
    for (const e of INVITATIONS) expect(e.text).toMatch(/notice|may|\?|let your attention/i)
  })
})
