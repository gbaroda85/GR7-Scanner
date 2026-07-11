const fs = require('fs');

let content = fs.readFileSync('src/lib/image.ts', 'utf8');

const targetStart = "  let blackPoint = 60;";
const targetEnd = "        data[i+2] = Math.min(255, Math.max(0, db * ratio));\n        data[i+3] = 255;\n     }\n  }";

const startIndex = content.indexOf(targetStart);
const endIndex = content.indexOf(targetEnd) + targetEnd.length;

if (startIndex !== -1 && endIndex !== -1) {
  const newLogic = `  let blackPoint = 60; 
  let whitePoint = 230; 
  
  if (filterType === 'magic') {
     blackPoint = 50; 
     whitePoint = 190; 
  } else if (filterType === 'bw') {
     blackPoint = 100;
     whitePoint = 180;
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
     let illumBlend = (illumLum - 50) / (130 - 50);
     // Boost blend for low-chroma pixels (gray shadows) to ensure they are flattened
     if (chroma < 20) {
        illumBlend += (20 - chroma) / 40; 
     }
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
        const protection = Math.min(90, chroma * 3.0);
        const activeWhitePoint = Math.min(255, whitePoint + protection);
        
        if (lum > activeWhitePoint) {
           data[i] = 255;
           data[i+1] = 255;
           data[i+2] = 255;
        } else {
           let whiteFactor = 1.0;
           if (lum > activeWhitePoint - 15) {
               whiteFactor = (activeWhitePoint - lum) / 15;
           }

           const adjustedBlackPoint = blackPoint * Math.max(0, 1 - (chroma / 40));
           const currentRange = activeWhitePoint - adjustedBlackPoint;
           
           let s = (lum - adjustedBlackPoint) * 255 / (currentRange || 1);
           s = Math.min(255, Math.max(0, s));
           
           const satBoost = 1.35;
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
  }`;
  
  content = content.substring(0, startIndex) + newLogic + content.substring(endIndex);
  fs.writeFileSync('src/lib/image.ts', content);
  console.log("Patched correctly");
} else {
  console.log("Could not find target range.");
}
