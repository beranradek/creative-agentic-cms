import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { PageSchema, type Page, type Asset, type Component } from "@cac/shared";
import { SimpleCircuitBreaker } from "./circuit-breaker.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const AgentInputSchema = z.object({
  userMessage: z.string().min(1),
  projectId: z.string().min(1),
  page: PageSchema,
  screenshotUrl: z.string().min(1).optional(),
  screenshotPngBase64: z.string().min(1).optional(),
  markupHtmlExcerpt: z.string().min(1).optional(),
});

export type AgentInput = z.infer<typeof AgentInputSchema>;

const AgentOutputSchema = z.object({
  assistantMessage: z.string(),
  page: PageSchema,
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

const circuitBreaker = new SimpleCircuitBreaker(3, 30_000);

function buildSystemPrompt() {
  return `You are an expert creative CMS editor agent.

You edit a single page represented as JSON.

Rules:
- Output MUST match the provided JSON schema (structured output).
- Preserve existing ids whenever you edit existing content.
- When creating new ids, use deterministic prefixes:
  - sec_<uuid> for sections
  - cmp_<uuid> for components
  - img_<uuid> for image assets
- Keep rich_text.html valid, minimal HTML (p, ul, ol, li, strong, em, a).
- Make small, user-requested changes only. Avoid "creative rewrites" unless explicitly asked.
- Do NOT delete sections/components/assets unless the user explicitly asks for deletion/removal.
- Do NOT reorder or move content between sections unless the user explicitly asks for it.
- Respect the diff budget (keep edits limited; prefer editing existing content over adding new structures).
- assistantMessage should be a short, user-facing summary of what changed and what to do next.
`;
}

function truncate(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function safeLabel(label: string): string {
  const cleaned = label.replace(/\s+/g, " ").trim();
  const noBrackets = cleaned.replaceAll("[", "(").replaceAll("]", ")");
  return truncate(noBrackets || "Section", 60);
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPageSnapshot(page: Page): string {
  const assetsById = new Map<string, Asset>(page.assets.map((a) => [a.id, a]));

  const lines: string[] = [];
  lines.push(`Meta: title="${truncate(page.metadata.title, 80)}" lang="${page.metadata.lang}"`);
  if (page.metadata.description) lines.push(`Meta.description: ${truncate(page.metadata.description, 140)}`);
  lines.push(`Sections: ${page.sections.length}, Assets: ${page.assets.length}`);

  const imageAssets = page.assets.filter((a) => a.type === "image");
  if (imageAssets.length) {
    lines.push("Images:");
    for (const img of imageAssets.slice(0, 20)) {
      if (img.type !== "image") continue;
      lines.push(`- ${img.id} file=${img.filename} alt="${truncate(img.alt, 80)}"`);
    }
  }

  lines.push("Structure:");
  for (const section of page.sections) {
    const styleParts: string[] = [];
    if (section.style.background) styleParts.push(`bg=${section.style.background}`);
    if (section.style.padding !== null) styleParts.push(`pad=${section.style.padding}px`);
    if (section.style.maxWidth !== null) styleParts.push(`maxW=${section.style.maxWidth}px`);
    if (!section.settings.visible) styleParts.push("hidden");
    if (section.settings.layout !== "stack") styleParts.push(`layout=${section.settings.layout}`);
    if (section.settings.gap !== null) styleParts.push(`gap=${section.settings.gap}px`);
    if (section.settings.layout === "grid" && section.settings.gridColumns !== null)
      styleParts.push(`cols=${section.settings.gridColumns}`);
    const styleText = styleParts.length ? ` {${styleParts.join(" ")}}` : "";
    lines.push(`- [${safeLabel(section.label)}] (${section.id})${styleText}`);
    for (const c of section.components) {
      lines.push("  " + describeComponent(c, assetsById));
    }
  }

  return lines.join("\n");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled component type: ${JSON.stringify(value)}`);
}

function describeComponent(component: Component, assetsById: Map<string, Asset>): string {
  if (component.type === "hero") {
    const bg = component.backgroundImageAssetId ? assetsById.get(component.backgroundImageAssetId) : null;
    const bgText = bg && bg.type === "image" ? ` bg=${bg.filename}` : "";
    return `hero: "${truncate(component.headline, 80)}" / "${truncate(component.subheadline, 120)}"${bgText}`;
  }
  if (component.type === "rich_text") {
    return `rich_text: "${truncate(stripHtmlToText(component.html), 180)}"`;
  }
  if (component.type === "image") {
    const asset = assetsById.get(component.assetId);
    const file = asset && asset.type === "image" ? asset.filename : "(missing)";
    const styleParts: string[] = [];
    if (component.style.fit) styleParts.push(`fit=${component.style.fit}`);
    if (component.style.align) styleParts.push(`align=${component.style.align}`);
    if (component.style.maxWidth !== null) styleParts.push(`maxW=${component.style.maxWidth}px`);
    if (component.style.radius !== null) styleParts.push(`radius=${component.style.radius}px`);
    const styleText = styleParts.length ? ` {${styleParts.join(" ")}}` : "";
    return `image: asset=${component.assetId} file=${file}${styleText} caption="${truncate(component.caption, 80)}"`;
  }
  if (component.type === "contact_form") {
    return `contact_form: "${truncate(component.headline, 80)}" submit="${truncate(component.submitLabel, 40)}"`;
  }
  return assertNever(component);
}

export async function runCmsAgent(input: AgentInput): Promise<AgentOutput> {
  const parsed = AgentInputSchema.parse(input);

  const modelName = process.env.MODEL?.trim() || "gpt-4o-mini";
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and set your key.");
  }
  const temperature = Number(process.env.TEMPERATURE ?? "0");
  const maxTokens = Number(process.env.MAX_TOKENS ?? "1200");

  const nowMs = Date.now();
  circuitBreaker.canRequest(nowMs);

  try {
    const model = new ChatOpenAI({
      model: modelName,
      temperature: Number.isFinite(temperature) ? temperature : 0,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : 1200,
      apiKey: process.env.OPENAI_API_KEY,
    }).withStructuredOutput(AgentOutputSchema, { name: "cms_edit_page" });

    const userText = `Project: ${parsed.projectId}

Page snapshot (for fast understanding):
${buildPageSnapshot(parsed.page)}

Rendered HTML excerpt (from current page render):
${parsed.markupHtmlExcerpt ?? "(not available)"}

Latest screenshot (rendered preview):
${parsed.screenshotUrl ?? "(not available)"}

Current page JSON (authoritative, must be edited via schema):
${JSON.stringify(parsed.page, null, 2)}

User request:
${parsed.userMessage}`;

    const humanContent = [
      { type: "text", text: userText },
      ...(parsed.screenshotPngBase64
        ? [{ type: "image", source_type: "base64", mime_type: "image/png", data: parsed.screenshotPngBase64 }]
        : []),
    ] as unknown as HumanMessage["content"];

    const response = await model.invoke([
      new SystemMessage({ content: buildSystemPrompt() }),
      new HumanMessage({ content: humanContent }),
    ]);

    const output = AgentOutputSchema.parse(response);
    circuitBreaker.onSuccess();
    return output;
  } catch (error) {
    circuitBreaker.onFailure(nowMs);
    throw error;
  }
}
