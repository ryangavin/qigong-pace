import { inPosture, retarget, type Proportions } from '../fit'
import { FIGURE_BODY, poseAt, type BodyKey } from '../moves'
import type { Pose, Posture, Pt } from '../skeleton'

// The calibration's reference tasks: simple shapes anyone can make without
// knowing qi gong, each held (or moved through) for a few seconds while the
// camera watches. What they measure is in `measure.ts`.

export const TASK_IDS = ['still', 'overhead', 'sides', 'palms', 'belly', 'forward', 'knees', 'circles', 'water'] as const
export type TaskId = (typeof TASK_IDS)[number]

/**
 * A shape, as the built-in figure makes it (front on). The figure can't show
 * a limb reaching toward the camera, so `upper` and `lower` shorten the upper
 * arms and the forearms (with the hands) to that share of their length, as the
 * camera would see them foreshortened.
 */
export interface TaskShape {
  key: Omit<BodyKey, 't'>
  upper?: number
  lower?: number
}

export interface CalibrationTask {
  id: TaskId
  /** A short name, for the summary. */
  title: string
  /** What the learner is asked, spoken-style. */
  prompt: Record<Posture, string>
  postures: Posture[]
  /** Seconds of capture once the learner has settled. */
  captureSec: number
  /** The shape asked for at `t` seconds into the capture (the same throughout, unless the task moves). */
  shape: (t: number, posture: Posture) => TaskShape
  /** The task asks for movement rather than a held shape. */
  moving: boolean
  /** How closely the learner matched the shape is worth measuring (not for the knees, whose depth is their own). */
  matched: boolean
  /** The learner reaches as far as they can here, so the reach envelope is taken from it. */
  reach: boolean
  /** Words that replace the prompt partway through the capture. */
  cues?: { at: number; text: string }[]
}

/** Seconds the prompt is shown before the countdown. */
export const PROMPT_SEC = 2.5
/** Seconds of countdown to settle into the shape. */
export const SETTLE_SEC = 3

const BOTH: Posture[] = ['standing', 'seated']
const still = (key: Omit<BodyKey, 't'>, upper?: number, lower?: number) => (): TaskShape => ({ key, upper, lower })

/** Seconds per arm circle. */
const CIRCLE_SEC = 4
/** Seconds of one slow rise and fall through water. */
const WATER_SEC = 10

export const TASKS: CalibrationTask[] = [
  {
    id: 'still',
    title: 'Standing still',
    prompt: {
      standing: 'Stand easily, arms hanging at your sides, and be still for a few breaths.',
      seated: 'Sit easily, hands resting in your lap, and be still for a few breaths.',
    },
    postures: BOTH,
    captureSec: 5,
    shape: (_, posture) => (posture === 'seated' ? { key: { lArm: 10, lElbow: 60, rArm: 10, rElbow: 60, sink: 0 }, lower: 0.6 } : { key: { lArm: 8, lElbow: 4, rArm: 8, rElbow: 4, sink: 0 } }),
    moving: false,
    matched: true,
    reach: true,
  },
  {
    id: 'overhead',
    title: 'Hands overhead',
    prompt: {
      standing: 'Reach both hands straight up over your head, as high as is comfortable.',
      seated: 'Reach both hands straight up over your head, as high as is comfortable.',
    },
    postures: BOTH,
    captureSec: 4,
    shape: still({ lArm: 178, lElbow: 0, rArm: 178, rElbow: 0, sink: 0 }),
    moving: false,
    matched: true,
    reach: true,
  },
  {
    id: 'sides',
    title: 'Arms out to the sides',
    prompt: {
      standing: 'Open both arms wide to the sides at shoulder height, palms down.',
      seated: 'Open both arms wide to the sides at shoulder height, palms down.',
    },
    postures: BOTH,
    captureSec: 4,
    shape: still({ lArm: 90, lElbow: 0, rArm: 90, rElbow: 0, sink: 0 }),
    moving: false,
    matched: true,
    reach: true,
  },
  {
    id: 'palms',
    title: 'Palms together',
    prompt: {
      standing: 'Bring your palms together in front of your chest, as if in greeting.',
      seated: 'Bring your palms together in front of your chest, as if in greeting.',
    },
    postures: BOTH,
    captureSec: 4,
    shape: still({ lArm: 25, lElbow: 145, rArm: 25, rElbow: 145, sink: 0 }, 1, 0.8),
    moving: false,
    matched: true,
    reach: false,
  },
  {
    id: 'belly',
    title: 'Hands on the belly',
    prompt: {
      standing: 'Rest both hands on your belly, just below the navel.',
      seated: 'Rest both hands on your belly, just below the navel.',
    },
    postures: BOTH,
    captureSec: 4,
    shape: still({ lArm: 8, lElbow: 80, rArm: 8, rElbow: 80, sink: 0 }, 1, 0.6),
    moving: false,
    matched: true,
    reach: false,
  },
  {
    id: 'forward',
    title: 'Arms reaching forward',
    prompt: {
      standing: 'Reach both arms straight out in front of you at shoulder height, toward the camera.',
      seated: 'Reach both arms straight out in front of you at shoulder height, toward the camera.',
    },
    postures: BOTH,
    captureSec: 4,
    shape: still({ lArm: 0, lElbow: 0, rArm: 0, rElbow: 0, sink: 0 }, 0.12, 0.12),
    moving: false,
    matched: true,
    reach: false,
  },
  {
    id: 'knees',
    title: 'Knees bent',
    prompt: {
      standing: 'Keep your back upright and bend your knees as far as is comfortable. Rest there.',
      seated: '',
    },
    postures: ['standing'],
    captureSec: 4,
    shape: still({ lArm: 8, lElbow: 4, rArm: 8, rElbow: 4, sink: 0.6 }),
    moving: false,
    matched: false,
    reach: false,
  },
  {
    id: 'circles',
    title: 'Arm circles',
    prompt: {
      standing: 'Draw big, slow circles with both arms: out to the sides, over your head, and down.',
      seated: 'Draw big, slow circles with both arms: out to the sides, over your head, and down.',
    },
    postures: BOTH,
    captureSec: 4 * CIRCLE_SEC,
    shape: (t) => {
      // Two circles one way, then two the other, from hanging.
      const half = 2 * CIRCLE_SEC
      const turn = t < half ? t / CIRCLE_SEC : -(t - half) / CIRCLE_SEC
      const a = ((turn * 360) % 360 + 360) % 360
      return { key: { lArm: a, lElbow: 0, rArm: a, rElbow: 0, sink: 0 } }
    },
    moving: true,
    matched: true,
    reach: true,
    cues: [{ at: 2 * CIRCLE_SEC, text: 'Now circle the other way.' }],
  },
  {
    id: 'water',
    title: 'Moving through water',
    prompt: {
      standing: 'Move slowly, as if through water: let your arms float up, and drift down again.',
      seated: 'Move slowly, as if through water: let your arms float up, and drift down again.',
    },
    postures: BOTH,
    captureSec: WATER_SEC,
    shape: (t) => {
      const u = (1 - Math.cos((2 * Math.PI * t) / WATER_SEC)) / 2
      const w = (1 - Math.cos((2 * Math.PI * (t - 1)) / WATER_SEC)) / 2
      return { key: { lArm: 15 + 75 * u, lElbow: 20 + 40 * u, rArm: 15 + 70 * w, rElbow: 20 + 40 * w, sink: 0.15 * u } }
    },
    moving: true,
    matched: true,
    reach: false,
  },
]

export const taskById = (id: string) => TASKS.find((t) => t.id === id)

/** The tasks for a posture, in order. */
export const tasksFor = (posture: Posture) => TASKS.filter((t) => t.postures.includes(posture))

/** The figure's proportions in `posture`'s body lengths. */
export const figureBody = (posture: Posture) => inPosture(FIGURE_BODY, posture)

const toward = (from: Pt, to: Pt, start: Pt, k: number): Pt => ({
  x: start.x + (to.x - from.x) * k,
  y: start.y + (to.y - from.y) * k,
  v: to.v,
})

/** The figure making `shape`, with its arms foreshortened as asked. */
export function shapePose(shape: TaskShape, posture: Posture): Pose {
  const p = poseAt({ t: 0, ...shape.key }, posture)
  const upper = shape.upper ?? 1
  const lower = shape.lower ?? 1
  if (upper === 1 && lower === 1) return p
  const out = { ...p }
  for (const s of ['l', 'r'] as const) {
    const elbow = toward(p[`${s}Shoulder`], p[`${s}Elbow`], p[`${s}Shoulder`], upper)
    const wrist = toward(p[`${s}Elbow`], p[`${s}Wrist`], elbow, lower)
    out[`${s}Elbow`] = elbow
    out[`${s}Wrist`] = wrist
    out[`${s}Palm`] = toward(p[`${s}Wrist`], p[`${s}Palm`], wrist, lower)
  }
  return out
}

/** `shape` made by a body of proportions `body` (in `posture`'s body lengths), where the figure would stand. */
export function shapeOn(shape: TaskShape, body: Proportions, posture: Posture): Pose {
  return retarget(shapePose(shape, posture), figureBody(posture), body, posture)
}
