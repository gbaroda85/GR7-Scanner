import { jsPDF } from 'jspdf';
import { Document, WatermarkOptions } from '../types';
import { loadImage, drawWatermarkOnCanvas } from './image';

export async function generatePDF(doc: Document, options?: { drawBorder?: boolean; password?: string; quality?: number; watermark?: WatermarkOptions; onProgress?: (progress: number, total: number) => void }): Promise<Blob> {
  const pdfOptions: any = {
    orientation: 'portrait',
    unit: 'px',
    format: 'a4',
  };

  if (options?.password) {
    pdfOptions.encryption = {
      userPassword: options.password,
      ownerPassword: options.password,
      userPermissions: ['print', 'modify', 'copy', 'annot-forms']
    };
  }

  const pdf = new jsPDF(pdfOptions);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < doc.pages.length; i++) {
    if (options?.onProgress) {
      options.onProgress(i + 1, doc.pages.length);
      await new Promise(resolve => setTimeout(resolve, 10)); // Yield to allow UI update
    }

    if (i > 0) {
      pdf.addPage();
    }
    
    const page = doc.pages[i];
    const sourceImageSrc = page.filteredImage;
    const img = await loadImage(sourceImageSrc);
    
    // Calculate dimensions to fit inside the margins of the page
    const margin = 20; // 20px margin on all sides
    const usableWidth = pageWidth - 2 * margin;
    const usableHeight = pageHeight - 2 * margin;

    const imgRatio = img.width / img.height;
    const usableRatio = usableWidth / usableHeight;
    
    let renderWidth = usableWidth;
    let renderHeight = usableHeight;
    let x = margin;
    let y = margin;
    
    if (imgRatio > usableRatio) {
      // Image is wider than usable area
      renderHeight = usableWidth / imgRatio;
      y = margin + (usableHeight - renderHeight) / 2;
    } else {
      // Image is taller than usable area
      renderWidth = usableHeight * imgRatio;
      x = margin + (usableWidth - renderWidth) / 2;
    }
    
    // Only compress on canvas if requested quality < 1. Otherwise use raw source (prevent blurring/taint issues).
    let imageToRender: string | HTMLCanvasElement | HTMLImageElement = sourceImageSrc;
    if (options?.quality && options.quality < 1) {
       const canvas = document.createElement('canvas');
       canvas.width = img.width;
       canvas.height = img.height;
       const ctx = canvas.getContext('2d');
       if (ctx) {
         ctx.drawImage(img, 0, 0);
         try {
           imageToRender = canvas.toDataURL('image/jpeg', options.quality);
         } catch (e) {
           console.warn("Canvas tainted, using original image");
           imageToRender = sourceImageSrc;
         }
       }
    }

    pdf.addImage(imageToRender, 'JPEG', x, y, renderWidth, renderHeight, undefined, options?.quality && options.quality < 1 ? 'FAST' : 'MEDIUM');
    
    if (options?.drawBorder) {
       pdf.setDrawColor(0, 0, 0); // black
       pdf.setLineWidth(1); // 1px
       pdf.rect(x, y, renderWidth, renderHeight);
    }
    
    // Add watermark natively to the PDF (vector text)
    if (options?.watermark && options.watermark.text && options.watermark.text.trim()) {
      const wm = options.watermark;
      
      // Ensure opacity state
      try {
        const opacity = wm.opacity ?? 0.3;
        // The GState constructor is available on the jsPDF instance in advanced API
        if (typeof (pdf as any).GState !== 'undefined') {
          pdf.setGState(new (pdf as any).GState({ opacity }));
        } else {
           // Fallback to internal if GState isn't exposed directly
           (pdf as any).internal.events.subscribe('addPage', () => {
             // Hacky fallback for opacity if needed, but jsPDF usually exposes GState
           });
        }
      } catch (e) {
        console.warn("Opacity not supported", e);
      }
      
      pdf.setTextColor(wm.color ?? '#cccccc');
      
      // Calculate font size relative to the page rendering width to match preview
      const scaleFactor = Math.max(0.5, renderWidth / 600); 
      const fontSize = Math.round((wm.size || 24) * scaleFactor);
      pdf.setFontSize(fontSize);
      pdf.setFont("helvetica", "bold");
      
      const text = wm.text.trim();
      const angle = wm.rotation ?? 0;
      
      if (wm.style === 'grid') {
        const m = wm.margin || 20;
        const colWidth = (renderWidth - 2 * m) / 3;
        const rowHeight = (renderHeight - 2 * m) / 3;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const cx = x + m + colWidth * c + colWidth / 2;
            const cy = y + m + rowHeight * r + rowHeight / 2;
            pdf.text(text, cx, cy, { align: "center", baseline: "middle", angle: -angle });
          }
        }
      } else {
        const pos = wm.position || 'center';
        const m = wm.margin || 20;
        let cx = x + renderWidth / 2;
        let cy = y + renderHeight / 2;
        let align: "left" | "center" | "right" = "center";
        
        if (pos === 'top-left') {
          cx = x + m;
          cy = y + m + fontSize / 2;
          align = "left";
        } else if (pos === 'top-right') {
          cx = x + renderWidth - m;
          cy = y + m + fontSize / 2;
          align = "right";
        } else if (pos === 'bottom-left') {
          cx = x + m;
          cy = y + renderHeight - m - fontSize / 2;
          align = "left";
        } else if (pos === 'bottom-right') {
          cx = x + renderWidth - m;
          cy = y + renderHeight - m - fontSize / 2;
          align = "right";
        }
        
        pdf.text(text, cx, cy, { align: align, baseline: "middle", angle: -angle });
      }
      
      // Reset opacity to 1.0 for next pages/elements
      try {
        if (typeof (pdf as any).GState !== 'undefined') {
          pdf.setGState(new (pdf as any).GState({ opacity: 1.0 }));
        }
      } catch (e) {}
    }
  }

  return pdf.output('blob');
}
