import { z } from "zod";

export const ExportConfigSchema = z
  .object({
    baseUrl: z.string().url().nullable().default(null),
    includeSitemap: z.boolean().default(true),
    includeRobotsTxt: z.boolean().default(true),
    allowIndexing: z.boolean().default(true),
    analyticsHtml: z.string().max(20_000).nullable().default(null),
  })
  .default({});

export type ExportConfig = z.infer<typeof ExportConfigSchema>;

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  return trimmed.replace(/\/+$/, "");
}

