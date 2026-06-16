// Play history dropdown — videos that have recorded takes. It shares the
// search field's dropdown area and is shown (by search-ui.js) when the field
// is empty.

import * as db from "./db.js";
import { reportError } from "./errors.js";
import { escapeHtml, makeIconButton } from "./ui.js";
import { loadVideo } from "./video.js";

export function showHistory(app) {
  const { elements } = app;
  elements.historyPanel.hidden = false;
  elements.searchInput.setAttribute("aria-expanded", "true");
  renderHistory(app);
}

export function hideHistory(app) {
  const { elements } = app;
  elements.historyPanel.hidden = true;
  if (elements.searchResults.hidden) {
    elements.searchInput.setAttribute("aria-expanded", "false");
  }
}

export async function renderHistory(app) {
  const { elements, currentVideoId } = app;
  let entries = [];

  try {
    entries = await db.getVideosWithRecordings();
  } catch (error) {
    reportError("renderHistory", error, null, app.notify);
  }

  elements.historyList.innerHTML = "";
  elements.historyEmpty.hidden = entries.length > 0;

  for (const entry of entries) {
    const listItem = document.createElement("li");
    listItem.className = "history-item" + (entry.videoId === currentVideoId ? " current" : "");

    const loadButton = document.createElement("button");
    loadButton.className = "history-load";
    loadButton.title = "Load this video";

    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = entry.title || "(untitled video)";

    const meta = document.createElement("span");
    meta.className = "history-meta";
    const takeLabel = `${entry.count} take${entry.count === 1 ? "" : "s"}`;
    const authorPrefix = entry.author ? `${entry.author} · ` : "";
    meta.innerHTML =
      `${escapeHtml(authorPrefix)}<span class="history-id">${escapeHtml(entry.videoId)}</span> · ${takeLabel}`;

    loadButton.append(title, meta);
    loadButton.addEventListener("click", () => {
      hideHistory(app);
      loadVideo(app, entry.videoId);
    });

    const link = document.createElement("a");
    link.className = "history-link";
    link.href = `https://youtu.be/${entry.videoId}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = "Open on YouTube";
    link.textContent = "↗";

    const deleteButton = makeIconButton("🗑", "Remove from history (deletes its takes)", async () => {
      const label = entry.title || entry.videoId;
      if (!confirm(
        `Remove "${label}" from history?\nThis permanently deletes its ${entry.count} recorded take${entry.count === 1 ? "" : "s"}.`
      )) return;

      try {
        await db.deleteVideo(entry.videoId);
        if (entry.videoId === currentVideoId) {
          app.engine.clear();
          app.tracks = [];
          app.renderTracks();
        }
        await renderHistory(app);
        app.notify("Removed from history.");
      } catch (error) {
        reportError("deleteVideo", error, "Could not remove from history.", app.notify);
      }
    });
    deleteButton.classList.add("danger", "history-del");

    listItem.append(loadButton, link, deleteButton);
    elements.historyList.append(listItem);
  }
}
