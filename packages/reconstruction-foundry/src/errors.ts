export class FoundryIntegrityError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FoundryIntegrityError";
    this.code = code;
  }
}

export function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
