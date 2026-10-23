/** Audio files the reader attaches on their own device, kept in IndexedDB so they survive reloads. */
const DB = 'living-lyrics';
const STORE = 'audio';
/** A stuck open must not hold playback. Callers fall back to the network file. */
const OPEN_MS = 3000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch (err) {
      reject(err instanceof Error ? err : new Error('indexedDB open failed'));
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) globalThis.clearTimeout(timer);
      fn();
    };
    timer = globalThis.setTimeout(() => {
      finish(() => reject(new Error('indexedDB open timed out')));
    }, OPEN_MS);
    const closeLate = () => {
      try {
        req.result?.close();
      } catch {
        /* the request never opened a database */
      }
    };
    try {
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        } catch {
          /* the store already exists */
        }
      };
      req.onsuccess = () => {
        if (settled) {
          closeLate();
          return;
        }
        finish(() => resolve(req.result));
      };
      req.onerror = () => finish(() => reject(req.error ?? new Error('indexedDB open failed')));
      // Another tab is holding an old version. Waiting here is the stall we are avoiding.
      req.onblocked = () => finish(() => reject(new Error('indexedDB open blocked')));
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error('indexedDB open failed')));
    }
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
