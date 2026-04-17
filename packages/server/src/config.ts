import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5174),
  DATA_DIR: z.string().default("./projects"),
  WORKSPACE_DIR: z.string().default("./.workspace"),
});

export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  return EnvSchema.parse(env);
}

