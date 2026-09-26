import { renderWav } from "./kernel";
import type { Session } from "./contracts";

self.onmessage = (event: MessageEvent<Session>) => {
  try {
    const wav = renderWav(event.data);
    self.postMessage(
      { bytes: wav.buffer },
      { transfer: [wav.buffer as ArrayBuffer] },
    );
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
