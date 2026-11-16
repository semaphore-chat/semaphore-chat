/** How big an `AttachmentTile` draws an image: decided before the picture loads, so the list never shifts. */

/** The largest box an image is drawn in; a smaller image keeps its own size. */
export const IMAGE_MAX = { width: 320, height: 240 } as const;
/** The box of an image whose size is not known. */
export const IMAGE_FALLBACK = { width: 240, height: 160 } as const;

/** The box an image is drawn in: its own size, shrunk to fit `IMAGE_MAX`, or the fallback box. */
export function imageBox(width?: number | null, height?: number | null): { width: number; height: number } {
  if (!width || !height || width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { ...IMAGE_FALLBACK };
  }
  const scale = Math.min(1, IMAGE_MAX.width / width, IMAGE_MAX.height / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
