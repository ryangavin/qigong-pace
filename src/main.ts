import { buildReference, Follower, type Reference } from './follower'
import { analyzeVideo, type VideoTeacher } from './extract'
import { DEMO_MOVES, MOVE_SETS, referenceFromMove } from './moves'
import { PoseTracker } from './pose'
import {
  alignPoseTo,
  cleanTrack,
  computeFeatures,
  containView,
  drawSkeleton,
  poseFromLandmarks,
  segmentErrors,
  SEGMENTS,
  POSTURES,
  toPx,
  type Features,
  type Pose,
  type Posture,
  type View,
} from './skeleton'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const INK = '#26221d'
const JADE = '#3f7a64'
const AMBER = '#c98a2b'
const VERMILION = '#b8432f'
const PAPER_DEEP = '#e8e0cf'

// ---- Moves -----------------------------------------------------------------

interface Entry {
  id: string
  name: string
  /** The move list's group. */
  set: string
  cue: string
  seatedCue?: string
  /** What the front-on teacher can't show. */
  lost?: string
  postures: Posture[]
  video?: VideoTeacher
}

const VIDEO_SET = 'Videos'

// ---- Posture -----------------------------------------------------------------

const POSTURE_KEY = 'qigong-pace.posture'

function loadPosture(): Posture {
  try {
    const saved = localStorage.getItem(POSTURE_KEY)
    if (saved && (POSTURES as readonly string[]).includes(saved)) return saved as Posture
  } catch {
    // Storage can be blocked; standing is the default.
  }
  return 'standing'
}

let posture = loadPosture()

const entries: Entry[] = DEMO_MOVES.map((m) => ({
  id: m.id,
  name: m.name,
  set: m.set,
  cue: m.cue,
  seatedCue: m.seatedCue,
  lost: m.lost,
  postures: m.postures,
}))
const available = () => entries.filter((e) => e.postures.includes(posture))
let entry = available()[0] ?? entries[0]
let ref: Reference = buildRef(entry)
let follower = new Follower(ref)

function buildRef(e: Entry): Reference {
  if (!e.video) return referenceFromMove(DEMO_MOVES.find((m) => m.id === e.id)!, posture)
  const v = e.video
  const opts = { aspect: v.aspect, flipX: false, facingAway: $<HTMLInputElement>('facingAway').checked }
  const poses = cleanTrack(v.landmarks.map((lm) => (lm ? poseFromLandmarks(lm, opts) : null)))
  return buildReference(v.name, v.fps, v.aspect, poses, posture)
}

function selectEntry(e: Entry) {
  entry = e
  const built = buildRef(e)
  if (built.poses.length < 2) {
    setStatus('No one could be found in that video.')
    return
  }
  ref = built
  const opts = follower.opts
  follower = new Follower(ref, opts)
  $('cue').textContent = posture === 'seated' && e.seatedCue ? e.seatedCue : e.cue
  $('lost').textContent = e.lost ? `Not shown from the front: ${e.lost}.` : ''
  $('facingWrap').hidden = !e.video
  sim.pos = 0
}

function renderMoveList() {
  const select = $<HTMLSelectElement>('move')
  select.innerHTML = ''
  for (const set of [...MOVE_SETS, VIDEO_SET]) {
    const inSet = available().filter((e) => e.set === set)
    if (!inSet.length) continue
    const group = document.createElement('optgroup')
    group.label = set
    for (const e of inSet) {
      const o = document.createElement('option')
      o.value = e.id
      o.textContent = e.name
      group.append(o)
    }
    select.append(group)
  }
  select.value = entry.id
}

function setPosture(p: Posture) {
  posture = p
  try {
    localStorage.setItem(POSTURE_KEY, p)
  } catch {
    // Not remembered, but still applied.
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#posture button')) {
    b.setAttribute('aria-pressed', String(b.dataset.posture === p))
  }
  $('youEmptyHint').textContent =
    p === 'seated'
      ? 'Sit facing the screen with your head, arms and waist in view.'
      : 'Stand back so your whole body is in view, facing the screen.'
  const next = entry.postures.includes(p) ? entry : available()[0]
  if (next) selectEntry(next)
  renderMoveList()
}

// ---- Learner input -----------------------------------------------------------

type Source = 'none' | 'camera' | 'sim'
let source: Source = 'none'
let camTracker: PoseTracker | null = null
const cam = document.createElement('video')
cam.muted = true
cam.playsInline = true
let lastCamTime = -1
let user: { pose: Pose; feats: Features; aspect: number } | null = null

const sim = { pos: 0, speed: 0.4, paused: false }

async function startCamera() {
  const err = $('cameraError')
  err.hidden = true
  $('startCamera').textContent = 'Loading pose tracker…'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    })
    cam.srcObject = stream
    await cam.play()
    camTracker ??= await PoseTracker.create()
    source = 'camera'
    $('youEmpty').hidden = true
    $('simControls').hidden = true
  } catch (e) {
    err.textContent = e instanceof Error ? e.message : String(e)
    err.hidden = false
  } finally {
    $('startCamera').textContent = 'Start camera'
  }
}

function startSim() {
  source = 'sim'
  sim.pos = 0
  $('youEmpty').hidden = true
  $('simControls').hidden = false
  follower.reset()
}

// Deterministic jitter so the simulated student looks tracked, not perfect.
let seed = 1
const jitter = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return (seed / 4294967296 - 0.5) * 0.006
}

function readLearner(dt: number) {
  if (source === 'camera' && camTracker && cam.readyState >= 2) {
    if (cam.currentTime === lastCamTime) return
    lastCamTime = cam.currentTime
    const lm = camTracker.detect(cam, performance.now())
    const aspect = cam.videoWidth / cam.videoHeight
    if (!lm) {
      user = null
      return
    }
    const pose = poseFromLandmarks(lm, { aspect, flipX: true, facingAway: false })
    user = { pose, feats: computeFeatures(pose, ref.posture), aspect }
  } else if (source === 'sim') {
    if (follower.state === 'following' && !sim.paused) {
      sim.pos = Math.min(ref.poses.length - 1, sim.pos + sim.speed * ref.fps * dt)
    }
    if (follower.state === 'waiting') sim.pos = 0
    const base = ref.poses[Math.round(sim.pos)]
    const pose = {} as Pose
    for (const [k, p] of Object.entries(base)) pose[k as keyof Pose] = { x: p.x + jitter(), y: p.y + jitter(), v: 0.95 }
    user = { pose, feats: computeFeatures(pose, ref.posture), aspect: ref.aspect }
  }
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
  return { w, h, dpr }
}

function errorColor(e: number) {
  const t = follower.opts.matchThreshold
  if (e < t * 1.6) return JADE
  if (e < t * 3) return AMBER
  return VERMILION
}

/** The built-in figure: soft ink brush strokes. */
function drawFigure(ctx: CanvasRenderingContext2D, p: Pose, view: View) {
  const T = Math.hypot(
    (p.lShoulder.x + p.rShoulder.x) / 2 - (p.lHip.x + p.rHip.x) / 2,
    (p.lShoulder.y + p.rShoulder.y) / 2 - (p.lHip.y + p.rHip.y) / 2,
  )
  const w = T * view.s * 0.2
  ctx.save()
  if (ref.posture === 'seated') drawStool(ctx, p, view, T)
  ctx.fillStyle = INK
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  for (const j of ['lShoulder', 'rShoulder', 'rHip', 'lHip'] as const) ctx.lineTo(...toPx(view, p[j]))
  ctx.closePath()
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = w * 0.9
  ctx.strokeStyle = INK
  ctx.stroke()
  drawSkeleton(ctx, p, view, () => INK, w)
  const [hx, hy] = toPx(view, p.head)
  ctx.beginPath()
  ctx.arc(hx, hy, T * view.s * 0.26, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** A pale stool under a seated figure: the seat just below the hips, legs to the floor behind the shins. */
function drawStool(ctx: CanvasRenderingContext2D, p: Pose, view: View, T: number) {
  const cx = (p.lHip.x + p.rHip.x) / 2
  const seatY = (p.lHip.y + p.rHip.y) / 2 + 0.1 * T
  const floorY = Math.max(p.lAnkle.y, p.rAnkle.y)
  const px = (x: number, y: number) => toPx(view, { x, y, v: 1 })
  ctx.save()
  ctx.globalAlpha = 0.3
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  ctx.lineCap = 'round'
  ctx.lineWidth = 0.08 * T * view.s
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(...px(cx + side * 0.4 * T, seatY))
    ctx.lineTo(...px(cx + side * 0.46 * T, floorY))
    ctx.stroke()
  }
  const [x0, y0] = px(cx - 0.55 * T, seatY - 0.05 * T)
  const [x1, y1] = px(cx + 0.55 * T, seatY + 0.07 * T)
  ctx.beginPath()
  ctx.roundRect(x0, y0, x1 - x0, y1 - y0, (y1 - y0) / 2)
  ctx.fill()
  ctx.restore()
}

/** Dots showing where each hand goes over the next couple of seconds. */
function drawTrails(ctx: CanvasRenderingContext2D, from: number, view: View, dpr: number) {
  const n = ref.poses.length
  const span = 2.5 * ref.fps
  const stepBy = Math.max(1, Math.round(ref.fps / 10))
  for (let i = Math.ceil(from); i < Math.min(n, from + span); i += stepBy) {
    const a = 1 - (i - from) / span
    for (const [j, color] of [
      ['lWrist', JADE],
      ['rWrist', AMBER],
    ] as const) {
      const [x, y] = toPx(view, ref.poses[i][j])
      ctx.globalAlpha = 0.7 * a
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, 3.2 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

const errs = new Float32Array(SEGMENTS.length)

function drawTeacher(lead: number) {
  const c = $<HTMLCanvasElement>('teacher')
  const { w, h, dpr } = fitCanvas(c)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = PAPER_DEEP
  ctx.fillRect(0, 0, w, h)
  const view = containView(w, h, ref.aspect)
  const shown = follower.displayFrame(lead)
  const frame = entry.video?.frames.get(shown)
  if (frame) ctx.drawImage(frame, view.ox, view.oy, view.w, view.h)
  else drawFigure(ctx, ref.poses[Math.round(shown)], view)

  drawTrails(ctx, shown, view, dpr)

  if (user && $<HTMLInputElement>('ghost').checked) {
    const here = ref.poses[follower.frame]
    ctx.globalAlpha = 0.85
    drawSkeleton(ctx, alignPoseTo(user.pose, here, ref.posture), view, () => VERMILION, 2.5 * dpr, ref.posture)
    ctx.globalAlpha = 1
  }
}

function drawYou() {
  const c = $<HTMLCanvasElement>('you')
  const { w, h, dpr } = fitCanvas(c)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = PAPER_DEEP
  ctx.fillRect(0, 0, w, h)
  if (source === 'none') return
  const aspect = source === 'camera' ? cam.videoWidth / cam.videoHeight || 4 / 3 : ref.aspect
  const view = containView(w, h, aspect)
  if (source === 'camera') {
    ctx.save()
    ctx.translate(view.ox + view.w, view.oy)
    ctx.scale(-1, 1)
    ctx.drawImage(cam, 0, 0, view.w, view.h)
    ctx.restore()
    ctx.fillStyle = 'rgba(243, 238, 227, 0.25)'
    ctx.fillRect(view.ox, view.oy, view.w, view.h)
  }
  if (!user) return
  const target = follower.state === 'waiting' ? ref.feats[0] : ref.feats[follower.frame]
  segmentErrors(user.feats, target, errs)
  drawSkeleton(ctx, user.pose, view, (i) => errorColor(errs[i]), 6 * dpr, ref.posture)
}

function drawTimeline() {
  const c = $<HTMLCanvasElement>('timeline')
  const { w, h, dpr } = fitCanvas(c)
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  const n = ref.poses.length
  const y = h / 2
  const x = (i: number) => (i / (n - 1)) * w
  // Holds are shaded, so you can see the pauses coming.
  ctx.fillStyle = 'rgba(63, 122, 100, 0.18)'
  let start = -1
  for (let i = 0; i <= n; i++) {
    const hold = i < n && ref.motion[i] < follower.opts.holdMotion
    if (hold && start < 0) start = i
    if (!hold && start >= 0) {
      ctx.fillRect(x(start), y - 9 * dpr, x(i) - x(start), 18 * dpr)
      start = -1
    }
  }
  ctx.lineCap = 'round'
  ctx.lineWidth = 3 * dpr
  ctx.strokeStyle = '#d6ccb8'
  ctx.beginPath()
  ctx.moveTo(2 * dpr, y)
  ctx.lineTo(w - 2 * dpr, y)
  ctx.stroke()
  ctx.strokeStyle = INK
  ctx.beginPath()
  ctx.moveTo(2 * dpr, y)
  ctx.lineTo(Math.max(2 * dpr, x(follower.pos)), y)
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.arc(x(follower.pos), y, 6 * dpr, 0, Math.PI * 2)
  ctx.fill()
}

// ---- Status ----------------------------------------------------------------

function setStatus(s: string) {
  const el = $('status')
  if (el.textContent !== s) el.textContent = s
}

function updateReadout() {
  const f = follower
  $('holdTag').hidden = !(f.state === 'following' && f.inHold)
  if (source === 'none') setStatus('Start the camera to begin.')
  else if (!user)
    setStatus(
      ref.posture === 'seated'
        ? 'Sit back until your head, shoulders and waist are in view.'
        : 'Step back until your whole body is in view.',
    )
  else if (f.state === 'waiting')
    setStatus(
      f.startProgress > 0
        ? 'Good. Hold the opening pose…'
        : ref.posture === 'seated'
          ? "Sit in the teacher's opening pose."
          : "Stand in the teacher's opening pose.",
    )
  else if (f.state === 'done') setStatus('Complete. Restart when you are ready.')
  else if (f.lost) setStatus("Find the teacher's shape. They'll wait for you.")
  else if (f.inHold) setStatus('Hold, and breathe.')
  else setStatus('Following you.')
  const secs = (f.pos / ref.fps).toFixed(1)
  const total = ((ref.poses.length - 1) / ref.fps).toFixed(1)
  $('pace').textContent =
    f.state === 'following' ? `${secs}s of ${total}s · your pace ${f.pace.toFixed(2)}×` : `${secs}s of ${total}s`
}

// ---- Loop --------------------------------------------------------------------

let lastT = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000)
  lastT = now
  readLearner(dt)
  follower.update(user?.feats ?? null, dt)
  const lead = Number($<HTMLInputElement>('lead').value)
  drawTeacher(lead)
  drawYou()
  drawTimeline()
  updateReadout()
  requestAnimationFrame(frame)
}

// ---- Controls ------------------------------------------------------------------

function bindRange(id: string, fmt: (v: number) => string, apply: (v: number) => void) {
  const input = $<HTMLInputElement>(id)
  const out = $<HTMLOutputElement>(`${id}Out`)
  const sync = () => {
    const v = Number(input.value)
    out.textContent = fmt(v)
    apply(v)
  }
  input.addEventListener('input', sync)
  sync()
}

bindRange('lead', (v) => `${v.toFixed(2)}s`, () => {})
bindRange('thresh', (v) => v.toFixed(2), (v) => (follower.opts.matchThreshold = v))
bindRange('simSpeed', (v) => `${v.toFixed(2)}×`, (v) => (sim.speed = v))

$('move').addEventListener('change', (e) => {
  const id = (e.target as HTMLSelectElement).value
  selectEntry(entries.find((x) => x.id === id)!)
})
$('restart').addEventListener('click', () => {
  follower.reset()
  sim.pos = 0
})
$<HTMLInputElement>('loop').addEventListener('change', (e) => {
  follower.opts.loop = (e.target as HTMLInputElement).checked
})
$('facingAway').addEventListener('change', () => selectEntry(entry))
$('startCamera').addEventListener('click', startCamera)
$('startSim').addEventListener('click', startSim)
$('useCamera').addEventListener('click', () => {
  $('youEmpty').hidden = false
  $('simControls').hidden = true
  source = 'none'
  user = null
})
$('simPause').addEventListener('click', (e) => {
  sim.paused = !sim.paused
  ;(e.target as HTMLButtonElement).textContent = sim.paused ? 'Resume student' : 'Pause student'
})

let analyzeAbort: AbortController | null = null
$('analyzeCancel').addEventListener('click', () => analyzeAbort?.abort())
$<HTMLInputElement>('videoFile').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  $('analyzing').hidden = false
  analyzeAbort = new AbortController()
  try {
    const tracker = await PoseTracker.create()
    const video = await analyzeVideo(
      file,
      tracker,
      (f) => ($<HTMLProgressElement>('analyzeProgress').value = f),
      analyzeAbort.signal,
    )
    tracker.close()
    const e: Entry = {
      id: `video-${entries.length}`,
      name: `Video: ${video.name}`,
      set: VIDEO_SET,
      cue: 'Mirror the teacher. They move only as fast as you do.',
      // Seated practice of a video just ignores the teacher's hips and legs.
      postures: [...POSTURES],
      video,
    }
    entries.push(e)
    selectEntry(e)
    renderMoveList()
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) setStatus(String(err))
  } finally {
    $('analyzing').hidden = true
  }
})

for (const b of document.querySelectorAll<HTMLButtonElement>('#posture button')) {
  b.addEventListener('click', () => {
    const p = b.dataset.posture as Posture
    // Re-clicking the active posture must not rebuild the Follower mid-move.
    if (p !== posture) setPosture(p)
  })
}

setPosture(posture)
requestAnimationFrame(frame)
