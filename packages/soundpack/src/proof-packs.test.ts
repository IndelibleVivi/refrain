import { describe, expect, it } from "vitest";
import {
  validateExtensionPack,
  validateRenderSceneV1,
  validateSoundProfileV2,
} from "./vnext.js";
import {
  ACOUSTIC_COLORS_PROFILE,
  ACOUSTIC_COLORS_PROOF_PACK,
  ACOUSTIC_COLORS_SCENE,
  PROOF_EXTENSION_PACKS,
  SYNTHETIC_SPICES_PROFILE,
  SYNTHETIC_SPICES_PROOF_PACK,
  SYNTHETIC_SPICES_SCENE,
} from "./proof-packs.js";
import { CORE_AUTHORING_VOCABULARY } from "./vnext.js";
import { SOUND_REGISTRY } from "./index.js";

describe("proof extension packs", () => {
  it("close exact acoustic and synthetic modules without duplicating authority", () => {
    expect(PROOF_EXTENSION_PACKS).toHaveLength(2);
    for (const pack of PROOF_EXTENSION_PACKS)
      expect(validateExtensionPack(pack)).toEqual([]);
    expect(
      validateSoundProfileV2(
        ACOUSTIC_COLORS_PROFILE,
        SOUND_REGISTRY,
        CORE_AUTHORING_VOCABULARY,
      ),
    ).toEqual([]);
    expect(
      validateSoundProfileV2(
        SYNTHETIC_SPICES_PROFILE,
        SOUND_REGISTRY,
        CORE_AUTHORING_VOCABULARY,
      ),
    ).toEqual([]);
    expect(validateRenderSceneV1(ACOUSTIC_COLORS_SCENE)).toEqual([]);
    expect(validateRenderSceneV1(SYNTHETIC_SPICES_SCENE)).toEqual([]);
    expect(ACOUSTIC_COLORS_PROOF_PACK.assets.length).toBeGreaterThan(0);
    expect(SYNTHETIC_SPICES_PROOF_PACK.assets).toEqual([]);
  });
});
