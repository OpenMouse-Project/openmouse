/**
 * Heuristic-based artwork verification engine.
 * Analyzes uploaded images to determine if they're suitable mouse artwork.
 */

interface VerificationResult {
  passed: boolean;
  confidence: number;
  reason?: string;
  needsExternalReview: boolean;
}

interface ColorStats {
  avgR: number;
  avgG: number;
  avgB: number;
  stdR: number;
  stdG: number;
  stdB: number;
  uniqueColors: number;
  edgeDensity: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function analyzeColors(imageData: ImageData): ColorStats {
  const { data, width, height } = imageData;
  const pixelCount = width * height;

  let sumR = 0, sumG = 0, sumB = 0;
  let sumR2 = 0, sumG2 = 0, sumB2 = 0;
  const colorSet = new Set<number>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 128) continue;

    sumR += r;
    sumG += g;
    sumB += b;
    sumR2 += r * r;
    sumG2 += g * g;
    sumB2 += b * b;

    const colorKey = (r << 16) | (g << 8) | b;
    colorSet.add(colorKey);
  }

  const avgR = sumR / pixelCount;
  const avgG = sumG / pixelCount;
  const avgB = sumB / pixelCount;

  const stdR = Math.sqrt(sumR2 / pixelCount - avgR * avgR);
  const stdG = Math.sqrt(sumG2 / pixelCount - avgG * avgG);
  const stdB = Math.sqrt(sumB2 / pixelCount - avgB * avgB);

  let edgeCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const idxRight = (y * width + x + 1) * 4;
      const idxDown = ((y + 1) * width + x) * 4;

      const dx = Math.abs(data[idx] - data[idxRight]) +
                 Math.abs(data[idx + 1] - data[idxRight + 1]) +
                 Math.abs(data[idx + 2] - data[idxRight + 2]);

      const dy = Math.abs(data[idx] - data[idxDown]) +
                 Math.abs(data[idx + 1] - data[idxDown + 1]) +
                 Math.abs(data[idx + 2] - data[idxDown + 2]);

      if (dx > 50 || dy > 50) edgeCount++;
    }
  }

  return {
    avgR,
    avgG,
    avgB,
    stdR,
    stdG,
    stdB,
    uniqueColors: colorSet.size,
    edgeDensity: edgeCount / pixelCount,
  };
}

function detectSkinTones(imageData: ImageData): number {
  const { data } = imageData;
  let skinPixels = 0;
  let totalPixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (a < 128) continue;
    totalPixels++;

    if (r > 95 && g > 40 && b > 20 &&
        r > g && r > b &&
        (r - g) > 15 &&
        Math.abs(r - g) > 15) {
      skinPixels++;
    }
  }

  return totalPixels > 0 ? skinPixels / totalPixels : 0;
}

function calculateMouseScore(
  stats: ColorStats,
  aspectRatio: number,
  width: number,
  height: number,
): number {
  let score = 0;

  if (aspectRatio <= 2.5) score += 0.3;
  else if (aspectRatio <= 3) score += 0.15;

  if (stats.stdR > 20 && stats.stdG > 20 && stats.stdB > 20) score += 0.25;
  else if (stats.stdR > 10 && stats.stdG > 10 && stats.stdB > 10) score += 0.15;

  if (stats.edgeDensity > 0.02 && stats.edgeDensity < 0.15) score += 0.25;
  else if (stats.edgeDensity > 0.01 && stats.edgeDensity < 0.2) score += 0.15;

  if (width >= 300 && height >= 300) score += 0.1;
  if (width >= 500 && height >= 500) score += 0.1;

  const brightness = (stats.avgR + stats.avgG + stats.avgB) / 3;
  if (brightness > 30 && brightness < 220) score += 0.1;

  return Math.min(score, 1);
}

export async function verifyArtwork(file: File): Promise<VerificationResult> {
  if (!file.type.startsWith("image/")) {
    return {
      passed: false,
      confidence: 0,
      reason: "Not an image file",
      needsExternalReview: false,
    };
  }

  const allowedTypes = ["image/png", "image/webp", "image/jpeg"];
  if (!allowedTypes.includes(file.type)) {
    return {
      passed: false,
      confidence: 0,
      reason: "Only PNG, WebP, or JPEG allowed",
      needsExternalReview: false,
    };
  }

  if (file.size > 5 * 1024 * 1024) {
    return {
      passed: false,
      confidence: 0,
      reason: "File too large (max 5MB)",
      needsExternalReview: false,
    };
  }

  if (file.size < 1024) {
    return {
      passed: false,
      confidence: 0,
      reason: "File too small (likely corrupted)",
      needsExternalReview: false,
    };
  }

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return {
      passed: false,
      confidence: 0,
      reason: "Failed to load image",
      needsExternalReview: false,
    };
  }

  if (img.width < 200 || img.height < 200) {
    return {
      passed: false,
      confidence: 0,
      reason: "Image too small (minimum 200x200)",
      needsExternalReview: false,
    };
  }

  if (img.width > 4000 || img.height > 4000) {
    return {
      passed: false,
      confidence: 0,
      reason: "Image too large (max 4000x4000)",
      needsExternalReview: false,
    };
  }

  const aspectRatio = Math.max(img.width, img.height) / Math.min(img.width, img.height);
  if (aspectRatio > 3) {
    return {
      passed: false,
      confidence: 0,
      reason: "Aspect ratio too extreme (max 3:1)",
      needsExternalReview: false,
    };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      passed: false,
      confidence: 0,
      reason: "Canvas not supported",
      needsExternalReview: false,
    };
  }

  const sampleWidth = Math.min(img.width, 400);
  const sampleHeight = Math.min(img.height, 400);
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  ctx.drawImage(img, 0, 0, sampleWidth, sampleHeight);

  const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);

  const skinToneRatio = detectSkinTones(imageData);
  if (skinToneRatio > 0.25) {
    return {
      passed: false,
      confidence: 0,
      reason: "Image may contain inappropriate content",
      needsExternalReview: false,
    };
  }

  const colorStats = analyzeColors(imageData);
  const mouseScore = calculateMouseScore(colorStats, aspectRatio, img.width, img.height);

  if (mouseScore > 0.5) {
    return {
      passed: true,
      confidence: mouseScore,
      needsExternalReview: false,
    };
  }

  if (mouseScore > 0.3) {
    return {
      passed: false,
      confidence: mouseScore,
      reason: "Image needs review - unclear if it's a mouse",
      needsExternalReview: true,
    };
  }

  return {
    passed: false,
    confidence: mouseScore,
    reason: "Image does not appear to be a mouse",
    needsExternalReview: false,
  };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
