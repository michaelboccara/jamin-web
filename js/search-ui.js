// YouTube search UI — searches as you type, and shows the play-history
// dropdown when the field is empty.

import { SEARCH_KEYWORD } from "./constants.js";
import { reportError } from "./errors.js";
import { formatTime } from "./ui.js";
import { parseVideoId } from "./youtube.js";
import { searchYouTube, thumbUrl } from "./search.js";
import { loadVideo } from "./video.js";
import { showHistory, hideHistory } from "./history-ui.js";

// Auto-search fires shortly after typing pauses, but never less often than
// every few seconds during continuous typing — so we don't hit the network on
// every keystroke, while still feeling responsive.
const TYPING_PAUSE_MS = 900;
const MAX_TYPING_WAIT_MS = 3000;
const MIN_QUERY_LENGTH = 2;

export function initSearch(app) {
  const { elements } = app;
  const input = elements.searchInput;

  let debounceTimer = null;
  let burstStartedAt = 0;

  function cancelPending() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    burstStartedAt = 0;
  }

  // Run a search (or load a pasted link/ID) immediately.
  function runNow(rawValue) {
    cancelPending();
    const text = rawValue.trim();
    if (!text) return;

    const directId = parseVideoId(text);
    if (directId) {
      hideSearchResults(elements);
      loadVideo(app, directId);
      return;
    }
    performSearch(app, text);
  }

  // Debounced auto-search: short delay after the last keystroke, capped so a
  // continuous typing burst still searches at most every MAX_TYPING_WAIT_MS.
  function scheduleSearch() {
    const text = input.value.trim();
    // A pasted link/ID is unambiguous, so act on it after the same debounce.
    if (text.length < MIN_QUERY_LENGTH && !parseVideoId(text)) {
      cancelPending();
      return;
    }
    const now = Date.now();
    if (!burstStartedAt) burstStartedAt = now;
    if (debounceTimer) clearTimeout(debounceTimer);
    const delay = Math.min(TYPING_PAUSE_MS, Math.max(0, MAX_TYPING_WAIT_MS - (now - burstStartedAt)));
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      burstStartedAt = 0;
      runNow(input.value);
    }, delay);
  }

  // Enter searches now (and handles a pasted link).
  elements.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runNow(input.value);
  });

  input.addEventListener("input", () => {
    if (!input.value.trim()) {
      cancelPending();
      hideSearchResults(elements);
      showHistory(app);
      return;
    }
    hideHistory(app);
    scheduleSearch();
  });

  // Tapping into an empty field surfaces the play history instead of results.
  const onFocus = () => {
    if (!input.value.trim()) {
      hideSearchResults(elements);
      showHistory(app);
    }
  };
  input.addEventListener("focus", onFocus);
  input.addEventListener("click", onFocus);

  document.addEventListener("click", (event) => {
    if (event.target === input) return;
    if (!elements.searchResults.hidden && !elements.searchResults.contains(event.target)) {
      hideSearchResults(elements);
    }
    if (!elements.historyPanel.hidden && !elements.historyPanel.contains(event.target)) {
      hideHistory(app);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSearchResults(elements);
      hideHistory(app);
    }
  });
}

async function performSearch(app, raw) {
  const { elements } = app;
  hideHistory(app);

  const sequence = ++app.searchSequence;
  const query = `${raw} ${SEARCH_KEYWORD}`;
  showSearchStatus(elements, "Searching & checking which videos allow embedding…");

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
  }

  if (sequence !== app.searchSequence) return;
  renderSearchResults(app, results);
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
  if (elements.historyPanel.hidden) {
    elements.searchInput.setAttribute("aria-expanded", "false");
  }
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
