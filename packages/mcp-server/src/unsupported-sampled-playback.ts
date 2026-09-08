function unavailable(): never {
  throw new Error(
    "Sampled and SoundFont playback is unavailable in Refrain's zero-asset MCP Canvas.",
  );
}

export class WorkletSynthesizer {
  constructor(_context: AudioContext) {
    unavailable();
  }
}

export class Sequencer {
  constructor(..._arguments: unknown[]) {
    unavailable();
  }
}

export class SpessaSynthProcessor {
  constructor(..._arguments: unknown[]) {
    unavailable();
  }
}

export class SpessaSynthSequencer {
  constructor(..._arguments: unknown[]) {
    unavailable();
  }
}
