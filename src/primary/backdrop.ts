import { bodyScale, coverView, jointOf, SEGMENTS, toPx, type Pose, type Posture } from '../skeleton'

// Shared by the primary view and the calibration page.

/** Size a canvas's backing store to its CSS box at the device's pixel ratio. */
export function fitCanvas(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(c.clientWidth * dpr)
  const h = Math.round(c.clientHeight * dpr)
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  return { w, h }
}

/**
 * Without a camera, a stand-in for one: a dim room with the simulated student
 * (or a replayed learner) as a soft dark figure, graded like the camera would be.
 */
export function drawBackdrop(c: HTMLCanvasElement, pose: Pose | null, aspect: number, posture: Posture) {
  const { w, h } = fitCanvas(c)
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75)
  g.addColorStop(0, '#39414c')
  g.addColorStop(1, '#101318')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  if (!pose) return
  const view = coverView(w, h, aspect)
  const T = bodyScale(pose, posture) * view.s
  ctx.save()
  ctx.strokeStyle = ctx.fillStyle = '#4c545e'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.filter = `blur(${Math.round(T * 0.05)}px)`
  ctx.beginPath()
  for (const j of ['lShoulder', 'rShoulder', 'rHip', 'lHip'] as const) ctx.lineTo(...toPx(view, pose[j]))
  ctx.closePath()
  ctx.lineWidth = T * 0.3
  ctx.fill()
  ctx.stroke()
  ctx.lineWidth = T * 0.2
  SEGMENTS.forEach((s) => {
    if (!s.draw || s.name === 'shoulders' || s.name === 'hips') return
    ctx.beginPath()
    ctx.moveTo(...toPx(view, jointOf(pose, s.a)))
    ctx.lineTo(...toPx(view, jointOf(pose, s.b)))
    ctx.stroke()
  })
  const [hx, hy] = toPx(view, pose.head)
  ctx.beginPath()
  ctx.ellipse(hx, hy, T * 0.2, T * 0.26, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
