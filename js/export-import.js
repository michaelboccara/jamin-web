// Export / import tracks as a zip of audio blobs + JSON metadata.

import * as db from "./db.js";
import { reportError } from "./errors.js";
import { buildZip, readZip } from "./zip.js";
import { loadVideo, captureVideoMeta } from "./video.js";

export function initExportImport(app) {
  const { elements } = app;

  elements.exportBtn.addEventListener("click", () => exportTracks(app));
  elements.importBtn.addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", () => importTracks(app));
}

async function exportTracks(app) {
  const { tracks, currentVideoId, notify } = app;
  if (!tracks.length) {
    notify("No tracks to export for this video.");
    return;
  }

  try {
    const metadata = { videoId: currentVideoId, exportedAt: Date.now(), version: 1, tracks: [] };
    const entries = [];
    let index = 0;

    for (const track of tracks) {
      const extension = (track.mimeType || "").includes("ogg") ? "ogg"
        : (track.mimeType || "").includes("mp4") ? "m4a" : "webm";
      const filename = `audio/${index}.${extension}`;
      entries.push({ name: filename, data: new Uint8Array(await track.blob.arrayBuffer()) });
      metadata.tracks.push({
        file: filename,
        name: track.name,
        startTime: track.startTime,
        offset: track.offset ?? 0,
        duration: track.duration,
        mimeType: track.mimeType,
        volume: track.volume,
        muted: track.muted,
        peaks: track.peaks,
        createdAt: track.createdAt,
      });
      index += 1;
    }
    entries.push({
      name: "metadata.json",
      data: new TextEncoder().encode(JSON.stringify(metadata, null, 2)),
    });

    const zip = buildZip(entries);
    const url = URL.createObjectURL(zip);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jamin-${currentVideoId}.zip`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notify("Exported.", "success");
  } catch (error) {
    reportError("exportTracks", error, "Export failed.", notify);
  }
}

async function importTracks(app) {
  const { elements, currentVideoId, notify, renderHistory } = app;
  const file = elements.importFile.files[0];
  elements.importFile.value = "";
  if (!file) return;

  try {
    const files = await readZip(file);
    const metadataBytes = files["metadata.json"];
    if (!metadataBytes) throw new Error("metadata.json missing");

    const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
    const targetVideoId = metadata.videoId || currentVideoId;

    for (const entry of metadata.tracks) {
      const bytes = files[entry.file];
      if (!bytes) continue;
      const blob = new Blob([bytes], { type: entry.mimeType || "audio/webm" });
      await db.addTrack({
        videoId: targetVideoId,
        name: entry.name || "Imported take",
        startTime: entry.startTime || 0,
        offset: entry.offset ?? 0,
        duration: entry.duration || 0,
        mimeType: entry.mimeType || "audio/webm",
        volume: entry.volume ?? 1,
        muted: !!entry.muted,
        peaks: entry.peaks || [],
        createdAt: entry.createdAt || Date.now(),
        blob,
      });
    }

    notify("Imported.", "success");
    if (targetVideoId === currentVideoId) {
      await loadVideo(app, currentVideoId);
    } else if (confirm("Imported takes belong to a different video. Load it now?")) {
      await loadVideo(app, targetVideoId);
    } else {
      captureVideoMeta(app, targetVideoId);
    }
    renderHistory();
  } catch (error) {
    reportError("importTracks", error, `Import failed: ${error.message}`, notify);
  }
}
