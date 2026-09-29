import type { View } from '../skeleton'

// The qi model's output, as the energy layer reads it. Declared here with the
// same names and shapes as the model in `src/qi/`, so the two can be unified.

export type QiRegion = 'dantian' | 'lPalm' | 'rPalm' | 'lArm' | 'rArm' | 'spine' | 'crown' | 'lFoot' | 'rFoot'

export const QI_REGIONS: readonly QiRegion[] = [
  'dantian',
  'lPalm',
  'rPalm',
  'lArm',
  'rArm',
  'spine',
  'crown',
  'lFoot',
  'rFoot',
]

export interface QiFrame {
  /** Overall qi this session, 0..1 (builds over minutes). */
  level: number
  /** -1 exhale/closing .. 1 inhale/opening. */
  breath: number
  /** Per-region charge, 0..1. */
  regions: Record<QiRegion, number>
  /** 0..1 field between facing palms. */
  palmField: number
  /** 0..1 moving smoothly in step right now. */
  flow: number
  /** 1 toward the fingertips, -1 toward the body, 0 still. */
  armFlow: { l: number; r: number }
}

export const quietFrame = (): QiFrame => ({
  level: 0,
  breath: 0,
  regions: { dantian: 0, lPalm: 0, rPalm: 0, lArm: 0, rArm: 0, spine: 0, crown: 0, lFoot: 0, rFoot: 0 },
  palmField: 0,
  flow: 0,
  armFlow: { l: 0, r: 0 },
})

/**
 * Where the learner's image sits on the energy canvas, in the canvas's CSS
 * pixels: `{ ...containView(cssW, cssH, aspect), aspect }` for a contained image.
 */
export interface EnergyView extends View {
  /** Width / height of the image the pose (and any mask) came from. */
  aspect: number
}
