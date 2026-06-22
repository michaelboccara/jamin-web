# Architecture

A reviewer's map of **Jam-in!** — a vanilla-JS PWA that plays a YouTube video,
records voice takes over it, and replays those takes *in sync* with the video.
No framework, no build step: `index.html` loads `js/main.js` as an ES module
and everything else is imported from there.

## The big picture

```
                  ┌─────────────┐    state + callbacks   ┌──────────────┐
   YouTube  ◀───▶│  youtube.js │◀─────────────────────▶│   main.js    │
   (IFrame API)   │  (Player)   │   (the `app` object)   │  bootstrap   │
                  └─────────────┘                        └──────┬───────┘
                                                                │ wires
         mic ──▶ recorder.js ──blob──▶ recording.js ───────────┤
                                           │ save               │
                                           ▼                    ▼
    playback.js ◀──AudioBuffer── db.js (IndexedDB) ◀───────── *-ui
    (Web Audio sync engine)                                (DOM rendering)
```

Three clocks/streams have to be reconciled, and that's where most of the complexity (and the bugs worth hunting) live:

1. **The video clock** — `player.getCurrentTime()` (YouTube, ~unpredictable).
2. **The audio clock** — `AudioContext.currentTime` (Web Audio, monotonic).
3. **The mic stream** — `MediaRecorder`, which is *always late* by an unobservable capture-latency amount.

## Module map


| Module                                         | Responsibility                                                                                             | Notes for review                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `js/main.js`                                   | Bootstrap. Builds the singleton `app` object and `init*()`s every feature.                                 | The `app` object **is** the global state (see below).       |
| `js/youtube.js`                                | Loads the IFrame API once, parses video IDs/URLs, wraps `YT.Player`.                                       | `STATE` enum, `parseVideoId`, metadata-readiness polling.   |
| `js/video.js`                                  | Loads a video, fetches tracks for it, captures title/author.                                               | `loadVideo` is the central "switch video" flow.             |
| `js/recorder.js`                               | `MediaRecorder` wrapper: mic constraints, mime picking, start/stop.                                        | Raw-mic toggle disables echo cancel/noise suppression.      |
| `js/recording.js`                              | Recording **session** lifecycle, tied to player state.                                                     | Pause/resume/seek handling; the trickiest UI logic.         |
| `js/playback.js`                               | **Web Audio sync engine.** Anchors, schedules, drift watchdog, latency offset.                             | The heart of the app — read its header comment first.       |
| `js/db.js`                                     | IndexedDB persistence, keyed by `videoId`.                                                                 | Two stores: `tracks` + `videos` (history metadata).         |
| `js/tracks-ui.js`                              | Timeline track rows: waveform position, per-take volume/mute/solo/nudge/delete.                            | Most DOM code; reads/writes track fields + engine.          |
| `js/timeline-playhead.js`                      | Playhead cursor, click-to-seek, click-to-play/pause.                                                       |                                                             |
| `js/latency.js`                                | Device-wide sync-offset control (persisted in `localStorage`).                                             |                                                             |
| `js/auto-sync.js`                              | Auto-detect per-take offset by cross-correlating the take's rhythm with a tab-audio reference of the song. | Chromium-desktop only; opt-in (beta). See note below.       |
| `js/search.js` / `search-ui.js`                | YouTube search via public Piped/Invidious instances + embeddability probe.                                 | No API key; depends on flaky third-party instances.         |
| `js/history-ui.js`                             | "Recorded videos" dropdown.                                                                                |                                                             |
| `js/export-import.js` / `zip.js`               | Zip of audio blobs + `metadata.json`.                                                                      | `zip.js` is a hand-rolled STORE-only zip (CRC32 + headers). |
| `js/waveform.js`                               | Downsample an `AudioBuffer` to peaks; draw canvas previews.                                                |                                                             |
| `js/ui.js`                                     | Toast, theme, overlay, `formatTime`, `escapeHtml`, modals, element binding.                                | `bindElements()` is the single source of DOM refs.          |
| `js/errors.js`                                 | `reportError` / `reportWarning` — console + optional toast.                                                |                                                             |
| `js/constants.js`                              | Storage keys, default video, thresholds.                                                                   |                                                             |
| `js/pwa.js` / `sw.js` / `manifest.webmanifest` | Install prompt + offline app-shell cache.                                                                  | `sw.js` `SHELL` list must be kept in sync with files.       |


## State model

There is **no framework and no store** — `main.js` creates one plain `app`
object that holds all mutable state (`currentVideoId`, `tracks`, `isRecording`,
`latencyOffset`, `soloTrackId`, …) plus references to the `player`, `recorder`,
and `engine`. Every `init*(app)` function attaches event listeners that mutate
`app` and call back into rendering (`app.renderTracks()`, `app.renderHistory()`).

`app.tracks` is the in-memory mirror of the IndexedDB rows for the current
video. The `engine` keeps its *own* decoded-buffer copy of each track. So a
track's truth lives in **three** places that must stay consistent: IndexedDB
(persistent), `app.tracks` (UI), and `engine.tracks` (audio). Watch every
mutation (rename/volume/mute/nudge/delete/import) to confirm all three are
updated — this is a prime source of subtle review findings.

## Sync engine (the part to scrutinize)

`playback.js` has a long header comment that is the spec; the summary:

- **Anchor:** on play, store `anchorAudio = ctx.currentTime` and
`anchorVideo = videoTime`. Expected video time is then
`anchorVideo + (ctx.currentTime - anchorAudio)`.
- **Scheduling:** each clip should sound at video time `clip.startTime`, so it's
started at `anchorAudio + (effStart - anchorVideo)`. A clip already mid-play
at anchor time is started immediately with an in-buffer offset.
- **Latency compensation:** takes are recorded *late*, so the engine plays them
*earlier*: `effStart = startTime - globalOffset - track.offset`
(`globalOffset` = device default in `latency.js`; `track.offset` = per-take
nudge in `tracks-ui.js`). This value is unknowable, hence user-tuned.
- **Drift watchdog** (`_tick`, 4×/sec): compares expected vs actual video time.
`|error| > SEEK_THRESHOLD (0.6s)` → treat as seek: stop, re-anchor,
reschedule. `|error| > DRIFT_THRESHOLD (0.18s)` → gentle re-anchor without
retriggering audible clips.

Note the same `effStart` formula is duplicated in `tracks-ui.js`
(`getTrackSegment`) to position waveforms — they must agree with the engine.

### Auto-sync (`auto-sync.js`, opt-in beta)

Since the latency is unknowable from APIs, auto-sync *measures* it from the
recording itself. With headphones a take is voice-only and shares no waveform
with the song — only its **rhythm** — so we:

1. Capture a reference of the song via `getDisplayMedia({audio:true})`
  ("Share tab audio"). The song plays in a **cross-origin YouTube iframe**, so
   tab-audio capture is the *only* way to obtain its waveform.
2. While recording, sample the reference's RMS envelope at 100 Hz, time-anchored
  to record start.
3. After the user keeps the take, reduce both the take and the reference to
  z-normalized **onset envelopes** (half-wave-rectified first difference) and
   **cross-correlate** them over lags in `[-0.1, +0.6] s`. The peak lag is the
   round-trip latency `R`; we store `track.offset = clamp(R - globalOffset)`.

Caveats (all handled by graceful degradation):

- **Chromium desktop only** — Firefox/Safari can't capture tab audio; the
feature self-disables and toasts once.
- Needs the per-session "Share tab audio" permission; requested on toggle-enable
so the prompt rides the click gesture. A take only auto-syncs when the stream
was already live at record start (a fresh prompt would desync the anchor), so
the first take after a reload primes the stream and the next one uses it.
- **Approximate** with headphones (singers don't hit every beat). Results below a
confidence/prominence threshold, or takes shorter than `AUTO_SYNC_MIN_TAKE_SEC`,
are **not applied** — the take saves with `offset: 0` and the user nudges.
- Monitored prior takes also leak into the tab-audio reference (voice-on-voice);
acceptable for the MVP.
- The detected value lands in the existing per-take `offset`, so it persists and
exports with no schema change.

## Key flows

**Load a video** (`video.js → loadVideo`): overlay → `player.load(id)` →
`engine.clear()` → `db.getTracksByVideo(id)` → `engine.addTrack()` per track →
`renderTracks()` → schedule timeline layout (YouTube metadata arrives late, so
it's polled) → `captureVideoMeta()` for the history title.

**Record a take** (`recording.js`): stop monitor playback → open mic → play
video, anchor `recStartVideoTime = currentTime` → `recorder.start()`. Player
state changes drive pause/resume; a large jump in `currentTime` between UI ticks
is treated as a seek and **auto-finalizes** the take. On stop → decode for
duration + peaks → confirm-keep modal → persist to all three stores.

**Replay**: driven by player state in `recording.js` / `timeline-playhead.js` —
`PLAYING` starts the engine, `PAUSED`/`ENDED`/`BUFFERING` stop it.

## Review hot spots

- **Three-way track consistency** (IndexedDB / `app.tracks` / `engine.tracks`) on
every edit path.
- `**effStart` duplication** between `playback.js` and `tracks-ui.js`.
- **Recording session edge cases** in `recording.js`: seek-during-record,
pause/resume timing, `finalizingRecording` re-entrancy guard, the elapsed-time
accounting (`recActiveMs` + segment timestamps).
- **Async re-entrancy / races**: `searchSequence` guards stale search responses;
`keepTakePending` / `finalizingRecording` guard the record button; metadata
polling loops in `youtube.js` / `video.js` have 15s deadlines.
- **Third-party fragility** in `search.js` (public instances) and
`captureVideoMeta` (oEmbed) — failure handling and timeouts.
- `**sw.js` cache list** must list every shipped file, and bump `CACHE` version
on change, or users get stale assets.
- `**zip.js`** is hand-rolled (STORE only, little validation) — check bounds and
the CRC/offset math if you care about robustness.
- **Security/escaping**: most DOM is built with `textContent` (safe), but
`history-ui.js` uses `innerHTML` with `escapeHtml()` — verify nothing
unescaped slips in.

## Out of scope (noted, not built)

Speaker-mode source-audio subtraction (record without headphones) and final
mixed-down video export — see the README "Future phases".