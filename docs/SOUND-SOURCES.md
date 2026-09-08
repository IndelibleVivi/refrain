# Sound sources and provenance

## Four authorities, four jobs

- `packages/soundpack/src/instrument-vocabulary.json` is the stable model-facing identity authority: instrument ID, label, family, authored range, explicit percussion notes, status, and authoring meaning. It contains no engine, asset, candidate, default, or gain choice.
- `packages/soundpack/src/sound-catalog.json` is lightweight routing: candidate ID, instrument, engine, release status, candidate content digest, and immutable shard locator/digest. It does not duplicate asset or mapping payloads.
- `packages/soundpack/src/candidates/sha256/*.json` are the implementation and provenance authority. Each immutable candidate shard closes over one candidate's exact assets, engine/mapping, calibration, loop/release data, processing history, rights, release status, candidate digest, and shard digest.
- `packages/soundpack/src/sound-profiles.json` is the selection authority. Each complete `SoundProfile@1` pins the vocabulary and every selected candidate directly by `{ id, sha256 }`; it has no monolithic soundpack reference. A selection is strict or uses an explicit whole-identity audition chain.

Catalog generation validates canonical vocabulary, profile, candidate, and shard digests; rejects duplicate candidate identities; and regenerates the static shard imports deterministically. Runtime validation rejects missing exact pins/assets, ambiguous attack or release regions, incomplete round robin, invalid loop frames, articulation cycles, incomplete sampled-release coverage, incomplete release-candidate coverage, non-release assets inside release candidates, incomplete profiles, and cross-identity candidate references. Existing profile and performance identities close over selected candidates only, so adding an unrelated catalog entry changes neither.

Audible execution adds three closed, self-verifying authorities exported by `packages/soundpack`: `refrain-render-scene@0-experimental`, `refrain-sound-palette@0-experimental`, and `refrain-performance-binding@0-experimental`. The current transparent scene executes master gain, peak ceiling, and velocity scale; bindings embed the complete selected profile, exact scene and optional palette, all selected candidate content digests, permitted overrides, and renderer/plan compatibility. These contracts identify how sound sources are used; they do not change asset provenance or promote listening status.

## Acceptance vocabulary

- `audition-fallback`: usable for development comparison, never a release identity;
- `listening-candidate`: provenance-complete and mechanically renderable, but pending Faye;
- `listening-accepted`: Faye accepted the exact digest-bound listening output named in `listening-decisions.json`; this does not imply full-range or public-release acceptance;
- `release-candidate`: mechanically complete for the declared identity and dependent only on release-candidate assets; and
- `publicReleaseAccepted: false`: no sample asset in this line is approved for a Refrain public release.

## GeneralUser GS fallback

GeneralUser GS 2.0.3 remains the `g3a-audition@1` fallback profile. The complete bank's custom license permits use in software projects and modification, but the upstream license also records incomplete provenance for some contained samples. Refrain therefore pins commit `684543d5e5efaef08d02be50dcda8d552478fa60`, stores the upstream license verbatim under `third_party/GeneralUser-GS/`, verifies the 32,319,396-byte asset and SHA-256 digest, and never labels it the release sound identity.

The official information page is <https://schristiancollins.com/generaluser.php>. The pinned source repository is <https://github.com/mrbumpy409/GeneralUser-GS>.

## VCSL candidates

VCSL is pinned at commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`. Its exact CC0 dedication is stored at `third_party/VCSL/LICENSE.txt`. Every used WAV has its own upstream path, URL, byte count, SHA-256, sample rate, frame count, channel count, and byte-exact processing record.

| Identity          | Candidate                           | Coverage                                                                                                 | Candidate calibration                 | Listening truth                            |
| ----------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| `warm_piano`      | `warm-piano-vcsl-kawai-c4`          | one root, MIDI 48–72                                                                                     | -3 dB                                 | exact G3A audio accepted; partial identity |
| `harp`            | `harp-vcsl-concert-a4`              | one root, MIDI 57–81                                                                                     | -13.5 dB                              | exact G3A audio accepted; partial identity |
| `marimba`         | `marimba-vcsl-c4`                   | one root, MIDI 48–72                                                                                     | -2.5 dB                               | exact G3A audio accepted; partial identity |
| `soft_percussion` | `soft-percussion-vcsl-acoustic-kit` | six exact notes; kick/snare/closed/open hat each have deterministic 2-way RR; two distinct cymbal colors | -20 dB plus explicit per-region trims | pending Faye                               |

The percussion candidate uses ten independent WAV assets totalling 7,675,588 bytes. A plan closes over only the RR variants actually selected by its authored attacks. Candidate-scoped true rotation now makes the tracked listening fixture exercise all ten assets, still far below the 32,319,396-byte GM fallback and without loading unrelated candidates. Natural one-shot tails are derived from asset duration and do not inherit the old fixed 2.5-second GM tail.

## VSCO 2 Community Edition candidates

VSCO 2 Community Edition is pinned at SFZ commit `6dd651d55dde97fd4028699be9d4481f26917891`; its separate CC0 text is stored at `third_party/VSCO-2-CE/LICENSE.txt`. The current `chamber-strings-vsco-loop-probe` uses the byte-exact violin-section sustain-vibrato C4 WAV, maps MIDI 71–73 around root 72, and declares an engineering loop from frame 88,200 to 352,800 with a 4,410-frame crossfade plus a 0.8-second envelope release. The source asset is 2,063,320 bytes.

This is a bounded engine/listening probe, not a complete chamber-strings claim: it contains one violin-section root, not blended violin/viola/cello sections across the vocabulary range. It remains `pending-faye` and requires full mapping work even if its loop sounds acceptable.

The E factory also compiles two pinned upstream SFZ sources at build time through a closed allow-list; vendor SFZ is never interpreted at runtime. Unknown sound-affecting opcodes, random selection, path escape, unsupported sequence semantics, absent `ampeg_dynamic=1`, source-map drift, and asset-lock drift fail closed.

| Identity   | Candidate                         | Mechanical coverage                                            | Exact asset closure    | Acceptance truth                                   |
| ---------- | --------------------------------- | -------------------------------------------------------------- | ---------------------- | -------------------------------------------------- |
| `flute`    | `flute-vsco-susnv-sfz-pilot`      | sustain/non-vibrato, MIDI 60–96, three explicit velocity bands | 19 WAVs / 49,000,614 B | browser/runtime verified; listening candidate only |
| `clarinet` | `clarinet-vsco-suslong-sfz-pilot` | long sustain, MIDI 50–90, three explicit velocity layers       | 33 WAVs / 59,347,828 B | browser/runtime verified; listening candidate only |

The exact independent `e-vsco-wind-pilots@1` profile and `e-vsco-wind-pilots@0` binding exercise both maps. They prove reproducible source compilation, complete sustain pitch/velocity coverage, selective content acquisition, exact byte verification, sampler resolution, multipoint AIR dynamics, and real browser playback. They do not claim broader articulation coverage, beauty, pairing, palette coherence, or Faye acceptance.

## F full-range listening candidates

F keeps the E pilot shards immutable and adds separate full-range candidate identities. VSCO remains pinned at `6dd651d55dde97fd4028699be9d4481f26917891`; Bigcat cello is pinned at `6fd75fbfc1dbb3109bf26220ba1adea46188a18b`; and FreePats guitar is pinned by the exact 7,262,494-byte `SpanishClassicalGuitar-SFZ-20190618.7z` container digest `ef2fb7de0cc0ab561c4ebc28494f3fc2962596e4f32f16d6c96b8a385c7c098b`. Their CC0-1.0 texts are stored verbatim under `third_party/VSCO-2-CE/`, `third_party/Karoryfer-Bigcat-Cello/`, and `third_party/FreePats-Spanish-Classical-Guitar/`. Container members and direct Git WAVs still carry individual byte count, SHA-256, audio metadata, source path, processing record, and local projection path.

| Identity          | Candidate                                 | Declared range | Regions/assets | Exact bytes |
| ----------------- | ----------------------------------------- | -------------- | -------------- | ----------- |
| `warm_piano`      | `warm-piano-vsco-upright-full`            | MIDI 21–108    | 69 / 69        | 253,636,638 |
| `harp`            | `harp-vsco-full`                          | MIDI 24–103    | 23 / 23        | 35,312,492  |
| `marimba`         | `marimba-vsco-full`                       | MIDI 45–96     | 9 / 9          | 10,801,674  |
| `nylon_guitar`    | `nylon-guitar-freepats-spanish-classical` | MIDI 40–88     | 39 / 39        | 9,915,058   |
| `solo_cello`      | `solo-cello-bigcat-bowed-full`            | MIDI 36–76     | 104 / 104      | 64,336,726  |
| `chamber_strings` | `chamber-strings-vsco-sections-full`      | MIDI 36–96     | 31 / 31        | 78,731,052  |
| `flute`           | `flute-vsco-susnv-full`                   | MIDI 60–96     | 19 / 19        | 49,000,614  |
| `clarinet`        | `clarinet-vsco-suslong-full`              | MIDI 50–94     | 33 / 33        | 59,347,828  |

The SFZ compiler now also closes exact 7z container membership, `key` defaults, velocity gain curves, CC-conditioned groups used by the cello source, and supported two-way sequence groups. Every declared MIDI note × velocity 1–127 has an unambiguous attack region; unsupported sound-affecting behavior still fails closed. “Full” means complete pitch/velocity coverage for the declared identity, not a claim that every possible articulation exists. Current palettes use explicit whole-identity articulation fallbacks.

Eight project-original synth candidates complete the 17-identity F vocabulary: `clean-bass-subtractive-original`, `air-pad-subtractive-original`, `glass-bell-modal-original`, `sub-bass-subtractive-original`, `lattice-pluck-subtractive-original`, `prism-lead-subtractive-original`, `dust-texture-subtractive-original`, and `rhythm-pulse-modal-original`. They are closed patch authorities shared by realtime and offline execution, not hidden production effects.

Four exact strict profiles/palettes/bindings—`f-acoustic-chamber@0`, `f-luminous-hybrid@0`, `f-lofi-degraded@0`, and `f-synthetic-beat@0`—select all 17 identities without GeneralUser GS. Each packet binds one native AIR render, an explicitly peak-matched preview, identity/pairing coverage, exact asset closure and receipts, and a separately rendered 8:00/12-voice/21,840-event stress embodiment. Mechanical status is `native-and-stress-rendered`; all four `listeningAcceptance` values remain `pending-faye`, and `publicReleaseAcceptance` remains false.

## Reproducible local pipeline

```bash
npm run soundpack:catalog
npm run soundpack:fetch -- --candidate flute-vsco-susnv-sfz-pilot
npm run soundpack:fetch -- --profile g3b-vcsl-listening@1
npm run soundpack:fetch -- --air fixtures/valid/e-wind-pilot.air.json --binding e-vsco-wind-pilots@0
npm run soundpack:fetch -- --air fixtures/f-palettes/acoustic-chamber-native.air.json --binding f-acoustic-chamber@0
npm run listening:packets -- --out=tmp/g3b-listening-packets
npm run f:palette-packets -- --out=tmp/f-palette-packets --render-stress
```

The catalog command validates all immutable shards, direct profile pins, and deterministic static imports. Fetch has no fetch-all default: it requires one exact candidate/profile/palette/AIR target, derives only that closure, and accepts bytes into the repo-external content-addressed store selected by `scripts/sound-content-store-root.ts` only when byte count and SHA-256 match. It reports verified assets and bytes as acquisition proceeds, then atomically projects the exact content into ignored soundbench paths. Browser and headless render paths repeat the same byte-count/SHA-256 boundary before decode, and `refrain-render-receipt@2-experimental` records the exact binding/scene/palette/renderer authority and bytes actually verified. The packet command renders five tracked same-AIR comparisons: the three digest-bound G3A decisions plus percussion and chamber-strings candidates. Listening packets explicitly use `refrain-audition-peak-match@0-experimental`; ordinary WAV export is native-gain. Each `refrain-listening-packet@2-experimental` contains exact bindings, profiles, scenes, required-asset closures, render receipts, provenance, output digests, local cold/warm load/render/first-sound measurements, peaks, and separate mechanical/listening acceptance fields.

These values describe the tested local environment only; they are not general network promises. Whole-identity fallback prevents a performance from silently combining an incomplete preferred candidate with GM notes. Candidate-only AIRs load their exact sample closure without fetching the 32,319,396-byte GM bank; the bank loads only when the resolved plan actually selects it.

## Remaining identity coverage

The project-original synths are two closed versioned families rather than one permissive patch bag: `refrain-synth-subtractive@0-experimental` and `refrain-synth-modal@0-experimental`. Browser realtime and offline/block rendering share oscillator/sample projection; modal mode decay and subtractive filter/envelope semantics are explicit. F expands the original air-pad and glass-bell pilots with clean/sub bass, lattice pluck, prism lead, dust texture, and rhythm pulse because the four proof palettes require those authored roles. They contain no third-party samples and are mechanically/browser verified listening candidates, not accepted palettes or public-release claims. Source availability, successful rendering, and a liked bounded phrase are each weaker facts than complete release identity coverage.
