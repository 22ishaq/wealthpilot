/**
 * Request schemas, shared by the API (which enforces them) and the web app (which uses them
 * to validate forms before submitting). Objects are strict: unknown keys are rejected, so a
 * client cannot smuggle fields such as tenantId or role into a request.
 */

import { z } from "zod";

import { RISK_PROFILES } from "./allocation.js";
import { MONEY_HINT, QUANTITY_HINT, parseMoney, parseQuantity } from "./money.js";
import { INVITABLE_ROLES } from "./roles.js";

export const ACCOUNT_TYPES = ["isa", "sipp", "gia", "cash"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Readonly<Record<AccountType, string>> = {
  isa: "Stocks & Shares ISA",
  sipp: "SIPP (pension)",
  gia: "General investment",
  cash: "Cash",
};

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z
  .string()
  .min(12, "must be at least 12 characters")
  .max(128, "must be at most 128 characters");
export const nameSchema = z.string().trim().min(1, "is required").max(120);
export const idSchema = z.uuid();

export const moneySchema = z.string().transform((text, ctx) => {
  const pence = parseMoney(text);
  if (pence === null) {
    ctx.addIssue({ code: "custom", message: `must be ${MONEY_HINT}` });
    return z.NEVER;
  }
  return pence;
});

export const quantitySchema = z.string().transform((text, ctx) => {
  const quantity = parseQuantity(text);
  if (quantity === null) {
    ctx.addIssue({ code: "custom", message: `must be ${QUANTITY_HINT}` });
    return z.NEVER;
  }
  return quantity;
});

export const symbolSchema = z.string().regex(/^[A-Z0-9.]{1,12}$/, "must be a ticker symbol");

export const signupSchema = z.strictObject({
  firmName: nameSchema,
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, "is required").max(128),
});

export const acceptInviteSchema = z.strictObject({
  token: z.string().min(20).max(200),
  name: nameSchema,
  password: passwordSchema,
});

export const inviteSchema = z.strictObject({
  email: emailSchema,
  role: z.enum(INVITABLE_ROLES),
});

export const memberUpdateSchema = z.strictObject({ role: z.enum(INVITABLE_ROLES) });

export const clientCreateSchema = z.strictObject({
  name: nameSchema,
  email: emailSchema.nullable().optional(),
  riskProfile: z.enum(RISK_PROFILES),
  advisorId: idSchema.nullable().optional(),
});

export const clientUpdateSchema = clientCreateSchema.partial();

export const clientListQuerySchema = z.strictObject({
  search: z.string().trim().max(120).optional(),
  advisorId: idSchema.optional(),
  archived: z.enum(["true", "false"]).optional(),
});

export const accountCreateSchema = z.strictObject({
  name: nameSchema,
  type: z.enum(ACCOUNT_TYPES),
  cash: moneySchema.optional(),
});

export const accountUpdateSchema = z.strictObject({
  name: nameSchema.optional(),
  cash: moneySchema.optional(),
});

export const holdingCreateSchema = z.strictObject({
  symbol: symbolSchema,
  quantity: quantitySchema,
  bookCost: moneySchema,
});

export const holdingUpdateSchema = z.strictObject({
  quantity: quantitySchema.optional(),
  bookCost: moneySchema.optional(),
});

export type SignupInput = z.input<typeof signupSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;
export type InviteInput = z.input<typeof inviteSchema>;
export type ClientCreateInput = z.input<typeof clientCreateSchema>;
export type ClientUpdateInput = z.input<typeof clientUpdateSchema>;
export type AccountCreateInput = z.input<typeof accountCreateSchema>;
export type AccountUpdateInput = z.input<typeof accountUpdateSchema>;
export type HoldingCreateInput = z.input<typeof holdingCreateSchema>;
export type HoldingUpdateInput = z.input<typeof holdingUpdateSchema>;
