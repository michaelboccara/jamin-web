# Jam-in! 🎤

Sing over any YouTube video, record your voice takes, and play them back **in sync** with the video. Vanilla JS, no build step, works offline (PWA).

## Run it

It must be served over `http://localhost` (or HTTPS) — the YouTube IFrame API,
microphone access, and the service worker won't work from a `file://` URL.

```bash
# from this folder
python -m http.server 8123
# then open http://localhost:8123
```

Any static server works (`npx serve`, etc.). Do **not** open `index.html` directly (`file://`) — the YouTube player and microphone need `http://localhost` (or HTTPS).

**Embedding note:** many karaoke channels (including Sing King) disable iframe embedding. If you see “can't be embedded”, try another video — official music videos and smaller karaoke channels often work better.

## How to use

1. The YouTube IFrame API demo loads by default (always embeds on localhost). Paste any embeddable karaoke or music video URL/ID and hit **Load**.
2. Press **● Record** — the video plays and your mic is captured. The take's start is anchored to the video's `currentTime`.
3. Press **■ Stop take** to save. Saved takes appear in the **Tracks** list (waveform preview, rename, per-track volume/mute, preview, delete).
4. **Sync offset** (slider): a take is always recorded slightly *late* because of headphone output + mic input latency (Bluetooth especially). Slide **right** if your voice plays late on replay, **left** if early. It's saved per device, and each take also has a `−/+` nudge for fine fixes.
5. **Raw mic** (checkbox): toggle browser noise suppression and echo cancellation (recommended when using headphones).
6. **Monitor takes** (checkbox): while recording, existing takes are monitored so you can overdub. Use headphones so they don't bleed into the new take.
7. **Export/Import**: save all takes for a video as a `.zip` (audio blobs + `metadata.json`) and re-import later.

## Architecture

| File | Responsibility |
| --- | --- |
| `index.html` / `css/styles.css` | App shell + minimal, dark-mode-first, mobile-friendly UI |
| `js/main.js` | Wires UI ↔ player ↔ recorder ↔ db ↔ playback engine |
| `js/youtube.js` | Loads the IFrame API, parses URLs, wraps the player |
| `js/recorder.js` | `MediaRecorder` voice capture (webm/opus) |
| `js/playback.js` | Web Audio engine that keeps takes synced to the video |
| `js/db.js` | IndexedDB persistence, keyed by YouTube video ID |
| `js/waveform.js` | Downsampled peaks + canvas preview |
| `js/zip.js` | Dependency-free STORE-method zip writer/reader |
| `sw.js` / `manifest.webmanifest` | PWA: offline app shell + installability |

### Sync model & drift handling

The video clock and the Web Audio clock are independent. The engine keeps one
**anchor** mapping `audioCtx.currentTime` → video time, and schedules every clip
relative to it. A 4×/sec watchdog compares expected vs. actual video time:

- error > ~0.6 s → treated as a **seek**: stop, re-anchor, reschedule.
- error > ~0.18 s → gentle **re-anchor** without retriggering audible clips.

**Latency compensation:** independent of drift, every take is recorded *late*
by the capture round-trip (the audio the singer heard in their headphones is
behind the video, and the mic adds more delay). The browser/YouTube stack
doesn't expose this latency, so it can't be computed — the engine subtracts a
user-tuned **sync offset** (global default + per-take nudge) from each clip's
start time. See the long comment block at the top of `js/playback.js`.

## Future phases (stubbed / noted)

- **Speaker mode / noise cancellation**: subtract the source audio so you can
  record without headphones (needs Web Audio analysis or a user-provided source track).
- **Final dubbed export**: render canvas + mixed audio via `MediaRecorder`.
