import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyEngine } from "./engine";
import { fixture } from "./test-fixture";
import { choose, newSession } from "./model";
import { encodeWav } from "./wav-encoder";
import { sha256Bytes } from "../../../packages/audio-engine/src/digest";
let ctx: FakeContext;
class FakeSource {
  buffer?: { duration: number };
  onended?: () => void;
  started?: [number, number];
  stopped = false;
  connect() {}
  disconnect() {}
  start(when: number, offset: number) {
    this.started = [when, offset];
  }
  stop() {
    this.stopped = true;
  }
}
class FakeContext {
  currentTime = 0;
  state = "running";
  destination = {};
  sources: FakeSource[] = [];
  constructor() {
    ctx = this;
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
  createGain() {
    return { gain: { value: 1, setTargetAtTime() {} }, connect() {} };
  }
  createBuffer(_channels: number, frames: number, rate: number) {
    return { duration: frames / rate, copyToChannel() {} };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("document", { baseURI: "http://localhost/" });
  vi.stubGlobal("window", { setInterval, clearInterval });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function setup() {
  const manifest = fixture(),
    data = encodeWav({
      left: new Float32Array(300000).fill(0.01),
      right: new Float32Array(300000).fill(0.02),
    }),
    digest = await sha256Bytes(data);
  for (const ref of Object.values(manifest.audio)) {
    ref.bytes = data.byteLength;
    ref.sha256 = digest;
  }
  let session = newSession(manifest),
    original = false;
  const fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => data.slice(0),
  }));
  vi.stubGlobal("fetch", fetch);
  const engine = new StudyEngine(
    manifest,
    () => session,
    () => original,
    vi.fn(),
    vi.fn(),
  );
  return {
    engine,
    fetch,
    setChoice: () => {
      session = choose(session, 0, "piano", 12);
    },
    setOriginal: () => {
      original = true;
    },
  };
}
describe("gesture-owned phrase scheduler", () => {
  it("does not fetch or create audio before Play; cancellation cannot emit deferred sound", async () => {
    const { engine, fetch } = await setup();
    expect(fetch).not.toHaveBeenCalled();
    expect(engine.status).toBe("ready");
    let resolve!: () => void;
    const pending = new Promise<void>((r) => (resolve = r));
    fetch.mockImplementation(async () => {
      await pending;
      return {
        ok: true,
        arrayBuffer: async () =>
          encodeWav({
            left: new Float32Array(300000).fill(0.01),
            right: new Float32Array(300000).fill(0.02),
          }),
      };
    });
    const play = engine.play();
    engine.pause();
    resolve();
    await play;
    expect(ctx.sources).toHaveLength(0);
    expect(engine.status).toBe("ready");
    await engine.play();
    expect(ctx.sources).toHaveLength(1);
    engine.dispose();
  });
  it("locks only the scheduled cue and starts reconstructed tails atomically on seek", async () => {
    const { engine, setChoice } = await setup();
    await engine.play();
    expect(engine.canChoose(0)).toBe(true);
    setChoice();
    ctx.currentTime = 9.91;
    await vi.advanceTimersByTimeAsync(35);
    expect(engine.canChoose(0)).toBe(false);
    expect(engine.canChoose(1)).toBe(true);
    engine.pause();
    await engine.seek(11);
    await engine.play();
    const alive = ctx.sources.filter((s) => !s.stopped);
    expect(alive).toHaveLength(2); // previous phrase's release and current phrase
    expect(alive[0]!.started![0]).toBeCloseTo(alive[1]!.started![0]);
    expect(alive[0]!.started![1]).toBeCloseTo(6);
    expect(alive[1]!.started![1]).toBeCloseTo(1);
    engine.stop();
    expect(engine.time).toBe(0);
    expect(engine.canChoose(0)).toBe(true);
    engine.dispose();
  });
  it("rejects corrupt bytes and exports without starting an AudioContext", async () => {
    const { engine, fetch } = await setup();
    fetch.mockImplementation(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(10),
    }));
    await engine.play();
    expect(engine.status).toBe("ready");
    expect(ctx.sources).toHaveLength(0);
    engine.dispose();
    const healthy = await setup();
    const contextCtor = vi.fn(function () {
      return new FakeContext();
    });
    vi.stubGlobal("AudioContext", contextCtor);
    const bytes = await healthy.engine.wav();
    expect(bytes.byteLength).toBeGreaterThan(44);
    expect(contextCtor).not.toHaveBeenCalled();
    healthy.engine.dispose();
  });
});
