# Jam-in! Web App

## Goal
Build a single-page web app that lets users play a YouTube video while recording voice commentary. Store recordings locally (IndexedDB or localForage for persistence + timestamps). On replay, sync and overlay the voice tracks with the video. Start with earphones mode (simple mixing). Plan for future speaker mode (real-time source audio subtraction via Web Audio API).
Make sure it works, with an embeddable YouTube video example of some karaoke of instrumental + lyrics.

## Tech Stack
- Vanilla JS for app and UI (keep it simplistic)
- YouTube IFrame API for video control.
- MediaRecorder API for voice recording.
- Web Audio API for playback mixing/sync.
- localForage or IndexedDB for storing audio blobs + metadata (video ID, timestamps).

## Core Features (Implement in this order)
1. YouTube URL input + embed player with play/pause controls.
2. Record button: Starts/stops voice recording while video plays. Capture timestamps relative to video currentTime.
3. List of recordings per video (with delete/play-individual).
4. Playback mode: Play video + automatically trigger synced audio clips at correct times (use Audio elements or Web Audio for mixing).
5. UI: Clean, minimal. Video on left/top, controls + recording list on side. Show waveform previews if possible (simple canvas).
6. Persistence: Key by YouTube video ID. Load existing tracks on video load.
7. Error handling: Permissions, YouTube embed restrictions, audio format (webm/opus).

## Non-functional
- Mobile-friendly.
- PWA
- Dark mode.
- Export/import recordings (zip of audios + JSON metadata).
- Comments explaining sync logic and potential drift fixes.

## Future Phases (Note but stub out)
- Noise cancellation: Analyze and subtract video audio (Web Audio filters, might need user-provided source track or advanced processing).
- Multi-track mixing, volume per track, export final dubbed video (MediaRecorder on canvas+audio).

Start with index.html, main.js. Generate full project structure. Make it work end-to-end before polishing.