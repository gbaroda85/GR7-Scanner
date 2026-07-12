import { jsPDF } from 'jspdf';
import { Document, WatermarkOptions } from '../types';
import { loadImage, addWatermarkToImage } from './image';

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
    let sourceImageSrc = page.filteredImage;
    if (options?.watermark) {
      sourceImageSrc = await addWatermarkToImage(sourceImageSrc, options.watermark);
    }
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
    
    // Quality compression
    let imageData = sourceImageSrc;
    if (options?.quality && options.quality < 1) {
       // compress on canvas
       const canvas = document.createElement('canvas');
       canvas.width = img.width;
       canvas.height = img.height;
       const ctx = canvas.getContext('2d');
       if (ctx) {
         ctx.drawImage(img, 0, 0);
         imageData = canvas.toDataURL('image/jpeg', options.quality);
       }
    }

    pdf.addImage(imageData, 'JPEG', x, y, renderWidth, renderHeight, undefined, options?.quality && options.quality < 1 ? 'FAST' : 'MEDIUM');
    
    if (options?.drawBorder) {
       pdf.setDrawColor(0, 0, 0); // black
       pdf.setLineWidth(1); // 1px
       pdf.rect(x, y, renderWidth, renderHeight);
    }
  }

  return pdf.output('blob');
}
