/** Types for the D3-compatible graph response */
export interface GraphNode {
  id: string;
  type: string;
  label: string;
  confidence: string;
  flags: string[];
  caseCount?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  relationship: string;
  confidence: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
  fallback: boolean;
}

/** Escape XML special characters */
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Maltego entity type mapping */
const MALTEGO_TYPE: Record<string, string> = {
  Case:         "maltego.custom.CaseID",
  PhoneNumber:  "maltego.PhoneNumber",
  UpiID:        "maltego.custom.UpiID",
  IPAddress:    "maltego.IPv4Address",
  Domain:       "maltego.Domain",
  Email:        "maltego.EmailAddress",
  CryptoWallet: "maltego.custom.CryptoWallet",
  TelegramID:   "maltego.custom.TelegramID",
  Entity:       "maltego.Entity",
};

/**
 * Generate a Maltego .mtgx XML export from a GraphResponse.
 * The .mtgx format is a ZIP of XML files; here we generate the inner entities.xml
 * which clients can open directly (many Maltego versions accept raw XML).
 */
export function generateMtgxXml(graph: GraphResponse, caseId: string): string {
  const entities = graph.nodes
    .map((node) => {
      const mType = MALTEGO_TYPE[node.type] ?? MALTEGO_TYPE.Entity;
      return `  <MaltegoEntity type="${escXml(mType)}" id="${escXml(node.id)}">
    <Value>${escXml(node.label)}</Value>
    <Weight>100</Weight>
    <AdditionalFields>
      <Field name="confidence" displayName="Confidence">${escXml(node.confidence)}</Field>
      <Field name="nodeType" displayName="Type">${escXml(node.type)}</Field>
      <Field name="caseId" displayName="Case ID">${escXml(caseId)}</Field>
      ${node.flags.map((f) => `<Field name="flag.${escXml(f)}" displayName="${escXml(f)}">true</Field>`).join("\n      ")}
    </AdditionalFields>
  </MaltegoEntity>`;
    })
    .join("\n");

  const links = graph.links
    .map(
      (link) =>
        `  <MaltegoLink from="${escXml(link.source)}" to="${escXml(link.target)}">
    <Label>${escXml(link.relationship)}</Label>
  </MaltegoLink>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<MaltegoMessage>
  <MaltegoTransformResponseMessage>
    <Entities>
${entities}
    </Entities>
    <UIMessages/>
  </MaltegoTransformResponseMessage>
</MaltegoMessage>`;
}
