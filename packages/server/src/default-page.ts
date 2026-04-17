import { type Page } from "@cac/shared";

export function createDefaultPage(): Page {
  return {
    version: 1,
    metadata: {
      title: "New Page",
      description: "",
      lang: "en",
    },
    sections: [],
    assets: [],
  };
}

