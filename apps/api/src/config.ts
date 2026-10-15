import { z } from "zod";

const flag = z.enum(["true", "false"]).transform((value) => value === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, "is required"),
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  COOKIE_SECURE: flag.optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  SCRYPT_COST: z.coerce
    .number()
    .int()
    .refine((n) => n >= 1024 && (n & (n - 1)) === 0, "must be a power of two >= 1024")
    .default(32768),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  TRUST_PROXY: flag.default(false),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface Config {
  env: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  migrationDatabaseUrl: string;
  appOrigin: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  scryptCost: number;
  loginRateLimit: number;
  trustProxy: boolean;
  poolMax: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    migrationDatabaseUrl: e.MIGRATION_DATABASE_URL ?? e.DATABASE_URL,
    appOrigin: new URL(e.APP_ORIGIN).origin,
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === "production",
    sessionTtlHours: e.SESSION_TTL_HOURS,
    scryptCost: e.SCRYPT_COST,
    loginRateLimit: e.LOGIN_RATE_LIMIT,
    trustProxy: e.TRUST_PROXY,
    poolMax: e.PG_POOL_MAX,
    logLevel: e.LOG_LEVEL,
  };
}
