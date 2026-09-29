import { DEMO_ASPECT, DEMO_MOVES, referenceFromMove } from '../moves'
import { containView, torsoLength, type Pose, type View } from '../skeleton'
import { createAutoQi } from './auto'
import { createEnergyLayer } from './layer'
import { PALETTE_NAMES, type PaletteName } from './palettes'
import { QI_REGIONS, quietFrame, type QiFrame } from './types'

// energy.html: a tuning bench for the energy layer. A simulated student plays
// a built-in move on a dark stage; the qi frame comes from sliders, or is read
// off the move ("auto").

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const params = new URLSearchParams(location.search)

const energyCanvas = $<HTMLCanvasElement>('energy')
const bodyCanvas = $<HTMLCanvasElement>('body')
let palette: PaletteName = PALETTE_NAMES.includes(params.get('palette') as PaletteName)
  ? (params.get('palette') as PaletteName)
  : 'dusk'
const layer = createEnergyLayer(energyCanvas, { palette })
const auto = createAutoQi({ rampSec: 60 })

// ---- Controls --------------------------------------------------------------

const moveSel = $<HTMLSelectElement>('move')
for (const m of DEMO_MOVES) moveSel.add(new Option(m.name, m.id))
moveSel.value = DEMO_MOVES.some((m) => m.id === params.get('move')) ? params.get('move')! : 'open-close'
let ref = referenceFromMove(DEMO_MOVES.find((m) => m.id === moveSel.value)!)
let simT = 0
moveSel.addEventListener('change', () => {
  ref = referenceFromMove(DEMO_MOVES.find((m) => m.id === moveSel.value)!)
  simT = 0
})

const paletteRow = $('palettes')
for (const name of PALETTE_NAMES) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = name
  b.dataset.palette = name
  b.addEventListener('click', () => setPalette(name))
  paletteRow.append(b)
}
function setPalette(name: PaletteName) {
  palette = name
  layer.setPalette(name)
  paletteRow.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.palette === name)))
}
setPalette(palette)

const autoBox = $<HTMLInputElement>('auto')
const rampBox = $<HTMLInputElement>('ramp')
$('restart').addEventListener('click', () => auto.reset())

interface Slider {
  input: HTMLInputElement
  out: HTMLSpanElement
  get: (f: QiFrame) => number
  set: (f: QiFrame, v: number) => void
}
const sliders: Slider[] = []
function slider(label: string, min: number, get: Slider['get'], set: Slider['set']) {
  const row = document.createElement('label')
  row.className = 'slider'
  const name = document.createElement('span')
  name.textContent = label
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = '1'
  input.step = '0.01'
  input.value = '0'
  const out = document.createElement('span')
  row.append(name, input, out)
  $('sliders').append(row)
  const s = { input, out, get, set }
  input.addEventListener('input', () => (out.textContent = Number(input.value).toFixed(2)))
  sliders.push(s)
  // The label doubles as a URL option: ?palmField=1 sets that slider.
  if (params.has(label)) {
    input.value = String(Number(params.get(label)))
    if (label === 'level') rampBox.checked = false
    else autoBox.checked = false
  }
  return s
}
const levelSlider = slider('level', 0, (f) => f.level, (f, v) => (f.level = v))
slider('breath', -1, (f) => f.breath, (f, v) => (f.breath = v))
slider('flow', 0, (f) => f.flow, (f, v) => (f.flow = v))
slider('palmField', 0, (f) => f.palmField, (f, v) => (f.palmField = v))
slider('armFlow.l', -1, (f) => f.armFlow.l, (f, v) => (f.armFlow.l = v))
slider('armFlow.r', -1, (f) => f.armFlow.r, (f, v) => (f.armFlow.r = v))
for (const r of QI_REGIONS) slider(r, 0, (f) => f.regions[r], (f, v) => (f.regions[r] = v))

if (params.get('body') === '0') $<HTMLInputElement>('showBody').checked = false
if (params.has('bare')) document.body.classList.add('bare')

document.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') {
    document.body.classList.toggle('bare')
    resize()
  }
})

// ---- The simulated student --------------------------------------------------

// Deterministic jitter so the student looks tracked, not perfect (as in main.ts).
let seed = 1
const jitter = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return (seed / 4294967296 - 0.5) * 0.004
}

function student(dt: number): Pose {
  simT = (simT + dt) % (ref.poses.length / ref.fps)
  const base = ref.poses[Math.min(ref.poses.length - 1, Math.floor(simT * ref.fps))]
  const pose = {} as Pose
  for (const [k, p] of Object.entries(base)) pose[k as keyof Pose] = { x: p.x + jitter(), y: p.y + jitter(), v: 0.95 }
  return pose
}

/** A dim stand-in for the learner in the darkened mirror. */
function drawBody(p: Pose, view: View, dpr: number) {
  const ctx = bodyCanvas.getContext('2d')!
  ctx.clearRect(0, 0, bodyCanvas.width, bodyCanvas.height)
  if (!$<HTMLInputElement>('showBody').checked) return
  const T = torsoLength(p) * view.s * dpr
  const at = (j: keyof Pose) => [(view.ox + p[j].x * view.s) * dpr, (view.oy + p[j].y * view.s) * dpr] as const
  const line = (a: keyof Pose, b: keyof Pose, w: number) => {
    ctx.lineWidth = w * T
    ctx.beginPath()
    ctx.moveTo(...at(a))
    ctx.lineTo(...at(b))
    ctx.stroke()
  }
  ctx.save()
  ctx.filter = `blur(${Math.round(0.05 * T)}px)`
  ctx.strokeStyle = ctx.fillStyle = '#15131c'
  ctx.lineCap = 'round'
  const [sx, sy] = [(at('lShoulder')[0] + at('rShoulder')[0]) / 2, (at('lShoulder')[1] + at('rShoulder')[1]) / 2]
  const [hx, hy] = [(at('lHip')[0] + at('rHip')[0]) / 2, (at('lHip')[1] + at('rHip')[1]) / 2]
  ctx.lineWidth = 0.7 * T
  ctx.beginPath()
  ctx.moveTo(sx, sy)
  ctx.lineTo(hx, hy)
  ctx.stroke()
  for (const s of ['l', 'r'] as const) {
    line(`${s}Shoulder`, `${s}Elbow`, 0.22)
    line(`${s}Elbow`, `${s}Wrist`, 0.18)
    line(`${s}Hip`, `${s}Knee`, 0.3)
    line(`${s}Knee`, `${s}Ankle`, 0.2)
  }
  const [x, y] = at('head')
  ctx.beginPath()
  ctx.ellipse(x, y - 0.08 * T, 0.24 * T, 0.3 * T, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ---- Loop -------------------------------------------------------------------

let dpr = 1
function resize() {
  dpr = window.devicePixelRatio || 1
  bodyCanvas.width = Math.round(bodyCanvas.clientWidth * dpr)
  bodyCanvas.height = Math.round(bodyCanvas.clientHeight * dpr)
  layer.resize()
}
window.addEventListener('resize', resize)
resize()

const manual = quietFrame()
let last = performance.now()
let frames = 0
let fpsSince = last
let workMs = 0

// GPU time per frame, where the browser offers timer queries.
const gl = energyCanvas.getContext('webgl2')!
const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
const queries: WebGLQuery[] = []
let gpuMs = 0
let gpuN = 0
function readQueries() {
  while (timer && queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
    const q = queries.shift()!
    if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
      gpuMs += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6
      gpuN++
    }
    gl.deleteQuery(q)
  }
}

function step(dt: number, show = true) {
  const pose = student(dt)
  const w = bodyCanvas.clientWidth
  const h = bodyCanvas.clientHeight
  const view = { ...containView(w, h, DEMO_ASPECT), aspect: DEMO_ASPECT }

  for (const s of sliders) s.set(manual, Number(s.input.value))
  let frame = manual
  if (autoBox.checked) {
    frame = auto.update(pose, dt, rampBox.checked ? undefined : manual.level)
  } else if (rampBox.checked) {
    // Only the level ramps; everything else stays on its slider.
    frame = { ...manual, level: auto.update(pose, dt).level }
  }
  for (const s of sliders) {
    const driven = s === levelSlider ? rampBox.checked : autoBox.checked
    s.input.disabled = driven
    if (driven) s.input.value = String(s.get(frame))
    s.out.textContent = s.get(frame).toFixed(2)
  }

  if (show) drawBody(pose, view, dpr)
  const q = timer && queries.length < 8 ? gl.createQuery() : null
  if (q) gl.beginQuery(timer!.TIME_ELAPSED_EXT, q)
  layer.render(frame, pose, view, dt)
  if (q) {
    gl.endQuery(timer!.TIME_ELAPSED_EXT)
    queries.push(q)
  }
}

function tick(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  const start = performance.now()
  readQueries()
  step(dt)
  workMs += performance.now() - start
  frames++
  if (now - fpsSince >= 1000) {
    const gpu = gpuN ? ` · ${(gpuMs / gpuN).toFixed(1)} ms gpu` : ''
    $('fps').textContent =
      `${Math.round((frames * 1000) / (now - fpsSince))} fps · ${(workMs / frames).toFixed(1)} ms cpu${gpu} · ` +
      `${energyCanvas.width}×${energyCanvas.height}`
    frames = 0
    workMs = 0
    gpuMs = 0
    gpuN = 0
    fpsSince = now
  }
  requestAnimationFrame(tick)
}

// ?warm=20 runs 20 simulated seconds before the first frame shows, so a
// screenshot sees the field settled whatever the browser's frame rate.
const warm = Math.round(Number(params.get('warm') ?? 0) * 60)
for (let i = 0; i < warm; i++) step(1 / 60, i === warm - 1)
requestAnimationFrame(tick)
