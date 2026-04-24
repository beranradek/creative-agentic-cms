import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5174),
  HOST: z.string().default("127.0.0.1"),
  DATA_DIR: z.string().default("./projects"),
  WORKSPACE_DIR: z.string().default("./.workspace"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
});

export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  return EnvSchema.parse(env);
}
