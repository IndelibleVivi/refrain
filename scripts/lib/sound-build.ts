import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  candidateContentSha256,
  soundObjectContentSha256,
  type InstrumentCandidate,
  type SoundAssetDefinition,
  type SoundpackManifest,
} from "@refrain/soundpack";

export interface WavMetadata {
  sampleRate: number;
  frameCount: number;
  channels: 1 | 2;
}

export interface WrittenCandidateShard {
  candidateId: string;
  candidateContentSha256: string;
  shardSha256: string;
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function gitShow(repository: string, ref: string, path: string): Buffer {
  return execFileSync("git", ["-C", repository, "show", `${ref}:${path}`], {
    maxBuffer: 1024 * 1024 * 1024,
  });
}

export function wavMetadata(bytes: Buffer, path: string): WavMetadata {
  if (
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error(`${path} is not a RIFF/WAVE asset.`);
  let cursor = 12;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let blockAlign: number | undefined;
  let dataBytes: number | undefined;
  while (cursor + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", cursor, cursor + 4);
    const length = bytes.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    if (start + length > bytes.length)
      throw new Error(`${path} has a truncated ${kind} chunk.`);
    if (kind === "fmt ") {
      const format = bytes.readUInt16LE(start);
      channels = bytes.readUInt16LE(start + 2);
      sampleRate = bytes.readUInt32LE(start + 4);
      blockAlign = bytes.readUInt16LE(start + 12);
      if (format !== 1) throw new Error(`${path} is not PCM WAV.`);
    } else if (kind === "data") {
      dataBytes = length;
    }
    cursor = start + length + (length % 2);
  }
  if (
    !sampleRate ||
    !blockAlign ||
    dataBytes === undefined ||
    (channels !== 1 && channels !== 2) ||
    dataBytes % blockAlign !== 0
  )
    throw new Error(`${path} has incomplete WAV metadata.`);
  return {
    sampleRate,
    frameCount: dataBytes / blockAlign,
    channels,
  };
}

export function assetId(
  candidateId: string,
  path: string,
  contentSha256: string,
): string {
  const extension = /\.[^.]+$/.exec(path)?.[0] ?? "";
  const name = basename(path, extension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${candidateId}-${name}-${contentSha256.slice(0, 12)}`;
}

export function directGitWavAsset(input: {
  bytes: Buffer;
  candidateId: string;
  path: string;
  repository: string;
  ref: string;
  rawUrlRoot: string;
  localNamespace: string;
  license: SoundAssetDefinition["license"];
  releaseStatus: SoundAssetDefinition["releaseStatus"];
  compiler: string;
  sfzPath: string;
}): SoundAssetDefinition {
  const digest = sha256(input.bytes);
  return {
    id: assetId(input.candidateId, input.path, digest),
    kind: "wav",
    source: {
      repository: input.repository,
      ref: input.ref,
      path: input.path,
      url: `${input.rawUrlRoot.replace(/\/$/, "")}/${input.path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    },
    localPath: `soundpacks/${input.localNamespace}/sha256/${digest}.wav`,
    bytes: input.bytes.length,
    sha256: digest,
    audio: wavMetadata(input.bytes, input.path),
    license: { ...input.license },
    processingHistory: [
      {
        operation: "source-lock",
        tool: input.compiler,
        inputSha256: digest,
        outputSha256: digest,
        parameters: { sfzPath: input.sfzPath, samplePath: input.path },
      },
    ],
    releaseStatus: input.releaseStatus,
    publicReleaseAccepted: false,
  };
}

export function containerWavAsset(input: {
  bytes: Buffer;
  candidateId: string;
  repository: string;
  archiveUrl: string;
  archiveBytes: number;
  archiveSha256: string;
  memberPath: string;
  localNamespace: string;
  license: SoundAssetDefinition["license"];
  releaseStatus: SoundAssetDefinition["releaseStatus"];
  compiler: string;
  sfzPath: string;
}): SoundAssetDefinition {
  const digest = sha256(input.bytes);
  return {
    id: assetId(input.candidateId, input.memberPath, digest),
    kind: "wav",
    source: {
      repository: input.repository,
      ref: input.archiveSha256,
      url: input.archiveUrl,
      path: input.memberPath,
      container: {
        format: "7z",
        bytes: input.archiveBytes,
        sha256: input.archiveSha256,
        memberPath: input.memberPath,
      },
    },
    localPath: `soundpacks/${input.localNamespace}/sha256/${digest}.wav`,
    bytes: input.bytes.length,
    sha256: digest,
    audio: wavMetadata(input.bytes, input.memberPath),
    license: { ...input.license },
    processingHistory: [
      {
        operation: "verified-container-member",
        tool: input.compiler,
        inputSha256: input.archiveSha256,
        outputSha256: digest,
        parameters: {
          containerFormat: "7z",
          memberPath: input.memberPath,
          sfzPath: input.sfzPath,
        },
      },
    ],
    releaseStatus: input.releaseStatus,
    publicReleaseAccepted: false,
  };
}

export async function writeCandidateShard(
  candidate: InstrumentCandidate,
  assets: SoundAssetDefinition[],
): Promise<WrittenCandidateShard> {
  const manifestCore = {
    format: "refrain-soundpack@1-experimental" as const,
    id: `${candidate.id}-candidate-digest`,
    status: "development-candidates" as const,
    assets,
    candidates: [candidate],
  };
  const manifest: SoundpackManifest = {
    ...manifestCore,
    contentSha256: soundObjectContentSha256(manifestCore),
  };
  const candidateDigest = candidateContentSha256(candidate, manifest);
  const shardCore = {
    format: "refrain-candidate-shard@0-experimental" as const,
    id: candidate.id,
    candidateContentSha256: candidateDigest,
    candidate,
    assets,
  };
  const shard = {
    ...shardCore,
    contentSha256: soundObjectContentSha256(shardCore),
  };
  const shardRoot = resolve("packages/soundpack/src/candidates/sha256");
  await mkdir(shardRoot, { recursive: true });
  await writeFile(
    resolve(shardRoot, `${shard.contentSha256}.json`),
    `${JSON.stringify(shard, null, 2)}\n`,
    "utf8",
  );
  const priorFiles = (await readdir(shardRoot)).filter(
    (filename) =>
      filename !== `${shard.contentSha256}.json` &&
      /^[0-9a-f]{64}\.json$/.test(filename),
  );
  for (const filename of priorFiles) {
    const prior = JSON.parse(
      await readFile(resolve(shardRoot, filename), "utf8"),
    );
    if (prior.id === candidate.id)
      await rm(resolve(shardRoot, filename), { force: true });
  }
  return {
    candidateId: candidate.id,
    candidateContentSha256: candidateDigest,
    shardSha256: shard.contentSha256,
  };
}
