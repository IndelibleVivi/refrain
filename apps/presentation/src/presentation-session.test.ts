import { describe, expect, it } from "vitest";
import { PresentationSessionStore } from "./presentation-session.js";

describe("expiring local presentation sessions", () => {
  it("stores only a token hash and returns typed lookup failures", () => {
    const store = new PresentationSessionStore("operator", 1_000);
    const created = store.create(
      new TextEncoder().encode("artifact"),
      `sha256:${"a".repeat(64)}`,
      "http://127.0.0.1:4319/session",
      1_000,
    );
    expect(created.token.length).toBeGreaterThanOrEqual(32);
    expect(store.recordKeys()).not.toContain(created.token);
    expect(
      store.resolve(created.token, `sha256:${"a".repeat(64)}`, "wrong", 1_500),
    ).toEqual({ ok: false, reason: "wrong-scope" });
    expect(
      store.resolve(
        created.token,
        `sha256:${"b".repeat(64)}`,
        "operator",
        1_500,
      ),
    ).toEqual({ ok: false, reason: "identity-mismatch" });
    expect(
      store.resolve(
        created.token,
        `sha256:${"a".repeat(64)}`,
        "operator",
        2_001,
      ),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      store.resolve(
        created.token,
        `sha256:${"a".repeat(64)}`,
        "operator",
        2_001,
      ),
    ).toEqual({ ok: false, reason: "missing" });
  });
});
