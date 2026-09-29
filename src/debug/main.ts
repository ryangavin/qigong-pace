import { buildReference, Follower, type Reference } from '../follower'
import { analyzeVideo, type VideoTeacher } from '../extract'
import { DEMO_MOVES, MOVE_SETS, referenceFromMove } from '../moves'
import { eachVideoFrame, modelFromParams, openCamera, PoseTracker } from '../pose'
import { loadPosture, savePosture } from '../prefs'
import { QI_REGIONS, QiModel } from '../qi'
import {
  landmarksFromPose,
  Recorder,
  Replayer,
  type RawLandmark,
  type Session,
  type SessionChange,
  type SessionSettings,
} from '../session'
import { clock, downloadSession, fetchSession, isShortcut, onSessionDrop, readSessionFile } from '../sessionFiles'
import { SimStudent } from '../sim'
import { LandmarkFilter, RateMeter } from '../smoothing'
import {
  alignPoseTo,
  cleanTrack,
  computeFeatures,
  containView,
  drawSkeleton,
  JOINTS,
  poseFromLandmarks,
  segmentErrors,
  SEGMENTS,
  POSTURES,
  toPx,
  type Features,
  type Pose,
  type Posture,
  type View,
} from '../skeleton'

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
  const built = buildRef(e)
  if (built.poses.length < 2) {
    setStatus('No one could be found in that video.')
    return
  }
  entry = e
  ref = built
  const opts = follower.opts
  follower = new Follower(ref, opts)
  $('cue').textContent = posture === 'seated' && e.seatedCue ? e.seatedCue : e.cue
  $('lost').textContent = e.lost ? `Not shown from the front: ${e.lost}.` : ''
  $('facingWrap').hidden = !e.video
  $<HTMLSelectElement>('move').value = e.id
  sim.pos = 0
  recorder?.event({ move: e.id }, performance.now())
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

/** `remember` keeps the choice for next time; a replay's posture isn't remembered. */
function setPosture(p: Posture, remember = true) {
  posture = p
  if (remember) savePosture(p)
  recorder?.event({ posture: p }, performance.now())
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

type Source = 'none' | 'camera' | 'sim' | 'replay'
let source: Source = 'none'
/** A recorded session played back in place of the camera: from the file picker, or a file dropped on the page. */
let replay: Replayer | null = null
let replayPaused = false
/** The session being recorded, if any. */
let recorder: Recorder | null = null
let camTracker: PoseTracker | null = null
const cam = document.createElement('video')
cam.muted = true
cam.playsInline = true
let user: { pose: Pose; feats: Features; aspect: number } | null = null
/** The camera learner as the tracker saw them, before filtering: drawn faintly under the filtered skeleton. */
let rawPose: Pose | null = null
const smoother = new LandmarkFilter()
const detections = new RateMeter()
let stopFrames: (() => void) | null = null
// ?model=heavy (or lite) tries another pose model.
const model = modelFromParams(new URLSearchParams(location.search))

const sim = new SimStudent()

async function startCamera() {
  const err = $('cameraError')
  err.hidden = true
  $('startCamera').textContent = 'Loading pose tracker…'
  try {
    cam.srcObject = await openCamera()
    await cam.play()
    camTracker ??= await PoseTracker.create({ model })
    stopFrames ??= eachVideoFrame(cam, readCamera)
    setSource('camera')
  } catch (e) {
    err.textContent = e instanceof Error ? e.message : String(e)
    err.hidden = false
  } finally {
    $('startCamera').textContent = 'Start camera'
  }
}

function startSim() {
  setSource('sim')
  sim.pos = 0
  follower.reset()
}

/** Switch the learner's input, and the controls that go with it. */
function setSource(s: Source) {
  if (recorder && s !== source) stopRecording()
  if (s !== 'camera') {
    for (const t of (cam.srcObject as MediaStream | null)?.getTracks() ?? []) t.stop()
    cam.srcObject = null
    stopFrames?.()
    stopFrames = null
  }
  source = s
  user = null
  rawPose = null
  smoother.reset()
  $('youEmpty').hidden = s !== 'none'
  $('simControls').hidden = s !== 'sim'
  $('replayControls').hidden = s !== 'replay'
  $<HTMLButtonElement>('record').disabled = s !== 'camera' && s !== 'sim'
}

/** Once per new camera frame, as the primary view does it: find the learner. */
function readCamera(timeMs: number) {
  if (source !== 'camera' || !camTracker) return
  detections.tick(timeMs)
  takeLandmarks(camTracker.detect(cam, timeMs), cam.videoWidth / cam.videoHeight, timeMs)
}

/** The simulated student and a replay step with the display; the camera is read as its frames come (`readCamera`). */
function readLearner(dt: number) {
  if (source === 'replay' && replay) {
    replay.advance(dt * 1000)
    for (const change of replay.events()) applyChange(change)
    const f = replay.read()
    // Timed by the recording's own clock, so the filter sees the camera's real gaps.
    if (f) takeLandmarks(f.landmarks, replay.session.aspect, f.t)
    // At its end the recorded learner steps out of view.
    else if (replay.ended) {
      user = null
      rawPose = null
    }
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
  const opts = { aspect, flipX: true, facingAway: false }
  rawPose = raw ? poseFromLandmarks(raw, opts) : null
  if (!lm) {
    user = null
    return
  }
  const pose = poseFromLandmarks(lm, opts)
  user = { pose, feats: computeFeatures(pose, ref.posture), aspect }
}

/** One tick of practice: read the learner, then follow them and gather qi. */
function advance(dt: number) {
  readLearner(dt)
  follower.update(user?.feats ?? null, dt)
  if (source !== 'none') qi.update({ follower, pose: user?.pose ?? null, dt })
}

// ---- Recording and replay ----------------------------------------------------

const settingsNow = (): SessionSettings => ({ follower: follower.opts, lead: Number($<HTMLInputElement>('lead').value) })

/** Start recording the session (R), or stop and download it. */
function toggleRecording() {
  if (recorder) return stopRecording()
  if (source !== 'camera' && source !== 'sim') return
  // A recording starts the move from its beginning, so a replay can start there too.
  restart()
  const aspect = source === 'camera' ? cam.videoWidth / cam.videoHeight : ref.aspect
  recorder = new Recorder({ app: 'debug', move: entry.id, posture, aspect, settings: settingsNow() }, performance.now())
}

function stopRecording() {
  if (!recorder) return
  const s = recorder.finish()
  recorder = null
  if (s.frames.length) downloadSession(s)
}

function showSession() {
  const button = $('record')
  const text = recorder ? `Stop recording · ${clock(recorder.elapsed(performance.now()))}` : 'Record session'
  if (button.textContent !== text) button.textContent = text
  button.setAttribute('aria-pressed', String(!!recorder))
  if (source !== 'replay' || !replay) return
  const scrub = $<HTMLInputElement>('replayScrub')
  scrub.max = String(replay.duration)
  // Left alone while it is being dragged.
  if (!scrub.matches(':active')) scrub.value = String(replay.time)
  const time = `${clock(replay.time)} of ${clock(replay.duration)}`
  if ($('replayTime').textContent !== time) $('replayTime').textContent = time
  const pause = replayPaused ? 'Play' : replay.ended ? 'Replay again' : 'Pause'
  if ($('replayPause').textContent !== pause) $('replayPause').textContent = pause
}

/** Play a recorded session in place of the camera, from its start. */
function startReplay(s: Session, name: string) {
  replay = new Replayer(s)
  $('replayName').textContent = name
  replayPaused = false
  setSource('replay')
  seekReplay(0)
}

/**
 * Put the replay at `ms`: back to the session's start (its move, posture and
 * settings, a fresh follower and qi), then run through to `ms` at 30 ticks a
 * second, so what shows there is what the session had come to.
 */
function seekReplay(ms: number) {
  if (!replay) return
  const s = replay.session
  if (s.posture !== posture) setPosture(s.posture, false)
  applyChange({ move: s.move })
  applySettings(s.settings)
  follower.reset()
  follower.reps = 0
  qi.reset()
  sim.pos = 0
  user = null
  rawPose = null
  smoother.reset()
  replay.seek(0)
  const tick = 1000 / 30
  for (let t = 0; t < ms; t += tick) advance(Math.min(tick, ms - t) / 1000)
}

/** A change the recorded learner made, played back. */
function applyChange(c: SessionChange) {
  if ('move' in c) {
    const e = available().find((x) => x.id === c.move)
    if (e) {
      if (e !== entry) selectEntry(e)
    } else setStatus(`No move "${c.move}" here (a video?); replaying with ${entry.name}.`)
  } else if ('posture' in c) {
    if (c.posture !== posture) setPosture(c.posture, false)
  } else if ('restart' in c) {
    restart()
  } else applySettings(c.settings)
}

/** Put the sliders and follower where a recording had them. */
function applySettings(s: SessionSettings) {
  follower.opts = { ...follower.opts, ...s.follower }
  $<HTMLInputElement>('lead').value = String(s.lead)
  $<HTMLInputElement>('thresh').value = String(follower.opts.matchThreshold)
  $<HTMLInputElement>('loop').checked = follower.opts.loop
  $('leadOut').textContent = `${s.lead.toFixed(2)}s`
  $('threshOut').textContent = follower.opts.matchThreshold.toFixed(2)
}

function restart() {
  follower.reset()
  sim.pos = 0
  recorder?.event({ restart: true }, performance.now())
}

const settingsChanged = () => recorder?.event({ settings: settingsNow() }, performance.now())

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
  const aspect =
    source === 'camera'
      ? cam.videoWidth / cam.videoHeight || 4 / 3
      : source === 'replay' && replay
        ? replay.session.aspect
        : ref.aspect
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
  if ((source === 'camera' || source === 'replay') && rawPose) {
    // The tracker's own landmarks, faint, under the filtered skeleton.
    ctx.fillStyle = INK
    for (const j of JOINTS) {
      const p = rawPose[j]
      ctx.globalAlpha = 0.15 + 0.3 * p.v
      const [x, y] = toPx(view, p)
      ctx.beginPath()
      ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
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

// ---- Qi ----------------------------------------------------------------------

// The session's qi, as the primary view's energy layer would be fed it.
const qi = new QiModel()
let qiShownAt = 0

/** A compact readout of the live QiFrame, refreshed a few times a second so it can be read. */
function updateQiReadout() {
  const now = performance.now()
  if (now - qiShownAt < 150) return
  qiShownAt = now
  const q = qi.frame
  const n = (v: number) => v.toFixed(2)
  const s = (v: number) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2)
  const regions = QI_REGIONS.map((r) => `${r} ${n(q.regions[r])}`).join('  ')
  $('qi').textContent =
    `qi ${n(q.level)}  breath ${s(q.breath)}  flow ${n(q.flow)}  palmField ${n(q.palmField)}  ` +
    `armFlow ${s(q.armFlow.l)} / ${s(q.armFlow.r)}\n${regions}`
  updateTrackingReadout()
}

/** Detection rate, the camera's actual settings, and each joint's visibility as tracked → as filtered. */
function updateTrackingReadout() {
  if (source !== 'camera') {
    $('tracking').textContent = ''
    return
  }
  const settings = (cam.srcObject as MediaStream | null)?.getVideoTracks()[0]?.getSettings()
  const fps = settings?.frameRate ? ` @ ${Math.round(settings.frameRate)} fps` : ''
  const head = `detect ${detections.hz.toFixed(1)} Hz  camera ${cam.videoWidth}×${cam.videoHeight}${fps}  model ${model}`
  const vis = JOINTS.map((j) => {
    const r = rawPose ? rawPose[j].v.toFixed(2) : ' -- '
    const f = user ? user.pose[j].v.toFixed(2) : ' -- '
    return `${j} ${r}→${f}`
  })
  const rows: string[] = []
  for (let i = 0; i < vis.length; i += 4) rows.push(vis.slice(i, i + 4).join('   '))
  $('tracking').textContent = `${head}\nvisibility (raw→filtered)\n${rows.join('\n')}`
}

// ---- Loop --------------------------------------------------------------------

let lastT = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000)
  lastT = now
  // A paused replay holds everything still, the teacher too.
  if (!(source === 'replay' && replayPaused)) advance(dt)
  updateQiReadout()
  showSession()
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

bindRange('lead', (v) => `${v.toFixed(2)}s`, settingsChanged)
bindRange('thresh', (v) => v.toFixed(2), (v) => {
  follower.opts.matchThreshold = v
  settingsChanged()
})
bindRange('simSpeed', (v) => `${v.toFixed(2)}×`, (v) => (sim.speed = v))

$('move').addEventListener('change', (e) => {
  const id = (e.target as HTMLSelectElement).value
  selectEntry(entries.find((x) => x.id === id)!)
})
$('restart').addEventListener('click', () => {
  if (source === 'replay') seekReplay(0)
  else restart()
})
$<HTMLInputElement>('loop').addEventListener('change', (e) => {
  follower.opts.loop = (e.target as HTMLInputElement).checked
  settingsChanged()
})

$('record').addEventListener('click', toggleRecording)
window.addEventListener('keydown', (e) => {
  if (isShortcut(e, 'r')) toggleRecording()
})
$<HTMLInputElement>('replayFile').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    startReplay(await readSessionFile(file), file.name)
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err))
  }
})
onSessionDrop(startReplay, setStatus)
$('replayPause').addEventListener('click', () => {
  if (replay?.ended && !replayPaused) seekReplay(0)
  else replayPaused = !replayPaused
})
$<HTMLInputElement>('replayScrub').addEventListener('input', (e) => seekReplay(Number((e.target as HTMLInputElement).value)))
$('replayStop').addEventListener('click', () => {
  replay = null
  setSource('none')
})
$('facingAway').addEventListener('change', () => selectEntry(entry))
$('startCamera').addEventListener('click', startCamera)
$('startSim').addEventListener('click', startSim)
$('useCamera').addEventListener('click', () => setSource('none'))
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
// ?replay=fixtures/replays/session.json plays a recorded session the dev server serves in place of the camera.
const replayParam = new URLSearchParams(location.search).get('replay')
if (replayParam)
  fetchSession(replayParam)
    .then((s) => startReplay(s, replayParam.split('/').pop() ?? replayParam))
    .catch((e) => setStatus(e instanceof Error ? e.message : String(e)))
requestAnimationFrame(frame)
