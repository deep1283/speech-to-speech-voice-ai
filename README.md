# Speech-to-Speech Voice AI

A browser-based interface for real-time speech-to-speech conversations with a compatible WebSocket backend. The client captures microphone audio, streams encoded audio to the server, plays streamed audio responses, and renders live audio activity in the browser.

## Highlights

- Real-time, bidirectional audio streaming over WebSockets
- Browser microphone capture with echo cancellation, noise suppression, and automatic gain control
- Continuous and push-to-talk interaction modes
- Configurable backend endpoint and audio settings
- Web Audio-based playback and microphone/speaker visualisation
- Text events alongside streamed audio responses

## Architecture

```text
Browser microphone
  → AudioManager / recorder
  → MoshiClient WebSocket protocol
  → compatible speech-to-speech backend
  → streamed audio + text events
  → browser playback + visualiser
```

The client expects a backend that implements the tagged Moshi-style WebSocket protocol used by `src/lib/moshi-client.ts`:

- `0x00`: session handshake
- `0x01`: audio payload
- `0x02`: UTF-8 text payload
- `0x03`: session control message

## Stack

- TypeScript and React 19
- Next.js 16
- Web Audio API
- WebSockets
- Tailwind CSS

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, open **Settings**, and set the WebSocket backend URL. The development default is `ws://127.0.0.1:8998/api/chat`.

## Quality checks

```bash
npm run lint
npm run build
```

## Notes

- The browser will request microphone access when a conversation begins.
- A running compatible speech backend is required; this repository provides the web client, not the model-serving runtime.
