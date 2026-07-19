# june

A jam room for YouTube Music — friends join a room and listen to the same
queue, in sync.

## Core logic

`src/jam/` is the pure, transport-agnostic heart of a jam. Every function is
deterministic (it takes the current time `now` as a parameter — no hidden
clocks), so the same code runs in tests and behind a realtime server.

The room stores `nowPlaying = { track, startedAt }`. Each client derives its
playback position as `now - startedAt`, so everyone converges on the same spot
without streaming any audio between them.

| Function | Behavior |
| --- | --- |
| `createJam(id)` | new, empty, idle room |
| `join` / `leave` | membership; `join` is reconnect-safe |
| `enqueue(jam, track, now)` | collaborative FIFO; auto-starts when idle |
| `currentPosition(jam, now)` | the shared clock: `now - startedAt` |
| `tick(jam, now)` | retires finished tracks, advances back-to-back |
| `skip(jam, now)` | jump to the next track |
| `removeFromQueue(jam, id)` | drop a queued track |

## Develop

```bash
npm install
npm test          # run the suite
npm run test:watch
npm run typecheck
```
