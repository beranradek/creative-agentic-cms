import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { PageSchema } from "@cac/shared";
import { SimpleCircuitBreaker } from "./circuit-breaker.js";

const AgentInputSchema = z.object({
  userMessage: z.string().min(1),
  projectId: z.string().min(1),
  page: PageSchema,
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
- Do not remove sections/components/assets unless explicitly asked.
- Keep rich_text.html valid, minimal HTML (p, ul, ol, li, strong, em, a).
- Prefer small, safe changes that satisfy the request.
`;
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

    const response = await model.invoke([
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: `Project: ${parsed.projectId}\n\nCurrent page JSON:\n${JSON.stringify(parsed.page, null, 2)}\n\nUser request:\n${parsed.userMessage}`,
      },
    ]);

    const output = AgentOutputSchema.parse(response);
    circuitBreaker.onSuccess();
    return output;
  } catch (error) {
    circuitBreaker.onFailure(nowMs);
    throw error;
  }
}
