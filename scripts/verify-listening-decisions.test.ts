import { describe, expect, it } from "vitest";
import type { ListeningDecision } from "@refrain/soundpack";
import {
  verifyAcceptedDigestRecords,
  type ListeningDigestRecord,
} from "./verify-listening-decisions.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

function decision(
  overrides: Partial<ListeningDecision> = {},
): ListeningDecision {
  return {
    instrumentId: "warm_piano",
    candidateId: "candidate-a",
    decision: "accepted",
    decidedBy: "Faye",
    decidedAt: "2026-08-23",
    scope: "Exact test packet.",
    packetSha256: DIGEST_C,
    candidateAudioSha256: DIGEST_A,
    fallbackAudioSha256: DIGEST_B,
    ...overrides,
  };
}

function record(
  overrides: Partial<ListeningDigestRecord> = {},
): ListeningDigestRecord {
  return {
    file: "warm-piano.listening.json",
    candidateId: "candidate-a",
    candidateAudioSha256: DIGEST_A,
    fallbackAudioSha256: DIGEST_B,
    listeningAcceptance: "accepted-for-exact-audio-digests",
    evidenceErrors: [],
    ...overrides,
  };
}

describe("accepted listening digest verification", () => {
  it("passes only when an accepted candidate and fallback pair reproduces", () => {
    const report = verifyAcceptedDigestRecords([decision()], [record()]);
    expect(report.status).toBe("passed");
    expect(report.reproducedAcceptedDecisionCount).toBe(1);
  });

  it("fails when either accepted audio digest drifts", () => {
    const report = verifyAcceptedDigestRecords(
      [decision()],
      [
        record({
          candidateAudioSha256: DIGEST_C,
          listeningAcceptance: "pending-faye",
        }),
      ],
    );
    expect(report.status).toBe("failed");
    expect(report.entries[0]?.status).toBe("digest-mismatch");
  });

  it("keeps candidates without an accepted Faye decision pending", () => {
    const report = verifyAcceptedDigestRecords(
      [],
      [
        record({
          candidateId: "candidate-pending",
          listeningAcceptance: "pending-faye",
        }),
      ],
    );
    expect(report.status).toBe("passed");
    expect(report.pendingPacketCount).toBe(1);
  });

  it("fails if a pending candidate is mechanically promoted", () => {
    const report = verifyAcceptedDigestRecords([], [record()]);
    expect(report.status).toBe("failed");
    expect(report.failures[0]).toContain("must remain pending-faye");
  });

  it("fails when an accepted decision has no generated packet", () => {
    const report = verifyAcceptedDigestRecords([decision()], []);
    expect(report.status).toBe("failed");
    expect(report.entries[0]?.status).toBe("missing-packet");
  });
});
