import { MAX_CAPS, POINTS } from './body'

// GLSL for the energy layer. Positions are in screen units: y runs 0..1 down
// the canvas, x runs 0..uAspect across it (uAspect = width / height), so the
// body geometry from body.ts can be used as is. The dye texture holds
// intensities, coloured only when compositing: r the sea, g light carried out
// of the body, b the hottest points (all three advected and fading), and a the
// light held in the body, drawn fresh each frame.

const POINT = Object.fromEntries(POINTS.map((k, i) => [k, i])) as Record<(typeof POINTS)[number], number>

/** A full-screen triangle from gl_VertexID; no buffers needed. */
export const VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

// 3D simplex noise with its analytic gradient, from Ashima Arts and Stefan
// Gustavson's webgl-noise (MIT licence).
const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v, out vec3 gradient) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec3 ns = 0.142857142857 * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  gradient *= 105.0;
  return 105.0 * dot(m4, pdotx);
}
float snoise(vec3 v) { vec3 g; return snoise(v, g); }
`

/**
 * One simulation step: carry last frame's dye along the flow (curl noise for
 * the sea, currents that follow the body), let it fade, and pour in new light
 * where the body is charged.
 */
export const SIM = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outDye;

uniform sampler2D uPrev;
uniform float uAspect;
uniform float uDt;
uniform float uTime;

uniform float uLevel;
uniform float uBreath;
uniform float uFlow;
uniform float uPalmField;
uniform vec2 uArmFlow;
// dantian, lPalm, rPalm, lArm, rArm, spine, crown, lFoot, rFoot
uniform float uReg[9];

uniform float uPresence;
uniform float uT;
uniform int uCapCount;
uniform vec4 uCaps[${MAX_CAPS}];
uniform vec4 uCapInfo[${MAX_CAPS}];
// Distance from the start of each capsule's chain (shoulder, hip) to its start.
uniform float uCapAlong[${MAX_CAPS}];
uniform vec2 uPts[${POINTS.length}];

uniform sampler2D uMask;
uniform float uMaskOn;
// The mask image's rectangle in screen units: x, y, width, height.
uniform vec4 uMaskRect;

${NOISE}

float gauss(vec2 d, float r) { return exp(-dot(d, d) / (r * r)); }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Distance from p to segment ab, and the nearest point on it.
float segDist(vec2 p, vec2 a, vec2 b, out vec2 q, out float h) {
  vec2 ab = b - a;
  h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
  q = a + ab * h;
  return length(p - q);
}

void main() {
  vec2 P = vec2(vUv.x * uAspect, 1.0 - vUv.y);
  float t = uTime;
  float T = max(uT, 1e-3);
  float lvl = uLevel;
  float pres = uPresence;
  // How organised the body's currents are: they need qi, and moving in step
  // draws them together. Out of step they only soften, never vanish.
  float cohere = pres * (0.25 + 0.75 * lvl) * (0.35 + 0.65 * uFlow);

  // ---- The sea: slow curl noise, three octaves, divergence free. The fine
  // octave draws the dye out into filaments.
  vec3 g1, g2, g3;
  snoise(vec3(P * 1.3, t * 0.045), g1);
  snoise(vec3(P * 3.2 + 11.0, t * 0.08), g2);
  snoise(vec3(P * 7.5 + 23.0, t * 0.14), g3);
  vec2 grad = g1.xy * 1.3 + 0.45 * g2.xy * 3.2 + 0.18 * g3.xy * 7.5;
  vec2 seaVel = vec2(grad.y, -grad.x) * mix(0.012, 0.022, lvl) * mix(1.15, 0.8, uFlow * lvl);
  vec2 vel = vec2(0.0);
  // Where the body's light may leave it: fingertips, roots, the crown.
  float spill = 0.0;

  // ---- The body: breath swells it; currents run along each capsule.
  float breathSwell = 1.0 + 0.16 * uBreath * (0.3 + 0.7 * lvl);
  float bodyD = 1e3;
  vec2 nearQ = P;
  float nearD = 1e3;
  // The nearest capsule's stream: distance along its chain, direction, speed.
  float nearAlong = 0.0;
  vec2 nearDir = vec2(0.0, -1.0);
  float nearS = 0.0;
  vec2 armIn = vec2(0.0);
  for (int i = 0; i < ${MAX_CAPS}; i++) {
    if (i >= uCapCount) break;
    vec4 c = uCaps[i];
    vec4 info = uCapInfo[i];
    if (info.z <= 0.0) continue;
    vec2 q;
    float h;
    float d = segDist(P, c.xy, c.zw, q, h) - mix(info.x, info.y, h) * breathSwell;
    // Doubtful capsules shrink away rather than pop.
    d += (1.0 - info.z) * 0.5 * T;
    bodyD = smin(bodyD, d, 0.1 * T);

    vec2 dir = normalize(c.zw - c.xy + 1e-6);
    float near = exp(-max(d, 0.0) / (0.14 * T)) * info.z;
    int kind = int(info.w + 0.5);
    float s;
    if (kind == 0) s = 0.7;                  // the trunk: rising up the spine
    else if (kind == 1) s = 1.9 * uArmFlow.x; // arms: out to the fingertips, or back in
    else if (kind == 2) s = 1.9 * uArmFlow.y;
    else if (kind == 3) s = 0.7;             // legs: sinking into the ground
    else s = 0.5;                            // neck and head: up to the crown
    if (d < nearD) {
      nearD = d;
      nearQ = q;
      nearAlong = uCapAlong[i] + h * length(c.zw - c.xy);
      nearDir = dir;
      nearS = s * cohere;
    }
    vel += dir * s * T * near * cohere;
    // A gentle pull toward the limb's axis keeps its stream inside it.
    vel += (q - P) * 1.2 * near * cohere * step(0.0, d);
    if (kind == 1) armIn.x = max(armIn.x, (1.0 - smoothstep(-0.02 * T, 0.06 * T, d)) * info.z);
    if (kind == 2) armIn.y = max(armIn.y, (1.0 - smoothstep(-0.02 * T, 0.06 * T, d)) * info.z);
  }
  if (uCapCount == 0) bodyD = 1e3;

  vec2 D = uPts[${POINT.dantian}];
  vec2 crown = uPts[${POINT.crown}];
  vec2 lPalm = uPts[${POINT.lPalm}];
  vec2 rPalm = uPts[${POINT.rPalm}];
  vec2 lTip = uPts[${POINT.lTip}];
  vec2 rTip = uPts[${POINT.rTip}];
  vec2 lFoot = uPts[${POINT.lFoot}];
  vec2 rFoot = uPts[${POINT.rFoot}];

  // A slow vortex around the dantian, and a wider, fainter orbit of the sea
  // that gathers toward the body as qi builds.
  vec2 r = P - D;
  float rl = length(r) + 1e-4;
  vec2 tang = vec2(-r.y, r.x) / rl;
  vel += tang * T * 0.5 * exp(-rl * rl / (0.9 * T * 0.9 * T)) * cohere * (0.4 + uReg[0]);
  vel += (tang * 0.14 - r / rl * 0.05 * smoothstep(0.6 * T, 2.5 * T, rl)) * lvl * uFlow * pres * T;

  // Breath: the boundary of the body swells outward on the in-breath.
  vec2 outward = (P - nearQ) / (length(P - nearQ) + 1e-4);
  vel += outward * uBreath * 0.55 * T * exp(-abs(nearD) / (0.5 * T)) * pres * (0.3 + 0.7 * lvl);

  // Fingertips spill the arm's stream out into the sea.
  for (int s = 0; s < 2; s++) {
    vec2 tip = s == 0 ? lTip : rTip;
    vec2 palm = s == 0 ? lPalm : rPalm;
    float af = s == 0 ? uArmFlow.x : uArmFlow.y;
    vec2 dir = normalize(tip - palm + 1e-6);
    vec2 rel = P - tip;
    float ahead = dot(rel, dir);
    float side = dot(rel, vec2(-dir.y, dir.x));
    float jet = exp(-side * side / (0.12 * T * 0.12 * T) * (1.0 / (1.0 + max(ahead, 0.0) / (0.4 * T))))
      * exp(-max(ahead, 0.0) / (1.4 * T)) * smoothstep(-0.3 * T, 0.0, ahead);
    vel += dir * max(af, 0.0) * 1.6 * T * jet * cohere;
    spill = max(spill, jet * (0.3 + 0.7 * max(af, 0.0)));
  }

  // Roots: below each foot the current sinks and spreads.
  for (int s = 0; s < 2; s++) {
    vec2 f = s == 0 ? lFoot : rFoot;
    vec2 rel = P - f;
    float below = smoothstep(-0.1 * T, 0.2 * T, rel.y);
    float root = exp(-rel.x * rel.x / (0.25 * T * 0.25 * T * (1.0 + max(rel.y, 0.0) / (0.3 * T)))) * exp(-max(rel.y, 0.0) / (1.2 * T));
    vel += vec2(sign(rel.x) * 0.25, 0.7) * T * root * below * cohere;
    spill = max(spill, root * below);
  }
  vec2 above = P - crown;
  spill = max(spill, exp(-above.x * above.x / (0.2 * T * 0.2 * T)) * exp(-max(-above.y, 0.0) / T) * smoothstep(0.1 * T, -0.1 * T, above.y));

  // The field between facing palms: arcs through both palms (bipolar
  // coordinates) that bulge with the breath and shimmer along their length.
  vec2 pa = lPalm - P;
  vec2 pb = rPalm - P;
  float sigma = acos(clamp(dot(pa, pb) / (length(pa) * length(pb) + 1e-6), -1.0, 1.0));
  float span = length(rPalm - lPalm);
  float fieldOn = uPalmField * pres * smoothstep(3.2 * T, 1.4 * T, span);
  float inField = smoothstep(0.5 - 0.08 * uBreath, 0.85, sigma / 3.14159);
  vec2 axis = (rPalm - lPalm) / (span + 1e-5);
  float lane = sin(sigma * 11.0 + 1.5 * snoise(vec3(P / T * 1.5, t * 0.3)) - t * 0.6);
  vel += axis * lane * 0.35 * T * inField * fieldOn;

  // Inside the body its own currents lead and the sea's turbulence calms.
  float hold = (1.0 - smoothstep(0.0, 0.35 * T, bodyD)) * pres;
  vel += seaVel * (1.0 - 0.65 * hold);

  // ---- Carry last frame along, and let it fade with a long tail. The
  // body's light lingers in the body and where it spills; elsewhere it fades
  // fast, and what it loses becomes the sea.
  vec2 back = P - vel * uDt;
  vec3 prev = texture(uPrev, vec2(back.x / uAspect, 1.0 - back.y)).rgb;
  float keep = max(hold, spill * 0.85);
  vec3 tau = vec3(7.0, mix(0.3 + 0.4 * lvl, 1.2 + 1.3 * lvl, keep), 0.5 + 0.3 * lvl);
  vec3 dye = prev * exp(-uDt / tau);
  dye.r += (prev.g - dye.g) * 0.5 * (1.0 - hold);

  // ---- New light.
  float grain = snoise(vec3(P * 7.0, t * 0.35));
  float flicker = 0.65 + 0.35 * grain;

  // The sea: wisps that thicken as qi builds, and gather about the body.
  float seaN = snoise(vec3(P * 1.7 + vec2(0.0, -t * 0.03), t * 0.06)) + 0.5 * grain;
  float nearBody = exp(-max(bodyD, 0.0) / (1.6 * T)) * pres;
  float sea = smoothstep(0.3, 1.1, seaN) * mix(0.006, 0.045, lvl) * (1.0 + 2.5 * lvl * nearBody);

  // ---- Light held in the body. It is drawn fresh each frame into the alpha
  // channel, not carried, so the silhouette always reads; a share of it is
  // also poured into the dye, which the currents draw out into smoke.
  float inside = 1.0 - smoothstep(-0.12 * T, 0.06 * T, bodyD);
  if (uMaskOn > 0.5) {
    vec2 muv = (P - uMaskRect.xy) / uMaskRect.zw;
    if (all(greaterThanEqual(muv, vec2(0.0))) && all(lessThanEqual(muv, vec2(1.0))))
      inside = max(inside, texture(uMask, muv).r);
  }
  // Streams: noise laid along the nearest limb, sliding the way its current runs.
  float across = dot(P - nearQ, vec2(-nearDir.y, nearDir.x));
  float stream = snoise(vec3(nearAlong / T * 2.2 - t * nearS * 1.4, across / T * 3.2, t * 0.25));
  float streamLight = 0.35 + 0.65 * smoothstep(-0.4, 0.9, stream);
  // The body's edge, a soft seam of light that rides out and in with the breath.
  float rim = exp(-pow((bodyD - 0.02 * T) / (0.1 * T), 2.0));
  float held = inside * (0.006 + 0.2 * lvl) * streamLight + rim * (0.005 + 0.1 * lvl) * (0.6 + 0.4 * streamLight);
  held += dot(armIn, vec2(uReg[3], uReg[4])) * 0.35 * streamLight;

  // Charged regions. "hot" is the part that whitens.
  float hot = 0.0;
  float pulse = 1.0 + 0.15 * uBreath;
  held += gauss(P - D, 0.3 * T * pulse) * uReg[0] * 0.55;
  hot += gauss(P - D, 0.11 * T * pulse) * uReg[0] * 0.6;

  held += (gauss(P - lPalm, 0.16 * T) * uReg[1] + gauss(P - rPalm, 0.16 * T) * uReg[2]) * 0.5;
  hot += (gauss(P - lPalm, 0.06 * T) * uReg[1] + gauss(P - rPalm, 0.06 * T) * uReg[2]) * 0.7;

  vec2 sq;
  float sh;
  float spineD = segDist(P, D, crown, sq, sh);
  // Beads of light climbing the spine.
  held += exp(-spineD * spineD / (0.06 * T * 0.06 * T)) * uReg[5] * 0.4 * (0.5 + 0.5 * sin(sh * 16.0 - t * 2.4));

  // The crown: a light that opens upward.
  vec2 cr = P - crown;
  held += gauss(vec2(cr.x, min(cr.y, 0.0) * 0.4 + max(cr.y, 0.0)), 0.22 * T) * uReg[6] * 0.4;
  hot += gauss(cr, 0.07 * T) * uReg[6] * 0.5;

  // Roots through the feet, fanning down into the ground in strands.
  for (int s = 0; s < 2; s++) {
    vec2 rel = P - (s == 0 ? lFoot : rFoot);
    float charge = s == 0 ? uReg[7] : uReg[8];
    float down = max(rel.y, 0.0);
    float strand = smoothstep(-0.2, 0.7, snoise(vec3(rel.x / T * 4.0 / (1.0 + down / (0.5 * T)), down / T * 0.8 - t * 0.3, t * 0.1)));
    held += gauss(vec2(rel.x / (1.0 + down / (0.4 * T)), min(rel.y, 0.0) + down * 0.3), 0.15 * T) * charge * (0.3 + 0.7 * strand) * 0.45;
  }

  // The palm field.
  float field = inField * fieldOn * (0.6 + 0.4 * lane) * flicker;
  held += field * 0.3;
  hot += field * field * 0.25;
  held *= pres;
  hot *= pres;

  // A thin aura is fed to the dye so the body smokes a little at its edge.
  float aura = exp(-max(bodyD, 0.0) / (0.15 * T)) * (1.0 - inside) * lvl * pres;
  vec3 src = vec3(sea, held * 0.22 + aura * 0.06, hot * 0.4);
  dye += src * uDt;
  outDye = vec4(dye, held + hot);
}`

/** A plain copy, to carry the field over when the canvas is resized. */
export const COPY = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
void main() {
  o = texture(uSrc, vUv);
}`

/** Bloom downsample (dual filter): a 5-tap box around the centre. */
export const DOWN = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  vec2 h = uTexel * 0.5;
  vec4 s = texture(uSrc, vUv) * 4.0;
  s += texture(uSrc, vUv - h);
  s += texture(uSrc, vUv + h);
  s += texture(uSrc, vUv + vec2(h.x, -h.y));
  s += texture(uSrc, vUv - vec2(h.x, -h.y));
  o = s / 8.0;
}`

/** Bloom upsample (dual filter), added onto the level above. */
export const UP = /* glsl */ `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  vec2 h = uTexel * 0.5;
  vec4 s = texture(uSrc, vUv + vec2(-h.x * 2.0, 0.0));
  s += texture(uSrc, vUv + vec2(-h.x, h.y)) * 2.0;
  s += texture(uSrc, vUv + vec2(0.0, h.y * 2.0));
  s += texture(uSrc, vUv + vec2(h.x, h.y)) * 2.0;
  s += texture(uSrc, vUv + vec2(h.x * 2.0, 0.0));
  s += texture(uSrc, vUv + vec2(h.x, -h.y)) * 2.0;
  s += texture(uSrc, vUv + vec2(0.0, -h.y * 2.0));
  s += texture(uSrc, vUv + vec2(-h.x, -h.y)) * 2.0;
  o = s / 12.0;
}`

/** Colour the dye and its bloom with the palette, tone-map, and dither. */
export const COMPOSITE = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uDye;
uniform sampler2D uBloom;
uniform float uLevel;
uniform float uTime;
uniform vec3 uSeaDeep;
uniform vec3 uSeaLight;
uniform vec3 uBody;
uniform vec3 uCore;
// Overall strength of the light, 0..1 (1 as tuned).
uniform float uStrength;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 d = texture(uDye, vUv);
  // The bloom levels are summed; bring them back to about one level's worth.
  vec4 b = texture(uBloom, vUv) * 0.25;
  vec4 e = d + b * vec4(0.5, 0.6, 1.2, 0.9);
  float sea = e.r;
  vec3 col = mix(uSeaDeep, uSeaLight, smoothstep(0.0, 1.4, sea)) * sea;
  // Carried and held body light; the brightest of it turns to the core colour.
  col += uBody * e.g + mix(uBody, uCore, smoothstep(0.3, 1.2, e.a)) * e.a + uCore * e.b;
  // Where light piles up it whitens, as light does.
  float heat = e.a * 0.5 + e.b + e.g * 0.2;
  col += vec3(1.0) * max(heat - 0.9, 0.0) * 0.2;
  col = 1.0 - exp(-col * mix(0.9, 1.2, uLevel));
  col = pow(col, vec3(1.0 / 2.2));
  col *= uStrength;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`
