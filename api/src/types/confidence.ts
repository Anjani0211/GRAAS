/**
 * OSINT enrichment confidence tiers.
 * Numeric values enable comparison: VERIFIED > HIGH > MEDIUM > LOW > UNVERIFIED.
 */
export enum ConfidenceScore {
  VERIFIED   = 4,   // 2+ independent APIs with matching results
  HIGH       = 3,   // 1 primary API, successful positive response
  MEDIUM     = 2,   // Secondary source, web scraper, or inferred data
  LOW        = 1,   // AI extraction only; OSINT returned nothing useful
  UNVERIFIED = 0,   // All lookups failed or no API key configured
}

export function confidenceToLabel(score: ConfidenceScore): string {
  return ConfidenceScore[score] as string;
}

export function labelToConfidence(label: string): ConfidenceScore {
  const key = label.toUpperCase() as keyof typeof ConfidenceScore;
  return key in ConfidenceScore ? ConfidenceScore[key] : ConfidenceScore.UNVERIFIED;
}
