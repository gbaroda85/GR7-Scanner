import { Document, Folder } from '../types';

const DB_NAME = 'ScannerAppDatabase';
const DB_VERSION = 1;
const DOCS_STORE = 'documents';
const FOLDERS_STORE = 'folders';

let dbPromise: Promise<IDBDatabase> | null = null;
let isIndexedDBAvailable: boolean | null = null;

// Fallback local memory store
let inMemoryDocs: Document[] = [];
let inMemoryFolders: Folder[] = [];

// Helper to safely access localStorage
function safeGetLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    console.warn(`localStorage read for key "${key}" blocked:`, e);
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`localStorage write for key "${key}" blocked:`, e);
    return false;
  }
}

async function migrateFromLocalStorage(db: IDBDatabase): Promise<void> {
  try {
    const rawDocs = safeGetLocalStorage('scanner_docs');
    const rawFolders = safeGetLocalStorage('scanner_folders');
    
    if (rawDocs) {
      const docs = JSON.parse(rawDocs);
      if (Array.isArray(docs) && docs.length > 0) {
        const tx = db.transaction(DOCS_STORE, 'readwrite');
        const store = tx.objectStore(DOCS_STORE);
        for (const doc of docs) {
          store.put(doc);
        }
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        try {
          window.localStorage.removeItem('scanner_docs');
        } catch (err) {}
        console.log('Successfully migrated documents to IndexedDB');
      }
    }
    
    if (rawFolders) {
      const folders = JSON.parse(rawFolders);
      if (Array.isArray(folders) && folders.length > 0) {
        const tx = db.transaction(FOLDERS_STORE, 'readwrite');
        const store = tx.objectStore(FOLDERS_STORE);
        for (const folder of folders) {
          store.put(folder);
        }
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        try {
          window.localStorage.removeItem('scanner_folders');
        } catch (err) {}
        console.log('Successfully migrated folders to IndexedDB');
      }
    }
  } catch (e) {
    console.error('Migration from localStorage failed:', e);
  }
}

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      if (!window.indexedDB) {
        reject(new Error("indexedDB is not defined on window"));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error || new Error("IndexedDB failed to open"));
      request.onsuccess = async () => {
        const db = request.result;
        try {
          await migrateFromLocalStorage(db);
        } catch (e) {
          console.warn("Migration failed during db initialization:", e);
        }
        resolve(db);
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DOCS_STORE)) {
          db.createObjectStore(DOCS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
          db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
        }
      };
    } catch (e) {
      reject(e);
    }
  });
  
  return dbPromise;
}

async function checkIndexedDB(): Promise<boolean> {
  if (isIndexedDBAvailable !== null) return isIndexedDBAvailable;
  
  try {
    if (!window.indexedDB) {
      isIndexedDBAvailable = false;
      return false;
    }
    await getDB();
    isIndexedDBAvailable = true;
    return true;
  } catch (e) {
    console.warn("IndexedDB initialization failed, falling back to LocalStorage:", e);
    isIndexedDBAvailable = false;
    return false;
  }
}

// Fallback Document Operations
function getFallbackDocuments(): Document[] {
  const raw = safeGetLocalStorage('scanner_docs');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inMemoryDocs = parsed;
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse fallback documents:", e);
    }
  }
  return inMemoryDocs;
}

function saveFallbackDocument(doc: Document): void {
  const docs = getFallbackDocuments();
  const idx = docs.findIndex(d => d.id === doc.id);
  if (idx >= 0) {
    docs[idx] = doc;
  } else {
    docs.push(doc);
  }
  inMemoryDocs = docs;
  safeSetLocalStorage('scanner_docs', JSON.stringify(docs));
}

function deleteFallbackDocument(id: string): void {
  const docs = getFallbackDocuments();
  const filtered = docs.filter(d => d.id !== id);
  inMemoryDocs = filtered;
  safeSetLocalStorage('scanner_docs', JSON.stringify(filtered));
}

// Fallback Folder Operations
function getFallbackFolders(): Folder[] {
  const raw = safeGetLocalStorage('scanner_folders');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inMemoryFolders = parsed;
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse fallback folders:", e);
    }
  }
  return inMemoryFolders;
}

function saveFallbackFolder(folder: Folder): void {
  const folders = getFallbackFolders();
  const idx = folders.findIndex(f => f.id === folder.id);
  if (idx >= 0) {
    folders[idx] = folder;
  } else {
    folders.push(folder);
  }
  inMemoryFolders = folders;
  safeSetLocalStorage('scanner_folders', JSON.stringify(folders));
}

function deleteFallbackFolder(id: string): void {
  const folders = getFallbackFolders();
  const filtered = folders.filter(f => f.id !== id);
  inMemoryFolders = filtered;
  safeSetLocalStorage('scanner_folders', JSON.stringify(filtered));
  
  // also update documents in fallback
  const docs = getFallbackDocuments();
  let modified = false;
  for (const d of docs) {
    if (d.folderId === id) {
      d.folderId = undefined;
      modified = true;
    }
  }
  if (modified) {
    inMemoryDocs = docs;
    safeSetLocalStorage('scanner_docs', JSON.stringify(docs));
  }
}

export async function getDocuments(): Promise<Document[]> {
  const isIDBAvail = await checkIndexedDB();
  if (!isIDBAvail) {
    return getFallbackDocuments();
  }
  
  try {
    const db = await getDB();
    return new Promise<Document[]>((resolve, reject) => {
      const tx = db.transaction(DOCS_STORE, 'readonly');
      const store = tx.objectStore(DOCS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Error fetching documents from IndexedDB, falling back:', e);
    return getFallbackDocuments();
  }
}

export async function saveDocument(doc: Document): Promise<void> {
  const isIDBAvail = await checkIndexedDB();
  if (!isIDBAvail) {
    saveFallbackDocument(doc);
    return;
  }
  
  try {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DOCS_STORE, 'readwrite');
      const store = tx.objectStore(DOCS_STORE);
      store.put(doc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Error saving document to IndexedDB, falling back:', e);
    saveFallbackDocument(doc);
  }
}

export async function deleteDocument(id: string): Promise<void> {
  const isIDBAvail = await checkIndexedDB();
  if (!isIDBAvail) {
    deleteFallbackDocument(id);
    return;
  }
  
  try {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DOCS_STORE, 'readwrite');
      const store = tx.objectStore(DOCS_STORE);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Error deleting document from IndexedDB, falling back:', e);
    deleteFallbackDocument(id);
  }
}

export async function getFolders(): Promise<Folder[]> {
  const isIDBAvail = await checkIndexedDB();
  if (!isIDBAvail) {
    return getFallbackFolders();
  }
  
  try {
    const db = await getDB();
    return new Promise<Folder[]>((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, 'readonly');
      const store = tx.objectStore(FOLDERS_STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Error fetching folders from IndexedDB, falling back:', e);
    return getFallbackFolders();
  }
}

export async function saveFolder(folder: Folder): Promise<void> {
  const isIDBAvail = await checkIndexedDB();
  if (!isIDBAvail) {
    saveFallbackFolder(folder);
    return;
  }
  
  try {
    const db = await getDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite');
      const store = tx.objectStore(FOLDERS_STORE);
      store.put(folder);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error('Error saving folder to IndexedDB, falling back:', e);
    saveFallbackFolder(folder);
  }
}

export async function deleteFolder(id: string): Promise<void> {
  const isIDBAvail = await checkIndexedDB();
  if (!isIDBAvail) {
    deleteFallbackFolder(id);
    return;
  }
  
  try {
    const db = await getDB();
    
    // First, remove the folder
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite');
      const store = tx.objectStore(FOLDERS_STORE);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    
    // Then, remove this folderId from all documents (moving them to uncategorized)
    const docs = await getDocuments();
    const updatePromises = docs
      .filter(d => d.folderId === id)
      .map(d => {
        d.folderId = undefined;
        return saveDocument(d);
      });
    await Promise.all(updatePromises);
  } catch (e) {
    console.error('Error deleting folder from IndexedDB, falling back:', e);
    deleteFallbackFolder(id);
  }
}
