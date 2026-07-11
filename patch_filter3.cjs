const fs = require('fs');

let content = fs.readFileSync('src/lib/image.ts', 'utf8');

const targetStart = "  // 3. Document / BW / Magic Color modes";
const targetEnd = "  return normalizedCanvas.toDataURL('image/jpeg', 0.95);\n}";

const startIndex = content.indexOf(targetStart);
const endIndex = content.indexOf(targetEnd) + targetEnd.length;

if (startIndex !== -1 && endIndex !== -1) {
  const newLogic = `  // 3. Document / BW / Magic Color modes
  const scale = 0.05; // 5% scale for a VERY broad illumination map
  const smallW = Math.max(1, Math.floor(adjCanvas.width * scale));
  const smallH = Math.max(1, Math.floor(adjCanvas.height * scale));
  
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = smallW;
  smallCanvas.height = smallH;
  const smallCtx = smallCanvas.getContext('2d')!;
  
  smallCtx.filter = 'blur(4px)'; // roughly 80px blur on original
  smallCtx.drawImage(adjCanvas, 0, 0, smallW, smallH);
  
  // We need the illumination map. Let's just scale it back up.
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = adjCanvas.width;
  blurCanvas.height = adjCanvas.height;
  const blurCtx = blurCanvas.getContext('2d')!;
  blurCtx.imageSmoothingEnabled = true;
  blurCtx.imageSmoothingQuality = 'high';
  blurCtx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, adjCanvas.width, adjCanvas.height);
  const illumImageData = blurCtx.getImageData(0, 0, adjCanvas.width, adjCanvas.height);
  const illumData = illumImageData.data;

  // Unsharp mask canvas
  const usmCanvas = document.createElement('canvas');
  usmCanvas.width = adjCanvas.width;
  usmCanvas.height = adjCanvas.height;
  const usmCtx = usmCanvas.getContext('2d')!;
  usmCtx.filter = 'blur(2px)';
  usmCtx.drawImage(adjCanvas, 0, 0);
  const usmImageData = usmCtx.getImageData(0, 0, adjCanvas.width, adjCanvas.height);
  const usmData = usmImageData.data;

  const origImageData = adjCtx.getImageData(0, 0, adjCanvas.width, adjCanvas.height);
  const origData = origImageData.data;
  
  const normalizedCanvas = document.createElement('canvas');
  normalizedCanvas.width = adjCanvas.width;
  normalizedCanvas.height = adjCanvas.height;
  const normCtx = normalizedCanvas.getContext('2d')!;
  const outImageData = normCtx.createImageData(adjCanvas.width, adjCanvas.height);
  const data = outImageData.data;

  let blackPoint = 60; 
  let whitePoint = 230; 
  
  if (filterType === 'magic') {
     blackPoint = 50; 
     whitePoint = 220; 
  } else if (filterType === 'bw') {
     blackPoint = 110;
     whitePoint = 190;
  }
  
  const range = whitePoint - blackPoint;
  
  for (let i = 0; i < data.length; i += 4) {
     let r0 = origData[i];
     let g0 = origData[i+1];
     let b0 = origData[i+2];

     let ur = usmData[i];
     let ug = usmData[i+1];
     let ub = usmData[i+2];

     // Apply USM (Sharpening)
     let sharpenAmount = filterType === 'magic' ? 1.5 : (filterType === 'bw' ? 2.0 : 1.0);
     let r = r0 + (r0 - ur) * sharpenAmount;
     let g = g0 + (g0 - ug) * sharpenAmount;
     let b = b0 + (b0 - ub) * sharpenAmount;
     r = Math.max(0, Math.min(255, r));
     g = Math.max(0, Math.min(255, g));
     b = Math.max(0, Math.min(255, b));
     
     let ir = illumData[i];
     let ig = illumData[i+1];
     let ib = illumData[i+2];
     
     let illumLum = ir * 0.299 + ig * 0.587 + ib * 0.114;
     let origLum = r * 0.299 + g * 0.587 + b * 0.114;
     let chroma = Math.max(r, g, b) - Math.min(r, g, b);

     // Heuristic to detect photos vs background
     // 1. If illumination is bright, it's background (flatten it)
     // 2. If it's very dark or very colorful, it's ink or photo.
     
     // illumBlend goes from 0.0 (photo/dark) to 1.0 (paper background)
     let illumBlend = (illumLum - 100) / (160 - 100);
     illumBlend = Math.max(0, Math.min(1, illumBlend));
     
     let factorR = (255 / Math.max(ir, 1)) * illumBlend + 1.0 * (1 - illumBlend);
     let factorG = (255 / Math.max(ig, 1)) * illumBlend + 1.0 * (1 - illumBlend);
     let factorB = (255 / Math.max(ib, 1)) * illumBlend + 1.0 * (1 - illumBlend);
     
     let dr = Math.min(255, r * factorR);
     let dg = Math.min(255, g * factorG);
     let db = Math.min(255, b * factorB);
     
     let lum = dr * 0.299 + dg * 0.587 + db * 0.114;
     
     if (filterType === 'bw') {
        let v = 0;
        if (lum < blackPoint) v = 0;
        else if (lum > whitePoint) v = 255;
        else v = (lum - blackPoint) * 255 / range;
        
        data[i] = v;
        data[i+1] = v;
        data[i+2] = v;
        data[i+3] = 255;
     } else if (filterType === 'magic') {
        // MAGIC FILTER: Preserve colors, whiten background
        // Colorful pixels (stamps, photos) get protection from aggressive whitening
        const protection = Math.min(80, chroma * 2.5);
        const activeWhitePoint = Math.min(255, whitePoint + protection);
        
        if (lum > activeWhitePoint) {
           data[i] = 255;
           data[i+1] = 255;
           data[i+2] = 255;
        } else {
           let whiteFactor = 1.0;
           if (lum > activeWhitePoint - 20) {
               whiteFactor = (activeWhitePoint - lum) / 20;
           }

           const adjustedBlackPoint = blackPoint * Math.max(0, 1 - (chroma / 30));
           const currentRange = activeWhitePoint - adjustedBlackPoint;
           
           let s = (lum - adjustedBlackPoint) * 255 / (currentRange || 1);
           s = Math.min(255, Math.max(0, s));
           
           const satBoost = 1.3;
           const ratio = s / (lum || 1);
           
           let nr = (dr * ratio - s) * satBoost + s;
           let ng = (dg * ratio - s) * satBoost + s;
           let nb = (db * ratio - s) * satBoost + s;
           
           data[i] = Math.min(255, Math.max(0, nr * whiteFactor + 255 * (1 - whiteFactor)));
           data[i+1] = Math.min(255, Math.max(0, ng * whiteFactor + 255 * (1 - whiteFactor)));
           data[i+2] = Math.min(255, Math.max(0, nb * whiteFactor + 255 * (1 - whiteFactor)));
        }
        data[i+3] = 255;
     } else { // 'document'
        let s = (lum - blackPoint) * 255 / range;
        s = Math.min(255, Math.max(0, s));
        const ratio = s / (lum || 1);
        
        data[i] = Math.min(255, Math.max(0, dr * ratio));
        data[i+1] = Math.min(255, Math.max(0, dg * ratio));
        data[i+2] = Math.min(255, Math.max(0, db * ratio));
        data[i+3] = 255;
     }
  }
  
  normCtx.putImageData(outImageData, 0, 0);
  return normalizedCanvas.toDataURL('image/jpeg', 0.95);
}`;
  
  content = content.substring(0, startIndex) + newLogic + content.substring(endIndex);
  fs.writeFileSync('src/lib/image.ts', content);
  console.log("Patched correctly");
} else {
  console.log("Could not find target range.");
}
