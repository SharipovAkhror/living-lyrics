/** Audio files the reader attaches on their own device, kept in IndexedDB so they survive reloads. */
const DB = 'living-lyrics';
const STORE = 'audio';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface StoredAudio {
  blob: Blob;
  name: string;
  added: number;
}

export async function saveAudio(slug: string, file: File): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ blob: file, name: file.name, added: Date.now() } satisfies StoredAudio, slug);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* storage unavailable: the file still plays for this session */
  }
}

export async function loadAudio(slug: string): Promise<StoredAudio | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(slug);
      req.onsuccess = () => resolve((req.result as StoredAudio) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function removeAudio(slug: string): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(slug);
  } catch {
    /* nothing to remove */
  }
}
