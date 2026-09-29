import type { View } from '../skeleton'

// The energy layer reads the qi model's `QiFrame` (src/qi/); only the view it
// draws into is declared here.

/**
 * Where the learner's image sits on the energy canvas, in the canvas's CSS
 * pixels: `{ ...containView(cssW, cssH, aspect), aspect }` for a contained image.
 */
export interface EnergyView extends View {
  /** Width / height of the image the pose (and any mask) came from. */
  aspect: number
}
