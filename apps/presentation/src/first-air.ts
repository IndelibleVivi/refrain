import { compileAirV1 } from "@refrain/compiler/v1";
import { createRefrainArtifactV3 } from "@refrain/renderer";
import { createRootReceiptV1 } from "@refrain/renderer/v1";
import { F_SYNTHETIC_BEAT_PERFORMANCE_BINDING } from "@refrain/soundpack";
import sourceText from "../../../fixtures/air-v1/synthetic-counterpulse.air.json?raw";
import { verifyArtifactForPresentation } from "./presentation-envelope.js";

// This is the checked-in score, compiled by the same path as a supplied air.
// The browser does not compose or contact a model.
export function firstAir() {
  const result = compileAirV1(sourceText);
  if (!result.source || !result.compiled)
    throw new Error("The first-listen score did not compile.");
  const portable = createRefrainArtifactV3({
    source: result.source,
    receipt: createRootReceiptV1(result.source),
    performanceBinding: F_SYNTHETIC_BEAT_PERFORMANCE_BINDING,
  });
  return verifyArtifactForPresentation(portable);
}
