# Rights and licensing status

**Project-original functional materials use [SUL-1.0](LICENSE); project-authored content uses [CC BY-NC-SA 4.0](LICENSE-CONTENT).** Selected on 2026-09-08. Refrain is source-available, not OSI open source.

SUL-1.0 allows personal, noncommercial, and internal business use; distribution or provision to others must be free of charge and noncommercial. Preserve its notices and mark modifications as its terms require. CC BY-NC-SA permits noncommercial sharing and adaptation with attribution, and requires the same license when adapted material is shared. The full texts govern: [Sustainable Use License](https://spdx.org/licenses/SUL-1.0.html), [CC legal code](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en).

These grants cover only project-original rights that the relevant licensor can grant. They do not relicense upstream material, claim exclusive rights in AI-generated output, or transfer contributor ownership.

| Material                                                                                                                                                                                            | Current authority                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Project-original software and functional materials: `apps/`, `packages/`, `bin/`, `scripts/`, `deploy/`, `.github/`, root config/package files, `AGENTS.md`, and Plugin manifest/Skill instructions | [SUL-1.0](LICENSE), except the content and third-party material below.                                                                        |
| Project-authored content: root READMEs and `SPEC.md`, `docs/` prose/diagrams/screenshots, Plugin README/submission prose, and musical compositions in `fixtures/**/*.air.json`                      | [CC BY-NC-SA 4.0](LICENSE-CONTENT). Functional code examples, test machinery, manifests, and tool-oriented Skill instructions remain SUL-1.0. |
| Third-party sound assets and their mapping/provenance records                                                                                                                                       | Original source terms and per-candidate provenance; see [Sound sources](docs/SOUND-SOURCES.md). No new project license overrides those terms. |
| npm dependencies                                                                                                                                                                                    | Their respective package licenses. They are installed from the lockfile, not relicensed by Refrain.                                           |
| User-authored airs, private context, and exports outside this repository                                                                                                                            | Not included in a repository-wide grant. Refrain does not claim ownership of your music. Third-party sounds still carry their own terms.      |

## Sound notices

Sample binaries are acquired selectively and are not tracked in the source repository. The retained upstream notices are:

- [VCSL — CC0](third_party/VCSL/LICENSE.txt)
- [VSCO 2 Community Edition — CC0](third_party/VSCO-2-CE/LICENSE.txt)
- [FreePats Spanish Classical Guitar — CC0](third_party/FreePats-Spanish-Classical-Guitar/LICENSE.txt)
- [Karoryfer/Bigcat cello — CC0](third_party/Karoryfer-Bigcat-Cello/LICENSE.txt)
- [GeneralUser GS — its own license](third_party/GeneralUser-GS/LICENSE.txt)

GeneralUser GS is an optional development/audition fallback with upstream sample-provenance limitations. It is not selected by the four F proof palettes or the synthetic first-use example. Do not present its package notice as proof of every sample's provenance.

The eight synthetic instrument implementations are project-original patches. The renderer's visual research is credited to the Refrain Faye/Selen design line. Credits identify creative provenance; they are not a claim to third-party rights.

No earlier project-original public license is recorded in the inspected source history. This selection does not retract or change any earlier third-party grant. Contributions are offered under the applicable terms for their material; contributors retain ownership and must have authority to contribute. This grants no assignment or separate commercial exception. For the difference between visibility and licensing, see [GitHub's licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).
