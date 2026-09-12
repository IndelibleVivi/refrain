import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { readAudition } from "@refrain/correspondence";
import { createRefrainArtifactV3 } from "@refrain/renderer/portable";
import { createRefrainServer } from "./server-factory.js";
import { minimalAirV1Example } from "./contract.js";
import { humV1 } from "./hum-v1.js";

function artifact(source: unknown = minimalAirV1Example) {
  const result = humV1({ air: source });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return createRefrainArtifactV3({
    source: result.source,
    receipt: result.receipt,
    performanceBinding: result.performanceBinding,
  });
}
async function host<T>(body: (client: Client) => Promise<T>) {
  const [c, s] = InMemoryTransport.createLinkedPair();
  const server = createRefrainServer();
  const client = new Client({ name: "audition-proof", version: "1" });
  await server.connect(s);
  await client.connect(c);
  try {
    return await body(client);
  } finally {
    await client.close();
    await server.close();
  }
}
function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([k, v]) =>
    k === "$ref" && typeof v === "string" && v.startsWith("#/") ? [v] : refs(v),
  );
}

describe("audition MCP capability", () => {
  it("publishes exact self-contained schemas beside hum, without a second App resource", () =>
    host(async (client) => {
      const result = await client.listTools();
      expect(result.tools.map((t) => t.name).sort()).toEqual([
        "audition",
        "hum",
      ]);
      const tool = result.tools.find((t) => t.name === "audition")!;
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(JSON.stringify(tool.inputSchema).length).toBeLessThan(200_000);
      expect(tool.description).toContain("20 seconds");
      for (const ref of refs(tool.inputSchema)) {
        let value: unknown = tool.inputSchema;
        for (const part of ref
          .slice(2)
          .split("/")
          .map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~")))
          value = (value as Record<string, unknown>)?.[part];
        expect(value, ref).toBeDefined();
      }
    }));

  it("returns actual WAV content matching the packet and labels host audio access unknown", () =>
    host(async (client) => {
      const parent = artifact();
      const result = await client.callTool({
        name: "audition",
        arguments: {
          artifact: parent,
          target: { startSeconds: 1, endSeconds: 3, contextSeconds: 0 },
        },
      });
      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as {
        audition: unknown;
        delivery: { modelAudioInput: string };
      };
      const packet = readAudition(structured.audition);
      expect(structured.delivery.modelAudioInput).toBe("unknown");
      const audio = (
        result.content as Array<{
          type: string;
          data?: string;
          mimeType?: string;
        }>
      ).find((c) => c.type === "audio")!;
      expect(audio.mimeType).toBe("audio/wav");
      const bytes = Buffer.from(audio.data!, "base64");
      expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
      expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
        packet.entries[0]!.media.sha256,
      );
      expect(bytes.byteLength).toBe(44 + 2 * 44_100 * 4);
      expect(packet.entries[0]!.artifact).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("refrain-mcp-audition-");
      expect(packet.entries[0]!.work.receiptId).toBe(parent.receipt.receiptId);
    }));

  it(
    "rejects oversized delivery, mixed comparison selectors, unavailable exact samples, and extra private context",
    () =>
      host(async (client) => {
        const parent = artifact();
        for (const args of [
          { artifact: parent, privateContext: "must not enter the core" },
          {
            artifact: parent,
            target: { startSeconds: 0, endSeconds: 1 },
            compare: { artifact: parent },
          },
          { artifact: { id: parent.receipt.airId } },
          {
            artifact: artifact(
              JSON.parse(
                readFileSync(
                  resolve("fixtures/air-v1/paper-waltz.air.json"),
                  "utf8",
                ),
              ),
            ),
            target: { startSeconds: 0, endSeconds: 1 },
          },
        ]) {
          const result = await client.callTool({
            name: "audition",
            arguments: args,
          });
          expect(result.isError).toBe(true);
        }
        const slow = {
          ...minimalAirV1Example,
          conductor: { ...minimalAirV1Example.conductor, tempo: 30 },
          voices: minimalAirV1Example.voices.map((voice) => ({
            ...voice,
            part: "@hello | @hello | @hello | @hello",
          })),
        };
        const tooLong = await client.callTool({
          name: "audition",
          arguments: { artifact: artifact(slow) },
        });
        expect(tooLong.isError).toBe(true);
        expect(JSON.stringify(tooLong.content)).toContain("at most 20 seconds");
      }),
    20_000,
  );
});
