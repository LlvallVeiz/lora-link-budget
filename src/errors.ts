/**
 * Error type for lora-link-budget.
 *
 * Every validation failure raises a LoraError with a machine-readable `code`
 * and a human-readable message that names the offending value and the valid
 * range, so CLI users can fix the input instead of guessing.
 */
export class LoraError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LoraError";
    this.code = code;
  }
}

/** Raised when a numeric input is outside its valid range. */
export function rangeError(
  field: string,
  value: unknown,
  valid: string,
): LoraError {
  return new LoraError(
    "OUT_OF_RANGE",
    `${field} = ${String(value)} is out of range (valid: ${valid}).`,
  );
}

/** Raised when an enum-like input is not one of the supported values. */
export function valueError(
  field: string,
  value: unknown,
  valid: readonly string[],
): LoraError {
  return new LoraError(
    "INVALID_VALUE",
    `${field} = ${String(value)} is not supported (valid: ${valid.join(", ")}).`,
  );
}
