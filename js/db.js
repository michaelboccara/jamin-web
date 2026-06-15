// ============================================================
// db.js — IndexedDB persistence, keyed by YouTube video ID.
//
// A "track" record looks like:
//   {
//     id:          auto-increment number (primary key),
//     videoId:     string  — YouTube video ID this take belongs to,
//     name:        string  — user-editable label,
//     startTime:   number  — video currentTime (seconds) when recording started,
//     offset:      number  — per-take sync nudge (seconds), on top of the
//                            device-wide latency offset; + plays the take earlier,
//     duration:    number  — length of the audio clip (seconds),
//     mimeType:    string  — e.g. "audio/webm;codecs=opus",
//     volume:      number  — 0..1 mix gain,
//     muted:       boolean,
//     peaks:       number[] — downsampled waveform peaks for preview,
//     createdAt:   number  — epoch ms,
//     blob:        Blob     — the recorded audio
//   }
// ============================================================

const DB_NAME = "jamin-db";
const DB_VERSION = 1;
const STORE = "tracks";

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        // Index by videoId so we can load all tracks for a given video quickly.
        store.createIndex("videoId", "videoId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

export async function addTrack(track) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.add(track);
    req.onsuccess = () => resolve(req.result); // resolves to the new id
    req.onerror = () => reject(req.error);
  });
}

export async function getTracksByVideo(videoId) {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const out = [];
    const idx = store.index("videoId");
    const req = idx.openCursor(IDBKeyRange.only(videoId));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        out.push(cur.value);
        cur.continue();
      } else {
        out.sort((a, b) => a.startTime - b.startTime);
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateTrack(track) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(track);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTrack(id) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getTrack(id) {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
