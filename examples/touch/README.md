# Undertow · 潮汐以内

A small question, passed between plucked strings and glass, with room for an answer.

This complete original piece demonstrates **Touch**, four sample-free synthetic voices whose tone responds to the dynamics authored in an air. A soft note and a strong note differ in their partial balance or filter opening, as well as level. Touch is a source listening candidate; this example is not a claim of listener acceptance.

From the repository root:

```sh
node bin/refrain.mjs open examples/touch/undertow.refrain.json --theme nocturne-ink
```

Press **Play**. No audio starts automatically and no sound download is needed. The same shared Player handles listening, passage selection, artifact saving and reopening. Its small voice marks follow measured activity during playback; the four existing Canvas compositions remain the visual source.

## Listen through the form

The score is 32 bars of 6/8 at 100 quarter notes per minute, lasting 57.6 seconds before release and room tails. Six voices share the space: lattice pluck, glass bell, prism lead, air pad, clean bass and a sparse tuned pulse.

| Passage | Score time | Authored change                                                      |
| ------- | ---------- | -------------------------------------------------------------------- |
| near    | 0:00       | A lightly plucked motif, with space between its questions.           |
| current | 0:07.2     | Bass, harmony and pulse enter beneath the returning contour.         |
| held    | 0:21.6     | The plucked lead rests; glass takes the melody.                      |
| open    | 0:28.8     | Stronger dynamics open the timbre and a separate counterline enters. |
| return  | 0:43.2     | The familiar line returns against a thinner accompaniment.           |
| shore   | 0:50.4     | A deliberate coda and final release.                                 |

## Compare the sound

Open **Sound for this listening view** below the music stage. The artifact carries four exact choices:

| Binding                      | Sound                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `undertow-touch@1` (default) | Touch with restrained delay, room and harmonic width.      |
| `undertow-classic@1`         | Original static synths, with the same production settings. |
| `touch@0`                    | Dry Touch instruments.                                     |
| `f-synthetic-beat@0`         | Dry original instruments.                                  |

Changing the sound stops and resets playback. Press Play again, or jump to the same passage. This is a native-level comparison, not synchronized or loudness-matched A/B. All four choices share the exact source and receipt. Saving the artifact preserves all four and its original default; saving a playlist additionally preserves its selected listening binding.

## Keep the music

```sh
node bin/refrain.mjs export examples/touch/undertow.refrain.json --out tmp/undertow-export
node bin/refrain.mjs open tmp/undertow-export/undertow.refrain.json
```

The export includes native WAV, MIDI, AIR, the portable artifact and exact provenance sidecars. Use a fresh output directory for another export. Add `--binding undertow-classic@1` to render the comparison, or `--matched-preview` to request a separately labeled audition peak-match WAV; ordinary native export retains production levels. MIDI approximates the performance and does not carry these synth sounds or effects.

To author another work with Touch, write the music using ordinary AIR dynamics and seal it with `refrain hum <source.air.json> --binding touch@0 --out <work.refrain.json>`. There is no new note syntax or composition model. `lattice_pluck` and `glass_bell` change partial balance with note velocity; `prism_lead` and `air_pad` also change filter opening. `gainDb` adjusts level without turning a light touch into a strong one. Attack, decay, sustain and release timing remain fixed by the exact instrument candidate.

The checked-in AIR and artifact are authored example music under CC BY-NC-SA 4.0; the functional sound implementation follows the repository's SUL-1.0 scope. See [LICENSING.md](../../LICENSING.md).
