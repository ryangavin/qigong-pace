import { buildReference, type Reference } from './follower'
import type { Pose, Pt } from './skeleton'

// Built-in moves, authored as keyframes of a front-on figure so the app works
// before anyone loads a video. Angles are in degrees, seen from the front.

export interface BodyKey {
  /** Seconds from the start of the move. */
  t: number
  /** Screen-left arm raised from hanging (0) through the side (90) to overhead (180). */
  lArm: number
  /** Screen-left elbow bent back toward the body's midline. */
  lElbow: number
  rArm: number
  rElbow: number
  /** Knee bend, 0 (standing) to 1 (deep horse stance). */
  sink: number
}

export interface Move {
  id: string
  name: string
  cue: string
  keys: BodyKey[]
}

const rest = (t: number, sink = 0): BodyKey => ({ t, lArm: 12, lElbow: 70, rArm: 12, rElbow: 70, sink })

export const DEMO_MOVES: Move[] = [
  {
    id: 'lift-sky',
    name: 'Holding up the sky',
    cue: 'Float the arms up the sides, press the palms to the sky, then sink as they fall.',
    keys: [
      rest(0),
      rest(1.5),
      { t: 5, lArm: 90, lElbow: 5, rArm: 90, rElbow: 5, sink: 0 },
      { t: 8.5, lArm: 168, lElbow: 25, rArm: 168, rElbow: 25, sink: 0 },
      { t: 11, lArm: 168, lElbow: 25, rArm: 168, rElbow: 25, sink: 0 },
      { t: 14.5, lArm: 90, lElbow: 0, rArm: 90, rElbow: 0, sink: 0.55 },
      rest(18, 0.2),
      rest(20),
    ],
  },
  {
    id: 'separate',
    name: 'Separating heaven and earth',
    cue: 'One palm pushes to the sky while the other presses to the earth. Change sides.',
    keys: [
      rest(0),
      rest(1.5),
      { t: 5.5, lArm: 172, lElbow: 12, rArm: 22, rElbow: 8, sink: 0 },
      { t: 7.5, lArm: 172, lElbow: 12, rArm: 22, rElbow: 8, sink: 0 },
      rest(11, 0.45),
      { t: 15, lArm: 22, lElbow: 8, rArm: 172, rElbow: 12, sink: 0 },
      { t: 17, lArm: 22, lElbow: 8, rArm: 172, rElbow: 12, sink: 0 },
      rest(20.5, 0.45),
      rest(22.5),
    ],
  },
  {
    id: 'open-close',
    name: 'Opening and closing',
    cue: 'Arms open wide as you rise, fold back to the belly as you sink.',
    keys: [
      rest(0),
      rest(1.5),
      { t: 4.5, lArm: 75, lElbow: 20, rArm: 75, rElbow: 20, sink: 0 },
      { t: 8, lArm: 25, lElbow: 95, rArm: 25, rElbow: 95, sink: 0.5 },
      { t: 11, lArm: 75, lElbow: 20, rArm: 75, rElbow: 20, sink: 0 },
      { t: 14.5, lArm: 25, lElbow: 95, rArm: 25, rElbow: 95, sink: 0.5 },
      rest(17.5),
      rest(19),
    ],
  },
]

// Body proportions in torso lengths.
const BODY = {
  torso: 0.19,
  shoulderHalf: 0.42,
  hipHalf: 0.22,
  upperArm: 0.72,
  forearm: 0.66,
  thigh: 0.95,
  shin: 0.95,
  head: 0.55,
  stanceHalf: 0.34,
}

export const DEMO_ASPECT = 4 / 3
const GROUND = 0.94

const ease = (u: number) => u * u * (3 - 2 * u)

function sample(keys: BodyKey[], t: number): BodyKey {
  if (t <= keys[0].t) return keys[0]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (t <= b.t) {
      const u = ease((t - a.t) / (b.t - a.t))
      const lerp = (x: number, y: number) => x + (y - x) * u
      return {
        t,
        lArm: lerp(a.lArm, b.lArm),
        lElbow: lerp(a.lElbow, b.lElbow),
        rArm: lerp(a.rArm, b.rArm),
        rElbow: lerp(a.rElbow, b.rElbow),
        sink: lerp(a.sink, b.sink),
      }
    }
  }
  return keys[keys.length - 1]
}

const deg = Math.PI / 180

export function poseAt(k: BodyKey): Pose {
  const T = BODY.torso
  const cx = DEMO_ASPECT / 2
  // Sinking: the thighs come forward, so from the front they look shorter and the knees open a little.
  const thighDrop = BODY.thigh * (1 - 0.45 * k.sink)
  const hipY = GROUND - (thighDrop + BODY.shin) * T
  const shoulderY = hipY - T
  const p = (x: number, y: number): Pt => ({ x, y, v: 1 })

  // side = -1 for the screen-left limb, +1 for the screen-right one.
  const arm = (side: -1 | 1, raise: number, bend: number) => {
    const sx = cx + side * BODY.shoulderHalf * T
    const upper = raise * deg
    const fore = (raise - bend) * deg
    const ex = sx + side * Math.sin(upper) * BODY.upperArm * T
    const ey = shoulderY + Math.cos(upper) * BODY.upperArm * T
    const wx = ex + side * Math.sin(fore) * BODY.forearm * T
    const wy = ey + Math.cos(fore) * BODY.forearm * T
    return [p(sx, shoulderY), p(ex, ey), p(wx, wy)] as const
  }
  const leg = (side: -1 | 1) => {
    const hx = cx + side * BODY.hipHalf * T
    const ax = cx + side * BODY.stanceHalf * T
    const kx = (hx + ax) / 2 + side * 0.12 * k.sink * T
    const ky = hipY + thighDrop * T
    return [p(hx, hipY), p(kx, ky), p(ax, GROUND)] as const
  }
  const [lShoulder, lElbow, lWrist] = arm(-1, k.lArm, k.lElbow)
  const [rShoulder, rElbow, rWrist] = arm(1, k.rArm, k.rElbow)
  const [lHip, lKnee, lAnkle] = leg(-1)
  const [rHip, rKnee, rAnkle] = leg(1)
  return {
    head: p(cx, shoulderY - BODY.head * T),
    lShoulder,
    rShoulder,
    lElbow,
    rElbow,
    lWrist,
    rWrist,
    lHip,
    rHip,
    lKnee,
    rKnee,
    lAnkle,
    rAnkle,
  }
}

export const DEMO_FPS = 30

export function referenceFromMove(move: Move): Reference {
  const end = move.keys[move.keys.length - 1].t
  const poses: Pose[] = []
  for (let i = 0; i <= Math.round(end * DEMO_FPS); i++) poses.push(poseAt(sample(move.keys, i / DEMO_FPS)))
  return buildReference(move.name, DEMO_FPS, DEMO_ASPECT, poses)
}
