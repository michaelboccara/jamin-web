// YouTube search UI — renders results and loads selected videos.

import { SEARCH_KEYWORD } from "./constants.js";
import { reportError } from "./errors.js";
import { formatTime } from "./ui.js";
import { parseVideoId } from "./youtube.js";
import { searchYouTube, thumbUrl } from "./search.js";
import { loadVideo } from "./video.js";

export function initSearch(app) {
  const { elements } = app;

  elements.searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = elements.searchInput.value.trim();
    if (!raw) return;

    const directId = parseVideoId(raw);
    if (directId) {
      hideSearchResults(elements);
      loadVideo(app, directId);
      return;
    }

    const sequence = ++app.searchSequence;
    const query = `${raw} ${SEARCH_KEYWORD}`;
    showSearchStatus(elements, "Searching & checking which videos allow embedding…");
    elements.searchBtn.disabled = true;

    let results;
    try {
      results = await searchYouTube(query);
    } catch (error) {
      if (sequence === app.searchSequence) {
        const message = error.message || "Search failed.";
        reportError("searchYouTube", error, message, app.notify);
        showSearchStatus(elements, message);
      }
      return;
    } finally {
      elements.searchBtn.disabled = false;
    }

    if (sequence !== app.searchSequence) return;
    renderSearchResults(app, results);
  });

  document.addEventListener("click", (event) => {
    if (elements.searchResults.hidden) return;
    if (!elements.searchResults.contains(event.target) && event.target !== elements.searchInput) {
      hideSearchResults(elements);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideSearchResults(elements);
  });
}

function showSearchStatus(elements, message) {
  elements.searchResults.innerHTML = "";
  const paragraph = document.createElement("p");
  paragraph.className = "search-status";
  paragraph.textContent = message;
  elements.searchResults.append(paragraph);
  openSearchResults(elements);
}

function openSearchResults(elements) {
  elements.searchResults.hidden = false;
  elements.searchInput.setAttribute("aria-expanded", "true");
}

function hideSearchResults(elements) {
  elements.searchResults.hidden = true;
  elements.searchInput.setAttribute("aria-expanded", "false");
}

function renderSearchResults(app, results) {
  const { elements } = app;
  elements.searchResults.innerHTML = "";

  if (!results.length) {
    showSearchStatus(elements, "No embeddable results. Try different words or paste a YouTube link.");
    return;
  }

  for (const result of results) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "search-item";
    item.setAttribute("role", "option");

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "search-thumb-wrap";

    const image = document.createElement("img");
    image.className = "search-thumb";
    image.loading = "lazy";
    image.src = thumbUrl(result.videoId);
    image.alt = "";
    thumbWrap.append(image);

    if (result.duration != null) {
      const duration = document.createElement("span");
      duration.className = "search-duration";
      duration.textContent = formatTime(result.duration);
      thumbWrap.append(duration);
    }

    const info = document.createElement("div");
    info.className = "search-info";

    const title = document.createElement("span");
    title.className = "search-title";
    title.textContent = result.title || "(untitled)";

    const author = document.createElement("span");
    author.className = "search-author";
    author.textContent = result.author || "";

    info.append(title, author);
    item.append(thumbWrap, info);
    item.addEventListener("click", () => {
      hideSearchResults(elements);
      loadVideo(app, result.videoId);
    });

    elements.searchResults.append(item);
  }
  openSearchResults(elements);
}
