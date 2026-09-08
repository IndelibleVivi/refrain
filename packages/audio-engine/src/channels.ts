import type { CompiledAir } from "@refrain/compiler";
import type { CompiledAirV1 } from "@refrain/compiler/v1";
import { instrumentById } from "@refrain/soundpack";

export interface VoiceChannel {
  voiceId: string;
  channel: number;
  instrument: string;
}

export function assignVoiceChannels(
  compiled: CompiledAir | CompiledAirV1,
): VoiceChannel[] {
  const voices = new Map<string, string>();
  for (const event of compiled.events)
    voices.set(event.voiceId, event.instrument);

  const available = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  let next = 0;
  return [...voices].map(([voiceId, instrument]) => {
    const definition = instrumentById.get(instrument);
    if (definition?.family === "percussion")
      return { voiceId, instrument, channel: 9 };
    const channel = available[next];
    if (channel === undefined)
      throw new Error("The compiled air exceeds available MIDI channels.");
    next += 1;
    return { voiceId, instrument, channel };
  });
}
