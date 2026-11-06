export function normalizeEmailForLookup(email: string): string {
  return email.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildCaseInsensitiveEmailQuery(email: string): Record<string, unknown> {
  const normalizedEmail = normalizeEmailForLookup(email);
  return {
    email: {
      $regex: `^${escapeRegExp(normalizedEmail)}$`,
      $options: "i",
    },
  };
}
