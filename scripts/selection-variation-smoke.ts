import type { AirSource } from "@refrain/air-schema";
import { compileAir } from "@refrain/compiler";
import { hum } from "@refrain/mcp-server/hum";
import {
  buildStructureViewModel,
  createRefrainSelection,
  selectionToAgentRequest,
} from "@refrain/renderer";

const parentSource: AirSource = {
  format: "air@0-experimental",
  title: "Selection seed",
  tempo: 72,
  meter: "4/4",
  motifs: { return: "C4/4 D4/4 E4/4 G4/4" },
  voices: [
    {
      id: "lead",
      instrument: "warm_piano",
      role: "lead",
      part: "@return",
    },
  ],
};

const parent = hum({ air: parentSource });
if (!parent.ok) throw new Error("Parent AIR failed to hum.");
const compiled = compileAir(parent.source).compiled;
if (!compiled) throw new Error("Parent AIR failed to recompile.");
const viewModel = buildStructureViewModel(
  parent.source,
  compiled,
  parent.receipt,
);
const selection = createRefrainSelection(
  viewModel,
  "motif",
  "lead:part:1:return",
);
const agentRequest = selectionToAgentRequest(selection);
if (
  !agentRequest.includes("not as an automatic request to call hum") ||
  !agentRequest.includes("preserve the exact parent AIR generation") ||
  agentRequest.includes("one complete new air@0-experimental source")
) {
  throw new Error("Selection did not preserve the conversational contract.");
}

const childSource: AirSource = {
  ...parentSource,
  title: "Selection variation",
  voices: [
    {
      id: "lead",
      instrument: "warm_piano",
      role: "lead",
      realize: [
        {
          id: "return-low",
          kind: "motif",
          motif: "return",
          transform: { transpose: -12 },
        },
      ],
    },
  ],
};

const child = hum({
  air: childSource,
  from: {
    air: parent.source,
    receipt: parent.receipt,
    relation: "variation",
    motifLinks: [
      {
        parent: "return",
        child: "return",
        parentAnchor: selection.anchor,
        childAnchor: "lead:return-low:1:return",
        transform: {
          transpose: -12,
          stretch: 1,
          invert: false,
          retrograde: false,
        },
      },
    ],
  },
});
if (!child.ok || child.receipt.verification.status !== "verified") {
  throw new Error("Selected motif did not close as a verified variation.");
}

process.stdout.write(
  `${JSON.stringify(
    {
      format: "refrain-selection-vertical@0-experimental",
      selection,
      requestPreservesConversationContract: true,
      childReceiptId: child.receipt.receiptId,
      verification: child.receipt.verification,
    },
    null,
    2,
  )}\n`,
);
