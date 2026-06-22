// YouTube video helpers — overlay, record button, error messages.

import { STORAGE_KEYS } from "./constants.js";
import { recordingSupportError } from "./recorder.js";

export function describeYouTubeError(code) {
  if (code === "101" || code === "150") {
    return "This video can't be embedded (uploader blocked it). Try another link — many karaoke channels disable embedding.";
  }
  if (code === "153") {
    return "YouTube rejected the embed (missing referrer). Open via http://localhost, not file://.";
  }
  if (code === "100") return "Video not found or removed.";
  if (code === "2") return "Invalid video ID.";
  return "Couldn't load this video.";
}

export function enableRecordButton(elements, enabled) {
  const blocked = recordingSupportError();
  elements.recBtn.disabled = !enabled || !!blocked;
  elements.recBtn.title = blocked || "Record a voice take while the video plays";
}

export { setPlayerOverlay } from "./ui.js";
