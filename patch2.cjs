const fs = require('fs');

let appContent = fs.readFileSync('src/App.tsx', 'utf8');

// Find processIncomingFiles and inject useEffect below it
const searchStr = "const processIncomingFiles = async (rawFiles: File[]) => {";
const index = appContent.indexOf(searchStr);

if (index !== -1) {
  const injection = `
  useEffect(() => {
    // Handle files shared via share_target (mobile)
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SHARED_FILES') {
        const files = event.data.files as File[];
        if (files && files.length > 0) {
          processIncomingFiles(files);
        }
      }
    };
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
      
      // Tell SW we are ready to receive any pending shared files
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'APP_READY' });
      }
    }

    // Handle files opened via file_handlers (desktop)
    if ('launchQueue' in window) {
      (window as any).launchQueue.setConsumer(async (launchParams: any) => {
        if (launchParams.files && launchParams.files.length > 0) {
          const files: File[] = [];
          for (const handle of launchParams.files) {
            const file = await handle.getFile();
            files.push(file);
          }
          if (files.length > 0) {
            processIncomingFiles(files);
          }
        }
      });
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
    };
  }, []);
  
`;

  appContent = appContent.substring(0, index) + injection + appContent.substring(index);
  fs.writeFileSync('src/App.tsx', appContent);
} else {
  console.error("Could not find processIncomingFiles");
}
