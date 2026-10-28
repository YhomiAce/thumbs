import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5115),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN must be at least 16 characters').optional(),
  RUN_WORKER: booleanFlag.default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).optional(),
});

/** Validated runtime configuration. */
export type Config = z.infer<typeof EnvSchema>;

/**
 * Parses and validates environment variables.
 *
 * Empty strings are treated as unset so `FOO=` in an env file falls back to the default.
 *
 * @param env - The environment to read (defaults to `process.env`)
 * @returns The validated configuration
 * @throws {Error} With a readable list of problems when validation fails
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
