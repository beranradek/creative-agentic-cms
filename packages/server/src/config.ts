import { z } from "zod";

const BoolFromEnvSchema = z.preprocess((value) => {
  if (value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5174),
  HOST: z.string().default("127.0.0.1"),
  DATA_DIR: z.string().default("./projects"),
  WORKSPACE_DIR: z.string().default("./.workspace"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  SERVE_WEB: BoolFromEnvSchema.default(false),
  WEB_DIST_DIR: z.string().default("./packages/web/dist"),
  API_SESSION_TOKEN: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().optional(),
  IMAGEGEN_MODEL: z.string().default("gpt-image-1"),
});

export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  return EnvSchema.parse(env);
}
