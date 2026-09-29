import type { MPMask } from '@mediapipe/tasks-vision'
import type { MaskData } from './energy/layer'
import { shrinkMask } from './mask'

/**
 * Reads MediaPipe's person segmentation masks back small and cheaply, for the
 * energy layer's silhouette.
 *
 * On the CPU delegate the mask is already an array: it is shrunk in place. On
 * the GPU delegate it lives in a texture in MediaPipe's own WebGL context,
 * and `getAsFloat32Array()` both stalls the GPU (about 4 ms a frame at 720p)
 * and, in Chrome on Apple silicon, returns all zeros. So instead the texture
 * is shrunk (and mirrored) on the GPU with one blit into a small buffer, read
 * into a pixel buffer without waiting, and picked up a frame later once a
 * fence says it's ready: a frame of latency, and no stall (about 0.8 ms a
 * frame in all, against 8 ms for the same read done synchronously). WebGL
 * only updates a fence between tasks, so this needs one call per frame.
 */
export class MaskReader {
  private out: MaskData | null = null
  private gpu: {
    gl: WebGL2RenderingContext
    src: WebGLFramebuffer
    dst: WebGLFramebuffer
    rb: WebGLRenderbuffer
    pbo: WebGLBuffer
    w: number
    h: number
    rgba: Uint8Array
    fence: WebGLSync | null
  } | null = null
  /** Set when the GPU path fails; masks are then left out rather than risked. */
  private broken = false

  constructor(
    private width: number,
    private flipX: boolean,
  ) {}

  /** The latest mask this reader has, after taking in `m` (the newest may arrive a frame later). */
  read(m: MPMask): MaskData | null {
    if (this.broken) return null
    if (m.hasFloat32Array() || !m.hasWebGLTexture() || !m.canvas) {
      this.out = shrinkMask(m.getAsFloat32Array(), m.width, m.height, this.width, this.flipX, this.out)
      return this.out
    }
    try {
      this.readGpu(m)
    } catch (e) {
      console.warn('Segmentation mask unavailable', e)
      this.broken = true
      this.out = null
    }
    return this.out
  }

  private readGpu(m: MPMask) {
    const gl = (m.canvas as HTMLCanvasElement | OffscreenCanvas).getContext('webgl2') as WebGL2RenderingContext | null
    if (!gl) throw new Error('no WebGL2 context on the mask')
    const w = Math.max(1, Math.min(this.width, m.width))
    const h = Math.max(1, Math.round((w * m.height) / m.width))
    let g = this.gpu
    if (!g || g.gl !== gl || g.w !== w || g.h !== h) {
      g = this.gpu = {
        gl,
        src: gl.createFramebuffer()!,
        dst: gl.createFramebuffer()!,
        rb: gl.createRenderbuffer()!,
        pbo: gl.createBuffer()!,
        w,
        h,
        rgba: new Uint8Array(w * h * 4),
        fence: null,
      }
    }
    // MediaPipe's state is left exactly as found.
    const prevRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING)
    const prevDraw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)
    const prevRb = gl.getParameter(gl.RENDERBUFFER_BINDING)
    const prevPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING)
    const scissor = gl.isEnabled(gl.SCISSOR_TEST)
    const discard = gl.isEnabled(gl.RASTERIZER_DISCARD)
    try {
      // Pick up the last frame's read, if the GPU has finished it.
      if (g.fence && gl.clientWaitSync(g.fence, 0, 0) !== gl.TIMEOUT_EXPIRED) {
        gl.deleteSync(g.fence)
        g.fence = null
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, g.pbo)
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, g.rgba)
        const data = this.out?.width === w && this.out.height === h ? this.out.data : new Uint8Array(w * h)
        for (let i = 0; i < w * h; i++) data[i] = g.rgba[i * 4]
        this.out = { data, width: w, height: h }
      }
      if (g.fence) return // Still busy; skip this frame's mask.
      gl.bindRenderbuffer(gl.RENDERBUFFER, g.rb)
      if (gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_WIDTH) !== w) {
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h)
      }
      gl.disable(gl.SCISSOR_TEST)
      gl.disable(gl.RASTERIZER_DISCARD)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, g.src)
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, m.getAsWebGLTexture(), 0)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, g.dst)
      gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, g.rb)
      // Shrink with filtering, and mirror by swapping the destination's ends.
      // Rows stay as MediaPipe keeps them, top first.
      const [x0, x1] = this.flipX ? [w, 0] : [0, w]
      gl.blitFramebuffer(0, 0, m.width, m.height, x0, 0, x1, h, gl.COLOR_BUFFER_BIT, gl.LINEAR)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, g.dst)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, g.pbo)
      if (gl.getBufferParameter(gl.PIXEL_PACK_BUFFER, gl.BUFFER_SIZE) !== g.rgba.length) {
        gl.bufferData(gl.PIXEL_PACK_BUFFER, g.rgba.length, gl.STREAM_READ)
      }
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0)
      g.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      // Without a flush the fence may never reach the GPU, and never signal.
      gl.flush()
      const err = gl.getError()
      if (err !== gl.NO_ERROR) throw new Error(`WebGL error ${err}`)
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevRead)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDraw)
      gl.bindRenderbuffer(gl.RENDERBUFFER, prevRb)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, prevPack)
      if (scissor) gl.enable(gl.SCISSOR_TEST)
      if (discard) gl.enable(gl.RASTERIZER_DISCARD)
    }
  }
}
