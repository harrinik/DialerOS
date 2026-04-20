export interface ParsedPastedPhoneInput {
  valid: string[];
  invalid: string[];
  duplicates: string[];
}

export function normalizeDialPhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed.replace(/^tel:/i, '');
  if (candidate.startsWith('00')) {
    candidate = `+${candidate.slice(2)}`;
  }

  const hasLeadingPlus = candidate.startsWith('+');
  candidate = hasLeadingPlus
    ? `+${candidate.slice(1).replace(/[^\d]/g, '')}`
    : candidate.replace(/[^\d]/g, '');

  if (!/^\+?[1-9]\d{1,14}$/.test(candidate)) {
    return null;
  }

  return candidate;
}

export function parsePastedPhoneInput(input: string): ParsedPastedPhoneInput {
  const tokens = input
    .split(/\r?\n/)
    .flatMap((line) => line.split(/[,\t;]+/))
    .map((token) => token.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];

  for (const token of tokens) {
    const normalized = normalizeDialPhone(token);
    if (!normalized) {
      invalid.push(token);
      continue;
    }
    if (seen.has(normalized)) {
      duplicates.push(normalized);
      continue;
    }
    seen.add(normalized);
    valid.push(normalized);
  }

  return { valid, invalid, duplicates };
}
