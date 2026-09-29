import type { MaskData } from './energy/layer'

/**
 * Shrink a person segmentation mask (confidences 0..1, rows from the top) to
 * about `width` pixels across, as bytes, mirrored when `flipX` so it lies the
 * same way as a pose read with `flipX`. The energy layer only needs a soft
 * silhouette, so each output pixel takes one sample from the middle of its
 * block: the cost is the output's size, not the camera's. `out` is reused when
 * it already has the right size.
 */
export function shrinkMask(
  src: ArrayLike<number>,
  w: number,
  h: number,
  width: number,
  flipX: boolean,
  out?: MaskData | null,
): MaskData {
  const step = Math.max(1, Math.ceil(w / width))
  const ow = Math.max(1, Math.floor(w / step))
  const oh = Math.max(1, Math.floor(h / step))
  const data = out && out.width === ow && out.height === oh ? out.data : new Uint8Array(ow * oh)
  const half = step >> 1
  for (let y = 0; y < oh; y++) {
    const row = (y * step + half) * w
    for (let x = 0; x < ow; x++) {
      const v = src[row + x * step + half]
      data[y * ow + (flipX ? ow - 1 - x : x)] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)
    }
  }
  return { data, width: ow, height: oh }
}
