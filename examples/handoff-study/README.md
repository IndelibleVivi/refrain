# A borrowed beat · 借来的半拍

Four complete 16-bar AIR@1 routes accompany the independent
[phrase-handoff study](../../apps/handoff-study/README.md). Every `.refrain.json`
is an exact Artifact@3 with Receipt@1 and the carried acoustic chamber binding.
There are no embedded sample bytes. The paired `.air.json` is its canonical music.

The first letter chooses the lead entering bar 5, the second the lead entering
bar 11: `p` is piano, `m` is marimba. `mp` is the complete default performance.
All routes share bars 1–4. Later lead rhythm, guitar spacing and the closing
response are authored consequences of the choices. The second handoff retains
musical consequences from the first.

```bash
node bin/refrain.mjs open examples/handoff-study/mp.refrain.json
node bin/refrain.mjs export examples/handoff-study/mp.refrain.json --out=tmp/handoff-native-export
```

Ordinary Player playback and native export use the complete canonical route.
The experimental session WAV assembles independently rendered phrases with
release overlap; native RR/DSP history can differ. Neither is a listening
acceptance claim. These files are deterministic projections of `createScore`
and `routeSources` in `apps/handoff-study/src/score.ts`; the source test checks
that they have not drifted. Authored music follows the existing
[content license](../../LICENSE-CONTENT); sample provenance and notices remain
with their [upstream owners](../../docs/SOUND-SOURCES.md).
