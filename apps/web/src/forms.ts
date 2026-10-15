import type { ZodError } from "zod";

import { ApiError } from "./api";

/** Field-path -> message, from either client-side (zod) or server-side validation. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (error instanceof ApiError) return error.fieldErrors();
  if (isZodError(error)) {
    const errors: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join(".");
      errors[path] ??= issue.message;
    }
    return errors;
  }
  return {};
}

function isZodError(error: unknown): error is ZodError {
  return (
    typeof error === "object" && error !== null && "issues" in error && Array.isArray(error.issues)
  );
}

/** An empty form field means "no value". */
export function blankToNull(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

/** Form values as strings, read from a submitted form by field name. */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}
