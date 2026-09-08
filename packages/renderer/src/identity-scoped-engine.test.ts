import { describe, expect, it } from "vitest";
import { IdentityScopedEngineSlot } from "./identity-scoped-engine.js";

class FakeEngine {
  destroyed = 0;

  async destroy(): Promise<void> {
    this.destroyed += 1;
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("IdentityScopedEngineSlot", () => {
  it("never returns the engine for A after replacement with B", async () => {
    const slot = new IdentityScopedEngineSlot<FakeEngine>("A");
    const engineA = new FakeEngine();
    await slot.get("A", async () => engineA);

    await slot.replace("B");
    const engineB = new FakeEngine();

    expect(await slot.get("B", async () => engineB)).toBe(engineB);
    expect(slot.current("A")).toBeUndefined();
    expect(engineA.destroyed).toBe(1);
  });

  it("destroys a pending A creation that resolves after B becomes current", async () => {
    const slot = new IdentityScopedEngineSlot<FakeEngine>("A");
    const pendingA = deferred<FakeEngine>();
    const engineA = new FakeEngine();
    const requestA = slot.get("A", async () => pendingA.promise);

    await slot.replace("B");
    pendingA.resolve(engineA);

    await expect(requestA).rejects.toMatchObject({ name: "AbortError" });
    expect(engineA.destroyed).toBe(1);
  });

  it("exposes only the current identity's pending user-gesture creation", async () => {
    const slot = new IdentityScopedEngineSlot<FakeEngine>("A");
    const pending = deferred<FakeEngine>();
    const engine = new FakeEngine();
    const request = slot.get("A", async () => pending.promise);

    expect(slot.pending("A")).toBeDefined();
    expect(slot.pending("B")).toBeUndefined();
    pending.resolve(engine);

    await expect(request).resolves.toBe(engine);
    expect(slot.pending("A")).toBeUndefined();
    expect(slot.current("A")).toBe(engine);
  });

  it("destroys the playing A engine before B can create", async () => {
    const slot = new IdentityScopedEngineSlot<FakeEngine>("A");
    const engineA = new FakeEngine();
    await slot.get("A", async () => engineA);

    const replacement = slot.replace("B");
    expect(slot.current("A")).toBeUndefined();
    await replacement;
    expect(engineA.destroyed).toBe(1);
  });

  it("destroys a creation that completes after disposal", async () => {
    const slot = new IdentityScopedEngineSlot<FakeEngine>("A");
    const pending = deferred<FakeEngine>();
    const created = new FakeEngine();
    const request = slot.get("A", async () => pending.promise);

    await slot.dispose();
    pending.resolve(created);

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(created.destroyed).toBe(1);
  });

  it("reactivates the same identity after a StrictMode-style cleanup", async () => {
    const slot = new IdentityScopedEngineSlot<FakeEngine>("A");
    await slot.dispose();
    await slot.replace("A");
    const engine = new FakeEngine();

    expect(await slot.get("A", async () => engine)).toBe(engine);
    expect(slot.isCurrent("A", engine)).toBe(true);
  });
});
