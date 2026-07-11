const fs = require('fs');

let content = fs.readFileSync('src/lib/image.ts', 'utf8');

// Replace the blending logic for 'magic' and 'document'
// From "const normalizedCanvas = document.createElement('canvas');" down to "normCtx.putImageData(imageData, 0, 0);"

const targetStart = "const normalizedCanvas = document.createElement('canvas');";
const targetEnd = "  normCtx.putImageData(imageData, 0, 0);";

const startIndex = content.indexOf(targetStart);
const endIndex = content.indexOf(targetEnd) + targetEnd.length;

if (startIndex !== -1 && endIndex !== -1) {
  const newLogic = `
  const normalizedCanvas = document.createElement('canvas');
  normalizedCanvas.width = adjCanvas.width;
  normalizedCanvas.height = adjCanvas.height;
  const normCtx = normalizedCanvas.getContext('2d')!;
  
  // We will do color dodge manually to prevent blowing out dark photos
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = adjCanvas.width;
  blurCanvas.height = adjCanvas.height;
  const blurCtx = blurCanvas.getContext('2d')!;
  blurCtx.imageSmoothingEnabled = true;
  blurCtx.imageSmoothingQuality = 'high';
  blurCtx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, adjCanvas.width, adjCanvas.height);
  
  const origImageData = adjCtx.getImageData(0, 0, adjCanvas.width, adjCanvas.height);
  const blurImageData = blurCtx.getImageData(0, 0, adjCanvas.width, adjCanvas.height);
  
  const outImageData = normCtx.createImageData(adjCanvas.width, adjCanvas.height);
  const origData = origImageData.data;
  const blurData = blurImageData.data;
  const data = outImageData.data;
  
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
     let r = origData[i];
     let g = origData[i+1];
     let b = origData[i+2];
     
     let br = blurData[i];
     let bg = blurData[i+1];
     let bb = blurData[i+2];
     
     let origLum = r * 0.299 + g * 0.587 + b * 0.114;
     let chroma = Math.max(r, g, b) - Math.min(r, g, b);
     
     // inverted blur is the illumination map: br, bg, bb
     // color dodge is (orig / (255 - (255 - blur))) = orig / blur
     // we clamp blur to avoid blowing out dark photos (e.g. passport photos)
     // A typical passport photo will have illumination estimation around 20-50 because it's dark
     // If we clamp to 100, we prevent it from being brightened by 5x
     
     let minIllum = filterType === 'document' ? 50 : 100;
     
     let illumR = Math.max(255 - br, minIllum);
     let illumG = Math.max(255 - bg, minIllum);
     let illumB = Math.max(255 - bb, minIllum);
     
     let dr = Math.min(255, (r * 255) / illumR);
     let dg = Math.min(255, (g * 255) / illumG);
     let db = Math.min(255, (b * 255) / illumB);
     
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
        const protection = Math.min(70, chroma * 2.0);
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
           
           const satBoost = 1.25;
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
  `;
  
  content = content.substring(0, startIndex) + newLogic + content.substring(endIndex);
  fs.writeFileSync('src/lib/image.ts', content);
} else {
  console.log("Could not find target range.");
}
