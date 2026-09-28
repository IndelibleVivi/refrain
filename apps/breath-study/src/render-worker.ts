import { renderStereo, renderWav } from "./kernel";
import type { Program } from "./contracts";

export interface RenderRequest {
  id: number;
  kind: "pcm" | "wav";
  program: Program;
  sampleRate: number;
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const { id, kind, program, sampleRate } = event.data;
  try {
    if (kind === "pcm") {
      const frames = Math.ceil(program.duration * sampleRate);
      const pcm = renderStereo(program, 0, frames, sampleRate);
      self.postMessage(
        { id, kind, left: pcm.left, right: pcm.right },
        {
          transfer: [
            pcm.left.buffer as ArrayBuffer,
            pcm.right.buffer as ArrayBuffer,
          ],
        },
      );
    } else {
      const bytes = renderWav(program, sampleRate);
      self.postMessage(
        { id, kind, bytes },
        { transfer: [bytes.buffer as ArrayBuffer] },
      );
    }
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
