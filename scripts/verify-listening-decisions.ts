import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderReceiptShapeIsValid } from "@refrain/audio-engine";
import {
  LISTENING_DECISIONS,
  type ListeningDecision,
} from "@refrain/soundpack";

type ListeningAcceptance = "accepted-for-exact-audio-digests" | "pending-faye";

export interface ListeningDigestRecord {
  file: string;
  candidateId: string;
  candidateAudioSha256: string;
  fallbackAudioSha256: string;
  listeningAcceptance: ListeningAcceptance;
  evidenceErrors: string[];
}

interface VerificationEntry {
  candidateId: string;
  instrumentId?: string;
  packet?: string;
  decision: "accepted" | "pending-faye";
  status:
    | "reproduced"
    | "digest-mismatch"
    | "invalid-evidence"
    | "missing-packet"
    | "pending-faye";
  candidateAudioSha256?: string;
  expectedCandidateAudioSha256?: string;
  fallbackAudioSha256?: string;
  expectedFallbackAudioSha256?: string;
  errors: string[];
}

export interface ListeningVerificationReport {
  format: "refrain-listening-verification@0-experimental";
  status: "passed" | "failed";
  acceptedDecisionCount: number;
  packetCount: number;
  reproducedAcceptedDecisionCount: number;
  pendingPacketCount: number;
  failures: string[];
  entries: VerificationEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function plainSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function sortedAssetFacts(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const facts: Array<{ assetId: string; bytes: number; sha256: string }> = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.assetId !== "string" ||
      typeof item.bytes !== "number" ||
      !Number.isInteger(item.bytes) ||
      !plainSha256(item.sha256)
    )
      return undefined;
    facts.push({
      assetId: item.assetId,
      bytes: item.bytes,
      sha256: item.sha256,
    });
  }
  return JSON.stringify(
    facts.sort((left, right) => left.assetId.localeCompare(right.assetId)),
  );
}

function sortedCandidateIds(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const candidateIds: string[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.candidateId !== "string")
      return undefined;
    candidateIds.push(item.candidateId);
  }
  return JSON.stringify(candidateIds.sort());
}

function assetClosureFacts(value: unknown):
  | {
      assets: string;
      candidates: string;
      soundpackDigest: string;
    }
  | undefined {
  if (
    !isRecord(value) ||
    value.format !== "refrain-asset-closure@0-experimental" ||
    !Array.isArray(value.assets) ||
    !Array.isArray(value.candidates) ||
    !isRecord(value.soundpack) ||
    typeof value.soundpack.id !== "string" ||
    !plainSha256(value.soundpack.sha256)
  )
    return undefined;
  const assets = sortedAssetFacts(
    value.assets.map((asset) =>
      isRecord(asset)
        ? {
            assetId: asset.id,
            bytes: asset.bytes,
            sha256: asset.sha256,
          }
        : asset,
    ),
  );
  const candidates = sortedCandidateIds(
    value.candidates.map((candidate) =>
      isRecord(candidate)
        ? {
            candidateId: candidate.id,
          }
        : candidate,
    ),
  );
  if (!assets || !candidates) return undefined;
  return {
    assets,
    candidates,
    soundpackDigest: `sha256:${value.soundpack.sha256}`,
  };
}

function comparisonRecord(
  file: string,
  label: "candidate" | "fallback",
  value: unknown,
): { audioSha256?: string; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      errors: [`${file}: comparison.${label} must be an object.`],
    };
  }
  const audioSha256 = plainSha256(value.audioSha256)
    ? value.audioSha256
    : undefined;
  if (!audioSha256)
    errors.push(
      `${file}: comparison.${label}.audioSha256 is not a lowercase SHA-256 digest.`,
    );

  if (!renderReceiptShapeIsValid(value.renderReceipt)) {
    errors.push(
      `${file}: comparison.${label}.renderReceipt is not identity- and semantics-valid.`,
    );
  } else {
    if (
      audioSha256 &&
      value.renderReceipt.outputSha256 !== `sha256:${audioSha256}`
    )
      errors.push(
        `${file}: comparison.${label} audio digest contradicts its RenderReceipt.`,
      );
    const receiptAssets = sortedAssetFacts(value.renderReceipt.requiredAssets);
    const receiptCandidates = sortedCandidateIds(
      value.renderReceipt.selectedCandidates,
    );
    const closure = assetClosureFacts(value.assetClosure);
    if (!closure) {
      errors.push(
        `${file}: comparison.${label}.assetClosure is not a complete asset closure.`,
      );
    } else {
      if (
        receiptAssets !== closure.assets ||
        receiptCandidates !== closure.candidates
      )
        errors.push(
          `${file}: comparison.${label} asset/candidate closure contradicts its RenderReceipt.`,
        );
      if (value.renderReceipt.soundClosureDigest !== closure.soundpackDigest)
        errors.push(
          `${file}: comparison.${label} soundpack closure contradicts its RenderReceipt.`,
        );
    }
  }
  return { ...(audioSha256 ? { audioSha256 } : {}), errors };
}

export function digestRecordFromPacket(
  file: string,
  value: unknown,
): ListeningDigestRecord {
  const evidenceErrors: string[] = [];
  if (!isRecord(value))
    throw new Error(`${file}: listening packet must be an object.`);
  if (value.format !== "refrain-listening-packet@2-experimental")
    evidenceErrors.push(`${file}: unsupported listening packet format.`);

  const reference = isRecord(value.reference) ? value.reference : undefined;
  const candidateId =
    reference && typeof reference.candidate === "string"
      ? reference.candidate
      : "";
  if (!candidateId)
    evidenceErrors.push(`${file}: reference.candidate is missing.`);

  const comparison = isRecord(value.comparison) ? value.comparison : undefined;
  const candidate = comparisonRecord(file, "candidate", comparison?.candidate);
  const fallback = comparisonRecord(file, "fallback", comparison?.fallback);
  evidenceErrors.push(...candidate.errors, ...fallback.errors);

  const listeningAcceptance =
    value.listeningAcceptance === "accepted-for-exact-audio-digests" ||
    value.listeningAcceptance === "pending-faye"
      ? value.listeningAcceptance
      : "pending-faye";
  if (
    value.listeningAcceptance !== "accepted-for-exact-audio-digests" &&
    value.listeningAcceptance !== "pending-faye"
  )
    evidenceErrors.push(`${file}: invalid listeningAcceptance state.`);

  return {
    file,
    candidateId,
    candidateAudioSha256: candidate.audioSha256 ?? "",
    fallbackAudioSha256: fallback.audioSha256 ?? "",
    listeningAcceptance,
    evidenceErrors,
  };
}

export function verifyAcceptedDigestRecords(
  decisions: readonly ListeningDecision[],
  records: readonly ListeningDigestRecord[],
): ListeningVerificationReport {
  const failures: string[] = [];
  const entries: VerificationEntry[] = [];
  const acceptedDecisions = decisions.filter(
    (decision) => decision.decision === "accepted",
  );
  const acceptedByCandidate = new Map<string, ListeningDecision>();
  for (const decision of acceptedDecisions) {
    if (acceptedByCandidate.has(decision.candidateId)) {
      failures.push(
        `Duplicate accepted listening decision for ${decision.candidateId}.`,
      );
    } else acceptedByCandidate.set(decision.candidateId, decision);
  }

  const recordByCandidate = new Map<string, ListeningDigestRecord>();
  for (const record of records) {
    if (!record.candidateId) {
      failures.push(`${record.file}: packet has no candidate identity.`);
      continue;
    }
    if (recordByCandidate.has(record.candidateId)) {
      failures.push(`Duplicate listening packet for ${record.candidateId}.`);
      continue;
    }
    recordByCandidate.set(record.candidateId, record);
    const decision = acceptedByCandidate.get(record.candidateId);
    if (!decision) {
      const errors = [...record.evidenceErrors];
      if (record.listeningAcceptance !== "pending-faye")
        errors.push(
          `${record.candidateId} has no accepted Faye decision and must remain pending-faye.`,
        );
      failures.push(...errors);
      entries.push({
        candidateId: record.candidateId,
        packet: record.file,
        decision: "pending-faye",
        status: errors.length ? "invalid-evidence" : "pending-faye",
        candidateAudioSha256: record.candidateAudioSha256,
        fallbackAudioSha256: record.fallbackAudioSha256,
        errors,
      });
      continue;
    }

    const errors = [...record.evidenceErrors];
    const digestsMatch =
      record.candidateAudioSha256 === decision.candidateAudioSha256 &&
      record.fallbackAudioSha256 === decision.fallbackAudioSha256;
    if (!digestsMatch)
      errors.push(
        `${record.candidateId} no longer reproduces the accepted candidate/fallback audio digests.`,
      );
    if (
      digestsMatch &&
      record.listeningAcceptance !== "accepted-for-exact-audio-digests"
    )
      errors.push(
        `${record.candidateId} reproduced accepted digests but its packet did not preserve that state.`,
      );
    if (!digestsMatch && record.listeningAcceptance !== "pending-faye")
      errors.push(
        `${record.candidateId} drifted but its packet was not demoted to pending-faye.`,
      );
    failures.push(...errors);
    entries.push({
      candidateId: record.candidateId,
      instrumentId: decision.instrumentId,
      packet: record.file,
      decision: "accepted",
      status: errors.length
        ? record.evidenceErrors.length
          ? "invalid-evidence"
          : "digest-mismatch"
        : "reproduced",
      candidateAudioSha256: record.candidateAudioSha256,
      expectedCandidateAudioSha256: decision.candidateAudioSha256,
      fallbackAudioSha256: record.fallbackAudioSha256,
      expectedFallbackAudioSha256: decision.fallbackAudioSha256,
      errors,
    });
  }

  for (const decision of acceptedDecisions) {
    if (recordByCandidate.has(decision.candidateId)) continue;
    const error = `No listening packet reproduced accepted decision ${decision.candidateId}.`;
    failures.push(error);
    entries.push({
      candidateId: decision.candidateId,
      instrumentId: decision.instrumentId,
      decision: "accepted",
      status: "missing-packet",
      expectedCandidateAudioSha256: decision.candidateAudioSha256,
      expectedFallbackAudioSha256: decision.fallbackAudioSha256,
      errors: [error],
    });
  }

  return {
    format: "refrain-listening-verification@0-experimental",
    status: failures.length ? "failed" : "passed",
    acceptedDecisionCount: acceptedDecisions.length,
    packetCount: records.length,
    reproducedAcceptedDecisionCount: entries.filter(
      (entry) => entry.status === "reproduced",
    ).length,
    pendingPacketCount: entries.filter(
      (entry) => entry.status === "pending-faye",
    ).length,
    failures,
    entries: entries.sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    ),
  };
}

function summaryOf(report: ListeningVerificationReport): string {
  const lines = [
    `listening verification: ${report.status}`,
    `accepted decisions reproduced: ${report.reproducedAcceptedDecisionCount}/${report.acceptedDecisionCount}`,
    `pending packets: ${report.pendingPacketCount}`,
  ];
  if (report.failures.length) {
    lines.push("", "failures:");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const packetsArgument = process.argv
    .find((item) => item.startsWith("--packets="))
    ?.slice("--packets=".length);
  const packetsRoot = resolve(packetsArgument ?? "tmp/g3b-listening-packets");
  await mkdir(packetsRoot, { recursive: true });
  const filenames = (await readdir(packetsRoot))
    .filter((name) => name.endsWith(".listening.json"))
    .sort();
  const records: ListeningDigestRecord[] = [];
  const readFailures: string[] = [];
  for (const filename of filenames) {
    try {
      records.push(
        digestRecordFromPacket(
          filename,
          JSON.parse(await readFile(resolve(packetsRoot, filename), "utf8")),
        ),
      );
    } catch (error) {
      readFailures.push(error instanceof Error ? error.message : String(error));
    }
  }
  const report = verifyAcceptedDigestRecords(LISTENING_DECISIONS, records);
  if (readFailures.length) {
    report.failures.unshift(...readFailures);
    report.status = "failed";
  }
  const summary = summaryOf(report);
  await Promise.all([
    writeFile(
      resolve(packetsRoot, "accepted-digest-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    ),
    writeFile(
      resolve(packetsRoot, "listening-verification-summary.txt"),
      summary,
    ),
  ]);
  process.stdout.write(summary);
  if (report.status === "failed") process.exitCode = 1;
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  await main();
}
