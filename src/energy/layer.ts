import { QI_REGIONS, quietFrame, type QiFrame } from '../qi'
import type { Pose } from '../skeleton'
import { bodyGeometry, emptyGeometry } from './body'
import { PALETTES, type Palette, type PaletteName } from './palettes'
import { COMPOSITE, COPY, DOWN, SIM, UP, VERT } from './shaders'
import type { EnergyView } from './types'

// The qi energy layer: a sea of luminous dye carried by a flow field and fed
// by the body, drawn over the camera with `mix-blend-mode: screen` (black
// leaves the camera untouched).
//
// Each frame: one simulation pass at reduced resolution (advect, fade,
// inject), a dual-filter bloom chain, then a full-resolution composite that
// colours it with the palette.
//
// If the browser takes the WebGL context away (a GPU reset, too many
// contexts), the layer stops drawing, and rebuilds itself when the context is
// restored. A lost canvas is blank, and screened blank adds nothing, so the
// view carries on without the energy rather than going black.

/** A single-channel mask, one byte per pixel, rows from the top. */
export interface MaskData {
  data: Uint8Array
  width: number
  height: number
}

export interface EnergyLayerOptions {
  palette?: PaletteName | Palette
  /** Simulation height as a fraction of the canvas's, capped at `maxSimHeight`. */
  simScale?: number
  maxSimHeight?: number
  /** Cap on device pixels per CSS pixel for the canvas; the light is soft, so 1 is plenty. */
  maxPixelRatio?: number
}

export interface EnergyLayer {
  /**
   * Step and draw one frame. `view` places the pose's image on the canvas in
   * its CSS pixels; a null pose lets the body's light fade while the sea goes on.
   */
  render(frame: QiFrame, pose: Pose | null, view: EnergyView, dt: number): void
  /** Match the canvas to its CSS size; call when it changes. */
  resize(): void
  setPalette(palette: PaletteName | Palette): void
  /**
   * A person segmentation mask (red channel 0..1, or bytes 0..255) in the same
   * image and orientation as the pose, adding to the body's silhouette. It may
   * be smaller than the image; it is stretched over it. Null removes it.
   */
  setMask(mask: TexImageSource | MaskData | null): void
  /** False while the WebGL context is lost; the canvas is blank until it's back. */
  readonly live: boolean
  dispose(): void
}

const BLOOM_LEVELS = 4

interface Target {
  tex: WebGLTexture
  fb: WebGLFramebuffer
  w: number
  h: number
}

export function createEnergyLayer(canvas: HTMLCanvasElement, opts: EnergyLayerOptions = {}): EnergyLayer {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  })
  if (!gl) throw new Error('WebGL2 is not available')
  const simScale = opts.simScale ?? 0.5
  const maxSimHeight = opts.maxSimHeight ?? 540
  const maxPixelRatio = opts.maxPixelRatio ?? 1

  // Everything the context owns; made again when a lost context comes back.
  let floatTargets = false
  let vao: WebGLVertexArrayObject | null = null
  let programs: Record<'sim' | 'copy' | 'down' | 'up' | 'composite', Program>
  function build() {
    // Half-float targets keep the long faint tails; without them, 8 bits will do.
    floatTargets = !!gl!.getExtension('EXT_color_buffer_float')
    vao = gl!.createVertexArray()
    gl!.bindVertexArray(vao)
    programs = {
      sim: program(gl!, SIM),
      copy: program(gl!, COPY),
      down: program(gl!, DOWN),
      up: program(gl!, UP),
      composite: program(gl!, COMPOSITE),
    }
    dye = null
    bloom = []
    mask = null
    maskOn = false
  }

  let lost = false
  const onLost = (e: Event) => {
    // Without preventDefault the browser never offers the context back.
    e.preventDefault()
    lost = true
  }
  const onRestored = () => {
    try {
      build()
      lost = false
      resize()
    } catch (err) {
      // Stay blank rather than half-drawn.
      console.warn('Energy layer could not be restored', err)
    }
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  let palette: Palette = resolvePalette(opts.palette ?? 'dusk')
  let dye: [Target, Target] | null = null
  let bloom: Target[] = []
  let cssW = 1
  let cssH = 1
  let time = 0
  let presence = 0
  const geo = emptyGeometry()
  // Inputs are eased a little so a jumpy model (or a dragged slider) doesn't pop.
  const eased = quietFrame()
  const reg = new Float32Array(QI_REGIONS.length)
  let mask: WebGLTexture | null = null
  let maskOn = false

  function target(w: number, h: number): Target {
    const tex = gl!.createTexture()!
    gl!.bindTexture(gl!.TEXTURE_2D, tex)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    if (floatTargets) gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA16F, w, h, 0, gl!.RGBA, gl!.HALF_FLOAT, null)
    else gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null)
    const fb = gl!.createFramebuffer()!
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fb)
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0)
    gl!.clearColor(0, 0, 0, 1)
    gl!.clear(gl!.COLOR_BUFFER_BIT)
    return { tex, fb, w, h }
  }

  function free(t: Target) {
    gl!.deleteTexture(t.tex)
    gl!.deleteFramebuffer(t.fb)
  }

  function allocate() {
    const simH = Math.max(32, Math.min(maxSimHeight, Math.round(canvas.height * simScale)))
    const simW = Math.max(32, Math.round((simH * canvas.width) / Math.max(1, canvas.height)))
    if (dye && dye[0].w === simW && dye[0].h === simH) return
    const old = dye
    bloom.forEach(free)
    dye = [target(simW, simH), target(simW, simH)]
    if (old) {
      // Carry the field over, so a resize doesn't wipe the sea.
      gl!.useProgram(programs.copy.prog)
      gl!.disable(gl!.BLEND)
      bindTex(0, old[0].tex)
      programs.copy.i('uSrc', 0)
      draw(dye[0])
      old.forEach(free)
    }
    bloom = []
    for (let i = 1; i <= BLOOM_LEVELS; i++) {
      bloom.push(target(Math.max(1, simW >> i), Math.max(1, simH >> i)))
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, maxPixelRatio)
    cssW = Math.max(1, canvas.clientWidth)
    cssH = Math.max(1, canvas.clientHeight)
    const w = Math.round(cssW * dpr)
    const h = Math.round(cssH * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    if (!lost) allocate()
  }

  function draw(t: Target | null) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, t ? t.fb : null)
    gl!.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
  }

  function bindTex(unit: number, tex: WebGLTexture) {
    gl!.activeTexture(gl!.TEXTURE0 + unit)
    gl!.bindTexture(gl!.TEXTURE_2D, tex)
  }

  function render(frame: QiFrame, pose: Pose | null, view: EnergyView, dtIn: number) {
    if (lost || gl!.isContextLost()) return
    if (!dye) resize()
    const dt = Math.min(Math.max(dtIn, 0), 1 / 20)
    const k = 1 - Math.exp(-dt / 0.2)
    const ease = (a: number, b: number) => a + (b - a) * k
    eased.level = ease(eased.level, frame.level)
    eased.breath = ease(eased.breath, frame.breath)
    eased.flow = ease(eased.flow, frame.flow)
    eased.palmField = ease(eased.palmField, frame.palmField)
    eased.armFlow.l = ease(eased.armFlow.l, frame.armFlow.l)
    eased.armFlow.r = ease(eased.armFlow.r, frame.armFlow.r)
    QI_REGIONS.forEach((r, i) => {
      eased.regions[r] = ease(eased.regions[r], frame.regions[r])
      reg[i] = eased.regions[r]
    })
    // The body's light fades in over about a second when someone is seen, and
    // lingers on its last shape when they're lost.
    presence += ((pose ? 1 : 0) - presence) * (1 - Math.exp(-dt / 0.8))
    if (pose) bodyGeometry(pose, view, cssH, geo)
    // The sea moves slowly at first and finds its pace as qi builds.
    time += dt * (0.45 + 0.55 * eased.level)

    const [src, dst] = dye!
    gl!.disable(gl!.BLEND)

    // Simulate.
    const sim = programs.sim
    gl!.useProgram(sim.prog)
    bindTex(0, src.tex)
    sim.i('uPrev', 0)
    sim.f('uAspect', canvas.width / canvas.height)
    sim.f('uDt', dt)
    sim.f('uTime', time)
    sim.f('uLevel', eased.level)
    sim.f('uBreath', eased.breath)
    sim.f('uFlow', eased.flow)
    sim.f('uPalmField', eased.palmField)
    sim.v2('uArmFlow', eased.armFlow.l, eased.armFlow.r)
    gl!.uniform1fv(sim.loc('uReg'), reg)
    sim.f('uPresence', presence)
    sim.f('uT', geo.T)
    sim.i('uCapCount', geo.count)
    gl!.uniform4fv(sim.loc('uCaps'), geo.caps)
    gl!.uniform4fv(sim.loc('uCapInfo'), geo.capInfo)
    gl!.uniform1fv(sim.loc('uCapAlong'), geo.chain)
    gl!.uniform2fv(sim.loc('uPts'), geo.points)
    sim.f('uMaskOn', maskOn ? 1 : 0)
    if (mask) {
      bindTex(1, mask)
      sim.i('uMask', 1)
      gl!.uniform4f(
        sim.loc('uMaskRect'),
        view.ox / cssH,
        view.oy / cssH,
        (view.s * view.aspect) / cssH,
        view.s / cssH,
      )
    } else {
      // The sampler still needs a texture of the right kind bound.
      bindTex(1, src.tex)
      sim.i('uMask', 1)
    }
    draw(dst)
    dye = [dst, src]

    // Bloom: down the chain, then back up, adding each level onto the one above.
    gl!.useProgram(programs.down.prog)
    programs.down.i('uSrc', 0)
    let from: Target = dst
    for (const t of bloom) {
      bindTex(0, from.tex)
      programs.down.v2('uTexel', 1 / from.w, 1 / from.h)
      draw(t)
      from = t
    }
    gl!.useProgram(programs.up.prog)
    programs.up.i('uSrc', 0)
    gl!.enable(gl!.BLEND)
    gl!.blendFunc(gl!.ONE, gl!.ONE)
    for (let i = bloom.length - 1; i > 0; i--) {
      bindTex(0, bloom[i].tex)
      programs.up.v2('uTexel', 1 / bloom[i].w, 1 / bloom[i].h)
      draw(bloom[i - 1])
    }
    gl!.disable(gl!.BLEND)

    // Composite onto the canvas.
    const c = programs.composite
    gl!.useProgram(c.prog)
    bindTex(0, dst.tex)
    bindTex(1, bloom[0].tex)
    c.i('uDye', 0)
    c.i('uBloom', 1)
    c.f('uLevel', eased.level)
    c.f('uTime', time)
    gl!.uniform3fv(c.loc('uSeaDeep'), palette.seaDeep)
    gl!.uniform3fv(c.loc('uSeaLight'), palette.seaLight)
    gl!.uniform3fv(c.loc('uBody'), palette.body)
    gl!.uniform3fv(c.loc('uCore'), palette.core)
    draw(null)
  }

  function setMask(source: TexImageSource | MaskData | null) {
    maskOn = !!source
    if (!source || lost) return
    if (!mask) {
      mask = gl!.createTexture()!
      gl!.bindTexture(gl!.TEXTURE_2D, mask)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    }
    gl!.bindTexture(gl!.TEXTURE_2D, mask)
    if ('data' in source && source.data instanceof Uint8Array) {
      // Rows of single bytes aren't 4-aligned in general.
      gl!.pixelStorei(gl!.UNPACK_ALIGNMENT, 1)
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.R8, source.width, source.height, 0, gl!.RED, gl!.UNSIGNED_BYTE, source.data)
      gl!.pixelStorei(gl!.UNPACK_ALIGNMENT, 4)
    } else {
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source as TexImageSource)
    }
  }

  function dispose() {
    canvas.removeEventListener('webglcontextlost', onLost)
    canvas.removeEventListener('webglcontextrestored', onRestored)
    dye?.forEach(free)
    bloom.forEach(free)
    dye = null
    bloom = []
    if (mask) gl!.deleteTexture(mask)
    Object.values(programs).forEach((p) => gl!.deleteProgram(p.prog))
    gl!.deleteVertexArray(vao)
  }

  build()
  resize()
  return {
    render,
    resize,
    setPalette: (p) => {
      palette = resolvePalette(p)
    },
    setMask,
    get live() {
      return !lost
    },
    dispose,
  }
}

type Program = ReturnType<typeof program>

function resolvePalette(p: PaletteName | Palette): Palette {
  return typeof p === 'string' ? PALETTES[p] : p
}

function program(gl: WebGL2RenderingContext, frag: string) {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Energy shader: ${gl.getShaderInfoLog(s)}`)
    return s
  }
  const prog = gl.createProgram()!
  const vs = shader(gl.VERTEX_SHADER, VERT)
  const fs = shader(gl.FRAGMENT_SHADER, frag)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Energy program: ${gl.getProgramInfoLog(prog)}`)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  const locs = new Map<string, WebGLUniformLocation | null>()
  const loc = (name: string) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name))
    return locs.get(name)!
  }
  return {
    prog,
    loc,
    f: (name: string, v: number) => gl.uniform1f(loc(name), v),
    i: (name: string, v: number) => gl.uniform1i(loc(name), v),
    v2: (name: string, x: number, y: number) => gl.uniform2f(loc(name), x, y),
  }
}
