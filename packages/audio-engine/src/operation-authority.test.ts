import { describe, expect, it } from "vitest";
import { OperationAuthority } from "./operation-authority.js";

type Kind = "play" | "seek" | "stop";

describe("OperationAuthority", () => {
  it("invalidates an older operation before a newer one begins", () => {
    const authority = new OperationAuthority<Kind>();
    const play = authority.begin("play");
    const seek = authority.begin("seek");

    expect(play.signal.aborted).toBe(true);
    expect(() => authority.assertCurrent(play)).toThrow(/superseded/);
    expect(() => authority.assertCurrent(seek)).not.toThrow();
  });

  it("makes Stop invalidate the current async continuation", () => {
    const authority = new OperationAuthority<Kind>();
    const play = authority.begin("play");

    authority.cancel("stop");

    expect(play.signal.aborted).toBe(true);
    expect(authority.isCurrent(play)).toBe(false);
  });

  it("does not let a finished token regain authority", () => {
    const authority = new OperationAuthority<Kind>();
    const play = authority.begin("play");

    authority.finish(play);

    expect(authority.isCurrent(play)).toBe(false);
  });
});
