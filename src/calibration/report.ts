import { inPosture, TYPICAL_BODY } from '../fit'
import { DEFAULT_OPTIONS } from '../follower'
import type { Joint, Posture } from '../skeleton'
import { auditMoves, type Audit, type AuditSpan } from './audit'
import { measure, type Measurements } from './measure'
import type { CalibrationRecording, RecordedTask } from './recording'
import { taskById } from './tasks'

// The calibration file the owner downloads and sends to the developers: a
// readable header, the plain-words summary, the measurements and the
// reachability audit, then each task's raw recording (one detection per line).

export const CALIBRATION_FORMAT = 'qigong-pace-calibration'
export const CALIBRATION_VERSION = 1

export interface CalibrationHead {
  /** When it was recorded, as an ISO date. */
  recordedAt: string
  posture: Posture
  /** Width / height of the camera image the landmarks are normalised to. */
  aspect: number
  /** The camera, or the simulated learner (`?sim`). */
  source: 'camera' | 'sim'
  /** The pose model (`?model=`). */
  model: string
  /** What the browser says of the camera, without asking for more permissions. */
  camera?: Record<string, string | number | boolean>
  /** And of the device and the window. */
  device?: Record<string, string | number | boolean>
  /** The simulated learner's settings, when it was one. */
  sim?: Record<string, number>
}

export interface CalibrationFile extends CalibrationHead {
  format: typeof CALIBRATION_FORMAT
  version: number
  summary: string[]
  measurements: Measurements
  audit: Audit | null
  tasks: RecordedTask[]
}

/** Measure a calibration's recording, audit the moves against it, and put it in words. */
export function buildCalibration(head: CalibrationHead, recording: CalibrationRecording): CalibrationFile {
  // Measured with the aspect as the file keeps it, so the file measures the same again.
  const rec = { ...recording, aspect: Math.round(recording.aspect * 1e4) / 1e4 }
  const measurements = measure(rec)
  const audit = auditOf(measurements, rec)
  return {
    format: CALIBRATION_FORMAT,
    version: CALIBRATION_VERSION,
    ...head,
    aspect: rec.aspect,
    posture: rec.posture,
    summary: describe(measurements, audit, rec),
    measurements,
    audit,
    tasks: rec.tasks,
  }
}

export function auditOf(m: Measurements, rec: CalibrationRecording): Audit | null {
  if (!m.still) return null
  return auditMoves({
    posture: rec.posture,
    aspect: rec.aspect,
    body: m.body,
    anchor: m.still,
    envelope: m.envelope,
    arm: m.arm,
  })
}

/** The recording inside a file, to measure again. */
export const recordingOf = (f: CalibrationFile): CalibrationRecording => ({
  posture: f.posture,
  aspect: f.aspect,
  tasks: f.tasks,
})

// Numbers to four places: plenty, and the file stays small.
function rounded(this: unknown, _key: string, value: unknown) {
  return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1e4) / 1e4 : value
}

/** The file as JSON: everything readable up top, then the recordings, one detection per line. */
export function serializeCalibration(f: CalibrationFile): string {
  const { tasks, ...head } = f
  const top = JSON.stringify(head, rounded, 1)
  const body = tasks.map(({ frames, ...rest }) => {
    const t = JSON.stringify(rest, rounded)
    const list = frames.length ? `[\n${frames.map((fr) => `   ${JSON.stringify(fr)}`).join(',\n')}\n  ]` : '[]'
    return `  ${t.slice(0, -1)}, "frames": ${list}}`
  })
  return `${top.slice(0, -2)},\n "tasks": [\n${body.join(',\n')}\n ]\n}\n`
}

export function parseCalibration(text: string): CalibrationFile {
  let f: Partial<CalibrationFile>
  try {
    f = JSON.parse(text)
  } catch {
    throw new Error('That file is not a calibration (it is not JSON).')
  }
  if (f?.format !== CALIBRATION_FORMAT || !Array.isArray(f.tasks)) throw new Error('That file is not a calibration.')
  if ((f.version ?? 0) > CALIBRATION_VERSION) throw new Error('That calibration was made by a newer version of the app.')
  return f as CalibrationFile
}

/** `qigong-calibration-<date>-<time>.json`. */
export function calibrationFileName(f: Pick<CalibrationFile, 'recordedAt'>): string {
  const d = new Date(f.recordedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `qigong-calibration-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}

// ---- In plain words ------------------------------------------------------------

const JOINT_WORDS: Partial<Record<Joint, string>> = {
  head: 'head',
  lShoulder: 'left shoulder',
  rShoulder: 'right shoulder',
  lElbow: 'left elbow',
  rElbow: 'right elbow',
  lWrist: 'left hand',
  rWrist: 'right hand',
  lHip: 'left hip',
  rHip: 'right hip',
  lKnee: 'left knee',
  rKnee: 'right knee',
  lAnkle: 'left foot',
  rAnkle: 'right foot',
}

const EDGE_WORDS = { top: 'above the picture', bottom: 'below the picture', left: 'off the left of the picture', right: 'off the right of the picture' }

const n2 = (x: number) => x.toFixed(2)
const pct = (x: number) => `${Math.round(x * 100)}%`
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const titleOf = (id: string) => taskById(id)?.title ?? id

/** The first moment in a move a light can't be reached, in words: both lights when the other hand's goes the same way then. */
function firstTrouble(spans: AuditSpan[]): string {
  const s = spans.reduce((a, b) => (b.from < a.from ? b : a))
  // Beyond reach, the two hands point opposite ways; out of the picture, they must leave by the same edge.
  const same = (o: AuditSpan) => o.why === s.why && (s.why === 'reach' || o.where === s.where)
  const both = spans.some((o) => o.hand !== s.hand && same(o) && Math.abs(o.from - s.from) < 1)
  const where = s.why === 'frame' ? EDGE_WORDS[s.where as keyof typeof EDGE_WORDS] : 'beyond your reach'
  const which = both ? 'both lights are' : `the ${s.hand === 'l' ? 'left' : 'right'} light is`
  return `at ${Math.round(s.from)} s ${which} ${where}`
}

/**
 * What the calibration found, in a few plain sentences. Left and right are as
 * the learner sees themselves on screen.
 */
export function describe(m: Measurements, audit: Audit | null, rec: Pick<CalibrationRecording, 'posture' | 'aspect'>): string[] {
  const out: string[] = []
  const standing = rec.posture === 'standing'
  const unit = standing ? 'torso lengths' : 'body lengths'
  const done = m.tasks.filter((t) => t.status === 'done')
  const skipped = m.tasks.filter((t) => t.status === 'skipped')
  if (!done.length) return ['Every task was skipped, so there is nothing to measure.']
  out.push(
    `Measured over ${done.length} task${done.length === 1 ? '' : 's'}${skipped.length ? `; skipped: ${list(skipped.map((t) => titleOf(t.id)))}` : ''}. Left and right are as you see yourself on screen.`,
  )

  const typical = inPosture(TYPICAL_BODY, rec.posture)
  const typicalArm = typical.upperArm + typical.forearm + typical.hand
  out.push(
    `Your arms measure ${n2(m.arm)} ${unit} from shoulder to palm (typically about ${n2(typicalArm)}), and your shoulders ${n2(m.body.shoulders)} across (typically ${n2(typical.shoulders)}).`,
  )

  const f = m.framing
  if (f) {
    const feet = f.cropped.filter((j) => /Ankle|Knee/.test(j))
    const upper = f.cropped.filter((j) => !/Ankle|Knee|Hip/.test(j))
    if (upper.length) out.push(`Held still, the camera couldn't see your ${list(upper.map((j) => JOINT_WORDS[j] ?? j))}.`)
    if (standing && feet.length) out.push(`Your legs are cut off at the bottom of the picture: stepping back would bring your whole body in.`)
    else out.push(`Held still, you fill ${pct(f.height)} of the picture's height, ${Math.abs(f.centre - 0.5) < 0.08 ? 'near the middle' : f.centre < 0.5 ? 'left of the middle' : 'right of the middle'}.`)
    out.push(
      `There are ${n2(f.headroom)} ${unit} of picture above your shoulders; raised overhead, your hands need about ${n2(m.arm)}.`,
    )
  }

  const hl = m.handsLeave
  const lostSides = hl.left + hl.right
  if (hl.top) {
    out.push(
      hl.topAbove !== null
        ? `Your hands leave the top of the picture when raised more than about ${n2(Math.max(0, hl.topAbove))} ${unit} above your shoulders.`
        : `Your hands left the top of the picture ${hl.top} time${hl.top === 1 ? '' : 's'}.`,
    )
  }
  if (lostSides) out.push(`Your hands left the sides of the picture ${lostSides} time${lostSides === 1 ? '' : 's'}.`)
  if (!hl.top && !lostSides && !hl.bottom) out.push('Your hands stayed in the picture throughout.')

  const oh = m.overhead
  if (oh?.aboveShoulders != null) {
    const unseen = oh.inFrame < 0.5 ? ' as far as the camera could see' : ''
    out.push(`Reaching up, your palms rose ${n2(oh.aboveShoulders)} ${unit} above your shoulders${unseen}.`)
  } else if (oh) out.push("Reaching up, your palms were out of the camera's sight.")
  if (m.span) out.push(`Arms out, your palms spanned ${n2(m.span.torso)} ${unit}, ${pct(m.span.frame / rec.aspect)} of the picture's width.`)

  const forward = m.tasks.find((t) => t.id === 'forward')?.detail.foreshortening
  if (forward !== undefined) out.push(`Reaching toward the camera, your arms look ${pct(forward)} of their length.`)
  const knees = m.tasks.find((t) => t.id === 'knees')?.detail.hipDrop
  if (knees !== undefined) out.push(`Bending your knees lowered your hips by ${n2(knees)} ${unit}.`)

  if (m.jitter) {
    out.push(
      `Held still, the tracking shivers by about ${pct1(m.jitter.rawTorso)} of a ${unit.slice(0, -1)} (${pct1(m.jitter.filteredTorso)} after smoothing).`,
    )
  }
  if (m.lag) out.push(`Moving slowly, the smoothing trails your hands by about ${Math.round(m.lag.ms)} ms.`)

  // The joints the camera lost most.
  const lost = (Object.entries(m.joints) as [Joint, (typeof m.joints)[Joint]][])
    .filter(([j, s]) => JOINT_WORDS[j] && s.drops > 0 && (standing || !/Hip|Knee|Ankle/.test(j)))
    .sort((a, b) => b[1].drops - a[1].drops)
    .slice(0, 3)
  if (lost.length) {
    const words = lost.map(([j, s]) => {
      const edges = s.at.map((a) => a[2])
      const most = (['top', 'bottom', 'left', 'right', 'inside'] as const)
        .map((e) => [e, edges.filter((x) => x === e).length] as const)
        .sort((a, b) => b[1] - a[1])[0]
      const where = most && most[1] ? (most[0] === 'inside' ? 'inside the picture' : `at the ${most[0]} edge`) : ''
      return `your ${JOINT_WORDS[j]} ${s.drops} time${s.drops === 1 ? '' : 's'}${where ? ` (mostly ${where})` : ''}`
    })
    out.push(`The camera lost ${list(words)}.`)
  }

  const rejected = m.detection.rejected
  if (rejected) {
    const worst = [...done].sort((a, b) => b.rejected - a.rejected)[0]
    out.push(
      `The tracker muddled your body ${rejected} time${rejected === 1 ? '' : 's'} for a moment (most in ${titleOf(worst.id)}); those were passed over.`,
    )
  }

  const threshold = DEFAULT_OPTIONS.matchThreshold
  const off = done.filter((t) => t.match && !t.id.match(/circles|water/) && (t.match.distance === null || t.match.distance > threshold))
  if (off.length) out.push(`These shapes didn't read as asked: ${list(off.map((t) => titleOf(t.id)))}.`)
  const times = done.flatMap((t) => (t.settledAfter !== null && t.id !== 'still' ? [t.settledAfter] : []))
  if (times.length) out.push(`You settled into each shape about ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)} s after it was asked.`)

  if (audit) {
    const n = audit.offenders.length
    if (!n) out.push(`All ${audit.checked} ${rec.posture} moves keep their lights within your reach and inside the picture.`)
    else {
      const names = audit.offenders.map((o) => `${o.name} (${firstTrouble(o.spans)})`)
      out.push(`${n} of ${audit.checked} moves ha${n === 1 ? 's' : 've'} lights you can't reach: ${names.join(', ')}.`)
    }
  }
  return out
}
