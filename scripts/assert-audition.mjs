import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Exercise the exact artifact returned by a real transport, never a local
// reconstruction. This is delivery evidence, not a claim of model hearing.
export async function assertAudition(client, tools, artifact) {
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["audition", "hum"]);
  const tool = tools.tools.find((t) => t.name === "audition");
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.ok(Buffer.byteLength(JSON.stringify(tool.inputSchema)) < 200_000);
  const result = await client.callTool({
    name: "audition",
    arguments: {
      artifact,
      target: { startSeconds: 0, endSeconds: 0.25, contextSeconds: 0 },
    },
  });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.equal(result.structuredContent?.ok, true);
  assert.equal(result.structuredContent.delivery.modelAudioInput, "unknown");
  const entry = result.structuredContent.audition.entries[0];
  assert.equal(entry.work.receiptId, artifact.receipt.receiptId);
  assert.equal(entry.artifact, undefined);
  const audio = result.content.filter((c) => c.type === "audio");
  assert.equal(audio.length, 1);
  assert.equal(audio[0].mimeType, "audio/wav");
  const bytes = Buffer.from(audio[0].data, "base64");
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.byteLength, 44 + 44_100);
  assert.equal(entry.media.bytes, bytes.byteLength);
  assert.equal(
    entry.media.sha256,
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  );
  return {
    mediaBytes: bytes.byteLength,
    modelAudioInput: "unknown",
    release: result._meta?.["refrain/release"],
  };
}
