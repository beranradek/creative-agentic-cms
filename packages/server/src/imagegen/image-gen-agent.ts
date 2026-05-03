import type { ImageQuality, ImageSize, TempImage } from "./types.js";

const OPENAI_IMAGES_API = "https://api.openai.com/v1/images/generations";
const MAX_PROMPT_LENGTH = 1000;

interface OpenAIImageResponse {
  data: Array<{ b64_json: string }>;
}

function mapOpenAIError(body: unknown): string {
  if (typeof body !== "object" || body === null) return "Image generation failed, try again.";
  const err = (body as { error?: { code?: string; message?: string } }).error;
  if (!err) return "Image generation failed, try again.";
  if (err.code === "rate_limit_exceeded") return "Rate limit reached, try again in a moment.";
  if (err.code === "content_policy_violation") return "Prompt was rejected by content policy.";
  return "Image generation failed, try again.";
}

export async function generateImage(
  prompt: string,
  size: ImageSize,
  quality: ImageQuality,
  model: string,
  apiKey: string
): Promise<TempImage> {
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error("Prompt exceeds maximum length of 1000 characters.");
  }

  const body = JSON.stringify({ model, prompt, n: 1, size, quality });
  const res = await fetch(OPENAI_IMAGES_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  const json = (await res.json()) as unknown;
  if (!res.ok) {
    throw new Error(mapOpenAIError(json));
  }

  const b64 = (json as OpenAIImageResponse).data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation failed, try again.");

  const buffer = Buffer.from(b64, "base64");
  const filename = `img_${crypto.randomUUID()}.png`;

  return {
    filename,
    buffer,
    mimeType: "image/png",
    width: null,
    height: null,
    createdAt: Date.now(),
  };
}
