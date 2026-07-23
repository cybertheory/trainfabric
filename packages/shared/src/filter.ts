/**
 * Lightweight SQL-ish filter validation.
 * Rejects obvious injection patterns; full parsing is done in compute.
 */

const FORBIDDEN = [
  /;\s*(drop|delete|insert|update|alter|create|truncate|grant|revoke)\b/i,
  /--/,
  /\/\*/,
  /\bxp_/i,
  /\bunion\s+select\b/i,
  /\binto\s+outfile\b/i,
  /\bload_file\b/i,
  /\bpg_sleep\b/i,
  /\bsleep\s*\(/i,
];

const ALLOWED_CHARS = /^[\w\s.="'<>!~+\-*/%(),]+$/i;

export class FilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterValidationError";
  }
}

export function validateFilter(filter: string | undefined | null): void {
  if (!filter) return;
  const trimmed = filter.trim();
  if (!trimmed) return;
  if (trimmed.length > 4000) {
    throw new FilterValidationError("Filter exceeds maximum length (4000)");
  }
  for (const re of FORBIDDEN) {
    if (re.test(trimmed)) {
      throw new FilterValidationError(`Filter rejected: matches forbidden pattern ${re}`);
    }
  }
  if (!ALLOWED_CHARS.test(trimmed)) {
    throw new FilterValidationError("Filter contains disallowed characters");
  }
}
