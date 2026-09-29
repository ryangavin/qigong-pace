import type { QiFrame } from '../qi'

// Gentle invitations to notice a sensation, offered when the qi model shows
// the state in which practitioners report it (docs/sensations.md). They
// invite and never assert: "notice", "you may feel", a question. Rare by
// design: one at a time, none early in practice or before the move has been
// done through once, each at most once every few
// minutes, and never over other words on the line. Pure logic, no drawing
// and no clock: time only moves by the `dt` it's given.

export type InvitationId = 'palmBall' | 'dantian' | 'rooting' | 'crown' | 'palms' | 'arms' | 'edge'

export interface Invitation {
  id: InvitationId
  text: string
}

/** What the invitations read each frame, besides the qi frame. */
export interface Sense {
  q: QiFrame
  /** Seconds the learner has been still in a hold. */
  holdSec: number
  /** The breath's direction right now: 1 rising / opening, -1 sinking / closing, 0 still. */
  breathDir: number
  standing: boolean
}

interface Entry {
  id: InvitationId
  text: string
  /** Seconds the state must last before the invitation is offered. */
  dwell: number
  when: (s: Sense) => boolean
}

const mean = (a: number, b: number) => (a + b) / 2

/** In priority order: the rarer and more specific states first. */
export const INVITATIONS: readonly Entry[] = [
  {
    id: 'palmBall',
    text: 'Notice the space between your palms. Does it push back, even a little?',
    dwell: 2.5,
    when: (s) => s.q.palmField > 0.6,
  },
  {
    id: 'dantian',
    text: 'As you breathe out, let your attention settle below your navel. You may notice warmth there.',
    dwell: 3,
    when: (s) => s.holdSec > 2 && s.q.regions.dantian > 0.5,
  },
  {
    id: 'rooting',
    text: 'As you sink, notice your weight pouring down through your legs into the ground.',
    dwell: 1,
    when: (s) => s.standing && s.breathDir < -0.3 && mean(s.q.regions.lFoot, s.q.regions.rFoot) > 0.45,
  },
  {
    id: 'crown',
    text: 'As you rise, you may feel the crown of your head lengthen upward, as if lifted by a thread.',
    dwell: 1,
    when: (s) => s.breathDir > 0.3 && s.q.regions.crown > 0.5,
  },
  {
    id: 'arms',
    text: 'As your hands travel out, let your attention travel with them, all the way to the fingertips.',
    dwell: 1,
    when: (s) =>
      s.q.flow > 0.5 &&
      ((s.q.armFlow.l > 0.6 && s.q.regions.lArm > 0.5) || (s.q.armFlow.r > 0.6 && s.q.regions.rArm > 0.5)),
  },
  {
    id: 'palms',
    text: 'Let your attention rest in the centre of your palms. Is there warmth, or tingling? Whatever is there is fine.',
    dwell: 4,
    when: (s) => Math.min(s.q.regions.lPalm, s.q.regions.rPalm) > 0.6,
  },
  {
    id: 'edge',
    text: 'Does the edge of your body feel as clear as when you started?',
    dwell: 6,
    when: (s) => s.q.level > 0.6 && s.q.flow > 0.5,
  },
]

export interface InvitationOptions {
  /** Practice before the first invitation, in seconds. */
  warmupSec: number
  /** How long each stays on the line. */
  showSec: number
  /** The least time before the same invitation is offered again. */
  repeatSec: number
  /** The least time between any two invitations. */
  gapSec: number
  /** Quiet on the line needed before an invitation may start. */
  quietSec: number
}

export const DEFAULT_INVITATION_OPTIONS: InvitationOptions = {
  warmupSec: 30,
  showSec: 11,
  repeatSec: 240,
  gapSec: 50,
  quietSec: 4,
}

export interface InvitationInput {
  q: QiFrame
  dt: number
  /** Practising right now: seen, in step, the move under way. */
  practising: boolean
  inHold: boolean
  standing: boolean
  /**
   * The learner has done the current move through at least once. Until then
   * their attention belongs on the shape, so nothing is offered.
   */
  repeated: boolean
  /** Other words are on the line (a move's cue, a prompt): no invitation shows. */
  busy: boolean
}

export class Invitations {
  /** The invitation on the line now, or null. */
  current: Invitation | null = null
  private clock = 0
  private practised = 0
  private quiet = 0
  private holdSec = 0
  private breathDir = 0
  private lastBreath: number | null = null
  private shownFor = 0
  private lastEnd = -Infinity
  private lastShown = new Map<InvitationId, number>()
  private dwell = new Map<InvitationId, number>()

  constructor(private opts: InvitationOptions = DEFAULT_INVITATION_OPTIONS) {}

  update({ q, dt, practising, inHold, standing, repeated, busy }: InvitationInput): Invitation | null {
    const o = this.opts
    this.clock += dt
    if (practising) this.practised += dt
    this.quiet = busy ? 0 : this.quiet + dt
    this.holdSec = practising && inHold ? this.holdSec + dt : 0
    // The breath's direction, eased: its rate over about half a second, where
    // a whole opening (-1 to 1) in four seconds reads as fully rising.
    if (this.lastBreath !== null && dt > 0) {
      const rate = (q.breath - this.lastBreath) / dt / 0.5
      this.breathDir += (Math.max(-1, Math.min(1, rate)) - this.breathDir) * (1 - Math.exp(-dt / 0.5))
    }
    this.lastBreath = q.breath

    const sense: Sense = { q, holdSec: this.holdSec, breathDir: this.breathDir, standing }
    for (const e of INVITATIONS) this.dwell.set(e.id, practising && e.when(sense) ? (this.dwell.get(e.id) ?? 0) + dt : 0)

    if (this.current) {
      this.shownFor += dt
      if (busy || !practising || this.shownFor >= o.showSec) {
        this.current = null
        this.lastEnd = this.clock
      }
      return this.current
    }
    if (busy || !practising || !repeated || this.practised < o.warmupSec || this.quiet < o.quietSec) return null
    if (this.clock - this.lastEnd < o.gapSec) return null
    for (const e of INVITATIONS) {
      if ((this.dwell.get(e.id) ?? 0) < e.dwell) continue
      if (this.clock - (this.lastShown.get(e.id) ?? -Infinity) < o.repeatSec) continue
      this.current = { id: e.id, text: e.text }
      this.lastShown.set(e.id, this.clock)
      this.shownFor = 0
      return this.current
    }
    return null
  }
}
