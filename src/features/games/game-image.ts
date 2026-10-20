
/** The longest side the picture is kept at, and the most Bridge accepts. */
const MAX_SIDE = 800;
const MIN_SIDE = 200;
/** Under Bridge's 512 kB limit, with room to spare. */
const MAX_BYTES = 450 * 1024;

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function prepareGameImage(file: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    for (let side = MAX_SIDE; side >= MIN_SIDE; side = Math.round(side * 0.75)) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
      for (const [type, quality] of [["image/png", undefined], ["image/jpeg", 0.88]] as const) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
        if (blob && blob.type === type && blob.size <= MAX_BYTES) return blob;
      }
    }
    return null;
  } catch {
    return null;
  }
}
