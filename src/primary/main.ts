import { Follower, type Reference } from '../follower'
import { DEMO_MOVES, MOVE_SETS, referenceFromMove, type Move } from '../moves'
import { PoseTracker } from '../pose'
import { loadPosture, savePosture } from '../prefs'
import { SimStudent } from '../sim'
import {
  alignment,
  alignPoseTo,
  bodyScale,
  computeFeatures,
  coverView,
  JOINTS,
  poseFromLandmarks,
  jointOf,
  segmentErrors,
  SEGMENTS,
  toPx,
  type Features,
  type Pose,
  type Posture,
  type Pt,
} from '../skeleton'
import { Guidance, handPath } from './guidance'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

/** How far ahead of the learner the ghost moves, in seconds of the move. */
const LEAD_SEC = 0.5
/** How much of the hands' way ahead the comet tails show. */
const TRAIL_SEC = 1.5
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
let follower = new Follower(ref)

function selectMove(m: Move) {
  move = m
  ref = referenceFromMove(m, posture)
  follower = new Follower(ref, follower.opts)
  sim.pos = 0
  cueUntil = -1
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

function setPosture(p: Posture) {
  posture = p
  savePosture(p)
  for (const b of document.querySelectorAll<HTMLButtonElement>('#posture button')) {
    b.setAttribute('aria-pressed', String(b.dataset.posture === p))
  }
  selectMove(move.postures.includes(p) ? move : available()[0])
  renderMoveList()
}

// ---- Learner input -----------------------------------------------------------

type Source = 'none' | 'camera' | 'sim'
let source: Source = 'none'
let tracker: PoseTracker | null = null
const cam = $<HTMLVideoElement>('cam')
let lastCamTime = -1
let user: { pose: Pose; feats: Features; aspect: number } | null = null
/** The learner eased a little, so the ghost laid on them doesn't shiver with the tracker. */
let calm: Pose | null = null

// ?sim drives the view with a simulated student; ?sim=0.6 sets its speed.
const simParam = new URLSearchParams(location.search).get('sim')
const sim = new SimStudent({ speed: Number(simParam) || 0.5, wander: 0.9 })

async function startCamera() {
  const err = $('cameraError')
  err.hidden = true
  const button = $('startCamera')
  button.textContent = 'Loading pose tracker…'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    })
    cam.srcObject = stream
    await cam.play()
    tracker ??= await PoseTracker.create()
    begin('camera')
  } catch (e) {
    err.textContent = e instanceof Error ? e.message : String(e)
    err.hidden = false
    $('intro').hidden = false
  } finally {
    button.textContent = 'Start camera'
  }
}

function begin(s: Source) {
  source = s
  user = null
  calm = null
  follower.reset()
  sim.pos = 0
  cueUntil = -1
  $('intro').hidden = true
  $('backdrop').hidden = s !== 'sim'
  cam.hidden = s !== 'camera'
  $('useCamera').hidden = s !== 'sim'
  $('again').hidden = false
  wake()
}

function readLearner(dt: number) {
  if (source === 'camera' && tracker && cam.readyState >= 2) {
    if (cam.currentTime === lastCamTime) return
    lastCamTime = cam.currentTime
    const lm = tracker.detect(cam, performance.now())
    const aspect = cam.videoWidth / cam.videoHeight
    if (!lm) {
      user = null
      return
    }
    const pose = poseFromLandmarks(lm, { aspect, flipX: true, facingAway: false })
    user = { pose, feats: computeFeatures(pose, ref.posture), aspect }
  } else if (source === 'sim') {
    const pose = sim.step(follower, dt)
    user = { pose, feats: computeFeatures(pose, ref.posture), aspect: ref.aspect }
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

const aspectNow = () => (source === 'camera' ? cam.videoWidth / cam.videoHeight || 16 / 9 : ref.aspect)

/**
 * Without a camera, a stand-in for one: a dim room with the simulated student
 * as a soft dark figure, graded like the camera would be.
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
  const view = coverView(w, h, ref.aspect)
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
const errs = new Float32Array(SEGMENTS.length)
let presence = 0
let ghost: Pose | null = null
let ghostPlace: ((p: Pt) => Pt) | null = null

function drawGuidance(dt: number, time: number) {
  const c = $<HTMLCanvasElement>('guidance')
  const { w, h } = fitCanvas(c)
  const ctx = c.getContext('2d')!
  const shown = follower.state === 'waiting' ? 0 : follower.displayFrame(LEAD_SEC)
  const teacher = ref.poses[Math.round(shown)]
  // The ghost stays where it was last laid while no one is seen, and fades.
  if (calm) {
    ghost = alignPoseTo(teacher, calm, ref.posture)
    ghostPlace = alignment(teacher, calm, ref.posture)
  }
  const target = follower.state === 'done' ? 0.45 : calm ? 1 : 0
  presence += (target - presence) * (1 - Math.exp(-dt / 0.8))
  if (!ghost || !ghostPlace) {
    ctx.clearRect(0, 0, w, h)
    return
  }
  if (user) {
    segmentErrors(user.feats, follower.state === 'waiting' ? ref.feats[0] : ref.feats[follower.frame], errs)
  }
  const moving = follower.state === 'following'
  guidance.draw(ctx, {
    view: coverView(w, h, aspectNow()),
    ghost,
    learner: calm,
    errs: user ? errs : null,
    threshold: follower.opts.matchThreshold,
    posture: ref.posture,
    trail: moving ? handPath(ref, shown, TRAIL_SEC, ghostPlace) : { l: [], r: [] },
    presence,
    dt,
    time,
  })
}

// ---- Words -----------------------------------------------------------------

let cueUntil = -1
let lineText = ''
let lineTimer = 0

/** Crossfade the one line of words at the bottom to `text`. */
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

function lineFor(now: number): string {
  const f = follower
  if (source === 'none') return ''
  if (!user)
    return ref.posture === 'seated'
      ? 'Sit back until your shoulders and waist are seen.'
      : 'Step back until the whole of you is seen.'
  if (f.state === 'waiting') {
    if (f.startProgress > 0) return 'Rest here, and breathe.'
    return ref.posture === 'seated' ? 'Settle into the opening shape.' : 'Step into the opening shape.'
  }
  if (f.state === 'done') return 'Let it settle. The form is complete.'
  if (f.lost) return 'Find the shape again.'
  if (cueUntil < 0) cueUntil = now + CUE_SEC * 1000
  if (now < cueUntil) return posture === 'seated' && move.seatedCue ? move.seatedCue : move.cue
  return ''
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
  follower.reset()
  sim.pos = 0
  cueUntil = -1
})
$('startCamera').addEventListener('click', startCamera)
$('useCamera').addEventListener('click', startCamera)

// ---- Loop --------------------------------------------------------------------

let lastT = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000)
  lastT = now
  readLearner(dt)
  easeLearner(dt)
  follower.update(user?.feats ?? null, dt)
  if (source === 'sim') drawBackdrop()
  drawGuidance(dt, now / 1000)
  say(lineFor(now))
  updateProgress()
  // At the end the chrome comes back to offer another round.
  if (follower.state === 'done') document.body.classList.remove('still')
  requestAnimationFrame(frame)
}

setPosture(posture)
if (simParam !== null) begin('sim')
requestAnimationFrame(frame)
