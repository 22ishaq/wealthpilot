import type { ApiErrorBody } from "@wealthpilot/shared";
import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";

/** An error with a stable, machine-readable code. Everything else becomes INTERNAL_ERROR. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string): AppError =>
  new AppError(404, "NOT_FOUND", `${what} not found`);

export const unauthenticated = (): AppError =>
  new AppError(401, "UNAUTHENTICATED", "Sign in to continue");

export const forbidden = (message = "You do not have permission to do that"): AppError =>
  new AppError(403, "FORBIDDEN", message);

interface PgError {
  code: string;
  constraint?: string;
}

function isPgError(error: unknown): error is PgError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[0-9A-Z]{5}$/.test(error.code) &&
    "severity" in error
  );
}

const UNIQUE_VIOLATIONS: Record<string, [string, string]> = {
  users_email_key: ["EMAIL_TAKEN", "That email address already has an account"],
  holdings_account_symbol_key: ["HOLDING_EXISTS", "This account already holds that security"],
};

function fromPg(error: PgError): AppError | null {
  switch (error.code) {
    case "23505": {
      const [code, message] = UNIQUE_VIOLATIONS[error.constraint ?? ""] ?? [
        "CONFLICT",
        "That already exists",
      ];
      return new AppError(409, code, message);
    }
    case "23503":
      return new AppError(422, "INVALID_REFERENCE", "A referenced record does not exist");
    case "23514":
      return new AppError(422, "VALIDATION_FAILED", "A value is out of range");
    // A row-level-security WITH CHECK failure means the row belongs to another tenant.
    // Report it as missing, exactly as a read of that row would.
    case "42501":
      return notFound("Resource");
    default:
      return null;
  }
}

interface BodyParserError {
  type: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return typeof error === "object" && error !== null && "type" in error && "status" in error;
}

export function toErrorResponse(error: unknown): { status: number; body: ApiErrorBody } {
  const make = (status: number, code: string, message: string, details?: unknown) => ({
    status,
    body: { error: details === undefined ? { code, message } : { code, message, details } },
  });

  if (error instanceof AppError) {
    return make(error.status, error.code, error.message, error.details);
  }
  if (error instanceof ZodError) {
    return make(
      422,
      "VALIDATION_FAILED",
      "The request is invalid",
      error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  if (isPgError(error)) {
    const mapped = fromPg(error);
    if (mapped) return make(mapped.status, mapped.code, mapped.message);
  }
  if (isBodyParserError(error)) {
    if (error.type === "entity.parse.failed") {
      return make(400, "MALFORMED_JSON", "The request body is not valid JSON");
    }
    if (error.type === "entity.too.large") {
      return make(413, "PAYLOAD_TOO_LARGE", "The request body is too large");
    }
  }
  return make(500, "INTERNAL_ERROR", "Something went wrong");
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const { status, body } = toErrorResponse(error);
    if (status >= 500) {
      logger.error({ err: error, reqId: req.id }, "unhandled error");
    }
    res.status(status).json(body);
  };
}
