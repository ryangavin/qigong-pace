import { fitOnto, type Proportions } from '../fit'
import { fitReference } from '../follower'
import { DEMO_MOVES, referenceFromMove } from '../moves'
import { bodyScale, type Pose, type Posture, type Pt } from '../skeleton'
import { sectorOf, type Edge } from './measure'

// The reachability audit: every built-in move for the learner's posture,
// fitted to their measured body and laid on them as they stood still (as the
// primary view lays it, `fitOnto`), checked for lights (the palm beads) that
// fall outside the camera's picture or beyond how far the learner was seen to
// reach in that direction.

/** A light this far (torso lengths) past the measured reach counts as out of reach. */
export const REACH_TOLERANCE = 0.1
/** Frames apart that two stretches of the same trouble are still one. */
const JOIN = 3

export interface AuditSpan {
  /** Seconds into the move. */
  from: number
  to: number
  /** The screen-left or screen-right hand's light. */
  hand: 'l' | 'r'
  /** Outside the picture, or beyond the measured reach. */
  why: 'frame' | 'reach'
  /** Which edge it crosses (for `frame`), or which way from the shoulder it points (degrees clockwise from up, for `reach`). */
  where: Exclude<Edge, 'inside'> | number
  /** How far out at worst: frame heights past the edge, or torso lengths past the reach. */
  by: number
}

export interface MoveAudit {
  id: string
  name: string
  spans: AuditSpan[]
}

export interface Audit {
  posture: Posture
  /** How many moves were checked. */
  checked: number
  /** The moves with an unreachable light, in the move list's order. */
  offenders: MoveAudit[]
}

export interface AuditInput {
  posture: Posture
  /** Width / height of the camera image. */
  aspect: number
  /** The learner's measured proportions. */
  body: Proportions
  /** The learner as they stood (or sat) still, in image units. */
  anchor: Pose
  /** How far each palm reached from its shoulder in each sector, torso lengths (`Envelope`); null where not seen. */
  envelope: { l: (number | null)[]; r: (number | null)[] }
  /** Shoulder to palm, torso lengths: the reach wherever the envelope has nothing. */
  arm: number
}

function outside(p: Pt, aspect: number): { where: AuditSpan['where']; by: number } | null {
  const over: [Exclude<Edge, 'inside'>, number][] = [
    ['top', -p.y],
    ['bottom', p.y - 1],
    ['left', -p.x],
    ['right', p.x - aspect],
  ]
  over.sort((a, b) => b[1] - a[1])
  return over[0][1] > 0 ? { where: over[0][0], by: over[0][1] } : null
}

/** Check each built-in move for `posture` against the learner's body, reach and picture. */
export function auditMoves(input: AuditInput): Audit {
  const { posture, aspect, body, anchor, envelope, arm } = input
  const unit = bodyScale(anchor, posture)
  const moves = DEMO_MOVES.filter((m) => m.postures.includes(posture))
  const offenders: MoveAudit[] = []
  for (const move of moves) {
    const ref = fitReference(referenceFromMove(move, posture), body)
    // The learner follows the teacher, so the move is laid on them once, from its opening shape.
    const place = fitOnto(ref.poses[0], anchor, posture)
    const spans: AuditSpan[] = []
    const open: Partial<Record<string, { span: AuditSpan; last: number }>> = {}
    ref.poses.forEach((teacher, i) => {
      const p = place(teacher)
      for (const hand of ['l', 'r'] as const) {
        const palm = p[`${hand}Palm`]
        const sh = p[`${hand}Shoulder`]
        const off = outside(palm, aspect)
        let trouble: Pick<AuditSpan, 'why' | 'where' | 'by'> | null = off ? { why: 'frame', ...off } : null
        if (!trouble) {
          const sector = sectorOf(sh, palm)
          const reach = envelope[hand][sector] ?? arm
          const d = Math.hypot(palm.x - sh.x, palm.y - sh.y) / unit
          if (d > reach + REACH_TOLERANCE) trouble = { why: 'reach', where: sector * (360 / envelope[hand].length), by: d - reach }
        }
        if (!trouble) continue
        const key = `${hand}${trouble.why}`
        const t = i / ref.fps
        const o = open[key]
        if (o && i - o.last <= JOIN) {
          o.span.to = t
          o.span.by = Math.max(o.span.by, trouble.by)
          o.last = i
        } else {
          const span = { from: t, to: t, hand, ...trouble }
          spans.push(span)
          open[key] = { span, last: i }
        }
      }
    })
    if (spans.length) offenders.push({ id: move.id, name: move.name, spans })
  }
  return { posture, checked: moves.length, offenders }
}
