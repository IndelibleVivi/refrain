# G2 execution coverage

This is the requirement-level execution ledger for **G2 — Air Language: Harmony, Form, Expression, Return**. `SPEC.md` owns the normative product contract; this file keeps implementation and evidence from collapsing into an early partial slice.

| ID        | Requirement                                                                                                                                                          | Implementation surface                                 | Required evidence                                                                              | Status                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| G2-PERF   | One performance/render plan owns gain, pan, channel, percussion, articulation/gate, synth patch, MIDI fallback, master gain, velocity, and attenuation-only ceiling. | `packages/audio-engine`                                | profile override parity plus quiet, hybrid, early-stop, dense, audition, and attenuation tests | Implemented; resolved profile parity and full gates pass                                            |
| G2-HARM   | Strict harmony plans and one supported chord-degree vocabulary across every contract surface.                                                                        | `packages/air-schema`, `packages/compiler`, MCP schema | exact supported-degree positives and unsupported-degree negatives                              | Implemented; every contract surface accepts only 1, 3, 5, 7, 9                                      |
| G2-REAL   | Exactly one of literal `part` or ordered `realize`; seven segment kinds, stable IDs, repeat, section, deterministic voice-leading and transforms.                    | `packages/air-schema`, `packages/compiler`             | literal compatibility plus per-bar structured-literal regressions                              | Implemented; each structured literal bar validates independently                                    |
| G2-EXPR   | Named/curved dynamics, articulation, gate, tie, compiled source anchors, and shared note lifecycle semantics.                                                        | `packages/compiler`, `packages/audio-engine`           | musical-time curves; tie/legato sampled and MIDI overlap regressions                           | Implemented; onset curves and overlap-safe lifecycle pass                                           |
| G2-RETURN | Evidence-backed quote/variation/extension verification from normalized compiler motif material; revise optional; reply declared-only.                                | `packages/compiler`, `packages/mcp-server`             | chord-first inversion, rest retrograde, invalid material, and fresh-process tests              | Implemented; verifier consumes normalized compiler material                                         |
| G2-AUTH   | Model-facing strict schema, compact summary, renderer view model, receipt, and portable artifact reflect G2 without expanded-event leakage.                          | `packages/mcp-server`, `packages/renderer`             | tools-list, response-contract, resource and artifact smoke tests                               | Implemented; contract and stdio/HTTP smokes pass                                                    |
| G2-FIX    | Canonical fixture set covers solo literal, acoustic ensemble, 45–75 second sectional form, expression, verified variation, verified extension, and invalid evidence. | `fixtures`                                             | fixture suite and audio smoke                                                                  | Implemented; fixture suite and two render smokes pass                                               |
| G2-BENCH  | Functional engineering UI inspects harmony/realization/evidence, mutes/solos voices, compares Worklet/PCM, and reports peak/first-sound timing.                      | `apps/soundbench`, shared renderer where applicable    | build plus real browser interaction/playback evidence                                          | Implemented; desktop/mobile and Worklet/PCM browser checks pass                                     |
| G2-CLOSE  | User/operator/agent docs agree with tested state; no deferred production aesthetic or host-matrix claim is promoted.                                                 | `README.md`, `docs/current-state.md`, relevant guides  | documentation pass, full checks, staged diff audit                                             | Source-complete; original G2 close passed 69 tests; current suite is recorded in `current-state.md` |

## Sequencing

1. Build and regression-test the shared performance boundary from the semantics already duplicated across adapters.
2. Add the strict source grammar and parser diagnostics.
3. Compile deterministic harmony, form, and expression into anchored events.
4. Verify musical return from recompiled evidence and bind it into receipt identity.
5. Reconcile model-facing contracts, fixtures, functional UI, exports, and end-to-end evidence.

## Deliberately deferred

- production Canvas visual direction;
- final release soundpack selection and asset approval;
- autonomous playback or device-authorized speaker integrations;
- the four-author/four-host acceptance matrix while the relevant model runtime is unavailable; and
- public release/licensing decisions.

Deferral of those boundaries does not narrow the G2 implementation contract above.
