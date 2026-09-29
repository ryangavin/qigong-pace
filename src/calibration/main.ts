import { BodyFit, fitOnto } from '../fit'
import { eachVideoFrame, modelFromParams, openCamera, PoseTracker } from '../pose'
import { loadPosture, savePosture } from '../prefs'
import { drawBackdrop, fitCanvas } from '../primary/backdrop'
import { Guidance } from '../primary/guidance'
import { TrackingHints } from '../primary/tracking'
import type { RawLandmark } from '../session'
import { coverView, JOINTS, poseFromLandmarks, type Pose, type Posture, type Pt } from '../skeleton'
import { LandmarkFilter } from '../smoothing'
import { skippedTask, TaskTake, type RecordedTask } from './recording'
import { buildCalibration, calibrationFileName, serializeCalibration, type CalibrationFile, type CalibrationHead } from './report'
import { CalibrationSim, simFromParams } from './sim'
import { PROMPT_SEC, SETTLE_SEC, shapeOn, tasksFor, type CalibrationTask, type TaskId } from './tasks'

// The calibration page: a few simple shapes, each asked in words and shown in
// light over the learner's own mirrored body, a countdown to settle, then a few
// seconds of capture. At the end it measures what it saw, audits the moves
// against it, says what it found and downloads the file for the developers.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const params = new URLSearchParams(location.search)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// ?sim does the calibration with a simulated learner; ?arms=, ?shoulders=, ?zoom= and ?reach= shape it.
const simOpts = params.has('sim') ? simFromParams(params) : null
const sim = simOpts ? new CalibrationSim(simOpts) : null

let posture: Posture = loadPosture()
let tasks: CalibrationTask[] = tasksFor(posture)

// ---- The learner ---------------------------------------------------------------

type Source = 'none' | 'camera' | 'sim'
let source: Source = 'none'
const cam = $<HTMLVideoElement>('cam')
let stream: MediaStream | null = null
let tracker: PoseTracker | null = null
let stopFrames: (() => void) | null = null
const smoother = new LandmarkFilter()
let fit = new BodyFit(posture)
let learner: Pose | null = null
/** The learner eased a little, so the light laid on them doesn't shiver. */
let calm: Pose | null = null

const aspectNow = () => (source === 'camera' ? cam.videoWidth / cam.videoHeight || 16 / 9 : (sim?.aspect ?? 16 / 9))

async function startCamera() {
  const err = $('cameraError')
  err.hidden = true
  const button = $('begin')
  button.textContent = 'Loading pose tracker…'
  try {
    stream = await openCamera()
    cam.srcObject = stream
    await cam.play()
    tracker ??= await PoseTracker.create({ flipX: true, model: modelFromParams(params) })
    stopFrames ??= eachVideoFrame(cam, (t) => {
      if (tracker) takeLandmarks(tracker.detect(cam, t), t)
    })
    source = 'camera'
    cam.hidden = false
    begin()
  } catch (e) {
    err.textContent = e instanceof Error ? e.message : String(e)
    err.hidden = false
  } finally {
    button.textContent = 'Begin'
  }
}

function stopCamera() {
  for (const t of stream?.getTracks() ?? []) t.stop()
  stopFrames?.()
  stopFrames = null
}

/** One detection's raw landmarks: recorded as they are, then steadied and read as the learner. */
function takeLandmarks(raw: RawLandmark[] | null, timeMs: number) {
  advance(timeMs)
  take?.add(raw, timeMs)
  const lm = smoother.update(raw, timeMs)
  learner = lm ? poseFromLandmarks(lm, { aspect: aspectNow(), flipX: true, facingAway: false }) : null
}

function easeLearner(dt: number) {
  if (!learner) {
    calm = null
    return
  }
  if (!calm) {
    calm = learner
    return
  }
  const k = 1 - Math.exp(-dt / 0.08)
  const next = {} as Pose
  for (const j of JOINTS) {
    const a = calm[j]
    const b = learner[j]
    next[j] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, v: b.v }
  }
  calm = next
}

// ---- The tasks -------------------------------------------------------------------

type State = 'intro' | 'running' | 'done'
let state: State = 'intro'
let index = 0
type Phase = 'prompt' | 'settle' | 'capture'
let phase: Phase = 'prompt'
/** When the current task's prompt appeared (ms, performance clock). */
let taskStart = 0
let take: TaskTake | null = null
const results = new Map<TaskId, RecordedTask>()
const attempts = new Map<TaskId, number>()
let file: CalibrationFile | null = null

const current = () => tasks[index]

function begin() {
  state = 'running'
  results.clear()
  attempts.clear()
  fit = new BodyFit(posture)
  smoother.reset()
  hints.reset()
  $('intro').hidden = true
  $('done').hidden = true
  for (const id of ['finish', 'back', 'again', 'skip']) $(id).hidden = false
  $('backdrop').hidden = source !== 'sim'
  startTask(0)
}

/** Start task `i` at `at` (ms, performance clock): now, or when the one before ended. */
function startTask(i: number, at = performance.now()) {
  index = i
  if (index >= tasks.length) return finish()
  const task = current()
  const n = (attempts.get(task.id) ?? 0) + 1
  attempts.set(task.id, n)
  taskStart = at
  take = new TaskTake(task.id, taskStart, n)
  phase = 'prompt'
  $('step').textContent = `${task.title} · ${index + 1} of ${tasks.length}`
  say(task.prompt[posture])
  $<HTMLButtonElement>('back').disabled = index === 0
}

/**
 * Move the task through its phases, on schedule; `now` on the performance
 * clock. Called with each detection and each display frame, so a detection is
 * always recorded in the phase (and the task) it belongs to.
 */
function advance(now: number) {
  if (state !== 'running' || !take) return
  const task = current()
  const settleAt = taskStart + PROMPT_SEC * 1000
  const captureAt = settleAt + SETTLE_SEC * 1000
  const endAt = captureAt + task.captureSec * 1000
  if (phase === 'prompt' && now >= settleAt) {
    phase = 'settle'
    take.settling(settleAt)
  }
  if (phase === 'settle' && now >= captureAt) {
    phase = 'capture'
    take.capturing(captureAt)
  }
  if (phase !== 'capture') return
  if (now >= endAt) {
    results.set(task.id, take.finish(endAt))
    take = null
    startTask(index + 1, endAt)
    return
  }
  const c = (now - captureAt) / 1000
  const cue = [...(task.cues ?? [])].reverse().find((q) => c >= q.at)
  say(cue?.text ?? task.prompt[posture])
}

function skip() {
  if (state !== 'running') return
  const task = current()
  take = null
  results.set(task.id, skippedTask(task.id, attempts.get(task.id) ?? 0))
  startTask(index + 1)
}

/** Begin the current task again, or go back to the one before. */
function redo(back: boolean) {
  if (state !== 'running') return
  take = null
  startTask(Math.max(0, index - (back ? 1 : 0)))
}

/** Measure what was done (tasks not reached count as skipped), say what was found and download the file. */
function finish() {
  take = null
  state = 'done'
  const recorded = tasks.map((t) => results.get(t.id) ?? skippedTask(t.id, attempts.get(t.id) ?? 0))
  file = buildCalibration(headNow(), { posture, aspect: aspectNow(), tasks: recorded })
  stopCamera()
  say('')
  showHint('')
  $('step').textContent = ''
  $('progress').style.transform = 'scaleX(0)'
  for (const id of ['finish', 'back', 'again', 'skip']) $(id).hidden = true
  const list = $('summary')
  list.innerHTML = ''
  for (const s of file.summary) {
    const li = document.createElement('li')
    li.textContent = s
    list.append(li)
  }
  $('done').hidden = false
  download()
}

function download() {
  if (!file) return
  const name = calibrationFileName(file)
  const url = URL.createObjectURL(new Blob([serializeCalibration(file)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  $('saved').textContent = `${name} is in your downloads. Send it to the developers; it holds only the tracked points of your body and what was measured from them.`
}

/** What can be said of the camera and the device without asking for more permissions. */
function headNow(): CalibrationHead {
  const head: CalibrationHead = {
    recordedAt: new Date().toISOString(),
    posture,
    aspect: aspectNow(),
    source: source === 'sim' ? 'sim' : 'camera',
    model: modelFromParams(params),
  }
  const track = stream?.getVideoTracks()[0]
  if (track) {
    const s = track.getSettings() as Record<string, string | number | boolean | undefined>
    head.camera = { label: track.label }
    for (const k of ['width', 'height', 'frameRate', 'aspectRatio', 'facingMode', 'resizeMode'] as const) {
      const v = s[k]
      if (v !== undefined) head.camera[k] = v
    }
  }
  const nav = navigator as Navigator & { deviceMemory?: number }
  head.device = {
    userAgent: nav.userAgent,
    platform: nav.platform,
    cores: nav.hardwareConcurrency,
    pixelRatio: window.devicePixelRatio,
    screen: `${screen.width}×${screen.height}`,
    window: `${innerWidth}×${innerHeight}`,
  }
  if (nav.deviceMemory) head.device.memoryGB = nav.deviceMemory
  if (simOpts) {
    const b = simOpts.body!
    head.sim = { arms: b.upperArm + b.forearm, shoulders: b.shoulders, zoom: simOpts.zoom ?? 1, reach: simOpts.maxRaise ?? 180 }
  }
  return head
}

// ---- Words -----------------------------------------------------------------------

let lineText = ''
let lineTimer = 0

/** Crossfade the prompt at the bottom to `text`. */
function say(text: string) {
  if (text === lineText) return
  lineText = text
  const el = $('line')
  el.classList.remove('shown')
  clearTimeout(lineTimer)
  lineTimer = window.setTimeout(
    () => {
      el.textContent = text
      if (text) el.classList.add('shown')
    },
    el.textContent ? 700 : 0,
  )
}

let hintText = ''
function showHint(text: string, count = false) {
  const el = $('hint')
  el.classList.toggle('count', count)
  if (text === hintText) return
  hintText = text
  if (text) el.textContent = text
  el.classList.toggle('shown', !!text)
}

const hints = new TrackingHints()

/** The countdown, or while capturing a word to keep going; the camera's troubles come first (not the hands leaving, which is measured). */
function updateHint(now: number, dt: number) {
  if (state !== 'running') return
  const trouble = source === 'camera' ? hints.update({ pose: learner, aspect: aspectNow(), posture, dt }) : null
  if (trouble && trouble !== 'hands') return showHint(hints.text(posture))
  const t = (now - taskStart) / 1000
  if (phase === 'settle') return showHint(String(Math.ceil(PROMPT_SEC + SETTLE_SEC - t)), true)
  if (phase === 'capture') return showHint(current().moving ? 'Keep going, slowly.' : 'Hold it there, and breathe.')
  showHint('')
}

// ---- Drawing ---------------------------------------------------------------------

const guidance = new Guidance(() => reducedMotion.matches)
let presence = 0

/** The shape asked for now: fitted to the learner's body, laid on them from their own shoulders. */
function drawShape(dt: number, now: number) {
  const c = $<HTMLCanvasElement>('guidance')
  const { w, h } = fitCanvas(c)
  const ctx = c.getContext('2d')!
  const running = state === 'running'
  presence += ((running && calm ? 1 : 0) - presence) * (1 - Math.exp(-dt / 0.6))
  if (!running || !calm) {
    guidance.draw(ctx, emptyFrame(w, h, dt, now))
    return
  }
  const task = current()
  const t = (now - taskStart) / 1000
  // Before the capture a moving task shows where it starts, and the way its hands will go.
  const tc = phase === 'capture' ? t - PROMPT_SEC - SETTLE_SEC : 0
  const at = (s: number) => shapeOn(task.shape(s, posture), fit.body, posture)
  const target = at(tc)
  const place = fitOnto(target, calm, posture)
  const shape = place(target)
  const ahead: { l: Pt[]; r: Pt[] } = { l: [], r: [] }
  if (task.moving) {
    for (let s = tc; s <= Math.min(task.captureSec, tc + 2); s += 0.05) {
      const p = place(at(s))
      ahead.l.push(p.lPalm)
      ahead.r.push(p.rPalm)
    }
  }
  const capture = phase === 'capture' ? Math.min(1, tc / task.captureSec) : null
  guidance.draw(ctx, {
    view: coverView(w, h, aspectNow()),
    dpr: window.devicePixelRatio || 1,
    shape,
    learner: calm,
    posture,
    behind: { l: [], r: [] },
    ahead,
    bead: { l: shape.lPalm, r: shape.rPalm },
    hold: task.moving ? null : capture,
    waiting: phase !== 'capture',
    presence,
    pathStrength: 1,
    dt,
    time: now / 1000,
  })
  $('progress').style.transform = `scaleX(${capture ?? 0})`
}

function emptyFrame(w: number, h: number, dt: number, now: number) {
  const p = { x: 0, y: 0, v: 0 }
  const none = {} as Pose
  for (const j of JOINTS) none[j] = p
  return {
    view: coverView(w, h, aspectNow()),
    dpr: window.devicePixelRatio || 1,
    shape: none,
    learner: null,
    posture,
    behind: { l: [], r: [] },
    ahead: { l: [], r: [] },
    bead: { l: p, r: p },
    hold: null,
    waiting: true,
    presence: 0,
    pathStrength: 1,
    dt,
    time: now / 1000,
  }
}

// ---- Controls --------------------------------------------------------------------

function setPosture(p: Posture) {
  posture = p
  savePosture(p)
  tasks = tasksFor(p)
  for (const b of document.querySelectorAll<HTMLButtonElement>('#posture button')) {
    b.setAttribute('aria-pressed', String(b.dataset.posture === p))
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#posture button')) {
  b.addEventListener('click', () => setPosture(b.dataset.posture as Posture))
}
$('begin').addEventListener('click', () => {
  if (sim) {
    source = 'sim'
    begin()
  } else startCamera()
})
$('skip').addEventListener('click', skip)
$('again').addEventListener('click', () => redo(false))
$('back').addEventListener('click', () => redo(true))
$('finish').addEventListener('click', () => state === 'running' && finish())
$('download').addEventListener('click', download)
$<HTMLAnchorElement>('restart').href = location.search || '?'
if (sim) {
  $('simLink').hidden = true
  $('begin').textContent = 'Begin with the simulated student'
}

// ---- Loop ------------------------------------------------------------------------

/** The simulated learner is "detected" 30 times a second, however often the display draws. */
const SIM_GAP = 1000 / 30
let simClock = 0

let lastT = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000)
  lastT = now
  if (source === 'sim' && sim && state === 'running') {
    simClock = Math.max(simClock, taskStart)
    while (state === 'running' && simClock + SIM_GAP <= now) {
      simClock += SIM_GAP
      advance(simClock)
      if (state === 'running') takeLandmarks(sim.landmarks(current(), (simClock - taskStart) / 1000, posture), simClock)
    }
  }
  if (learner) fit.update(learner, true, dt)
  easeLearner(dt)
  advance(now)
  if (source === 'sim') drawBackdrop($<HTMLCanvasElement>('backdrop'), calm, aspectNow(), posture)
  drawShape(dt, now)
  updateHint(now, dt)
  requestAnimationFrame(frame)
}

setPosture(posture)
requestAnimationFrame(frame)
