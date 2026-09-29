import { createEnergyLayer, PALETTE_NAMES, type EnergyLayer, type PaletteName } from '../energy'
import { Follower, type Reference } from '../follower'
import { DEMO_MOVES, MOVE_SETS, referenceFromMove, type Move } from '../moves'
import { eachVideoFrame, modelFromParams, openCamera, PoseTracker } from '../pose'
import { loadPosture, savePosture } from '../prefs'
import { QiModel } from '../qi'
import {
  landmarksFromPose,
  Recorder,
  Replayer,
  type RawLandmark,
  type Session,
  type SessionChange,
  type SessionSettings,
} from '../session'
import { clock, downloadSession, fetchSession, isShortcut, onSessionDrop } from '../sessionFiles'
import { SimStudent } from '../sim'
import { LandmarkFilter } from '../smoothing'
import {
  alignment,
  bodyScale,
  computeFeatures,
  coverView,
  JOINTS,
  poseFromLandmarks,
  jointOf,
  SEGMENTS,
  toPx,
  type Features,
  type Pose,
  type Posture,
  type Pt,
} from '../skeleton'
import { beadFrame, Guidance, guidanceMix, handPath, holdAt, holdProgress, matchOf, wristsAt } from './guidance'
import { Invitations } from './invitations'
import { TrackingHints } from './tracking'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const params = new URLSearchParams(location.search)

/** How far ahead of the learner the beads are, in seconds of the move. */
const LEAD_SEC = 0.5
/** How long the move's cue stays once the move begins. */
const CUE_SEC = 9
/** Stillness before the chrome fades away. */
const IDLE_MS = 3000

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// ---- Moves -----------------------------------------------------------------

let posture = loadPosture()
const available = () => DEMO_MOVES.filter((m) => m.postures.includes(posture))
let move: Move = available()[0] ?? DEMO_MOVES[0]
let ref: Reference = referenceFromMove(move, posture)
// ?reps=2 starts each move as if already practised that many times, smoothly:
// a dev aid for looking at the view once the energy has grown.
const startReps = Math.max(0, Math.floor(Number(params.get('reps')) || 0))
let follower = new Follower(ref)
follower.reps = startReps
/** How well the learner has been tracking this move lately, 0..1; with `follower.reps`, it sets the `guidanceMix`. */
let flow = startReps ? 1 : 0

function selectMove(m: Move) {
  move = m
  ref = referenceFromMove(m, posture)
  follower = new Follower(ref, follower.opts)
  follower.reps = startReps
  flow = startReps ? 1 : 0
  sim.pos = 0
  cueUntil = -1
  $<HTMLSelectElement>('move').value = m.id
  recorder?.event({ move: m.id }, performance.now())
}

function renderMoveList() {
  const select = $<HTMLSelectElement>('move')
  select.innerHTML = ''
  for (const set of MOVE_SETS) {
    const inSet = available().filter((m) => m.set === set)
    if (!inSet.length) continue
    const group = document.createElement('optgroup')
    group.label = set
    for (const m of inSet) {
      const o = document.createElement('option')
      o.value = m.id
      o.textContent = m.name
      group.append(o)
    }
    select.append(group)
  }
  select.value = move.id
}

/** `remember` keeps the choice for next time; a replay's posture isn't remembered. */
function setPosture(p: Posture, remember = true) {
  posture = p
  if (remember) savePosture(p)
  recorder?.event({ posture: p }, performance.now())
  for (const b of document.querySelectorAll<HTMLButtonElement>('#posture button')) {
    b.setAttribute('aria-pressed', String(b.dataset.posture === p))
  }
  selectMove(move.postures.includes(p) ? move : available()[0])
  renderMoveList()
}

// ---- Learner input -----------------------------------------------------------

type Source = 'none' | 'camera' | 'sim' | 'replay'
let source: Source = 'none'
/** A recorded session played back in place of the camera (`?replay=<url>`, or a file dropped on the page). */
let replay: Replayer | null = null
let replayName = ''
/** The session being recorded, if any. */
let recorder: Recorder | null = null
let tracker: PoseTracker | null = null
const cam = $<HTMLVideoElement>('cam')
/** Steadies the tracker's landmarks before they become the learner's pose. */
const smoother = new LandmarkFilter()
let stopFrames: (() => void) | null = null
let user: { pose: Pose; feats: Features; aspect: number } | null = null
/** The learner eased a little, so the guidance laid on them doesn't shiver with the tracker. */
let calm: Pose | null = null

// ?sim drives the view with a simulated student; ?sim=0.6 sets its speed.
// ?wander=2 lets its screen-right hand stray further (torso lengths; 0.9 by
// default, 0 keeps it on the path), to see the hand ring off its path.
const simParam = params.get('sim')
const wanderParam = Number(params.get('wander'))
const sim = new SimStudent({ speed: Number(simParam) || 0.5, wander: params.has('wander') && wanderParam >= 0 ? wanderParam : 0.9 })

async function startCamera() {
  const err = $('cameraError')
  err.hidden = true
  const button = $('startCamera')
  button.textContent = 'Loading pose tracker…'
  try {
    cam.srcObject = await openCamera()
    await cam.play()
    // The mask lies like the mirrored pose, for the energy layer's silhouette.
    // ?model=heavy (or lite) tries another pose model.
    tracker ??= await PoseTracker.create({ segmentation: !!energy, flipX: true, model: modelFromParams(params) })
    stopFrames ??= eachVideoFrame(cam, readCamera)
    begin('camera')
  } catch (e) {
    err.textContent = e instanceof Error ? e.message : String(e)
    err.hidden = false
    $('intro').hidden = false
  } finally {
    button.textContent = 'Start camera'
  }
}

function stopCamera() {
  for (const t of (cam.srcObject as MediaStream | null)?.getTracks() ?? []) t.stop()
  cam.srcObject = null
  stopFrames?.()
  stopFrames = null
}

function begin(s: Source) {
  if (recorder) stopRecording()
  source = s
  user = null
  calm = null
  smoother.reset()
  hints.reset()
  follower.reset()
  sim.pos = 0
  cueUntil = -1
  $('intro').hidden = true
  $('backdrop').hidden = s !== 'sim' && s !== 'replay'
  cam.hidden = s !== 'camera'
  $('useCamera').hidden = s !== 'sim' && s !== 'replay'
  $('again').hidden = false
  $('record').hidden = s !== 'camera' && s !== 'sim'
  energy?.setMask(null)
  wake()
}

/** Once per new camera frame: find the learner. */
function readCamera(timeMs: number) {
  if (source !== 'camera' || !tracker) return
  const raw = tracker.detect(cam, timeMs)
  energy?.setMask(tracker.mask)
  takeLandmarks(raw, cam.videoWidth / cam.videoHeight, timeMs)
}

/**
 * The simulated student and a replay step with the display; the camera is read
 * as its frames come (`readCamera`).
 */
function readLearner(dt: number) {
  if (source === 'replay' && replay) {
    replay.advance(dt * 1000)
    for (const change of replay.events()) applyChange(change)
    const f = replay.read()
    // Timed by the recording's own clock, so the filter sees the camera's real gaps.
    if (f) takeLandmarks(f.landmarks, replay.session.aspect, f.t)
    // At its end the recorded learner steps out of view.
    else if (replay.ended) user = null
  } else if (source === 'sim') {
    const pose = sim.step(follower, dt)
    recorder?.add(landmarksFromPose(pose, ref.aspect), performance.now())
    user = { pose, feats: computeFeatures(pose, ref.posture), aspect: ref.aspect }
  }
}

/**
 * One detection's raw landmarks, from the camera or a replay: recorded as they
 * are, then steadied and read as the learner.
 */
function takeLandmarks(raw: RawLandmark[] | null, aspect: number, timeMs: number) {
  recorder?.add(raw, timeMs)
  const lm = smoother.update(raw, timeMs)
  if (!lm) {
    user = null
    return
  }
  const pose = poseFromLandmarks(lm, { aspect, flipX: true, facingAway: false })
  user = { pose, feats: computeFeatures(pose, ref.posture), aspect }
}

// ---- Recording and replay ----------------------------------------------------

const settingsNow = (): SessionSettings => ({ follower: follower.opts, lead: LEAD_SEC })

/** Start recording the session (R), or stop and download it. */
function toggleRecording() {
  if (recorder) return stopRecording()
  if (source !== 'camera' && source !== 'sim') return
  // A recording starts the move from its beginning, so a replay can start there too.
  beginAgain()
  const head = { app: 'primary' as const, move: move.id, posture, aspect: aspectNow(), settings: settingsNow() }
  recorder = new Recorder(head, performance.now())
  showRecording()
}

function stopRecording() {
  if (!recorder) return
  const s = recorder.finish()
  recorder = null
  if (s.frames.length) downloadSession(s)
  showRecording()
}

function showRecording() {
  const button = $('record')
  const text = recorder ? `Stop recording · ${clock(recorder.elapsed(performance.now()))}` : 'Record'
  if (button.textContent !== text) button.textContent = text
  button.setAttribute('aria-pressed', String(!!recorder))
  $('recordDot').hidden = !recorder
  const note = $('replayNote')
  const replayText = source === 'replay' && replay ? `Replaying ${replayName} · ${clock(replay.time)} of ${clock(replay.duration)}` : ''
  if (note.textContent !== replayText && !noticeUntil) note.textContent = replayText
}

let noticeUntil = 0
/** A short message by the recording control, e.g. why a session couldn't be replayed. */
function notice(text: string) {
  if (source === 'none') {
    $('cameraError').textContent = text
    $('cameraError').hidden = false
    return
  }
  $('replayNote').textContent = text
  clearTimeout(noticeUntil)
  noticeUntil = window.setTimeout(() => (noticeUntil = 0), 6000)
  wake()
}

/** Play a recorded session in place of the camera, from its start and with its move, posture and settings. */
function startReplay(s: Session, name: string) {
  stopCamera()
  replay = new Replayer(s)
  replayName = name
  begin('replay')
  if (s.posture !== posture) setPosture(s.posture, false)
  applyChange({ move: s.move })
  follower.opts = { ...follower.opts, ...s.settings.follower }
}

/** A change the recorded learner made, played back. */
function applyChange(c: SessionChange) {
  if ('move' in c) {
    const m = available().find((x) => x.id === c.move)
    if (m) selectMove(m)
    else notice(`This view has no move "${c.move}"; replaying with ${move.name}.`)
  } else if ('posture' in c) {
    if (c.posture !== posture) setPosture(c.posture, false)
  } else if ('restart' in c) {
    beginAgain()
  } else {
    follower.opts = { ...follower.opts, ...c.settings.follower }
  }
}

function beginAgain() {
  follower.reset()
  sim.pos = 0
  cueUntil = -1
  recorder?.event({ restart: true }, performance.now())
}

// ---- Qi --------------------------------------------------------------------

// One session's qi, kept across moves, postures and beginning again.
const qi = new QiModel()
// ?qi=0.7 starts the session with that much gathered: a dev aid for looking
// at the view at higher qi without practising for minutes first.
if (params.has('qi')) qi.frame.level = Math.min(1, Math.max(0, Number(params.get('qi')) || 0))

// ?palette=jade (or dusk, the default, or ember) colours the energy.
const paletteParam = params.get('palette') as PaletteName
const palette: PaletteName = PALETTE_NAMES.includes(paletteParam) ? paletteParam : 'dusk'

/**
 * The balance of guidance and energy, eased from `guidanceMix`: the energy
 * only glimmers while the move is new and grows as it is learned (its strength
 * 1 is the energy layer as tuned on energy.html).
 */
let mix = guidanceMix(startReps, flow)

/** The energy layer, or null where WebGL2 isn't available: the view works without it. */
let energy: EnergyLayer | null = null
try {
  energy = createEnergyLayer($<HTMLCanvasElement>('energy'), { palette, strength: mix.energyStrength })
} catch (e) {
  console.warn('No energy layer:', e)
  $('energy').hidden = true
}
window.addEventListener('resize', () => energy?.resize())

function drawEnergy(dt: number) {
  if (!energy) return
  const c = $<HTMLCanvasElement>('energy')
  const aspect = aspectNow()
  const view = { ...coverView(c.clientWidth, c.clientHeight, aspect), aspect }
  energy.setStrength(mix.energyStrength)
  energy.render(qi.frame, calm, view, dt)
}

/** Follow how well the learner is tracking the move, and ease the mix of guidance and energy toward it. */
function updateMix(dt: number) {
  if (user && follower.state === 'following') {
    const target = follower.lost ? 0 : matchOf(follower.distance, follower.opts.matchThreshold)
    flow += (target - flow) * (1 - Math.exp(-dt / 4))
  }
  const to = guidanceMix(follower.reps, flow)
  const k = 1 - Math.exp(-dt / 1.5)
  mix = {
    pathStrength: mix.pathStrength + (to.pathStrength - mix.pathStrength) * k,
    pathSeconds: mix.pathSeconds + (to.pathSeconds - mix.pathSeconds) * k,
    energyStrength: mix.energyStrength + (to.energyStrength - mix.energyStrength) * k,
  }
}

function easeLearner(dt: number) {
  if (!user) {
    calm = null
    return
  }
  const prev = calm
  if (!prev) {
    calm = user.pose
    return
  }
  const k = 1 - Math.exp(-dt / 0.08)
  const next = {} as Pose
  for (const j of JOINTS) {
    const a = prev[j]
    const b = user.pose[j]
    next[j] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, v: b.v }
  }
  calm = next
}

// ---- Drawing -------------------------------------------------------------

function fitCanvas(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(c.clientWidth * dpr)
  const h = Math.round(c.clientHeight * dpr)
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  return { w, h }
}

const aspectNow = () =>
  source === 'camera'
    ? cam.videoWidth / cam.videoHeight || 16 / 9
    : source === 'replay' && replay
      ? replay.session.aspect
      : ref.aspect

/**
 * Without a camera, a stand-in for one: a dim room with the simulated student
 * (or a replayed learner) as a soft dark figure, graded like the camera would be.
 */
function drawBackdrop() {
  const c = $<HTMLCanvasElement>('backdrop')
  const { w, h } = fitCanvas(c)
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75)
  g.addColorStop(0, '#39414c')
  g.addColorStop(1, '#101318')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  if (!calm) return
  const view = coverView(w, h, aspectNow())
  const T = bodyScale(calm, ref.posture) * view.s
  ctx.save()
  ctx.strokeStyle = ctx.fillStyle = '#4c545e'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.filter = `blur(${Math.round(T * 0.05)}px)`
  ctx.beginPath()
  for (const j of ['lShoulder', 'rShoulder', 'rHip', 'lHip'] as const) ctx.lineTo(...toPx(view, calm[j]))
  ctx.closePath()
  ctx.lineWidth = T * 0.3
  ctx.fill()
  ctx.stroke()
  ctx.lineWidth = T * 0.2
  SEGMENTS.forEach((s) => {
    if (!s.draw || s.name === 'shoulders' || s.name === 'hips') return
    ctx.beginPath()
    ctx.moveTo(...toPx(view, jointOf(calm!, s.a)))
    ctx.lineTo(...toPx(view, jointOf(calm!, s.b)))
    ctx.stroke()
  })
  const [hx, hy] = toPx(view, calm.head)
  ctx.beginPath()
  ctx.ellipse(hx, hy, T * 0.2, T * 0.26, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const guidance = new Guidance(() => reducedMotion.matches)
let presence = 0
/** How the teacher was last laid on the learner; it stays while no one is seen, and fades. */
let place: ((p: Pt) => Pt) | null = null

function drawGuidance(dt: number, time: number) {
  const c = $<HTMLCanvasElement>('guidance')
  const { w, h } = fitCanvas(c)
  const ctx = c.getContext('2d')!
  const waiting = follower.state === 'waiting'
  const moving = follower.state === 'following'
  const pos = waiting ? 0 : follower.pos
  // Waiting, the beads sit at the opening shape and fill as the learner holds it.
  const hold = moving ? holdAt(ref, pos, follower.opts.holdMotion) : null
  const bead = waiting ? 0 : beadFrame(ref, pos, LEAD_SEC, hold)
  const teacher = ref.poses[Math.round(bead)]
  if (calm) place = alignment(teacher, calm, ref.posture)
  const target = follower.state === 'done' ? 0.45 : calm ? 1 : 0
  presence += (target - presence) * (1 - Math.exp(-dt / 0.8))
  if (!place) {
    ctx.clearRect(0, 0, w, h)
    return
  }
  const none = { l: [], r: [] }
  const shape = {} as Pose
  for (const j of JOINTS) shape[j] = place(teacher[j])
  const due = (bead - pos) / ref.fps
  // The traced stretch reaches a little way back of where the follower puts
  // the learner too, so a hand a moment behind still counts as on its way.
  const from = Math.max(0, pos - LEAD_SEC * ref.fps)
  guidance.draw(ctx, {
    view: coverView(w, h, aspectNow()),
    dpr: window.devicePixelRatio || 1,
    shape,
    learner: calm,
    posture: ref.posture,
    behind: moving ? handPath(ref, from, (bead - from) / ref.fps, place) : none,
    ahead: moving ? handPath(ref, bead, Math.max(0, mix.pathSeconds - due), place) : none,
    bead: wristsAt(ref, bead, place),
    hold: waiting ? follower.startProgress : hold ? holdProgress(hold, pos) : null,
    waiting,
    presence,
    pathStrength: mix.pathStrength,
    dt,
    time,
  })
}

// ---- Words -----------------------------------------------------------------

let cueUntil = -1
let lineText = ''
let lineTimer = 0
const invitations = new Invitations()

/**
 * Crossfade the one line of words at the bottom to `text`. An invitation
 * fades in and out more slowly than the move's words; the old words are
 * always gone before the new ones come, so the two never overlap.
 */
function say(text: string, invite = false) {
  if (text === lineText) return
  lineText = text
  const el = $('line')
  const fadeOut = el.classList.contains('invite') ? 2000 : 700
  el.classList.remove('shown')
  clearTimeout(lineTimer)
  lineTimer = window.setTimeout(
    () => {
      el.textContent = text
      el.classList.toggle('invite', invite)
      if (text) el.classList.add('shown')
    },
    el.textContent ? fadeOut : 0,
  )
}

function lineFor(now: number): string {
  const f = follower
  // No one seen is the tracking hint's to say (`showHint`), up top.
  if (source === 'none' || !user) return ''
  if (f.state === 'waiting') {
    if (f.startProgress > 0) return 'Rest here, and breathe.'
    return ref.posture === 'seated'
      ? 'Settle into the opening shape: bring your hands to the lights.'
      : 'Step into the opening shape: bring your hands to the lights.'
  }
  if (f.state === 'done') return 'Let it settle. The form is complete.'
  if (f.lost) return 'Find the shape again.'
  if (cueUntil < 0) cueUntil = now + CUE_SEC * 1000
  if (now < cueUntil) return posture === 'seated' && move.seatedCue ? move.seatedCue : move.cue
  return ''
}

const hints = new TrackingHints()
let hintText = ''

/**
 * When the camera can't see the learner well, say so briefly, up top and apart
 * from the move's line. Nothing while tracking is fine.
 */
function showHint(dt: number) {
  // A replay says what the camera would have said.
  const trouble =
    source === 'camera' || source === 'replay' ? hints.update({ pose: user?.pose ?? null, aspect: aspectNow(), posture: ref.posture, dt }) : null
  const text = trouble ? hints.text(ref.posture) : ''
  if (text === hintText) return
  hintText = text
  const el = $('hint')
  if (text) el.textContent = text
  el.classList.toggle('shown', !!text)
}

function updateProgress() {
  const n = ref.poses.length - 1
  $('progress').style.transform = `scaleX(${n > 0 ? follower.pos / n : 0})`
}

// ---- Chrome ------------------------------------------------------------------

let idleTimer = 0

/** Show the chrome, and let it fade again after a while of stillness during practice. */
function wake() {
  document.body.classList.remove('still')
  clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => {
    if (source !== 'none' && follower.state !== 'done') document.body.classList.add('still')
  }, IDLE_MS)
}

window.addEventListener('pointermove', wake)
window.addEventListener('pointerdown', wake)
window.addEventListener('keydown', wake)

$('move').addEventListener('change', (e) => {
  const id = (e.target as HTMLSelectElement).value
  selectMove(DEMO_MOVES.find((m) => m.id === id)!)
})
for (const b of document.querySelectorAll<HTMLButtonElement>('#posture button')) {
  b.addEventListener('click', () => {
    const p = b.dataset.posture as Posture
    // Re-clicking the active posture must not rebuild the Follower mid-move.
    if (p !== posture) setPosture(p)
  })
}
$('again').addEventListener('click', () => {
  // A replay begins again from the start of the recording.
  if (source === 'replay' && replay) startReplay(replay.session, replayName)
  else beginAgain()
})
$('startCamera').addEventListener('click', startCamera)
$('useCamera').addEventListener('click', startCamera)
$('record').addEventListener('click', toggleRecording)
window.addEventListener('keydown', (e) => {
  if (isShortcut(e, 'r')) toggleRecording()
})
onSessionDrop(startReplay, notice)

// ---- Loop --------------------------------------------------------------------

let lastT = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000)
  lastT = now
  readLearner(dt)
  easeLearner(dt)
  follower.update(user?.feats ?? null, dt)
  if (source !== 'none') qi.update({ follower, pose: user?.pose ?? null, dt })
  updateMix(dt)
  if (source === 'sim' || source === 'replay') drawBackdrop()
  if (source !== 'none') drawEnergy(dt)
  drawGuidance(dt, now / 1000)
  // The move's own words come first; an invitation only ever fills a quiet line.
  const line = lineFor(now)
  const invite = invitations.update({
    q: qi.frame,
    dt,
    practising: !!user && follower.state === 'following' && !follower.lost,
    inHold: follower.inHold,
    // Only once the move itself is known: after one whole repetition of it.
    repeated: follower.reps >= 1,
    standing: ref.posture === 'standing',
    busy: line !== '',
  })
  say(line || invite?.text || '', !line && !!invite)
  showHint(dt)
  updateProgress()
  showRecording()
  // At the end the chrome comes back to offer another round.
  if (follower.state === 'done') document.body.classList.remove('still')
  requestAnimationFrame(frame)
}

setPosture(posture)
if (simParam !== null) begin('sim')
// ?replay=fixtures/replays/session.json plays a recorded session the dev server serves in place of the camera.
const replayParam = params.get('replay')
if (replayParam)
  fetchSession(replayParam)
    .then((s) => startReplay(s, replayParam.split('/').pop() ?? replayParam))
    .catch((e) => notice(e instanceof Error ? e.message : String(e)))
requestAnimationFrame(frame)
