# Drift study

Two shadows of one phrase gradually drift apart. A softens its attack; B grows a
longer tail. The untouched route ends after 72 seconds. This independent Refrain
experiment explores changing the rules while a piece is running, then keeping
both the instrument and a particular performance.

## Run

From the repository root, after `npm ci`:

```bash
npm run drift
# Open http://127.0.0.1:4387

npm run test:drift
npm run build:drift
```

Keep the server running while playing; Ctrl+C stops it. Port 4387 must be free.
The built site is in `apps/drift-study/dist`, with relative JS/CSS/worklet URLs
and no public-directory projection. Serve it over localhost or HTTPS. Opening
`index.html` directly is not supported. The UI is Chinese with English musical
labels. Local Chromium behavior is verified; physical mobile/Safari behavior and
human listening acceptance are separate, unverified claims.

## Play

Press **开始聆听**, click a labeled note on the orbit, or press a note key to start.
No AudioContext exists before an explicit sound gesture.
The initial phrase is E4 · B4 · F♯5 · A4 over a 4.8-second loop. Both layers use
local oscillator synthesis; there are no sound downloads or model calls.

| Control                    | What it changes                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orbit note / keys 1–9      | Pluck that material note in the selected layer(s). This starts or resumes playback and records the attack in the performance.                       |
| 偏移速度 / horizontal drag | How quickly B moves ahead of A, without jumping their current relative phase.                                                                       |
| 起音消散                   | How quickly A's subsequent notes soften their attack.                                                                                               |
| 余响生长 / vertical drag   | How quickly B's subsequent notes grow longer tails.                                                                                                 |
| 冻结这次相遇               | Holds relative phase and further timbre evolution while both loops and the route clock continue. 松开 releases from that point without catching up. |
| 两层 / A / B               | Which layer is heard. The other layer stays in the work.                                                                                            |
| 暂停 / 回到开头            | Pause holds the clock; returning to the beginning stops there and retains recorded controls for replay.                                             |
| 撤回 / 重做                | Move through edits and their saved positions. One continuous drag is one undo entry.                                                                |
| 保留这一刻                 | Save a named position and its gesture path; click it to return and take another direction.                                                          |

Note buttons accept Enter/Space; left/right move focus between notes. Number keys
1–9 play the corresponding material note outside text inputs. The field accepts
arrow keys: left/right change drift, up/down change bloom.
Space on the field or page background toggles playback. Sliders use normal arrow
keys. Command/Ctrl+Z and Shift+Command/Ctrl+Z undo/redo outside text inputs.
Escape or a cancelled pointer gesture rolls back that drag. Motion reduction
slows the visual update rate and holds the wake expansion still. The light around
notes follows the shared sound envelope; direct plucks leave an additional ripple.
Nearby phase heads briefly join with a lit thread. Leaving the page pauses playback.

Each intervention has a time. Seeking back alone preserves the recorded future;
making a new intervention there removes later controls from the active path.
Bookmarks keep their own paths. Undo/redo retains up to 80 states in the current
tab; saving a file keeps the active path and bookmarks, not the undo stack.
Freezing does not make the route infinite: it still fades to its finite ending.

## Keep and return

**保存实验** downloads `drift-study.experiment.json`. It contains the material,
loop length, duration, initial rules, timed controls, current position and named
return points. **打开实验** restores it without autoplay. Unsupported or malformed
files leave the current experiment in place. **回到最初的实验**, inside the details,
starts the default work again and can itself be undone.

The browser also stores the session on edits, seeks, pause and page exit. This is
localStorage under `refrain-drift-study-v0`, scoped to this origin. A changed port,
another browser, or cleared site data will not carry it over; save the JSON for
portable custody. No work is uploaded. The repository link in the header opens
GitHub only when clicked.

**导出这一遍 WAV**, inside the details, renders the entire route from its beginning
using the recorded controls, even when the cursor is in the middle. It produces
stereo 16-bit PCM at 22,050 Hz in a worker. The monitor-volume slider affects live
listening only; the file uses the fixed experiment gain. Realtime playback and
WAV export share the sample kernel. Live transport edits add a short click-reducing
transition; these transport transitions are not recorded as musical controls.

## Source contract

New sessions use `drift-study-session@1` containing `drift-study-work@0`.
Historical `drift-study-session@0` files still open and save as @0 until a direct
pluck is added, which advances the edited session to @1. Version @0 rejects
plucks, including in bookmarks; its old controls keep their original meaning.
It does not import AIR or Refrain artifacts, use native performance bindings, or
issue receipts. Its canvas is an instrument surface for this experiment, not a
replacement for the production Canvas. The production `hum`, Player and renderer
remain on their own canonical paths.

The JSON is editable: `notes[].at` is a fraction of one loop, `notes[].duration`
is seconds, and `notes[].midi` is an integer MIDI pitch. Rules are in `[0, 1]`.
Supported files have 1–16 time-ordered notes (MIDI 36–96), loops of 1–12 seconds,
routes of 12–120 seconds, up to 2,048 ordered controls and 12 bookmarks, within
2 MiB. Tied note positions and same-time controls retain their array order.
A pluck is `{ "at": 12, "kind": "pluck", "note": 0, "layers": "both" }`: time in
seconds, a zero-based material-note index, and `both`, `a`, or `b`. It adds an attack
without changing the loop phases or evolution rules. It is kept in bookmarks,
undo, JSON and WAV like other performance edits. Unknown fields and versions are
rejected rather than silently discarded.

| File                                | Responsibility                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/contracts.ts`, `src/model.ts`  | Source/session types, strict file parser, immutable timed edits and piecewise evolution.                                                                                  |
| `src/kernel.ts`                     | Finite notes and bounded voice-envelope projection, shared stereo block rendering and PCM WAV. Reuses `packages/audio-engine/src/synth-kernel.ts`'s oscillator primitive. |
| `src/engine.ts`, `src/processor.ts` | Gesture-only browser lifecycle and AudioWorklet execution.                                                                                                                |
| `src/export-worker.ts`              | Offline rendering through the same kernel.                                                                                                                                |
| `src/app.ts`, `src/visual.ts`       | Controls, undo/bookmarks, local files/storage and a view of the actual model phases.                                                                                      |

No sample assets or third-party musical material are bundled. Existing repository
[licensing](../../LICENSING.md) applies. See [test topology](../../docs/TESTING.md#drift-study-lane)
and [current evidence](../../docs/current-state.md#drift-study-experiment).
