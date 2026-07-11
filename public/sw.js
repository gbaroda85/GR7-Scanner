let pendingFiles = [];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'APP_READY') {
    if (pendingFiles.length > 0) {
      event.source.postMessage({ type: 'SHARED_FILES', files: pendingFiles });
      pendingFiles = []; // clear after sending
    }
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  if (url.pathname === '/_share-target' && event.request.method === 'POST') {
    event.respondWith(Response.redirect('/?shared=true', 303));
    
    event.waitUntil(async function() {
      try {
        const formData = await event.request.formData();
        const files = formData.getAll('shared_file');
        
        pendingFiles = files;
        
        // Also try to send immediately if a client is already ready
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientsList) {
          client.postMessage({ type: 'SHARED_FILES', files: pendingFiles });
        }
        
      } catch (err) {
        console.error('Error handling share target POST', err);
      }
    }());
  }
});
