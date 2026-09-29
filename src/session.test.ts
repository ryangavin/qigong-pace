import { describe, expect, it } from 'vitest'
import { DEFAULT_OPTIONS, Follower, type Reference } from './follower'
import { DEMO_MOVES, referenceFromMove } from './moves'
import { QiModel } from './qi'
import {
  decodeFrame,
  encodeLandmarks,
  landmarksFromPose,
  parseSession,
  Recorder,
  Replayer,
  serializeSession,
  sessionFileName,
  type RawLandmark,
  type Session,
} from './session'
import { SimStudent } from './sim'
import { LandmarkFilter } from './smoothing'
import { computeFeatures, JOINTS, poseFromLandmarks } from './skeleton'

const move = DEMO_MOVES[0]
const ASPECT = 16 / 9

/** A detection's raw landmarks read as the learner, without the filter. */
const learner = (lm: RawLandmark[] | null, aspect: number, ref: Reference) => {
  if (!lm) return null
  const pose = poseFromLandmarks(lm, { aspect, flipX: true, facingAway: false })
  return { pose, feats: computeFeatures(pose, ref.posture) }
}

/** What both pages do with each detection's raw landmarks (`takeLandmarks`): steady them, then read the learner. */
function pipeline(aspect: number, ref: Reference) {
  const filter = new LandmarkFilter()
  return (lm: RawLandmark[] | null, timeMs: number) => learner(filter.update(lm, timeMs), aspect, ref)
}

/**
 * A small fixture: the simulated student practising the first move, its poses
 * turned into the landmarks a mirrored webcam would give, detected at ~30 fps
 * with uneven gaps and a few frames where no one is found.
 */
function recordSim(seconds: number) {
  const ref = referenceFromMove(move, 'standing')
  const follower = new Follower(ref)
  const sim = new SimStudent({ speed: 1 })
  const settings = { follower: { ...DEFAULT_OPTIONS }, lead: 0.5 }
  const rec = new Recorder({ app: 'debug', move: move.id, posture: 'standing', aspect: ASPECT, settings }, 1000)
  const live: { t: number; lm: RawLandmark[] | null }[] = []
  const read = pipeline(ASPECT, ref)
  let now = 1000
  let last = now
  for (let i = 0; now - 1000 < seconds * 1000; i++) {
    now += 30 + (i % 5) // 30–34 ms apart, like a real camera
    const dt = (now - last) / 1000
    last = now
    const pose = sim.step(follower, dt)
    const lm = i % 97 === 50 ? null : landmarksFromPose(pose, ASPECT)
    rec.add(lm, now)
    live.push({ t: now - 1000, lm })
    const user = read(lm, now)
    follower.update(user?.feats ?? null, dt)
  }
  return { session: rec.finish(), live, follower }
}

/** Feed decoded frames straight to a follower and qi model, one update per detection. */
function feedDirect(s: Session) {
  const ref = referenceFromMove(move, s.posture)
  const follower = new Follower(ref, { ...s.settings.follower })
  const qi = new QiModel()
  const read = pipeline(s.aspect, ref)
  let lastT = 0
  const log: number[] = []
  for (const f of s.frames.map(decodeFrame)) {
    const dt = (f.t - lastT) / 1000
    lastT = f.t
    const user = read(f.landmarks, f.t)
    follower.update(user?.feats ?? null, dt)
    qi.update({ follower, pose: user?.pose ?? null, dt })
    log.push(follower.pos)
  }
  return { follower, qi, log }
}

/** Drive a follower and qi model from a Replayer, the way the pages' loops do, ticking at `ticks` (ms). */
function feedReplay(s: Session, ticks: number[]) {
  const replay = new Replayer(s)
  const ref = referenceFromMove(move, s.posture)
  const follower = new Follower(ref, { ...s.settings.follower })
  const qi = new QiModel()
  const read = pipeline(s.aspect, ref)
  let user: ReturnType<typeof learner> = null
  let prev = 0
  const log: number[] = []
  for (const t of ticks) {
    const dt = (t - prev) / 1000
    prev = t
    replay.advance(t - replay.time)
    const f = replay.read()
    if (f) user = read(f.landmarks, f.t)
    follower.update(user?.feats ?? null, dt)
    qi.update({ follower, pose: user?.pose ?? null, dt })
    if (f) log.push(follower.pos)
  }
  return { follower, qi, log }
}

describe('recorded sessions', () => {
  it('keeps landmarks to a tenth of a pixel, and visibility', () => {
    const lm: RawLandmark[] = Array.from({ length: 33 }, (_, i) => ({
      x: 0.123456 + i / 100,
      y: 0.654321,
      z: -0.2345,
      visibility: 0.987,
    }))
    const back = decodeFrame([42, ...encodeLandmarks(lm)])
    expect(back.t).toBe(42)
    expect(back.landmarks).toHaveLength(33)
    back.landmarks!.forEach((p, i) => {
      expect(p.x).toBeCloseTo(lm[i].x, 4)
      expect(p.y).toBeCloseTo(lm[i].y, 4)
      expect(p.z).toBeCloseTo(lm[i].z!, 3)
      expect(p.visibility).toBeCloseTo(0.99, 5)
    })
    expect(decodeFrame([7]).landmarks).toBeNull()
  })

  it('round-trips the simulated student through record, JSON and replay', () => {
    const { session, live, follower } = recordSim(20)
    expect(follower.state).not.toBe('waiting')
    const text = serializeSession(session)
    // Compact: well under a kilobyte per detection.
    expect(text.length / session.frames.length).toBeLessThan(700)
    const back = parseSession(text)
    expect(back).toEqual(session)
    expect(sessionFileName(back)).toMatch(new RegExp(`^qigong-session-${move.id}-\\d{4}-\\d\\d-\\d\\d-\\d{4}\\.json$`))

    // Replayed at the camera's own pace, every detection comes back once, at its time, as recorded.
    const replay = new Replayer(back)
    for (const want of live) {
      replay.advance(want.t - replay.time)
      const got = replay.read()!
      expect(got.t).toBe(want.t)
      if (!want.lm) {
        expect(got.landmarks).toBeNull()
        continue
      }
      const a = learner(want.lm, ASPECT, follower.ref)!.pose
      const b = learner(got.landmarks, back.aspect, follower.ref)!.pose
      for (const j of JOINTS) {
        expect(b[j].x).toBeCloseTo(a[j].x, 3)
        expect(b[j].y).toBeCloseTo(a[j].y, 3)
      }
    }
    expect(replay.ended).toBe(true)

    // And the replayed student gets as far through the move as the live one did.
    const replayed = feedDirect(back).follower
    expect(replayed.state).toBe(follower.state)
    expect(replayed.reps).toBe(follower.reps)
    expect(replayed.pos).toBeCloseTo(follower.pos, 0)
  })

  it('replays to the same follower and qi as feeding the same landmarks directly', () => {
    const { session } = recordSim(12)
    const direct = feedDirect(session)
    const decoded = session.frames.map(decodeFrame)
    const replayed = feedReplay(
      session,
      decoded.map((f) => f.t),
    )
    expect(replayed.log).toEqual(direct.log)
    expect(replayed.follower.state).toBe(direct.follower.state)
    expect(replayed.follower.pos).toBe(direct.follower.pos)
    expect(replayed.follower.reps).toBe(direct.follower.reps)
    expect(replayed.qi.frame).toEqual(direct.qi.frame)
    expect(direct.follower.state).not.toBe('waiting')
  })

  it('hands over each detection once, in order, when the display ticks faster than the camera', () => {
    const { session } = recordSim(3)
    const replay = new Replayer(session)
    const seen: number[] = []
    for (let t = 0; t <= replay.duration + 20; t += 1000 / 120) {
      replay.advance(1000 / 120)
      const f = replay.read()
      if (f) {
        expect(f.t).toBeLessThanOrEqual(replay.time)
        seen.push(f.t)
      }
    }
    expect(seen).toEqual(session.frames.map((f) => f[0]))
  })

  it('plays back changes at their time, and seeks', () => {
    const settings = { follower: { ...DEFAULT_OPTIONS }, lead: 0.5 }
    const rec = new Recorder({ app: 'primary', move: 'a', posture: 'standing', aspect: 1.5, settings }, 0)
    for (let t = 0; t <= 1000; t += 100) rec.add(null, t)
    rec.event({ posture: 'seated' }, 250)
    rec.event({ settings: { ...settings, follower: { ...settings.follower, matchThreshold: 0.3 } } }, 450)
    settings.follower.matchThreshold = 0.1 // the recorder keeps its own copy
    rec.event({ restart: true }, 800)
    const replay = new Replayer(parseSession(serializeSession(rec.finish())))
    replay.advance(300)
    expect(replay.events()).toEqual([{ t: 250, posture: 'seated' }])
    replay.advance(200)
    const [change] = replay.events()
    expect('settings' in change && change.settings.follower.matchThreshold).toBe(0.3)
    expect(replay.session.settings.follower.matchThreshold).toBe(DEFAULT_OPTIONS.matchThreshold)
    replay.seek(750)
    expect(replay.read()?.t).toBe(700)
    expect(replay.events()).toEqual([])
    replay.advance(100)
    expect(replay.events()).toEqual([{ t: 800, restart: true }])
  })

  it('refuses files that are not sessions', () => {
    expect(() => parseSession('not json')).toThrow(/not a recorded session/)
    expect(() => parseSession('{"format":"other"}')).toThrow(/not a recorded session/)
  })
})
