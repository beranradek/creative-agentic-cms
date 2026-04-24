import { PageSchema, type Page } from "@cac/shared";

export function createDefaultPage(): Page {
  return PageSchema.parse({
    version: 1,
    metadata: {
      title: "New Page",
      description: "",
      lang: "en",
    },
    sections: [],
    assets: [],
  });
}
