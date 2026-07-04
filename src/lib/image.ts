import { FilterType, Point, WatermarkOptions } from '../types';
import { distance, getPerspectiveTransform } from './math';

async function getExifOrientation(src: string): Promise<number> {
  try {
    let arrayBuffer: ArrayBuffer;
    if (src.startsWith('data:')) {
      const parts = src.split(',');
      if (parts.length < 2) return -1;
      const base64 = parts[1];
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      arrayBuffer = bytes.buffer;
    } else {
      const res = await fetch(src);
      arrayBuffer = await res.arrayBuffer();
    }

    const view = new DataView(arrayBuffer);
    if (view.byteLength < 2 || view.getUint16(0, false) !== 0xFFD8) {
      return -2; // Not a JPEG
    }
    const length = view.byteLength;
    let offset = 2;
    while (offset < length) {
      if (offset + 2 > length) return -1;
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xFFE1) { // APP1 marker
        if (offset + 6 > length) return -1;
        if (view.getUint32(offset, false) !== 0x45786966) { // "Exif"
          return -1;
        }
        offset += 6; // Skip "Exif" + 2 bytes of zeros
        const tiffOffset = offset;
        if (offset + 8 > length) return -1;
        const littleEndian = view.getUint16(offset, false) === 0x4949; // "II" or "MM"
        offset += 2;
        if (view.getUint16(offset, littleEndian) !== 0x002A) {
          return -1;
        }
        const firstIFDOffset = view.getUint32(offset + 2, littleEndian);
        offset = tiffOffset + firstIFDOffset;
        if (offset + 2 > length) return -1;
        const numEntries = view.getUint16(offset, littleEndian);
        offset += 2;
        for (let i = 0; i < numEntries; i++) {
          if (offset + 12 > length) return -1;
          const tag = view.getUint16(offset, littleEndian);
          if (tag === 0x0112) { // Orientation tag
            return view.getUint16(offset + 8, littleEndian);
          }
          offset += 12;
        }
        return -1;
      } else if ((marker & 0xFF00) !== 0xFF00) {
        break;
      } else {
        if (offset + 2 > length) return -1;
        offset += view.getUint16(offset, false);
      }
    }
    return -1;
  } catch (e) {
    console.warn("Failed to parse EXIF orientation:", e);
    return -1;
  }
}

export async function downscaleImage(src: string, maxDim: number = 2000): Promise<string> {
  let orientation = -1;
  try {
    orientation = await getExifOrientation(src);
  } catch (e) {
    console.warn("Error getting EXIF orientation", e);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      
      // Determine if we need to swap width and height for destination canvas
      let swap = false;
      if (orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8) {
        swap = true;
      }
      
      let targetWidth = width;
      let targetHeight = height;
      
      if (swap) {
        targetWidth = height;
        targetHeight = width;
      }
      
      if (targetWidth > maxDim || targetHeight > maxDim) {
        const scale = Math.min(maxDim / targetWidth, maxDim / targetHeight);
        targetWidth = Math.round(targetWidth * scale);
        targetHeight = Math.round(targetHeight * scale);
        
        if (swap) {
          width = targetHeight;
          height = targetWidth;
        } else {
          width = targetWidth;
          height = targetHeight;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(src);
        return;
      }
      
      // Apply transform based on EXIF orientation
      switch (orientation) {
        case 2: // Horizontal flip
          ctx.translate(targetWidth, 0);
          ctx.scale(-1, 1);
          break;
        case 3: // 180 rotate
          ctx.translate(targetWidth, targetHeight);
          ctx.rotate(Math.PI);
          break;
        case 4: // Vertical flip
          ctx.translate(0, targetHeight);
          ctx.scale(1, -1);
          break;
        case 5: // Horizontal flip + 270 rotate
          ctx.rotate(0.5 * Math.PI);
          ctx.scale(1, -1);
          break;
        case 6: // 90 rotate CW
          ctx.translate(targetWidth, 0);
          ctx.rotate(0.5 * Math.PI);
          break;
        case 7: // Horizontal flip + 90 rotate
          ctx.rotate(0.5 * Math.PI);
          ctx.translate(targetWidth, -targetHeight);
          ctx.scale(-1, 1);
          break;
        case 8: // 270 rotate CW
          ctx.translate(0, targetHeight);
          ctx.rotate(-0.5 * Math.PI);
          break;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error("Failed to load image for downscaling"));
    img.src = src;
  });
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

export async function warpPerspective(
  imageSrc: string,
  corners: Point[] // [TL, TR, BR, BL]
): Promise<string> {
  const cv = (window as any).cv;
  const img = await loadImage(imageSrc);
  
  let w1 = distance(corners[0], corners[1]);
  let w2 = distance(corners[3], corners[2]);
  let h1 = distance(corners[0], corners[3]);
  let h2 = distance(corners[1], corners[2]);
  
  let dstW = Math.round(Math.max(w1, w2));
  let dstH = Math.round(Math.max(h1, h2));
  
  if (isNaN(dstW) || !isFinite(dstW) || dstW <= 0) dstW = 1;
  if (isNaN(dstH) || !isFinite(dstH) || dstH <= 0) dstH = 1;

  if (img.width === 0 || img.height === 0) {
    throw new Error("Source image dimensions are zero");
  }

  const MAX_DIM = 2000;
  if (dstW > MAX_DIM || dstH > MAX_DIM) {
    const scale = Math.min(MAX_DIM / dstW, MAX_DIM / dstH);
    dstW = Math.round(dstW * scale);
    dstH = Math.round(dstH * scale);
  }
  
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = dstW;
  dstCanvas.height = dstH;

  // 1. Try ultra-fast OpenCV.js WebAssembly warpPerspective first
  if (cv && cv.Mat && cv.imread && cv.warpPerspective) {
    let srcMat: any = null;
    let dstMat: any = null;
    let srcTri: any = null;
    let dstTri: any = null;
    let M: any = null;
    try {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;
      const srcCtx = srcCanvas.getContext('2d')!;
      srcCtx.drawImage(img, 0, 0);

      srcMat = cv.imread(srcCanvas);
      dstMat = new cv.Mat();
      srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners[0].x, corners[0].y,
        corners[1].x, corners[1].y,
        corners[2].x, corners[2].y,
        corners[3].x, corners[3].y
      ]);
      dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        dstW, 0,
        dstW, dstH,
        0, dstH
      ]);
      M = cv.getPerspectiveTransform(srcTri, dstTri);
      const dsize = new cv.Size(dstW, dstH);
      cv.warpPerspective(srcMat, dstMat, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
      cv.imshow(dstCanvas, dstMat);
      return dstCanvas.toDataURL('image/jpeg', 0.9);
    } catch (err) {
      console.warn("OpenCV warpPerspective failed, falling back to pure JS:", err);
    } finally {
      if (srcMat) { try { srcMat.delete(); } catch(e){} }
      if (dstMat) { try { dstMat.delete(); } catch(e){} }
      if (srcTri) { try { srcTri.delete(); } catch(e){} }
      if (dstTri) { try { dstTri.delete(); } catch(e){} }
      if (M) { try { M.delete(); } catch(e){} }
    }
  }

  // 2. Pure JS Fallback: Downscale the max output dimensions to ensure fluid frame rates
  const FALLBACK_MAX_DIM = 1000;
  if (dstW > FALLBACK_MAX_DIM || dstH > FALLBACK_MAX_DIM) {
    const scale = Math.min(FALLBACK_MAX_DIM / dstW, FALLBACK_MAX_DIM / dstH);
    dstW = Math.round(dstW * scale);
    dstH = Math.round(dstH * scale);
    dstCanvas.width = dstW;
    dstCanvas.height = dstH;
  }

  const dstCtx = dstCanvas.getContext('2d')!;
  
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = img.width;
  srcCanvas.height = img.height;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(img, 0, 0);
  
  const srcImgData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const srcData = srcImgData.data;
  
  const dstImgData = dstCtx.createImageData(dstW, dstH);
  const dstData = dstImgData.data;
  
  const dstPoints = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH }
  ];
  
  const h = getPerspectiveTransform(dstPoints, corners);
  const [t0, t1, t2, t3, t4, t5, t6, t7, t8] = h;
  
  if (t0 === 0 && t1 === 0 && t2 === 0 && t3 === 0 && t4 === 0) {
     return imageSrc;
  }

  // Optimize pixel copy with single 32-bit (RGBA) array writes instead of 4 separate byte writes
  const srcData32 = new Uint32Array(srcData.buffer);
  const dstData32 = new Uint32Array(dstData.buffer);

  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;

  for (let y = 0; y < dstH; y++) {
    const y_t1 = t1 * y + t2;
    const y_t4 = t4 * y + t5;
    const y_t7 = t7 * y + t8;
    const y_dstW = y * dstW;
    
    for (let x = 0; x < dstW; x++) {
      const d = t6 * x + y_t7;
      if (d === 0) continue;
      
      const sx = Math.round((t0 * x + y_t1) / d);
      const sy = Math.round((t3 * x + y_t4) / d);
      
      if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
        dstData32[y_dstW + x] = srcData32[sy * srcW + sx];
      }
    }
  }
  
  dstCtx.putImageData(dstImgData, 0, 0);
  return dstCanvas.toDataURL('image/jpeg', 0.9);
}

function boxBlur(imageData: ImageData, radius: number) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  
  const temp = new Uint8ClampedArray(data.length);
  temp.set(data);
  
  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < width) {
          const idx = (y * width + nx) * 4;
          rSum += temp[idx];
          gSum += temp[idx + 1];
          bSum += temp[idx + 2];
          count++;
        }
      }
      const destIdx = (y * width + x) * 4;
      data[destIdx] = Math.round(rSum / count);
      data[destIdx + 1] = Math.round(gSum / count);
      data[destIdx + 2] = Math.round(bSum / count);
    }
  }
  
  // Vertical pass
  temp.set(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < height) {
          const idx = (ny * width + x) * 4;
          rSum += temp[idx];
          gSum += temp[idx + 1];
          bSum += temp[idx + 2];
          count++;
        }
      }
      const destIdx = (y * width + x) * 4;
      data[destIdx] = Math.round(rSum / count);
      data[destIdx + 1] = Math.round(gSum / count);
      data[destIdx + 2] = Math.round(bSum / count);
    }
  }
}

export async function applyFilter(
  imageSrc: string, 
  filterType: FilterType,
  options: {
    rotation?: number;
    brightness?: number;
    contrast?: number;
  } = {}
): Promise<string> {
  const img = await loadImage(imageSrc);
  if (img.width === 0 || img.height === 0) {
    throw new Error("Source image dimensions are zero");
  }
  const rot = options.rotation || 0;
  const br = options.brightness !== undefined ? options.brightness : 100;
  const cr = options.contrast !== undefined ? options.contrast : 100;

  // 1. Rotate the base image
  const rotCanvas = document.createElement('canvas');
  if (rot === 90 || rot === 270) {
    rotCanvas.width = img.height;
    rotCanvas.height = img.width;
  } else {
    rotCanvas.width = img.width;
    rotCanvas.height = img.height;
  }
  const rotCtx = rotCanvas.getContext('2d')!;
  rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
  rotCtx.rotate((rot * Math.PI) / 180);
  rotCtx.drawImage(img, -img.width / 2, -img.height / 2);

  // 2. Apply Brightness and Contrast
  const adjCanvas = document.createElement('canvas');
  adjCanvas.width = rotCanvas.width;
  adjCanvas.height = rotCanvas.height;
  const adjCtx = adjCanvas.getContext('2d')!;
  adjCtx.filter = `brightness(${br}%) contrast(${cr}%)`;
  adjCtx.drawImage(rotCanvas, 0, 0);

  if (filterType === 'original') {
    return adjCanvas.toDataURL('image/jpeg', 0.9);
  } else if (filterType === 'photo') {
    const photoCanvas = document.createElement('canvas');
    photoCanvas.width = adjCanvas.width;
    photoCanvas.height = adjCanvas.height;
    const photoCtx = photoCanvas.getContext('2d')!;
    photoCtx.filter = 'saturate(1.1) contrast(1.05)';
    photoCtx.drawImage(adjCanvas, 0, 0);
    return photoCanvas.toDataURL('image/jpeg', 0.9);
  }

  // 3. Document / BW / Magic Color modes
  const scale = 0.1;
  const smallW = Math.max(1, Math.floor(adjCanvas.width * scale));
  const smallH = Math.max(1, Math.floor(adjCanvas.height * scale));
  
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = smallW;
  smallCanvas.height = smallH;
  const smallCtx = smallCanvas.getContext('2d')!;
  
  // Use pure-JS boxBlur for 100% cross-browser reliability instead of unstable ctx.filter
  smallCtx.drawImage(adjCanvas, 0, 0, smallW, smallH);
  const smallImgData = smallCtx.getImageData(0, 0, smallW, smallH);
  boxBlur(smallImgData, 3);
  smallCtx.putImageData(smallImgData, 0, 0);
  
  smallCtx.globalCompositeOperation = 'difference';
  smallCtx.fillStyle = 'white';
  smallCtx.fillRect(0, 0, smallW, smallH);
  
  const normalizedCanvas = document.createElement('canvas');
  normalizedCanvas.width = adjCanvas.width;
  normalizedCanvas.height = adjCanvas.height;
  const normCtx = normalizedCanvas.getContext('2d')!;
  
  normCtx.drawImage(adjCanvas, 0, 0);
  normCtx.globalCompositeOperation = 'color-dodge';
  normCtx.imageSmoothingEnabled = true;
  normCtx.imageSmoothingQuality = 'high';
  normCtx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, adjCanvas.width, adjCanvas.height);
  
  const imageData = normCtx.getImageData(0, 0, adjCanvas.width, adjCanvas.height);
  const data = imageData.data;
  
  let blackPoint = 80; 
  let whitePoint = 220; 
  
  if (filterType === 'magic') {
     blackPoint = 40; 
     whitePoint = 245; 
  } else if (filterType === 'bw') {
     blackPoint = 120;
     whitePoint = 200;
  }
  
  const range = whitePoint - blackPoint;
  
  for (let i = 0; i < data.length; i += 4) {
     let r = data[i];
     let g = data[i+1];
     let b = data[i+2];
     
     let lum = r * 0.299 + g * 0.587 + b * 0.114;
     let chroma = Math.max(r, g, b) - Math.min(r, g, b);

     if (filterType === 'bw') {
        let v = 0;
        if (lum < blackPoint) v = 0;
        else if (lum > whitePoint) v = 255;
        else v = (lum - blackPoint) * 255 / range;
        
        data[i] = v;
        data[i+1] = v;
        data[i+2] = v;
     } else if (filterType === 'magic') {
        // MAGIC FILTER: Preserve colors, whiten background
        // Colorful pixels (stamps, photos) get protection from aggressive whitening
        const protection = Math.min(70, chroma * 2.0);
        const activeWhitePoint = Math.min(255, whitePoint + protection);
        
        if (lum > activeWhitePoint) {
           data[i] = 255;
           data[i+1] = 255;
           data[i+2] = 255;
        } else {
           // Smooth transition near the white point to prevent harsh edges
           let whiteFactor = 1.0;
           if (lum > activeWhitePoint - 20) {
               whiteFactor = (activeWhitePoint - lum) / 20;
           }

           // Reduce black point influence for colorful pixels to keep ink colors rich
           const adjustedBlackPoint = blackPoint * Math.max(0, 1 - (chroma / 30));
           const currentRange = activeWhitePoint - adjustedBlackPoint;
           
           let s = (lum - adjustedBlackPoint) * 255 / (currentRange || 1);
           s = Math.min(255, Math.max(0, s));
           
           // Boost saturation and maintain color ratio
           const satBoost = 1.25;
           const ratio = s / (lum || 1);
           
           let nr = (r * ratio - s) * satBoost + s;
           let ng = (g * ratio - s) * satBoost + s;
           let nb = (b * ratio - s) * satBoost + s;
           
           // Blend towards white for background areas
           data[i] = Math.min(255, Math.max(0, nr * whiteFactor + 255 * (1 - whiteFactor)));
           data[i+1] = Math.min(255, Math.max(0, ng * whiteFactor + 255 * (1 - whiteFactor)));
           data[i+2] = Math.min(255, Math.max(0, nb * whiteFactor + 255 * (1 - whiteFactor)));
        }
     } else { // 'document'
        // DOCUMENT FILTER: Balanced contrast and color
        let s = (lum - blackPoint) * 255 / range;
        s = Math.min(255, Math.max(0, s));
        const ratio = s / (lum || 1);
        
        data[i] = Math.min(255, Math.max(0, r * ratio));
        data[i+1] = Math.min(255, Math.max(0, g * ratio));
        data[i+2] = Math.min(255, Math.max(0, b * ratio));
     }
  }
  
  normCtx.putImageData(imageData, 0, 0);
  return normalizedCanvas.toDataURL('image/jpeg', 0.9);
}

function getCornerAngle(p0: Point, p1: Point, p2: Point): number {
  const v1 = { x: p0.x - p1.x, y: p0.y - p1.y };
  const v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const len1 = Math.hypot(v1.x, v1.y);
  const len2 = Math.hypot(v2.x, v2.y);
  if (len1 === 0 || len2 === 0) return 0;
  const cosTheta = dot / (len1 * len2);
  return Math.acos(Math.max(-1, Math.min(1, cosTheta))) * (180 / Math.PI);
}

function orderCorners(pts: Point[]): Point[] {
  if (pts.length !== 4) return pts;
  
  // 1. Try sum/difference method (geometrically robust for Top-Left, Top-Right, Bottom-Right, Bottom-Left)
  let tl = pts[0];
  let tr = pts[0];
  let br = pts[0];
  let bl = pts[0];
  
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;
  
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = p;
    }
  }
  
  // Verify that all 4 resolved points are unique reference points
  const uniquePoints = new Set([tl, tr, br, bl]);
  if (uniquePoints.size === 4) {
    return [tl, tr, br, bl];
  }
  
  // 2. Fallback to polar angle sorting if any duplicates occurred
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  
  const withAngles = pts.map(p => ({
    p,
    angle: Math.atan2(p.y - cy, p.x - cx)
  }));
  
  withAngles.sort((a, b) => a.angle - b.angle);
  return withAngles.map(item => item.p);
}

interface Candidate {
  corners: Point[];
  confidence: number;
}

function isImageBorderCorners(corners: Point[], w: number, h: number): boolean {
  const marginW = w * 0.035; // 3.5%
  const marginH = h * 0.035; // 3.5%
  let tlClose = false, trClose = false, brClose = false, blClose = false;
  for (const p of corners) {
    if (p.x <= marginW && p.y <= marginH) tlClose = true;
    if (p.x >= w - marginW && p.y <= marginH) trClose = true;
    if (p.x >= w - marginW && p.y >= h - marginH) brClose = true;
    if (p.x <= marginW && p.y >= h - marginH) blClose = true;
  }
  const closeCount = (tlClose ? 1 : 0) + (trClose ? 1 : 0) + (brClose ? 1 : 0) + (blClose ? 1 : 0);
  return closeCount >= 3;
}

function extractBestQuadrilateral(
  cv: any,
  edgeMat: any,
  w: number,
  h: number,
  forceConvexHull: boolean = false,
  imgWidth?: number,
  imgHeight?: number
): Candidate | null {
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  let closedEdgeMat = new cv.Mat();
  
  try {
    // Zero out the outer border of the edge matrix to prevent snapping/merging with the image bounds
    try {
      const borderClr = new cv.Scalar(0);
      cv.rectangle(edgeMat, new cv.Point(0, 0), new cv.Point(w - 1, h - 1), borderClr, 6);
    } catch (e) {
      console.warn("Failed to clear edgeMat border:", e);
    }

    // Apply morphological closing to close gaps in the edge lines before finding contours
    let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    try {
      cv.morphologyEx(edgeMat, closedEdgeMat, cv.MORPH_CLOSE, kernel);
    } catch (e) {
      console.warn("Failed morphological closing in extractBestQuadrilateral, using raw edgeMat:", e);
      edgeMat.copyTo(closedEdgeMat);
    } finally {
      kernel.delete();
    }

    // Use RETR_LIST instead of RETR_EXTERNAL to detect nested document pages inside binding covers or table frames
    cv.findContours(closedEdgeMat, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    
    let bestCandidate: Candidate | null = null;
    const totalArea = w * h;

    for (let i = 0; i < contours.size(); i++) {
      let contour = contours.get(i);
      let approx = new cv.Mat();
      let hullMat: any = null;
      try {
        let area = cv.contourArea(contour);

        // Determine dynamic minimum area ratio based on original input image resolution
        let minAreaRatio = 0.12; // default 12%
        if (imgWidth && imgHeight) {
          const originalPixels = imgWidth * imgHeight;
          if (originalPixels > 8000000) {      // > 8 MP (e.g. 12MP, 4K)
            minAreaRatio = 0.04; // 4% (highly detailed, allow smaller size relative to image)
          } else if (originalPixels > 4000000) { // > 4 MP
            minAreaRatio = 0.06; // 6%
          } else if (originalPixels > 2000000) { // > 2 MP
            minAreaRatio = 0.08; // 8%
          } else if (originalPixels > 1000000) { // > 1 MP
            minAreaRatio = 0.10; // 10%
          }
        }

        // Document must occupy between minAreaRatio and 95% of the overall frame
        if (area < totalArea * minAreaRatio || area > totalArea * 0.95) {
          continue;
        }

        let peri = cv.arcLength(contour, true);

        // We'll perform polygon approximation.
        let workingContour = contour;
        
        if (forceConvexHull) {
          hullMat = new cv.Mat();
          cv.convexHull(contour, hullMat, false, true);
          workingContour = hullMat;
          peri = cv.arcLength(hullMat, true);
        }

        // Dynamic Epsilon loop for precision contour refinement
        let success = false;
        let targetEpsilon = 0.02;
        
        // Sweep epsilon to try and find a clean 4-corner approximation
        for (let eps = 0.01; eps <= 0.06; eps += 0.005) {
          cv.approxPolyDP(workingContour, approx, eps * peri, true);
          if (approx.rows === 4) {
            success = true;
            targetEpsilon = eps;
            break;
          }
        }

        // Try convex hull as a refinement fallback if we still cannot find 4 corners
        if (!success && !forceConvexHull) {
          hullMat = new cv.Mat();
          cv.convexHull(contour, hullMat, false, true);
          peri = cv.arcLength(hullMat, true);
          for (let eps = 0.01; eps <= 0.06; eps += 0.005) {
            cv.approxPolyDP(hullMat, approx, eps * peri, true);
            if (approx.rows === 4) {
              success = true;
              targetEpsilon = eps;
              break;
            }
          }
        }

        let pts: Point[] = [];
        if (success && approx.rows === 4) {
          for (let j = 0; j < 4; j++) {
            pts.push({
              x: approx.data32S[j * 2],
              y: approx.data32S[j * 2 + 1]
            });
          }
        } else {
          // Fallback: Get approximation (e.g. epsilon = 0.02) and find its 4 extreme corners
          cv.approxPolyDP(workingContour, approx, 0.02 * peri, true);
          const numPoints = approx.rows;
          if (numPoints >= 3) {
            const tempPts: Point[] = [];
            for (let j = 0; j < numPoints; j++) {
              tempPts.push({
                x: approx.data32S[j * 2],
                y: approx.data32S[j * 2 + 1]
              });
            }
            let tl = tempPts[0];
            let tr = tempPts[0];
            let br = tempPts[0];
            let bl = tempPts[0];
            
            let minSum = Infinity;
            let maxSum = -Infinity;
            let minDiff = Infinity;
            let maxDiff = -Infinity;
            
            for (const p of tempPts) {
              const sum = p.x + p.y;
              const diff = p.x - p.y;
              
              if (sum < minSum) { minSum = sum; tl = p; }
              if (sum > maxSum) { maxSum = sum; br = p; }
              if (diff > maxDiff) { maxDiff = diff; tr = p; }
              if (diff < minDiff) { minDiff = diff; bl = p; }
            }
            pts = [tl, tr, br, bl];
            success = true;
          }
        }

        if (success && pts.length === 4) {
          const ordered = orderCorners(pts);

          // Reject if corners are duplicate, too close to each other, or snap directly to the image outer frame
          const minCornerDistance = Math.min(w, h) * 0.08;
          let tooClose = false;
          if (isImageBorderCorners(ordered, w, h)) {
            tooClose = true;
          } else {
            for (let k = 0; k < 4; k++) {
              for (let m = k + 1; m < 4; m++) {
                if (distance(ordered[k], ordered[m]) < minCornerDistance) {
                  tooClose = true;
                }
              }
            }
          }

          if (!tooClose) {
            // Compute detailed confidence score based on corner orthogonality and opposite side equality
            let deviationSum = 0;
            for (let j = 0; j < 4; j++) {
              const pPrev = ordered[(j + 3) % 4];
              const pCurr = ordered[j];
              const pNext = ordered[(j + 1) % 4];
              const angle = getCornerAngle(pPrev, pCurr, pNext);
              deviationSum += Math.abs(angle - 90);
            }
            const avgDeviation = deviationSum / 4;

            const w1 = distance(ordered[0], ordered[1]);
            const w2 = distance(ordered[3], ordered[2]);
            const h1 = distance(ordered[0], ordered[3]);
            const h2 = distance(ordered[1], ordered[2]);

            const sideRatioW = Math.min(w1, w2) / Math.max(w1, w2);
            const sideRatioH = Math.min(h1, h2) / Math.max(h1, h2);

            let confidence = 100;
            confidence -= avgDeviation * 2.5;
            confidence -= (1 - sideRatioW) * 40;
            confidence -= (1 - sideRatioH) * 40;
            
            const areaRatio = area / totalArea;
            if (areaRatio < 0.2) {
              confidence -= (0.2 - areaRatio) * 100;
            }

            confidence = Math.max(0, Math.min(100, confidence));

            if (!bestCandidate || confidence > bestCandidate.confidence) {
              bestCandidate = {
                corners: ordered,
                confidence: confidence
              };
            }
          }
        }
      } finally {
        approx.delete();
        if (hullMat) {
          try { hullMat.delete(); } catch(e){}
        }
        contour.delete();
      }
    }
    
    contours.delete();
    hierarchy.delete();
    if (closedEdgeMat) {
      try { closedEdgeMat.delete(); } catch(e){}
    }
    return bestCandidate;
  } catch (err) {
    console.error("Error in extractBestQuadrilateral:", err);
    try { contours.delete(); } catch(e){}
    try { hierarchy.delete(); } catch(e){}
    if (closedEdgeMat) {
      try { closedEdgeMat.delete(); } catch(e){}
    }
    return null;
  }
}

function detectDocumentCornersOpenCV(img: HTMLImageElement | HTMLCanvasElement): Point[] | null {
  const cv = (window as any).cv;
  if (!cv || !cv.Mat) {
    console.log("OpenCV.js not loaded yet or unavailable.");
    return null;
  }

  const maxDim = 800;
  let scale = Math.min(maxDim / img.width, maxDim / img.height);
  if (scale > 1) scale = 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  let src: any = null;
  try {
    src = cv.imread(canvas);
  } catch (err) {
    console.error("Error reading canvas with cv.imread:", err);
    return null;
  }

  let gray = new cv.Mat();
  let blurred = new cv.Mat();
  let edges = new cv.Mat();
  let thresh = new cv.Mat();
  let closed = new cv.Mat();
  
  const cleanUp = () => {
    if (src) { try { src.delete(); } catch(e){} }
    if (gray) { try { gray.delete(); } catch(e){} }
    if (blurred) { try { blurred.delete(); } catch(e){} }
    if (edges) { try { edges.delete(); } catch(e){} }
    if (thresh) { try { thresh.delete(); } catch(e){} }
    if (closed) { try { closed.delete(); } catch(e){} }
  };

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    const candidates: Candidate[] = [];

    // Strategy 1: Canny edge detection + Morphological Closing
    try {
      cv.Canny(blurred, edges, 50, 150, 3, false);
      const m1 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
      try {
        cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, m1);
      } finally {
        m1.delete();
      }
      const res = extractBestQuadrilateral(cv, closed, w, h, false, img.width, img.height);
      if (res) candidates.push(res);
    } catch (e) {
      console.warn("Canny extraction failed:", e);
    }

    // Strategy 2: Adaptive Threshold + Morphological Closing
    try {
      cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
      const m2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
      try {
        cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, m2);
      } finally {
        m2.delete();
      }
      const res = extractBestQuadrilateral(cv, closed, w, h, false, img.width, img.height);
      if (res) candidates.push(res);
    } catch (e) {
      console.warn("Adaptive threshold extraction failed:", e);
    }

    // Strategy 3: Otsu thresholding + Morphological Closing
    try {
      cv.threshold(blurred, thresh, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      const m3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
      try {
        cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, m3);
      } finally {
        m3.delete();
      }
      const res = extractBestQuadrilateral(cv, closed, w, h, false, img.width, img.height);
      if (res) candidates.push(res);
    } catch (e) {
      console.warn("Otsu extraction failed:", e);
    }

    // Strategy 4: Direct convex hull on lower-Canny edges
    try {
      cv.Canny(blurred, edges, 30, 100, 3, false);
      const m4 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      try {
        cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, m4);
      } finally {
        m4.delete();
      }
      const res = extractBestQuadrilateral(cv, closed, w, h, true, img.width, img.height);
      if (res) candidates.push(res);
    } catch (e) {
      console.warn("Low-canny hull extraction failed:", e);
    }

    // Strategy 5: Sobel Magnitude Thresholding (Outstandingly robust for low-contrast document sheets)
    try {
      let gradX = new cv.Mat();
      let gradY = new cv.Mat();
      let absGradX = new cv.Mat();
      let absGradY = new cv.Mat();
      let sobMat = new cv.Mat();
      
      try {
        cv.Sobel(blurred, gradX, cv.CV_16S, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
        cv.Sobel(blurred, gradY, cv.CV_16S, 0, 1, 3, 1, 0, cv.BORDER_DEFAULT);
        cv.convertScaleAbs(gradX, absGradX);
        cv.convertScaleAbs(gradY, absGradY);
        cv.addWeighted(absGradX, 0.5, absGradY, 0.5, 0, sobMat);
        
        // Threshold Sobel magnitude
        cv.threshold(sobMat, thresh, 30, 255, cv.THRESH_BINARY);
        const m5 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
        try {
          cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, m5);
        } finally {
          m5.delete();
        }
        const res = extractBestQuadrilateral(cv, closed, w, h, false, img.width, img.height);
        if (res) candidates.push(res);
      } finally {
        gradX.delete();
        gradY.delete();
        absGradX.delete();
        absGradY.delete();
        sobMat.delete();
      }
    } catch (e) {
      console.warn("Sobel extraction failed:", e);
    }

    cleanUp();

    if (candidates.length === 0) {
      console.log("OpenCV.js found no valid document quadrilaterals.");
      return null;
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];

    console.log("OpenCV.js detected document corners with confidence:", best.confidence, "%");

    if (best.confidence >= 15) {
      const scaleBack = 1 / scale;
      const finalCorners = best.corners.map(p => ({
        x: Math.max(0, Math.min(img.width, p.x * scaleBack)),
        y: Math.max(0, Math.min(img.height, p.y * scaleBack))
      }));
      return finalCorners;
    } else {
      console.log("OpenCV confidence too low:", best.confidence, "%, trying fallback detectors");
    }
  } catch (err) {
    console.error("Error during OpenCV document detection:", err);
    cleanUp();
  }

  return null;
}

export function detectDocumentCorners(img: HTMLImageElement | HTMLCanvasElement): Point[] | null {
  // First, attempt to detect using OpenCV.js if loaded and highly confident.
  try {
    const cvCorners = detectDocumentCornersOpenCV(img);
    if (cvCorners) {
      return cvCorners;
    }
  } catch (err) {
    console.warn("Failed OpenCV.js detection, falling back to pure JS:", err);
  }

  const MAX_DIM = 256;
  let scale = Math.min(MAX_DIM / img.width, MAX_DIM / img.height);
  if (scale > 1) scale = 1;
  const w = Math.floor(img.width * scale);
  const h = Math.floor(img.height * scale);
  
  if (!(w > 0) || !(h > 0)) return null;
  
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  
  // 1. Try to detect corners using the White Paper Segmenter.
  // This isolates the highest-brightness document region, ignoring colored folders/backgrounds.
  const whitePaperCorners = detectWhitePaperCorners(w, h, data, scale, img.width, img.height);
  if (whitePaperCorners) {
      return whitePaperCorners;
  }
  
  // 2. Fallback to edge-based corner detection
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
      gray[i] = Math.round(data[i*4]*0.299 + data[i*4+1]*0.587 + data[i*4+2]*0.114);
  }
  
  // Double-pass box blur to smooth out text and keep macroscopic document borders
  const blurred1 = new Uint8Array(w * h);
  const blurred2 = new Uint8Array(w * h);
  
  // Pass 1
  for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                  sum += gray[(y + dy) * w + (x + dx)];
              }
          }
          blurred1[y * w + x] = Math.round(sum / 9);
      }
  }
  // Fill borders for pass 1
  for (let x = 0; x < w; x++) {
    blurred1[x] = gray[x];
    blurred1[(h - 1) * w + x] = gray[(h - 1) * w + x];
  }
  for (let y = 0; y < h; y++) {
    blurred1[y * w] = gray[y * w];
    blurred1[y * w + w - 1] = gray[y * w + w - 1];
  }

  // Pass 2
  for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                  sum += blurred1[(y + dy) * w + (x + dx)];
              }
          }
          blurred2[y * w + x] = Math.round(sum / 9);
      }
  }
  // Fill borders for pass 2
  for (let x = 0; x < w; x++) {
    blurred2[x] = blurred1[x];
    blurred2[(h - 1) * w + x] = blurred1[(h - 1) * w + x];
  }
  for (let y = 0; y < h; y++) {
    blurred2[y * w] = blurred1[y * w];
    blurred2[y * w + w - 1] = blurred1[y * w + w - 1];
  }

  const mag = new Float32Array(w * h);
  for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
          const idx = y * w + x;
          const gx = -blurred2[idx - w - 1] + blurred2[idx - w + 1]
                     -2*blurred2[idx - 1] + 2*blurred2[idx + 1]
                     -blurred2[idx + w - 1] + blurred2[idx + w + 1];
          const gy = -blurred2[idx - w - 1] - 2*blurred2[idx - w] - blurred2[idx - w + 1]
                     +blurred2[idx + w - 1] + 2*blurred2[idx + w] + blurred2[idx + w + 1];
          mag[idx] = Math.sqrt(gx*gx + gy*gy);
      }
  }
  
  // Adaptive percentile thresholding instead of maxMag * 0.3
  const marginX = Math.floor(w * 0.05);
  const marginY = Math.floor(h * 0.05);
  
  const hist = new Int32Array(1500);
  let count = 0;
  for (let y = marginY; y < h - marginY; y++) {
      for (let x = marginX; x < w - marginX; x++) {
          const val = Math.min(1499, Math.floor(mag[y * w + x]));
          hist[val]++;
          count++;
      }
  }
  
  let threshold = 40;
  let edgePixelCount = 0;
  const targetCount = count * 0.12; // Designate the top 12% highest gradient pixels as edge pixels
  for (let i = 1499; i >= 0; i--) {
      edgePixelCount += hist[i];
      if (edgePixelCount >= targetCount) {
          threshold = Math.max(30, i);
          break;
      }
  }
  
  const binary = new Uint8Array(w * h);
  for (let y = marginY; y < h - marginY; y++) {
      for (let x = marginX; x < w - marginX; x++) {
          if (mag[y * w + x] > threshold) {
              binary[y * w + x] = 1;
          }
      }
  }
  
  // Find connected components using BFS and filter out tiny noisy components
  const visited = new Uint8Array(w * h);
  const salientPixels: number[] = [];
  
  for (let i = 0; i < w * h; i++) {
      if (binary[i] && !visited[i]) {
          const q = [i];
          visited[i] = 1;
          const comp = [];
          let qIdx = 0;
          
          while (qIdx < q.length) {
              const curr = q[qIdx++];
              comp.push(curr);
              
              const cx = curr % w;
              const cy = Math.floor(curr / w);
              
              for (let dy = -2; dy <= 2; dy++) {
                  for (let dx = -2; dx <= 2; dx++) {
                      if (dx === 0 && dy === 0) continue;
                      const nx = cx + dx;
                      const ny = cy + dy;
                      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                          const nidx = ny * w + nx;
                          if (binary[nidx] && !visited[nidx]) {
                              visited[nidx] = 1;
                              q.push(nidx);
                          }
                      }
                  }
              }
          }
          
          // Discard components with fewer than 30 pixels (isolated noise, dust, fine lines)
          if (comp.length >= 30) {
              for (let j = 0; j < comp.length; j++) {
                  salientPixels.push(comp[j]);
              }
          }
      }
  }
  
  // If the total salient edge pixels is too small, fallback to null
  if (salientPixels.length < (w + h)) {
      return null;
  }
  
  // Extract corners by maximizing/minimizing the diagonal projections of salient edges
  let tl = { x: 0, y: 0, val: Infinity };
  let tr = { x: 0, y: 0, val: -Infinity };
  let br = { x: 0, y: 0, val: -Infinity };
  let bl = { x: 0, y: 0, val: Infinity };
  
  const borderThreshW = w * 0.035;
  const borderThreshH = h * 0.035;
  
  for (let i = 0; i < salientPixels.length; i++) {
      const x = salientPixels[i] % w;
      const y = Math.floor(salientPixels[i] / w);
      
      // EXCLUDE pixels that are too close to the image outer frame to prevent snapping to background camera bounds
      if (x <= borderThreshW || x >= w - borderThreshW || y <= borderThreshH || y >= h - borderThreshH) {
          continue;
      }
      
      const sum = x + y;
      const diff = x - y;
      
      if (sum < tl.val) { tl = { x, y, val: sum }; }
      if (diff > tr.val) { tr = { x, y, val: diff }; }
      if (sum > br.val) { br = { x, y, val: sum }; }
      if (diff < bl.val) { bl = { x, y, val: diff }; }
  }
  
  if (tl.val === Infinity || tr.val === -Infinity || br.val === -Infinity || bl.val === Infinity) {
      return null;
  }
  
  const scaleBack = 1 / scale;
  const detectedCorners = [
      { x: tl.x * scaleBack, y: tl.y * scaleBack },
      { x: tr.x * scaleBack, y: tr.y * scaleBack },
      { x: br.x * scaleBack, y: br.y * scaleBack },
      { x: bl.x * scaleBack, y: bl.y * scaleBack }
  ];
  
  // Validate detected quadrilateral for convexity and sufficient area
  if (isValidDocumentQuadrilateral(detectedCorners, img.width, img.height)) {
      return detectedCorners;
  }
  
  // 3. Fallback: Text Saliency Bounding Box Expansion
  try {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      
      for (let i = 0; i < salientPixels.length; i++) {
          const x = salientPixels[i] % w;
          const y = Math.floor(salientPixels[i] / w);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
      }
      
      const textW = maxX - minX;
      const textH = maxY - minY;
      
      if (textW > w * 0.12 && textH > h * 0.12) {
          const scaleBack2 = 1 / scale;
          
          // Expand the text bounding box outward by a reasonable margin to encompass the paper border
          const padW = Math.max(w * 0.04, textW * 0.14);
          const padH = Math.max(h * 0.04, textH * 0.14);
          
          const docMinX = Math.max(0, minX - padW);
          const docMaxX = Math.min(w, maxX + padW);
          const docMinY = Math.max(0, minY - padH);
          const docMaxY = Math.min(h, maxY + padH);
          
          const textCorners = [
              { x: docMinX * scaleBack2, y: docMinY * scaleBack2 },
              { x: docMaxX * scaleBack2, y: docMinY * scaleBack2 },
              { x: docMaxX * scaleBack2, y: docMaxY * scaleBack2 },
              { x: docMinX * scaleBack2, y: docMaxY * scaleBack2 }
          ];
          
          if (isValidDocumentQuadrilateral(textCorners, img.width, img.height)) {
              console.log("Using robust Text Saliency Bounding Box fallback:", textCorners);
              return textCorners;
          }
      }
  } catch (err) {
      console.warn("Text cluster bounding box fallback failed:", err);
  }
  
  return null;
}

function detectWhitePaperCorners(
  w: number,
  h: number,
  data: Uint8ClampedArray,
  scale: number,
  imgWidth: number,
  imgHeight: number
): Point[] | null {
  const gray = new Uint8Array(w * h);
  let maxVal = 0;
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const val = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    gray[i] = val;
    if (val > maxVal) maxVal = val;
  }

  // Double box blur with 7x7 window to completely erase printed/written text inside the paper
  const blurred = new Uint8Array(w * h);
  const kSize = 3; 
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -kSize; dy <= kSize; dy++) {
        for (let dx = -kSize; dx <= kSize; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            sum += gray[ny * w + nx];
            count++;
          }
        }
      }
      blurred[y * w + x] = Math.round(sum / count);
    }
  }

  // Otsu's thresholding
  const hist = new Int32Array(256);
  for (let i = 0; i < blurred.length; i++) {
    hist[blurred[i]]++;
  }
  const total = blurred.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) {
    sum += t * hist[t];
  }
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let varMax = 0;
  let otsu = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > varMax) {
      varMax = varBetween;
      otsu = t;
    }
  }

  // Try multiple dynamic threshold candidates to handle cream/beige pages, shadows, and unevenly lit conditions
  const threshCandidates = [
    Math.max(60, Math.round(otsu)),
    Math.max(65, Math.round(otsu * 0.95 + maxVal * 0.05)),
    Math.max(70, Math.round(otsu * 0.90 + maxVal * 0.10)),
    Math.max(75, Math.round(otsu * 0.80 + maxVal * 0.20)),
    Math.max(80, Math.round(otsu * 0.70 + maxVal * 0.30))
  ];

  for (const paperThresh of threshCandidates) {
    const paperBinary = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      paperBinary[i] = blurred[i] >= paperThresh ? 1 : 0;
    }

    // Find the largest connected component of bright pixels
    const visited = new Uint8Array(w * h);
    let maxComp: number[] = [];
    
    for (let i = 0; i < w * h; i++) {
      if (paperBinary[i] && !visited[i]) {
        const q = [i];
        visited[i] = 1;
        let qIdx = 0;
        
        while (qIdx < q.length) {
          const curr = q[qIdx++];
          const cx = curr % w;
          const cy = Math.floor(curr / w);
          
          const neighbors = [
            { x: cx - 1, y: cy },
            { x: cx + 1, y: cy },
            { x: cx, y: cy - 1 },
            { x: cx, y: cy + 1 }
          ];
          
          for (const n of neighbors) {
            if (n.x >= 0 && n.x < w && n.y >= 0 && n.y < h) {
              const nidx = n.y * w + n.x;
              if (paperBinary[nidx] && !visited[nidx]) {
                visited[nidx] = 1;
                q.push(nidx);
              }
            }
          }
        }
        
        if (q.length > maxComp.length) {
          maxComp = q;
        }
      }
    }

    // Document must occupy between 15% and 95% of the overall frame
    if (maxComp.length < w * h * 0.15 || maxComp.length > w * h * 0.95) {
      continue;
    }

    // Extract corners using extreme diagonal projection of the paper component
    let tl = { x: 0, y: 0, val: Infinity };
    let tr = { x: 0, y: 0, val: -Infinity };
    let br = { x: 0, y: 0, val: -Infinity };
    let bl = { x: 0, y: 0, val: Infinity };
    
    const borderThreshW = w * 0.035;
    const borderThreshH = h * 0.035;
    
    for (let i = 0; i < maxComp.length; i++) {
      const idx = maxComp[i];
      const x = idx % w;
      const y = Math.floor(idx / w);
      
      // EXCLUDE pixels near the image outer frame to prevent snapping to background camera boundaries
      if (x <= borderThreshW || x >= w - borderThreshW || y <= borderThreshH || y >= h - borderThreshH) {
        continue;
      }
      
      const sum = x + y;
      const diff = x - y;
      
      if (sum < tl.val) { tl = { x, y, val: sum }; }
      if (diff > tr.val) { tr = { x, y, val: diff }; }
      if (sum > br.val) { br = { x, y, val: sum }; }
      if (diff < bl.val) { bl = { x, y, val: diff }; }
    }

    if (tl.val === Infinity || tr.val === -Infinity || br.val === -Infinity || bl.val === Infinity) {
      continue;
    }

    const scaleBack = 1 / scale;
    const detectedCorners = [
      { x: tl.x * scaleBack, y: tl.y * scaleBack },
      { x: tr.x * scaleBack, y: tr.y * scaleBack },
      { x: br.x * scaleBack, y: br.y * scaleBack },
      { x: bl.x * scaleBack, y: bl.y * scaleBack }
    ];

    if (isValidDocumentQuadrilateral(detectedCorners, imgWidth, imgHeight)) {
      console.log(`Successfully detected white paper with threshold: ${paperThresh}`);
      return detectedCorners;
    }
  }

  return null;
}

function isValidDocumentQuadrilateral(corners: Point[], width: number, height: number): boolean {
  if (corners.length !== 4) return false;
  
  // 1. Calculate area using Shoelace formula
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 4];
    area += (p1.x * p2.y - p2.x * p1.y);
  }
  area = Math.abs(area) * 0.5;
  
  const totalArea = width * height;
  // If the detected quadrilateral covers less than 15% of the total image, it's highly likely to be a false positive
  // If it covers more than 96%, it has just snapped to the outer canvas, which is also invalid (must fall back to margins)
  if (area < totalArea * 0.15 || area > totalArea * 0.96) {
    return false;
  }
  
  // Reject if the quadrilateral has snapped directly to the image borders
  if (isImageBorderCorners(corners, width, height)) {
    return false;
  }
  
  // 2. Check convexity using cross products of consecutive edges
  const crossProducts = [];
  for (let i = 0; i < 4; i++) {
    const p0 = corners[i];
    const p1 = corners[(i + 1) % 4];
    const p2 = corners[(i + 2) % 4];
    
    const dx1 = p1.x - p0.x;
    const dy1 = p1.y - p0.y;
    const dx2 = p2.x - p1.x;
    const dy2 = p2.y - p1.y;
    
    const cp = dx1 * dy2 - dy1 * dx2;
    crossProducts.push(cp);
  }
  
  const allPositive = crossProducts.every(cp => cp > 1e-5);
  const allNegative = crossProducts.every(cp => cp < -1e-5);
  
  if (!allPositive && !allNegative) {
    return false; // Self-intersecting or concave polygon
  }
  
  return true;
}

export async function addWatermarkToImage(imageSrc: string, watermark: WatermarkOptions): Promise<string> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageSrc;

  // Draw original image
  ctx.drawImage(img, 0, 0);

  if (!watermark || !watermark.text || !watermark.text.trim()) {
    return canvas.toDataURL('image/jpeg', 0.95);
  }

  ctx.save();
  ctx.globalAlpha = watermark.opacity ?? 0.3;
  ctx.fillStyle = watermark.color ?? '#cccccc';
  
  const scaleFactor = Math.max(0.5, img.width / 600); 
  const fontSize = Math.round((watermark.size || 24) * scaleFactor);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const text = watermark.text.trim();

  if (watermark.style === 'grid') {
    // 3x3 Grid with margin
    const m = watermark.margin || 20;
    const colWidth = (img.width - 2 * m) / 3;
    const rowHeight = (img.height - 2 * m) / 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const x = m + colWidth * c + colWidth / 2;
        const y = m + rowHeight * r + rowHeight / 2;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((watermark.rotation ?? 0) * Math.PI / 180);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      }
    }
  } else {
    // Single position with margin
    const pos = watermark.position || 'center';
    const m = watermark.margin || 20;
    let x = img.width / 2;
    let y = img.height / 2;
    let rotateAngle = (watermark.rotation ?? 0) * Math.PI / 180;

    if (pos === 'top-left') {
      x = m + fontSize;
      y = m + fontSize;
      ctx.textAlign = 'left';
    } else if (pos === 'top-right') {
      x = img.width - m - fontSize;
      y = m + fontSize;
      ctx.textAlign = 'right';
    } else if (pos === 'bottom-left') {
      x = m + fontSize;
      y = img.height - m - fontSize;
      ctx.textAlign = 'left';
    } else if (pos === 'bottom-right') {
      x = img.width - m - fontSize;
      y = img.height - m - fontSize;
      ctx.textAlign = 'right';
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotateAngle);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.95);
}

