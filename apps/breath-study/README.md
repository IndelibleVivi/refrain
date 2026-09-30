# Breath study

A small instrument for hesitation: three returns of an authored melody, a gap
that can open inside each phrase, and a synthetic pluck that moves toward glass.
This independent experiment preserves the original score while making a chosen
transformation audible. It does not replace Drift study or the production Canvas.

```bash
npm ci
npm run breath
# http://127.0.0.1:4390
npm run test:breath
```

`npm run build:breath` creates `apps/breath-study/dist` with relative URLs.
Serve that directory over localhost or HTTPS; direct `file://` opening is not
supported. It has no sample downloads, external fonts, account, upload, or model
calls. The GitHub header link opens an external page only when clicked.

## Play and change a phrase

- **聆听 / 暂停** plays or holds the current position. **回到开头** stops there.
  The time slider and phrase buttons seek without starting paused audio.
- Click a note to audition it. Hover and focus stay silent. Arrow keys move note
  focus; Enter/Space plays the focused note. Number keys 1–9 audition notes in the
  current phrase outside form fields. These previews are not recorded in the score.
- **留白** inserts 0–2 seconds before each authored breath position. Later attacks
  move; pitches and the decays already sounding do not change. The central handle
  supports horizontal drag and arrow/Home/End keys; the labeled slider supplies
  an alternative to dragging.
- **折光** changes harmonic/inharmonic partials and damping from warm string-like
  synthesis to glass. It is not a recording of an acoustic guitar.
- **余温** changes the amount of a short, deterministic stereo echo field.
- Editing pauses the current sound. Releasing a control resumes from the current
  phrase only if it was already playing. A drag is one undo entry; Escape or a
  cancelled pointer gesture restores its starting settings.
- **原句 / 我的变形** compares the same score at neutral settings and your settings.
  Switching stops playback; click Listen again. It never overwrites the variation.
- Undo/redo keeps up to 50 edits in this tab. Command/Ctrl+Z and Shift+Command/Ctrl+Z
  work outside form fields. Reset is undoable. Leaving the page pauses sound.

The default work is **A little room between**, 84 BPM, three 16-beat phrases in
E major / C♯ minor. Melody, supporting voicings, bass, dynamics and the ending are
explicitly authored in `src/seed.ts`. The runtime never adds accompaniment or
makes compositional decisions. The five-second finite render tail is included
in the displayed duration.

## Save, reopen, and export

**保存实验** downloads the complete `breath-study-work@0` score and settings.
Opening a valid file or restoring localStorage never auto-plays. Invalid files
leave the current work intact. Local persistence uses `refrain-breath-study-v0`
on this exact origin. Port/browser changes do not transfer it; use the file.
Undo history, audition taps, playback cursor and the temporary comparison mode
are not part of that work file.

**带走 WAV** freezes the currently selected original or variation at export time
and renders its complete route, even if playback is paused in the middle. The
worker emits stereo PCM16 at 32 kHz using the same kernel as browser playback.
The live monitor volume does not change this file. Export does not start sound.

The closed JSON reader accepts up to 256 notes, MIDI 36–96, positive durations
within 1–96 beats, tempo 40–160, explicit breath positions, and settings in their
shown ranges. The finite render is at most 150 seconds and input at most 1 MiB.
Unknown fields and versions are rejected. An edit that would exceed the duration
limit preserves the last valid settings. JSON object fields are ordinary source
fields, not hashes or Refrain receipt identities. This app does not import AIR or
issue native bindings/receipts. The companion download below is a separate file.

## The sampled companions

[The AIR source](../../fixtures/air-v1/breath-study.air.json) and
[the exact Artifact@3](../../examples/breath-study/a-little-room-between.refrain.json)
carry the same 36 melody pitches and beat onsets. Native notation gates and
sampled performance dynamics are deliberately authored for that embodiment;
this is not a claim that synthetic and sampled audio are identical. The app's
**关于这片声音** offers the artifact download without loading its samples.

```bash
node bin/refrain.mjs fetch --candidate nylon-guitar-freepats-spanish-classical
node bin/refrain.mjs open examples/breath-study/a-little-room-between.refrain.json --no-open --json
node bin/refrain.mjs export examples/breath-study/a-little-room-between.refrain.json --out tmp/breath-nylon
```

The file retains its original `f-acoustic-chamber@0` binding and selects the new
`breath-close-room@1` binding: the existing FreePats nylon candidate, a 6.2 kHz
low-pass, a restrained 0.85-second room, and an explicit gain/fade treatment.
The native gain is authored, not export normalization. Native playback uses the
ordinary shared Player and its verified sample closure. The zero-asset MCP Canvas
cannot play this sampled binding. The experiment's sliders never rewrite this
companion artifact. This is a listening candidate, not a listening acceptance.

The new [archtop AIR](../../fixtures/air-v1/breath-study-archtop.air.json) and
[exact archtop Artifact@3](../../examples/breath-study/a-little-room-between-archtop.refrain.json)
keep those same 36 melody pitches and beat onsets, replace every voice with the
pack-carried `archtop_guitar` identity, and select
`refrain-shinyguitar-archtop@1`. The Artifact carries exact native and
audition-matched RenderReceipt@3/projection references. The app offers both
Artifacts without loading either sample closure.

Build the optional candidate from an exact local copy of the pinned upstream
source, then render its native and comparison WAVs:

```bash
npm run soundpack:build-shinyguitar -- --source-root /path/to/karoryfer.shinyguitar
npm run breath:build-archtop -- --source-root /path/to/karoryfer.shinyguitar --out tmp/breath-shinyguitar
node bin/refrain.mjs export examples/breath-study/a-little-room-between.refrain.json --matched-preview --out tmp/breath-nylon-matched
```

Compare `tmp/breath-nylon-matched/a-little-room-between.audition-matched.wav`
with `tmp/breath-shinyguitar/a-little-room-between-archtop.audition-matched.wav`.
Both use the same score and the explicit peak-match contract; room, filtering,
gain and decay remain part of each exact binding, so this compares complete
embodiments rather than pretending to isolate raw sample tone.

## The optional archtop DLC candidate

The current FreePats candidate contains 39 assets and 39 regions with a single
velocity range per region, without round-robin alternatives. Its source is a
[CC0 Spanish classical guitar](https://freepats.zenvoid.org/Guitar/acoustic-guitar.html).
The source explicitly describes imperfect recording conditions and noise filtering.
That establishes provenance and an identifiable limitation, not a quality verdict.

A focused alternative is the acoustic/microphone side of
[Karoryfer Shinyguitar](https://shop.karoryfer.com/pages/free-shinyguitar).
Its upstream [SFZ](https://github.com/sfzinstruments/karoryfer.shinyguitar/blob/master/Programs/acoustic.sfz)
provides four velocity layers and four alternative attacks per zone; the publisher
lists the free libraries under [CC0](https://shop.karoryfer.com/pages/free-samples).
It is a distinct archtop identity, not a nylon-guitar replacement. Refrain pins
commit `57243cca85277dbcc120ce17c6178032f93c80f3`, the exact program and license,
and a checked-in byte/SHA lock for all 272 acoustic attack WAVs. Its closed SFZ
compiler lowers the 68 four-way random groups to deterministic candidate-scoped
round robin. Pickup/electric programs and release-noise samples stay outside the
candidate.

Pack metadata, mappings and the CC0 notice are tracked; the 222,776,152 sample
bytes are not. The builder refuses a local WAV that differs from the checked-in
upstream lock. The Breath piece resolves only 54 assets / 43,413,576 bytes and
has been rendered locally at 44.1 kHz for 34.536 seconds. This proves exact
execution and creates the listening files; `listeningAcceptance` remains
`pending-faye`, and public release remains false.

This candidate is not installed into local pack discovery. The archtop Artifact
therefore preserves an exact but currently unavailable binding in the ordinary
Player; use the rendered WAVs for this listening decision. Installing the pack
and its sample projection is a separate integration boundary.

## Code and evidence boundaries

`model.ts` owns strict source and the explicit time transform; `kernel.ts` owns
one sample implementation; `render-worker.ts` runs that kernel for PCM/WAV;
`engine.ts` owns gesture-only AudioContext, cancellation and transport;
`app.ts` owns UI/history/files; `seed.ts` owns this authored composition.
The kernel reuses Refrain's oscillator primitive. Production AIR grammar,
native renderer and MCP contracts are unchanged. The canonical soundpack path
is extended with an explicit carried vocabulary and closed SFZ lowering for the
new candidate; the core vocabulary, catalog and existing candidate identities
remain unchanged.

Run `test:breath` for typecheck, model/kernel/companion checks and production build.
The companion check keeps both sampled AIRs on the same melody/onset sequence and
parses the archtop Artifact's exact receipt/projection graph.
Real-browser checks cover actual nonzero PCM, controls, cancelled startup, JSON
and WAV downloads, reopen, keyboard, reduced motion, and desktop/mobile layout.
See [current evidence](../../docs/current-state.md#breath-study-experiment).
Chromium evidence is separate from physical-device/Safari behavior and human
judgment of the sound or visual direction. Existing repository
[licensing](../../LICENSING.md) applies; upstream sample terms remain separate.
