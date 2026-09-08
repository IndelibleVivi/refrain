import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { VOICE_ROLES } from "@refrain/air-schema";
import {
  AIR_V1_FORMAT,
  createAirVocabularyClosure,
  type AirSourceV1,
} from "@refrain/air-schema/v1";
import { compileAir } from "@refrain/compiler";
import { parseRefrainArtifact } from "@refrain/renderer";
import { INSTRUMENTS } from "@refrain/soundpack";
import { CORE_AUTHORING_VOCABULARY } from "@refrain/soundpack/vnext";
import { describe, expect, it } from "vitest";
import {
  airObjectSchema,
  arrangedAirExample,
  humErrorOutputSchema,
  humSuccessOutputSchema,
  minimalAirV1Example,
} from "./contract.js";
import { airObjectSchemaV1 } from "./contract-v1.js";
import { createRefrainServer } from "./server-factory.js";

const fixture = JSON.parse(
  readFileSync(resolve("fixtures/valid/returning-home.air.json"), "utf8"),
);

function localRefs(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(localRefs);
  if (!schema || typeof schema !== "object") return [];
  return Object.entries(schema as Record<string, unknown>).flatMap(
    ([key, value]) =>
      key === "$ref" && typeof value === "string" && value.startsWith("#/")
        ? [value]
        : localRefs(value),
  );
}

function resolvesLocalRef(schema: unknown, ref: string): boolean {
  let current = schema;
  for (const token of ref
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (!current || typeof current !== "object" || !(token in current))
      return false;
    current = (current as Record<string, unknown>)[token];
  }
  return true;
}

describe("hum MCP authoring contract", () => {
  it("publishes a closed, discoverable AIR schema and a compact result", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createRefrainServer();
    const client = new Client({
      name: "refrain-contract-test",
      version: "0.0.0-experimental",
    });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const tools = await client.listTools();
      const tool = tools.tools.find((candidate) => candidate.name === "hum");
      expect(tool).toBeDefined();
      if (!tool) return;
      expect((tool._meta as Record<string, unknown>).securitySchemes).toEqual([
        { type: "noauth" },
      ]);

      const input = tool.inputSchema as Record<string, unknown>;
      const inputProperties = input.properties as Record<string, unknown>;
      expect(input.additionalProperties).toBe(false);
      expect(input.required).toEqual(["air"]);
      expect(Object.keys(inputProperties).sort()).toEqual([
        "air",
        "caption",
        "from",
        "performance",
      ]);

      const contractText = JSON.stringify({
        description: tool.description,
        input: tool.inputSchema,
        output: tool.outputSchema,
      });
      const inputBytes = Buffer.byteLength(JSON.stringify(tool.inputSchema));
      const outputBytes = Buffer.byteLength(JSON.stringify(tool.outputSchema));
      expect(inputBytes).toBeLessThan(85_000);
      expect(outputBytes).toBeLessThan(35_000);
      expect(Buffer.byteLength(contractText)).toBeLessThan(120_000);
      for (const schema of [tool.inputSchema, tool.outputSchema]) {
        const refs = localRefs(schema);
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs)
          expect(resolvesLocalRef(schema, ref)).toBe(true);
      }
      for (const role of VOICE_ROLES) expect(contractText).toContain(role);
      for (const instrument of INSTRUMENTS) {
        expect(contractText).toContain(instrument.id);
        expect(contractText).toContain(
          `${instrument.midiMin}-${instrument.midiMax}`,
        );
      }
      expect(contractText).toContain("NOTE/DURATION");
      expect(contractText).toContain("@pp|@p|@mp|@mf|@f|@ff");
      expect(contractText).toContain("Every bar must fill the meter");
      expect(contractText).toContain("Minimal current AIR@1");
      expect(contractText).toContain("@name(-3,0.5)");
      expect(contractText).toContain(
        "Named text such as @name(transpose,1) is invalid",
      );
      expect(contractText).toContain("motifLinks");
      expect(contractText).toContain("parentAnchor");
      expect(contractText).toContain("childAnchor");
      expect(contractText).toContain("anchors");
      expect(contractText).toContain("exact compiled prefix");
      expect(contractText).toContain("drum_grid");
      expect(contractText).toContain("musical-relation@0-experimental");
      expect(contractText).toContain("parentArtifact");
      expect(tool.description).toContain(
        "pass the exact Artifact@3 from the prior result unchanged",
      );
      expect(tool.description).toContain(
        "This MCP host defaults omitted AIR@1 performance.bindingId to f-synthetic-beat@0",
      );
      expect(tool.description).toContain(
        "air_pad, clean_bass, dust_texture, glass_bell, lattice_pluck, prism_lead, rhythm_pulse, sub_bass",
      );
      expect(tool.description).toContain(
        "its performanceStatus is unavailable in this Canvas",
      );
      expect(tool.description).not.toContain(
        "always returns the complete selected PerformanceBinding",
      );
      expect(tool.description).not.toContain("Arranged AIR");
      expect(airObjectSchema.safeParse(arrangedAirExample).success).toBe(true);
      expect(airObjectSchemaV1.safeParse(minimalAirV1Example).success).toBe(
        true,
      );
      const unsupportedDegree = {
        ...arrangedAirExample,
        voices: [
          {
            id: "arp",
            instrument: "harp",
            role: "lead",
            realize: [
              {
                id: "unsupported",
                kind: "arpeggio",
                harmony: "hello_changes",
                degrees: [1, 2, 5],
                stepBeats: 1,
                octaveSpan: 1,
                register: { min: "C3", max: "C6" },
              },
            ],
          },
        ],
      };
      expect(airObjectSchema.safeParse(unsupportedDegree).success).toBe(false);
      expect(compileAir(arrangedAirExample).compiled).toBeDefined();
      expect(contractText).toContain("isError");
      expect(contractText).not.toContain('"context"');

      const response = await client.callTool({
        name: "hum",
        arguments: { air: fixture, caption: "A contract check." },
      });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toMatchObject({
        ok: true,
        source: { format: "air@0-experimental" },
        summary: { format: "compiled-air-summary@0-experimental" },
        receipt: { format: "refrain-receipt@0-experimental" },
        performanceBinding: {
          format: "refrain-performance-binding@0-experimental",
        },
      });
      expect(response.structuredContent).toHaveProperty("summary.authoring");
      expect(response.structuredContent).not.toHaveProperty("compiled");
      expect(response.structuredContent).not.toHaveProperty(
        "performanceBinding.soundProfile",
      );
      expect(response.content).toEqual([
        expect.objectContaining({ type: "text" }),
      ]);
      const responseMeta = response._meta as Record<string, unknown>;
      const privateArtifact = responseMeta["refrain/artifact"] as {
        mimeType: string;
        uri: string;
        text: string;
      };
      expect(privateArtifact.mimeType).toBe("application/vnd.refrain+json");
      expect(privateArtifact.uri).toMatch(
        /^refrain:\/\/artifact\/sha256:[0-9a-f]{64}$/,
      );
      const parsed = parseRefrainArtifact(JSON.parse(privateArtifact.text));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.artifact.source).toEqual(fixture);
        expect(parsed.artifact).not.toHaveProperty("compiled");
      }
      expect(responseMeta).toHaveProperty(
        "refrain/canvas.performanceBinding.soundProfile",
      );
      expect(
        Buffer.byteLength(
          JSON.stringify({
            structuredContent: response.structuredContent,
            content: response.content,
          }),
          "utf8",
        ),
      ).toBeLessThan(24_000);

      const currentAir: AirSourceV1 = {
        format: AIR_V1_FORMAT,
        title: "Five then seven through MCP",
        conductor: {
          tempo: 90,
          meters: [
            { bar: 1, meter: "5/8" },
            { bar: 2, meter: "7/8" },
          ],
        },
        vocabulary: createAirVocabularyClosure({
          id: "mcp-core-language@0",
          instruments: CORE_AUTHORING_VOCABULARY.instruments.map(
            (instrument) => ({
              id: instrument.id,
              label: instrument.label,
              family: instrument.family,
              midiMin: instrument.midiMin,
              midiMax: instrument.midiMax,
              status: instrument.status,
              authoringMeaning: instrument.authoringMeaning,
              ...(instrument.supportedNotes === undefined
                ? {}
                : { supportedNotes: Array.from(instrument.supportedNotes) }),
            }),
          ),
          techniques: [],
        }),
        motifs: {},
        voices: [
          {
            id: "piano",
            instrument: "warm_piano",
            role: "lead",
            part: "C4/4 D4/4 E4/8 | F4/4 G4/4 A4/4 B4/8",
          },
        ],
      };
      const currentResponse = await client.callTool({
        name: "hum",
        arguments: { air: currentAir },
      });
      expect(currentResponse.isError).not.toBe(true);
      expect(currentResponse.structuredContent).toMatchObject({
        ok: true,
        artifact: {
          format: "refrain-artifact@3-experimental",
          source: { format: AIR_V1_FORMAT },
          receipt: { format: "refrain-receipt@1-experimental" },
          defaultBindingId: "f-synthetic-beat@0",
          performanceBindings: [
            expect.objectContaining({
              format: "refrain-performance-binding@0-experimental",
              id: "f-synthetic-beat@0",
            }),
          ],
        },
        summary: {
          format: "compiled-air-summary@1-experimental",
          meters: [
            { bar: 1, meter: "5/8" },
            { bar: 2, meter: "7/8" },
          ],
        },
        performanceStatus: {
          status: "unavailable",
          reason: "sample-origin-missing",
        },
      });
      expect(JSON.stringify(currentResponse.content)).toContain(
        "unavailable in this MCP Canvas",
      );
      expect(JSON.stringify(currentResponse.content)).not.toContain(
        "Exact audible embodiment: f-synthetic-beat@0",
      );
      const currentMeta = currentResponse._meta as Record<string, unknown>;
      const currentArtifact = currentMeta["refrain/artifact"] as {
        mimeType: string;
        sha256: string;
        text?: string;
      };
      expect(currentArtifact).toMatchObject({
        mimeType: "application/vnd.refrain+json",
        sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      });
      expect(currentArtifact).not.toHaveProperty("text");
      expect(currentMeta).not.toHaveProperty("refrain/canvas");
      expect(
        parseRefrainArtifact(
          (currentResponse.structuredContent as { artifact: unknown }).artifact,
        ),
      ).toMatchObject({
        ok: true,
        artifact: { format: "refrain-artifact@3-experimental" },
      });

      const minimalCurrentResponse = await client.callTool({
        name: "hum",
        arguments: { air: minimalAirV1Example },
      });
      expect(minimalCurrentResponse.isError).not.toBe(true);
      expect(minimalCurrentResponse.structuredContent).toMatchObject({
        ok: true,
        artifact: {
          source: {
            voices: [expect.objectContaining({ instrument: "lattice_pluck" })],
          },
          defaultBindingId: "f-synthetic-beat@0",
        },
        performanceStatus: { status: "available" },
      });

      const completePieceResponse = await client.callTool({
        name: "hum",
        arguments: {
          air: fixture,
          performance: { bindingId: "e-vsco-wind-pilots@0" },
        },
      });

      const upperAir: AirSourceV1 = {
        ...currentAir,
        title: "Upper model-visible envelope",
        vocabulary: createAirVocabularyClosure({
          id: "mcp-upper-envelope@0",
          instruments: [
            ...currentAir.vocabulary.instruments,
            ...Array.from({ length: 80 }, (_, index) => ({
              id: `pack_voice_${index}`,
              label: `Portable pack voice ${index}`,
              family: "pitched" as const,
              midiMin: 0,
              midiMax: 127,
              status: "active" as const,
              authoringMeaning: "x".repeat(500),
            })),
          ],
          techniques: [],
        }),
      };
      const upperResponse = await client.callTool({
        name: "hum",
        arguments: { air: upperAir },
      });
      expect(upperResponse.isError).not.toBe(true);
      expect(
        Buffer.byteLength(
          JSON.stringify({
            structuredContent: upperResponse.structuredContent,
            content: upperResponse.content,
          }),
          "utf8",
        ),
      ).toBeLessThan(80_000);
      expect(completePieceResponse.isError).not.toBe(true);
      expect(completePieceResponse.structuredContent).toMatchObject({
        ok: true,
        performanceBinding: {
          renderer: {
            contract: "refrain-renderer@1-experimental",
            performancePlanFormat: "performance-plan@3-experimental",
          },
        },
      });

      const rejectedContext = await client.callTool({
        name: "hum",
        arguments: {
          air: fixture,
          context: { private: "must stay host-side" },
        },
      });
      expect(rejectedContext.isError).toBe(true);
      expect(JSON.stringify(rejectedContext.content)).toMatch(
        /Unrecognized key.*context/i,
      );

      expect(
        humSuccessOutputSchema.safeParse({
          ...(response.structuredContent as Record<string, unknown>),
          compiled: { events: [] },
        }).success,
      ).toBe(false);
      expect(
        humErrorOutputSchema.safeParse({
          ok: false,
          diagnostics: [],
          source: fixture,
        }).success,
      ).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
