import * as pdfjsLib from 'pdfjs-dist';

// Set worker src. We can use a CDN for simplicity, matching the version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export async function extractImagesFromPdf(file: File, onProgress?: (progress: number, total: number) => void): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;
  const images: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    // Render with higher scale for better resolution
    const viewport = page.getViewport({ scale: 2.0 });
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };
    
    await page.render(renderContext as any).promise;
    
    // Convert to high-quality JPEG
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    images.push(dataUrl);
    
    if (onProgress) {
      onProgress(i, numPages);
    }
  }

  return images;
}
