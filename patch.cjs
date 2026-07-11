const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

if (!appContent.includes("import { convertFilesToImageFiles } from './lib/fileImport';")) {
  appContent = appContent.replace(
    "import { loadDocuments, saveDocument, deleteDocument, initDb } from './lib/store';",
    "import { loadDocuments, saveDocument, deleteDocument, initDb } from './lib/store';\nimport { convertFilesToImageFiles } from './lib/fileImport';"
  );
}

// Rename handleCapture to not process files directly, but call a generic function
// First find handleCapture
const handleCaptureStart = appContent.indexOf("const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {");

let newHandleCapture = `
  const processIncomingFiles = async (rawFiles: File[]) => {
    if (rawFiles.length === 0) return;
    setIsProcessingBatch(true);
    setTotalBatchFiles(rawFiles.length);
    setProcessedBatchFiles(0);
    
    // Check if we need to convert PDFs to images
    const files = await convertFilesToImageFiles(rawFiles, (msg) => {
      // We can use an existing progress text state, or just console.log
      console.log(msg);
    });

    if (files.length === 0) {
      setIsProcessingBatch(false);
      return;
    }

    setTotalBatchFiles(files.length);
    setProcessedBatchFiles(0);
    
    const processFile = async (file: File): Promise<QueueItem | null> => {
      let objectUrl: string | null = null;
      try {
        objectUrl = URL.createObjectURL(file);
        if (!objectUrl) {
          setProcessedBatchFiles(prev => Math.min(prev + 1, files.length));
          return null;
        }

        let finalUrl = '';
        try {
           finalUrl = await downscaleImage(objectUrl, 2400);
        } catch (e) {
           finalUrl = await new Promise<string>((resolve) => {
             const reader = new FileReader();
             reader.onload = (e) => resolve((e.target?.result as string) || '');
             reader.readAsDataURL(file);
           });
        }

        const img = await loadImage(finalUrl);
        let corners = detectDocumentCorners(img);
        
        if (!corners) {
          const marginW = img.width * 0.1;
          const marginH = img.height * 0.1;
          corners = [
            { x: marginW, y: marginH },
            { x: img.width - marginW, y: marginH },
            { x: img.width - marginW, y: img.height - marginH },
            { x: marginW, y: img.height - marginH }
          ];
        }

        if (objectUrl) URL.revokeObjectURL(objectUrl);

        setProcessedBatchFiles(prev => Math.min(prev + 1, files.length));
        return { url: finalUrl, corners: corners };
      } catch (err) {
        console.error("Error processing file in queue:", err);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        setProcessedBatchFiles(prev => Math.min(prev + 1, files.length));
        return null;
      }
    };

    const runInQueue = async (files: File[], limit: number): Promise<QueueItem[]> => {
      const results = new Array<QueueItem | null>(files.length).fill(null);
      let index = 0;
      const worker = async () => {
        while (index < files.length) {
          const currentIndex = index++;
          results[currentIndex] = await processFile(files[currentIndex]);
          await new Promise(r => setTimeout(r, 100));
        }
      };
      const workers = Array(Math.min(limit, files.length)).fill(null).map(worker);
      await Promise.all(workers);
      return results.filter((item): item is QueueItem => item !== null);
    };

    try {
      const results = await runInQueue(files, 1);
      if (results.length > 0) {
        setCapturedImage(results[0].url);
        setCurrentCorners(results[0].corners || undefined);
        setProcessingQueue(results.slice(1));
        setAppState('crop');
      } else {
        alert("Could not process the files. Please try again.");
      }
    } catch (err) {
      console.error("Error processing captured batch:", err);
      alert("Error processing the files.");
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputElement = e.target;
    const files = Array.from(inputElement.files || []) as File[];
    await processIncomingFiles(files);
    inputElement.value = '';
  };
`;

// Replace everything from handleCaptureStart to the end of handleCapture
// We can find the end of handleCapture by looking for the next function declaration
const nextFuncStart = appContent.indexOf("const handleCropNext = async", handleCaptureStart);

appContent = appContent.substring(0, handleCaptureStart) + newHandleCapture + "\n" + appContent.substring(nextFuncStart);

fs.writeFileSync('src/App.tsx', appContent);
