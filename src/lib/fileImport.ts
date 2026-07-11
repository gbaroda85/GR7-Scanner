import { extractImagesFromPdf } from './pdfImport';
import { QueueItem } from '../types';

export async function convertFilesToImageFiles(files: File[], onProgress?: (msg: string) => void): Promise<File[]> {
  const imageFiles: File[] = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (onProgress) onProgress(`Extracting pages from PDF ${i + 1}/${files.length}...`);
      try {
        const dataUrls = await extractImagesFromPdf(file, (p, t) => {
          if (onProgress) onProgress(`Extracting page ${p}/${t} from PDF ${i + 1}...`);
        });
        
        for (let j = 0; j < dataUrls.length; j++) {
          const res = await fetch(dataUrls[j]);
          const blob = await res.blob();
          imageFiles.push(new File([blob], `${file.name}-page${j+1}.jpg`, { type: 'image/jpeg' }));
        }
      } catch (err) {
        console.error("Error extracting PDF", err);
      }
    } else if (file.type.startsWith('image/')) {
      imageFiles.push(file);
    }
  }
  
  return imageFiles;
}
