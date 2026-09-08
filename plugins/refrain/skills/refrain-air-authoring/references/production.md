# Produce an exact sound treatment

Use this for mix, space, effects, balance or a different treatment of an existing work. `produce` operates on an exact AIR@1 Artifact@3. It preserves the music, caption and musical receipt; a new binding carries the production. Keep relational judgment with the host: proximity, contrast and the space around a reply are expressive choices, not fixed romantic presets.

## File workflow

```bash
refrain produce inspect response.refrain.json --json
refrain produce init response.refrain.json --id close-room@1 --out close-room.production.json --json
# Edit the generated scene in close-room.production.json.
refrain produce inspect response.refrain.json --settings close-room.production.json --json
refrain produce apply response.refrain.json --settings close-room.production.json --out close-room.refrain.json --json
refrain open close-room.refrain.json --no-open --json
refrain export close-room.refrain.json --out close-room-export --json
```

`init` changes no sound. It writes `refrain-production-settings@0-experimental`: new binding `id`, exact `baseBinding`, `sourceRevision`, and editable `scene`. Preserve the generated source/base identities; they prevent settings from silently targeting another work or sound. Give each changed treatment a distinct binding ID. `inspect --settings` resolves a proposed treatment without writing. `apply` validates and compiles before writing a new file. Init/apply never overwrite existing files. A fully silent draft can be inspected and initialized, but apply requires at least one sounding note. Silent voices remain in AIR; the binding’s required instruments come from compiled sounding events, while the original full profile coverage is retained.

The scene has `id`, `master`, `buses`, and `routes`; the tool constructs its digest. For an existing Scene@1, init preserves its graph, IDs and processor order. For transparent Scene@0, it creates empty role buses feeding an empty `mix` bus. No effects are selected automatically.

**Master policy:** init materializes the canonical plan's effective master values into `scene.master`. The new binding has no overrides, so scene edits cannot be shadowed or applied twice. Inspection distinguishes authored voice gain/pan, resolved candidate/profile gain, ordered bus processors, raw scene master, old binding overrides and effective master.

Apply explicitly creates Binding@1/Scene@1/plan@4, including when starting from Binding@0. All old bindings, render receipts and projections remain; only the default switches to the new binding. This is a new rendering authority, not a claim of byte-identical cross-version audio. Old palette identity and listening acceptance stay on the old binding. Exact candidate chains and profile gains are preserved; an existing sparse profile retains its complete identity and extra coverage.

## Group placement and shared space

Scenes have 1–8 acyclic buses, at most 8 processors per bus, and 1–32 ordered routes. First match wins; unmatched voices go to `master`. A route matches `instrumentIds`, `roles`, or both (AND). AIR roles are `lead`, `harmony`, `counter`, `bass`, `pulse`, `percussion`, and `texture`. A catch-all `{}` belongs last. Inspection lists the voices actually selected by each route; an empty list may reveal a typo or a shadowed route.

Routes select instrument/role groups, not voice IDs or sections. `inseparableGroups` names voices sharing both identities. Do not rename AIR roles/instruments to bypass this while promising unchanged music. The scene applies throughout the piece; section-specific musical dynamics and gates remain AIR edits.

For example, replace the generated buses/routes with this deliberately chosen treatment while keeping generated master/source/base fields:

```json
{
  "buses": [
    { "id": "front", "output": "space", "processors": [] },
    {
      "id": "support",
      "output": "space",
      "processors": [
        {
          "id": "place",
          "type": "gain-pan",
          "gainDb": -2,
          "pan": 0.15,
          "width": 1.1
        },
        { "id": "soften", "type": "lowpass", "frequencyHz": 4500, "q": 0.7 }
      ]
    },
    {
      "id": "space",
      "output": "master",
      "processors": [
        { "id": "room", "type": "room", "decaySeconds": 0.65, "mix": 0.1 }
      ]
    }
  ],
  "routes": [
    {
      "id": "dry-foundation",
      "bus": "master",
      "match": { "roles": ["bass", "percussion"] }
    },
    { "id": "foreground", "bus": "front", "match": { "roles": ["lead"] } },
    {
      "id": "accompaniment",
      "bus": "support",
      "match": { "roles": ["harmony", "counter", "pulse", "texture"] }
    }
  ]
}
```

These are audition starting values, not a generally superior mix. Bass/percussion bypass this room; other groups converge before it. This is an inline wet/dry processor, **not an aux send**. More distance need not mean more reverb: arrangement, level, duration and register can be the right change.

For a close/dry comparison, use empty time-effect chains. Keep source and master fixed when isolating production. The original remains accessible with `refrain open close-room.refrain.json --binding <original-id> --no-open --json`; the new default opens without `--binding`. These are independent transports, not synchronized A/B.

## Executable processors

Order is audible. Processor IDs must be unique within each bus.

| Type         | Fields and accepted ranges                         | Use and limit                                                    |
| ------------ | -------------------------------------------------- | ---------------------------------------------------------------- |
| `gain-pan`   | `gainDb` −60…12; `pan` −1…1; `width` 0…2           | Group level and stereo placement; retain headroom                |
| `lowpass`    | `frequencyHz` 40…20000; `q` 0.1…12                 | Upper-frequency attenuation; not high-pass or parametric EQ      |
| `saturation` | `drive` 1…12; `mix` 0…1                            | Nonlinear coloration; may change apparent level                  |
| `delay`      | `delayMs` 1…2000; `feedback` 0…0.85; `mix` 0…1     | Explicit echo time and feedback                                  |
| `room`       | `decaySeconds` 0.05…8; `mix` 0…1                   | Existing basic room; use restrained values for a crowded passage |
| `fade`       | `inSeconds`, `outSeconds`, `tailSeconds` each 0…30 | Piece-level fade/tail, not arbitrary automation                  |

Master fields: `gainDb` −60…6, `peakCeiling` 0.05…1, `velocityScale` 0.05…2. Native WAV preserves amplitude with attenuation-only ceiling behavior. `--matched-preview` is a distinct listening transform; do not use it to disguise a gain change.

High-pass, parametric EQ, compressor, sidechain, aux sends and general effect automation are not implemented in Scene@1. Unsupported fields fail. New processors or a new room algorithm require an explicit versioned sound contract, not edits to historical scene meaning.

## Evidence and handoff

Inspection reports current plan resolution, including selected candidate and fallback, separately from pinned profile chains. Silent voices retain their authored routing but have `execution: "silent"` and `resolvedSound: null`; they do not imply an executed sound. It does not measure masking or listen. Browser playback does not feed audio to the agent. Claim audio understanding only when the actual host supplied the audio to an audio-capable model; even then, distinguish interpretation from the person's listening judgment.

Present the exact artifact and usable preview. Name the treatment and what is preserved. WAV/browser execute the scene; MIDI does not encode bus effects. Export JSON reports a `directory` and relative `files` map; resolve filenames against that directory. Technical correctness does not establish listening preference.
