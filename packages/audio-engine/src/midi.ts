import type { CompiledAir } from "@refrain/compiler";
import type { CompiledAirV1 } from "@refrain/compiler/v1";
import {
  createPerformancePlan,
  type PerformanceEvent,
  type PerformancePlan,
  type PerformanceVoice,
} from "./performance.js";
import { createNoteLifecycle } from "./note-lifecycle.js";
import { performanceEventAt, type ExecutionBundle } from "./execution.js";

const TICKS_PER_BEAT = 480;
const uint32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const uint16 = (value: number): number[] => [
  (value >>> 8) & 0xff,
  value & 0xff,
];
const ascii = (value: string): number[] => [...new TextEncoder().encode(value)];

function variableLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

const chunk = (id: string, body: number[]): number[] => [
  ...ascii(id),
  ...uint32(body.length),
  ...body,
];

function metaText(type: number, text: string): number[] {
  const encoded = ascii(text);
  return [0, 0xff, type, ...variableLength(encoded.length), ...encoded];
}

function conductorTrack(compiled: CompiledAir | CompiledAirV1): number[] {
  const microsPerQuarter = Math.round(60_000_000 / compiled.tempo);
  const meters =
    compiled.format === "compiled-air@1-experimental"
      ? compiled.meterChanges
      : [
          {
            meter: compiled.meter,
            startBeat: 0,
          },
        ];
  const timeline: MidiEvent[] = [
    {
      tick: 0,
      order: 0,
      bytes: [
        0xff,
        0x51,
        0x03,
        (microsPerQuarter >>> 16) & 0xff,
        (microsPerQuarter >>> 8) & 0xff,
        microsPerQuarter & 0xff,
      ],
    },
    ...meters.map((entry) => {
      const [numeratorText, denominatorText] = entry.meter.split("/");
      return {
        tick: Math.round(entry.startBeat * TICKS_PER_BEAT),
        order: 1,
        bytes: [
          0xff,
          0x58,
          0x04,
          Number(numeratorText),
          Math.log2(Number(denominatorText)),
          24,
          8,
        ],
      };
    }),
  ];
  timeline.sort(
    (left, right) => left.tick - right.tick || left.order - right.order,
  );
  const body = [...metaText(0x03, compiled.title)];
  let cursor = 0;
  for (const event of timeline) {
    body.push(...variableLength(event.tick - cursor), ...event.bytes);
    cursor = event.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return chunk("MTrk", body);
}

interface MidiEvent {
  tick: number;
  order: number;
  bytes: number[];
}

function voiceTrack(
  voice: PerformanceVoice,
  events: PerformanceEvent[],
  includeMasterGain: boolean,
): number[] {
  const body: number[] = [...metaText(0x03, voice.voiceId)];
  const timeline: MidiEvent[] = [];
  const program = voice.program ?? voice.midiFallbackProgram;
  if (program !== undefined) {
    timeline.push({
      tick: 0,
      order: 0,
      bytes: [0xc0 | voice.channel, program],
    });
  }
  if (events.length > 0) {
    const pan = Math.max(0, Math.min(127, Math.round((voice.pan + 1) * 63.5)));
    timeline.push({
      tick: 0,
      order: 1,
      bytes: [
        0xb0 | voice.channel,
        7,
        includeMasterGain ? voice.midiChannelGain : voice.channelGain,
      ],
    });
    timeline.push({
      tick: 0,
      order: 1,
      bytes: [0xb0 | voice.channel, 10, pan],
    });
  }
  for (const action of createNoteLifecycle(events)) {
    const event = action.event;
    timeline.push({
      tick: Math.round(action.beat * TICKS_PER_BEAT),
      order: action.type === "noteOff" ? 2 : 3,
      bytes:
        action.type === "noteOn"
          ? [0x90 | voice.channel, event.midi, event.noteOnVelocity]
          : [0x80 | voice.channel, event.midi, 0],
    });
  }
  timeline.sort(
    (left, right) => left.tick - right.tick || left.order - right.order,
  );
  let cursor = 0;
  for (const event of timeline) {
    body.push(...variableLength(event.tick - cursor), ...event.bytes);
    cursor = event.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  return chunk("MTrk", body);
}

export function encodeMidi(
  compiled: CompiledAir | CompiledAirV1,
  suppliedPlan?: PerformancePlan,
  options: { includeMasterGain?: boolean } = {},
): Uint8Array {
  const plan = suppliedPlan ?? createPerformancePlan(compiled);
  const tracks = [conductorTrack(compiled)];
  for (const voice of plan.voices) {
    tracks.push(
      voiceTrack(
        voice,
        plan.events.filter((event) => event.voiceId === voice.voiceId),
        options.includeMasterGain ?? true,
      ),
    );
  }
  const header = chunk("MThd", [
    ...uint16(1),
    ...uint16(tracks.length),
    ...uint16(TICKS_PER_BEAT),
  ]);
  return new Uint8Array([...header, ...tracks.flat()]);
}

export function encodeExecutionMidi(
  bundle: ExecutionBundle,
  options: { includeMasterGain?: boolean } = {},
): Uint8Array {
  const tracks = [conductorTrack(bundle.compiled)];
  const eventIndexesByVoice = new Map<string, number[]>();
  for (
    let eventIndex = 0;
    eventIndex < bundle.compiled.events.length;
    eventIndex += 1
  ) {
    const voiceId = bundle.compiled.events[eventIndex]!.voiceId;
    const indexes = eventIndexesByVoice.get(voiceId);
    if (indexes) indexes.push(eventIndex);
    else eventIndexesByVoice.set(voiceId, [eventIndex]);
  }
  for (const voice of bundle.plan.voices) {
    tracks.push(
      voiceTrack(
        voice,
        (eventIndexesByVoice.get(voice.voiceId) ?? []).map((eventIndex) =>
          performanceEventAt(bundle, eventIndex),
        ),
        options.includeMasterGain ?? true,
      ),
    );
  }
  const header = chunk("MThd", [
    ...uint16(1),
    ...uint16(tracks.length),
    ...uint16(TICKS_PER_BEAT),
  ]);
  return new Uint8Array([...header, ...tracks.flat()]);
}
