import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AirSource } from "@refrain/air-schema";
import type {
  ContinuationRelation,
  MotifLinkEvidence,
} from "@refrain/renderer";
import { hum } from "./hum.js";

interface RelationshipFixture {
  format: "refrain-relationship-fixture@0-experimental";
  relation: ContinuationRelation;
  parent: AirSource;
  child: AirSource;
  motifLinks?: MotifLinkEvidence[];
  expectedStatus?: "verified";
  expectedCode?: string;
}

const fixtureRoot = new URL(
  "../../../fixtures/relationships/",
  import.meta.url,
);

async function load(directory: "valid" | "invalid") {
  const root = new URL(`${directory}/`, fixtureRoot);
  const files = await readdir(root);
  return Promise.all(
    files.map(async (file) => ({
      file,
      fixture: JSON.parse(
        await readFile(new URL(file, root), "utf8"),
      ) as RelationshipFixture,
    })),
  );
}

function runFixture(fixture: RelationshipFixture) {
  const parent = hum({ air: fixture.parent });
  if (!parent.ok) throw new Error("Relationship parent fixture did not hum.");
  return hum({
    air: fixture.child,
    from: {
      air: parent.source,
      receipt: parent.receipt,
      relation: fixture.relation,
      ...(fixture.motifLinks ? { motifLinks: fixture.motifLinks } : {}),
    },
  });
}

describe("relationship fixtures", () => {
  it("verifies every valid relationship fixture", async () => {
    for (const { file, fixture } of await load("valid")) {
      const result = runFixture(fixture);
      expect(result.ok, file).toBe(true);
      if (result.ok) {
        expect(result.receipt.verification.status, file).toBe(
          fixture.expectedStatus,
        );
      }
    }
  });

  it("fails every invalid evidence fixture closed", async () => {
    for (const { file, fixture } of await load("invalid")) {
      const result = runFixture(fixture);
      expect(result.ok, file).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.code, file).toBe(fixture.expectedCode);
      }
    }
  });
});
