// Colours of the energy layer, in linear RGB 0..1. The simulation carries
// intensities only; colour is applied when compositing, so switching palette
// is instant.

export type RGB = readonly [number, number, number]

export interface Palette {
  /** The sea: its deep tone where it is thin, and its light where it gathers. */
  seaDeep: RGB
  seaLight: RGB
  /** Light held in and around the body. */
  body: RGB
  /** The hottest points (a charged dantian, a palm, the field between palms). */
  core: RGB
}

export const PALETTES = {
  // Indigo and violet sea, gold and amber body light.
  dusk: {
    seaDeep: [0.07, 0.04, 0.26],
    seaLight: [0.36, 0.2, 0.78],
    body: [1.0, 0.56, 0.16],
    core: [1.0, 0.86, 0.56],
  },
  // Deep teal sea, green-white light.
  jade: {
    seaDeep: [0.0, 0.13, 0.15],
    seaLight: [0.06, 0.48, 0.46],
    body: [0.36, 0.95, 0.58],
    core: [0.82, 1.0, 0.88],
  },
  // Deep crimson sea, orange-gold light.
  ember: {
    seaDeep: [0.24, 0.0, 0.015],
    seaLight: [0.75, 0.05, 0.04],
    body: [1.0, 0.3, 0.03],
    core: [1.0, 0.72, 0.28],
  },
} satisfies Record<string, Palette>

export type PaletteName = keyof typeof PALETTES
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[]
