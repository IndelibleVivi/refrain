import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderPcm, renderWav } from "@refrain/audio-engine";
import { compileAir } from "@refrain/compiler";

const bankBytes = await readFile(
  resolve("apps/soundbench/public/soundpacks/GeneralUser-GS.sf2"),
);
const soundBank = bankBytes.buffer.slice(
  bankBytes.byteOffset,
  bankBytes.byteOffset + bankBytes.byteLength,
) as ArrayBuffer;
const fixtures = ["returning-home", "acoustic-ensemble"];
const evidence: Array<{
  fixture: string;
  events: number;
  sampleRate: number;
  frames: number;
  activeSamples: number;
  peak: number;
  wavBytes: number;
}> = [];
for (const fixture of fixtures) {
  const source = await readFile(
    resolve(`fixtures/valid/${fixture}.air.json`),
    "utf8",
  );
  const result = compileAir(source);
  if (!result.compiled) throw new Error(JSON.stringify(result.diagnostics));
  const pcm = await renderPcm(result.compiled, soundBank.slice(0));
  if (!pcm) throw new Error("Renderer was unexpectedly cancelled.");
  const wav = await renderWav(result.compiled, soundBank.slice(0));

  let peak = 0;
  let activeSamples = 0;
  for (let index = 0; index < pcm.left.length; index += 1) {
    const magnitude = Math.max(
      Math.abs(pcm.left[index] ?? 0),
      Math.abs(pcm.right[index] ?? 0),
    );
    peak = Math.max(peak, magnitude);
    if (magnitude > 0.00001) activeSamples += 1;
  }
  const header = new TextDecoder("ascii").decode(new Uint8Array(wav, 0, 12));
  if (!header.startsWith("RIFF") || !header.endsWith("WAVE"))
    throw new Error("Renderer did not emit a RIFF/WAVE file.");
  if (activeSamples === 0) throw new Error("Renderer emitted silence.");
  if (peak > 0.721)
    throw new Error(`PCM peak ${peak} exceeded the 0.72 render ceiling.`);
  evidence.push({
    fixture,
    events: result.compiled.events.length,
    sampleRate: pcm.sampleRate,
    frames: pcm.left.length,
    activeSamples,
    peak: Number(peak.toFixed(6)),
    wavBytes: wav.byteLength,
  });
}

process.stdout.write(
  JSON.stringify({ policy: "attenuation-only@0", fixtures: evidence }, null, 2),
);
process.stdout.write("\n");
