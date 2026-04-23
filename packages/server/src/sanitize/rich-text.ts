import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = ["p", "br", "strong", "em", "a", "ul", "ol", "li"] as const;

export function sanitizeRichTextHtml(inputHtml: string): string {
  return sanitizeHtml(inputHtml, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      a: ["href"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
  });
}

