import type { AnyAirArtifact } from "@refrain/renderer";
import velvetText from "../../../examples/demo/velvet-mischief.refrain.json?raw";
import doorText from "../../../examples/demo/after-the-door.refrain.json?raw";
import { verifyArtifactForPresentation } from "./presentation-envelope.js";

export const demoWorks = [
  {
    id: "velvet-mischief",
    title: "Velvet Mischief · 夜色偏心",
    text: velvetText,
  },
  { id: "after-the-door", title: "After the Door · 门后", text: doorText },
];

const verifiedWorks = new Map(
  demoWorks.map((work) => [
    work.id,
    verifyArtifactForPresentation(JSON.parse(work.text)),
  ]),
);

export function firstAir(id = demoWorks[0]!.id) {
  return verifiedWorks.get(id)!;
}

export function hasDemoSound(artifact: AnyAirArtifact) {
  return [...verifiedWorks.values()].some(
    (result) =>
      result.ok &&
      artifact.receipt.receiptId === result.artifact.receipt.receiptId &&
      artifact.performanceBinding?.contentSha256 ===
        result.artifact.performanceBinding?.contentSha256,
  );
}
