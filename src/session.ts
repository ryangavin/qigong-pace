import type { FollowerOptions } from './follower'
import { type Joint, type Pose, type Posture } from './skeleton'

// A recorded practice session: the raw MediaPipe landmarks of every detection,
// with their real timestamps, so a session at the owner's webcam can be
// replayed exactly by someone without one. No images are kept.
//
// Recording and replay sit at the input boundary: raw landmark arrays in, the
// same raw arrays out. Everything after (filtering, calibration, following,
// qi) runs on a replay just as it does on the camera.

export const SESSION_FORMAT = 'qigong-pace-session'
export const SESSION_VERSION = 1
/** MediaPipe's pose model finds 33 landmarks. */
export const LANDMARK_COUNT = 33

// Stored as integers: x and y to 1/10000 of the frame (about a tenth of a
// pixel at 1280 wide), z to 1/1000, visibility to 1/100.
const XY = 10000
const Z = 1000
const VIS = 100

/** One MediaPipe landmark, as the tracker gives it. */
export interface RawLandmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

/** The settings that change how the learner is followed. */
export interface SessionSettings {
  follower: FollowerOptions
  /** Seconds of the move the guidance shows ahead of the learner. */
  lead: number
}

/** Something the learner changed during the session. */
export type SessionChange = { move: string } | { posture: Posture } | { restart: true } | { settings: SessionSettings }
/** A change, at `t` ms from the start of the session. */
export type SessionEvent = { t: number } & SessionChange

export interface SessionHead {
  /** The page it was recorded on. */
  app: 'primary' | 'debug'
  /** The move and posture at the start. */
  move: string
  posture: Posture
  /** Width / height of the camera image the landmarks are normalised to. */
  aspect: number
  settings: SessionSettings
}

export interface Session extends SessionHead {
  format: typeof SESSION_FORMAT
  version: number
  /** When it was recorded, as an ISO date. */
  recordedAt: string
  events: SessionEvent[]
  /**
   * One entry per detection: ms from the start, then x, y, z and visibility
   * for each of the 33 landmarks as scaled integers; just [ms] when no one was found.
   */
  frames: number[][]
}

/** A detection, decoded. */
export interface SessionFrame {
  t: number
  landmarks: RawLandmark[] | null
}

export function encodeLandmarks(lm: readonly RawLandmark[]): number[] {
  const out: number[] = []
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = lm[i] ?? { x: 0, y: 0, visibility: 0 }
    out.push(Math.round(p.x * XY), Math.round(p.y * XY), Math.round((p.z ?? 0) * Z), Math.round((p.visibility ?? 1) * VIS))
  }
  return out
}

export function decodeFrame(f: readonly number[]): SessionFrame {
  if (f.length < 1 + LANDMARK_COUNT * 4) return { t: f[0], landmarks: null }
  const landmarks: RawLandmark[] = []
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const k = 1 + i * 4
    landmarks.push({ x: f[k] / XY, y: f[k + 1] / XY, z: f[k + 2] / Z, visibility: f[k + 3] / VIS })
  }
  return { t: f[0], landmarks }
}

/** Records a session as it happens. `now` is in ms, from the same clock the landmarks are timed by. */
export class Recorder {
  private frames: number[][] = []
  private events: SessionEvent[] = []
  private recordedAt = new Date().toISOString()

  constructor(
    private head: SessionHead,
    private start: number,
  ) {
    this.head = { ...head, aspect: Math.round(head.aspect * 1e4) / 1e4, settings: cloneSettings(head.settings) }
  }

  /** The raw landmarks of one detection, or null when no one was found. */
  add(landmarks: readonly RawLandmark[] | null, now: number) {
    const t = Math.max(0, Math.round(now - this.start))
    this.frames.push(landmarks ? [t, ...encodeLandmarks(landmarks)] : [t])
  }

  /** The learner changed the move, posture or settings, or began again. */
  event(change: SessionChange, now: number) {
    const t = Math.max(0, Math.round(now - this.start))
    this.events.push({ t, ...('settings' in change ? { settings: cloneSettings(change.settings) } : change) })
  }

  /** Milliseconds recorded so far. */
  elapsed(now: number) {
    return now - this.start
  }

  get frameCount() {
    return this.frames.length
  }

  finish(): Session {
    return {
      format: SESSION_FORMAT,
      version: SESSION_VERSION,
      recordedAt: this.recordedAt,
      ...this.head,
      events: this.events,
      frames: this.frames,
    }
  }
}

function cloneSettings(s: SessionSettings): SessionSettings {
  return { follower: { ...s.follower }, lead: s.lead }
}

/** The session as JSON: the header readable, one detection per line. */
export function serializeSession(s: Session): string {
  const { frames, ...head } = s
  const top = JSON.stringify(head, null, 1)
  const body = frames.map((f) => JSON.stringify(f)).join(',\n')
  return `${top.slice(0, -2)},\n "frames": [\n${body}\n ]\n}\n`
}

export function parseSession(text: string): Session {
  let s: Partial<Session>
  try {
    s = JSON.parse(text)
  } catch {
    throw new Error('That file is not a recorded session (it is not JSON).')
  }
  if (s?.format !== SESSION_FORMAT || !Array.isArray(s.frames)) throw new Error('That file is not a recorded session.')
  if ((s.version ?? 0) > SESSION_VERSION) throw new Error('That session was recorded by a newer version of the app.')
  return { ...s, events: s.events ?? [] } as Session
}

/** A file name for a session: `qigong-session-<move>-<date>-<time>.json`. */
export function sessionFileName(s: Session): string {
  const d = new Date(s.recordedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `qigong-session-${s.move.replace(/[^a-z0-9-]+/gi, '-')}-${date}.json`
}

/**
 * Plays a session back as the camera would: advance its clock by the time
 * that passed, then `read` the latest detection since the last read, if any.
 * Like a camera, it hands over only the newest detection when the reader is
 * slower than the recording.
 */
export class Replayer {
  readonly frames: SessionFrame[]
  /** Milliseconds into the session. */
  time = 0
  private next = 0
  private nextEvent = 0

  constructor(readonly session: Session) {
    this.frames = session.frames.map(decodeFrame)
  }

  get duration() {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0
  }

  /** Every detection has been read. */
  get ended() {
    return this.next >= this.frames.length
  }

  advance(ms: number) {
    this.time = Math.min(this.duration, this.time + Math.max(0, ms))
  }

  /** Jump to `ms`: the detection there is the next to be read, and events from there on are yet to come. */
  seek(ms: number) {
    this.time = Math.min(this.duration, Math.max(0, ms))
    let i = 0
    while (i + 1 < this.frames.length && this.frames[i + 1].t <= this.time) i++
    this.next = i
    this.nextEvent = this.session.events.findIndex((e) => e.t > this.time)
    if (this.nextEvent < 0) this.nextEvent = this.session.events.length
  }

  /** The newest detection at or before the clock that hasn't been read yet, or undefined if there is none. */
  read(): SessionFrame | undefined {
    let found: SessionFrame | undefined
    while (this.next < this.frames.length && this.frames[this.next].t <= this.time) found = this.frames[this.next++]
    return found
  }

  /** The events that have come due since the last call. */
  events(): SessionEvent[] {
    const out: SessionEvent[] = []
    const all = this.session.events
    while (this.nextEvent < all.length && all[this.nextEvent].t <= this.time) out.push(all[this.nextEvent++])
    return out
  }
}

// MediaPipe landmark indices of each joint, as the selfie view sees them:
// with the image mirrored, the screen-left joint is the anatomical left.
const INDEX: Record<Joint, number> = {
  head: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
}

/**
 * The raw landmarks a mirrored webcam would give for `pose` (the inverse of
 * `poseFromLandmarks` with `flipX`), for recording the simulated student.
 * Landmarks the app doesn't use are left unseen at the origin.
 */
export function landmarksFromPose(pose: Pose, aspect: number): RawLandmark[] {
  const lm: RawLandmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  for (const [j, i] of Object.entries(INDEX) as [Joint, number][]) {
    const p = pose[j]
    lm[i] = { x: 1 - p.x / aspect, y: p.y, z: 0, visibility: p.v }
  }
  return lm
}
