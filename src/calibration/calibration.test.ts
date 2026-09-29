import { describe, expect, it } from 'vitest'
import { TYPICAL_BODY, type Proportions } from '../fit'
import { DEFAULT_OPTIONS } from '../follower'
import { DEMO_MOVES } from '../moves'
import { parseSession } from '../session'
import type { Posture } from '../skeleton'
import { measure } from './measure'
import {
  buildCalibration,
  calibrationFileName,
  parseCalibration,
  recordingOf,
  serializeCalibration,
  type CalibrationFile,
} from './report'
import { CalibrationSim, simulateCalibration, type CalibrationSimOptions, type SimulateOptions } from './sim'
import { tasksFor } from './tasks'

const head = { recordedAt: '2026-09-29T18:30:00.000Z', source: 'sim' as const, model: 'full' }
const SLOW = 30_000

/** A body built as `?arms=` and `?shoulders=` build the simulated student: arms shoulder to wrist, in torso lengths. */
function build(arms: number, shoulders: number): Proportions {
  const body = { ...TYPICAL_BODY }
  const k = arms / (body.upperArm + body.forearm)
  body.upperArm *= k
  body.forearm *= k
  body.hand *= k
  body.shoulders = shoulders
  return body
}

function calibrate(sim: CalibrationSimOptions = {}, opts: Omit<SimulateOptions, 'sim'> = {}): CalibrationFile {
  const posture: Posture = opts.posture ?? 'standing'
  const rec = simulateCalibration({ ...opts, posture, sim: new CalibrationSim(sim) })
  return buildCalibration({ ...head, posture, aspect: rec.aspect }, rec)
}

const task = (f: CalibrationFile, id: string) => f.measurements.tasks.find((t) => t.id === id)!

describe('measuring a body of known proportions', () => {
  const body = build(1.4, 0.7)
  const f = calibrate({ body })
  const m = f.measurements
  const arm = body.upperArm + body.forearm + body.hand

  it('measures its segment lengths', () => {
    expect(m.body.upperArm + m.body.forearm).toBeCloseTo(1.4, 1)
    expect(m.body.shoulders).toBeCloseTo(0.7, 1)
    expect(m.arm / arm).toBeGreaterThan(0.95)
    expect(m.arm / arm).toBeLessThan(1.05)
  }, SLOW)

  it('measures how far it reaches, overhead and to the sides', () => {
    expect(m.overhead!.aboveShoulders).toBeGreaterThan(arm - 0.1)
    expect(m.overhead!.inFrame).toBe(1)
    expect(m.span!.torso).toBeGreaterThan(2 * arm + 0.7 - 0.15)
    expect(m.span!.shoulders).toBeCloseTo((m.span!.torso * m.units.torso) / m.units.shoulders, 6)
    expect(m.units.shoulders / m.units.torso).toBeCloseTo(0.7, 1)
    // Each sector of the envelope was reached, about an arm's length out, for both hands.
    for (const s of [...m.envelope.l, ...m.envelope.r]) expect(s).toBeGreaterThan(arm - 0.15)
    // The same reach in torso lengths, shoulder widths and frame heights.
    const up = m.envelope.torso.l!.up
    expect(m.envelope.shoulders.l!.up).toBeCloseTo((up * m.units.torso) / m.units.shoulders, 6)
    expect(m.envelope.frame.l!.up).toBeCloseTo(up * m.units.torso, 6)
  }, SLOW)

  it('measures each task, and how closely its shape came out', () => {
    for (const t of m.tasks) {
      expect(t.status).toBe('done')
      expect(t.hz).toBeGreaterThan(25)
      if (t.match && !['circles', 'water'].includes(t.id)) {
        expect(t.match.distance!).toBeLessThan(DEFAULT_OPTIONS.matchThreshold)
        expect(t.match.within).toBeGreaterThan(0.9)
      }
    }
    // It starts moving a second after the prompt and takes a second and a half.
    expect(task(f, 'overhead').settledAfter).toBeGreaterThan(1.2)
    expect(task(f, 'overhead').settledAfter).toBeLessThan(3)
    expect(task(f, 'forward').detail.foreshortening).toBeCloseTo(0.12, 1)
    expect(task(f, 'palms').detail.gap).toBeLessThan(0.3)
    expect(task(f, 'knees').detail.hipDrop).toBeGreaterThan(0.1)
    expect(task(f, 'knees').detail.kneeAngle).toBeLessThan(170)
  }, SLOW)

  it('measures the shiver held still and the lag moving, raw and filtered', () => {
    expect(m.jitter!.raw).toBeGreaterThan(m.jitter!.filtered)
    expect(m.jitter!.filtered).toBeGreaterThan(0)
    expect(m.lag!.ms).toBeGreaterThan(20)
    expect(m.lag!.ms).toBeLessThan(300)
  }, SLOW)

  it('sees it whole and centred, with its hands in the picture throughout', () => {
    expect(m.framing!.cropped).toEqual([])
    expect(m.framing!.centre).toBeCloseTo(0.5, 1)
    expect(m.handsLeave.top + m.handsLeave.left + m.handsLeave.right + m.handsLeave.bottom).toBe(0)
    expect(f.summary.join(' ')).toMatch(/hands stayed in the picture/)
  }, SLOW)

  it('finds every move within its reach', () => {
    expect(f.audit!.checked).toBe(DEMO_MOVES.filter((mv) => mv.postures.includes('standing')).length)
    expect(f.audit!.offenders).toEqual([])
    expect(f.summary.join(' ')).toMatch(/All \d+ standing moves keep their lights within your reach/)
  }, SLOW)
})

describe('where the camera loses the learner', () => {
  it('counts injected dropouts and where they happened', () => {
    // The screen-left hand is lost for half a second, held overhead.
    const f = calibrate({ drop: (j, id, t) => j === 'lWrist' && id === 'overhead' && t > 7 && t < 7.5 })
    const js = task(f, 'overhead').joints.lWrist
    expect(js.drops).toBe(1)
    expect(js.seen).toBeLessThan(0.97)
    expect(js.at).toHaveLength(1)
    expect(js.at[0][1]).toBeLessThan(0.3)
    expect(js.at[0][2]).toBe('inside')
    expect(task(f, 'overhead').joints.rWrist.drops).toBe(0)
    expect(f.measurements.handsLeave.inside).toBe(1)
    expect(f.summary.join(' ')).toMatch(/lost your left hand 1 time \(mostly inside the picture\)/)
  }, SLOW)

  it('says when the hands leave the top of the picture, and which moves put lights there', () => {
    const f = calibrate({ zoom: 1.35 })
    const m = f.measurements
    expect(m.handsLeave.top).toBeGreaterThan(0)
    expect(m.handsLeave.topAbove!).toBeLessThan(m.framing!.headroom)
    expect(m.overhead!.inFrame).toBeLessThan(0.5)
    const sky = f.audit!.offenders.find((o) => o.id === 'lift-sky')!
    expect(sky.spans.some((s) => s.why === 'frame' && s.where === 'top')).toBe(true)
    // Each stretch of trouble is one span, not a frame each.
    expect(sky.spans.length).toBeLessThanOrEqual(4)
    expect(f.summary.join(' ')).toMatch(/hands leave the top of the picture when raised more than about/)
    expect(f.summary.join(' ')).toMatch(/Holding up the sky \(at \d+ s both lights are above the picture\)/)
  }, SLOW)

  it("finds the lights beyond a learner who can't raise their arms high", () => {
    const f = calibrate({ maxRaise: 110 })
    const m = f.measurements
    // Nothing was seen straight up, from either shoulder.
    expect(m.envelope.l[0]).toBeNull()
    expect(m.envelope.r[0]).toBeNull()
    expect(task(f, 'overhead').match!.distance!).toBeGreaterThan(DEFAULT_OPTIONS.matchThreshold)
    expect(f.summary.join(' ')).toMatch(/didn't read as asked: Hands overhead/)
    const sky = f.audit!.offenders.find((o) => o.id === 'lift-sky')!
    expect(sky.spans.every((s) => s.why === 'reach')).toBe(true)
    expect(f.summary.join(' ')).toMatch(/moves have lights you can't reach: .*Holding up the sky \(at \d+ s both lights are beyond your reach\)/)
  }, SLOW)
})

describe('seated, and skipping', () => {
  it('leaves out the knees seated, and audits the seated moves', () => {
    const f = calibrate({}, { posture: 'seated' })
    expect(f.tasks.map((t) => t.id)).toEqual(tasksFor('seated').map((t) => t.id))
    expect(f.tasks.some((t) => t.id === 'knees')).toBe(false)
    expect(f.audit!.posture).toBe('seated')
    expect(f.audit!.checked).toBe(DEMO_MOVES.filter((mv) => mv.postures.includes('seated')).length)
    expect(f.measurements.framing!.cropped).toEqual([])
    expect(f.measurements.body.shoulders).toBeCloseTo(0.84, 2)
  }, SLOW)

  it('measures what was done when a task is skipped', () => {
    const f = calibrate({}, { skip: ['circles', 'knees'] })
    expect(task(f, 'circles').status).toBe('skipped')
    expect(f.tasks.find((t) => t.id === 'circles')!.frames).toEqual([])
    expect(f.measurements.overhead).not.toBeNull()
    expect(f.summary[0]).toMatch(/skipped: Knees bent and Arm circles/)
  }, SLOW)
})

describe('the calibration file', () => {
  const f = calibrate()
  const text = serializeCalibration(f)

  it('reads back, and measures the same again from its recordings alone', () => {
    const back = parseCalibration(text)
    expect(back.format).toBe('qigong-pace-calibration')
    expect(back.tasks).toEqual(f.tasks)
    expect(back.summary).toEqual(f.summary)
    // Measured again from the recordings in the file, it comes out the same, to the digit.
    const again = buildCalibration(
      { recordedAt: back.recordedAt, source: back.source, model: back.model, posture: back.posture, aspect: back.aspect },
      recordingOf(back),
    )
    expect(serializeCalibration(again).split('\n')).toEqual(text.split('\n'))
    expect(measure(recordingOf(back)).body).toEqual(f.measurements.body)
  }, SLOW)

  it('keeps one detection per line, after a readable header', () => {
    const lines = text.split('\n')
    expect(lines[1]).toBe(' "format": "qigong-pace-calibration",')
    const frames = f.tasks.reduce((n, t) => n + t.frames.length, 0)
    expect(lines.filter((l) => /^ {3}\[\d+,/.test(l))).toHaveLength(frames)
    expect(text.indexOf('"summary"')).toBeLessThan(text.indexOf('"tasks"'))
  }, SLOW)

  it('is named by its date, and is not taken for a session (or a session for it)', () => {
    expect(calibrationFileName(f)).toMatch(/^qigong-calibration-2026-09-\d\d-\d{4}\.json$/)
    expect(() => parseSession(text)).toThrow(/not a recorded session/)
    expect(() => parseCalibration('{"format":"qigong-pace-session","frames":[]}')).toThrow(/not a calibration/)
    expect(() => parseCalibration('nope')).toThrow(/not JSON/)
  }, SLOW)
})
