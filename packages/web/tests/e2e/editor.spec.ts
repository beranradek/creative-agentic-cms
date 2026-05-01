import { expect, test } from "@playwright/test";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Gd0sAAAAASUVORK5CYII=";
const PNG_2X2_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwHwyBNBAw/AcAR8oI+ItOQ4UAAAAASUVORK5CYII=";

async function fetchPageJson(page: import("@playwright/test").Page, projectId: string) {
  return await page.evaluate(async (pid) => {
    const token = (window as Window & { __CAC_API_TOKEN__?: string }).__CAC_API_TOKEN__;
    if (!token) throw new Error("Missing API session token");
    const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/page`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as { page?: unknown };
    return json.page;
  }, projectId);
}

async function loadProject(page: import("@playwright/test").Page, projectId: string) {
  await ensurePaletteTab(page, "project");
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();
  await expect(page.getByTestId("loaded-project")).toHaveText(`loaded: ${projectId}`);
  await expect(page.getByTestId("load-state")).toHaveText("ready");
}

async function ensurePaletteTab(
  page: import("@playwright/test").Page,
  tab: "project" | "page" | "theme" | "sections" | "agent" | "add" | "images"
) {
  const titleByTab: Record<typeof tab, string> = {
    project: "Project",
    page: "Page",
    theme: "Theme",
    sections: "Sections",
    agent: "Agent",
    add: "Add blocks",
    images: "Images + Assets",
  };
  const testIdByTab: Record<typeof tab, string> = {
    project: "palette-tab-project",
    page: "palette-tab-page",
    theme: "palette-tab-theme",
    sections: "palette-tab-sections",
    agent: "palette-tab-agent",
    add: "palette-tab-add",
    images: "palette-tab-images",
  };

  const desiredTitle = titleByTab[tab];
  const title = page.getByTestId("palette-active-title");
  if (await title.isVisible().catch(() => false)) {
    const current = (await title.textContent())?.trim();
    if (current === desiredTitle) return;
  }

  await page.getByTestId(testIdByTab[tab]).click();
  await expect(title).toHaveText(desiredTitle);
}

test("project page API requires auth and invalid ids are sanitized", async ({ page }) => {
  await page.goto("/");

  const unauthenticated = await page.request.get("/api/projects/demo/page");
  expect(unauthenticated.status()).toBe(401);
  await expect(unauthenticated.json()).resolves.toEqual({ error: "Unauthorized." });

  const invalidProjectId = await page.request.get("/api/projects/..%2F..%2FREADME/page");
  expect(invalidProjectId.status()).toBe(400);
  const invalidBody = (await invalidProjectId.json()) as { error?: string; stack?: string };
  expect(invalidBody.error).toBe("Invalid projectId.");
  expect(JSON.stringify(invalidBody)).not.toContain("ZodError");
  expect(JSON.stringify(invalidBody)).not.toContain("stack");
});

test("editor can add content, upload image, save and reload", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  await ensurePaletteTab(page, "images");
  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  await expect(page.locator(".imageBlock img")).toHaveCount(1);

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.locator("text=Design. Compose. Publish.")).toBeVisible();
  await expect(page.locator(".imageBlock img")).toHaveCount(1);
});

test("undo/redo works for adding a hero section", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_undo_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await expect(page.getByTestId("preview-item")).toHaveCount(1);

  await ensurePaletteTab(page, "project");
  await page.getByTestId("undo-page").click();
  await expect(page.getByTestId("preview-item")).toHaveCount(0);

  await page.getByTestId("redo-page").click();
  await expect(page.getByTestId("preview-item")).toHaveCount(1);
});

test("keyboard shortcuts undo/redo work (and don't hijack contenteditable)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_undo_keys_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await expect(page.getByTestId("preview-item")).toHaveCount(1);

  await ensurePaletteTab(page, "project");
  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("preview-item")).toHaveCount(0);

  await page.keyboard.press("Control+Shift+Z");
  await expect(page.getByTestId("preview-item")).toHaveCount(1);

  await page.locator('[data-testid="preview-item"][data-component-type="hero"]').click();
  await page.locator(".hero h1").click();
  await page.keyboard.type(" X");

  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("preview-item")).toHaveCount(1);
});

test("page editors moved into palette tabs and inspector stays selection-only", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_palette_refactor_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "page");
  const metadataCard = page.getByTestId("page-metadata-panel");
  await expect(metadataCard.locator("label").filter({ hasText: "Title" })).toBeVisible();
  await expect(metadataCard.locator("label").filter({ hasText: "Description" })).toBeVisible();

  await metadataCard.locator("input").fill("Palette metadata title");
  await metadataCard.locator("textarea").fill("Metadata now lives in the left palette.");

  await ensurePaletteTab(page, "theme");
  await expect(page.getByTestId("theme-panel")).toBeVisible();
  await expect(page.getByTestId("theme-preset")).toBeVisible();
  await expect(page.getByTestId("theme-accent")).toBeVisible();

  await ensurePaletteTab(page, "sections");
  await expect(page.getByTestId("sections-section-card")).toHaveCount(0);
  await expect(page.getByTestId("palette-tab-project")).toBeVisible();
  await expect(page.getByTestId("palette-tab-page")).toBeVisible();
  await expect(page.getByTestId("palette-tab-theme")).toBeVisible();
  await expect(page.getByTestId("palette-tab-sections")).toBeVisible();

  const inspectorPanel = page.getByTestId("inspector-panel");
  await expect(inspectorPanel.getByRole("heading", { name: "Inspector" })).toBeVisible();
  await expect(inspectorPanel).toContainText("Select a section or component to inspect it.");
  await expect(inspectorPanel).not.toContainText("Page metadata");
  await expect(inspectorPanel).not.toContainText("Theme");
  await expect(inspectorPanel).not.toContainText("Remove");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await ensurePaletteTab(page, "page");
  await expect(metadataCard.locator("input")).toHaveValue("Palette metadata title");
  await expect(metadataCard.locator("textarea")).toHaveValue("Metadata now lives in the left palette.");
});

test("palette tab order and small-viewport scrolling remain usable", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_palette_tabs_${Date.now()}`;
  await loadProject(page, projectId);

  const tabIds = await page.getByTestId("palette-tabs").locator("button").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid"))
  );
  expect(tabIds).toEqual([
    "palette-tab-project",
    "palette-tab-page",
    "palette-tab-theme",
    "palette-tab-sections",
    "palette-tab-add",
    "palette-tab-images",
    "palette-tab-agent",
  ]);

  await page.setViewportSize({ width: 1280, height: 320 });
  await page.getByTestId("palette-tab-agent").scrollIntoViewIfNeeded();
  await page.getByTestId("palette-tab-agent").click();
  await expect(page.getByTestId("palette-active-title")).toHaveText("Agent");
});

test("sections can be reordered via drag and drop (Sections tab)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_reorder_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  await ensurePaletteTab(page, "sections");
  const cards = page.getByTestId("sections-section-card");
  await expect(cards).toHaveCount(2);

  // Swap order: drag first section handle onto second.
  const handles = page.getByTestId("sections-section-drag-handle");
  await expect(handles).toHaveCount(2);
  await handles.nth(0).dragTo(cards.nth(1));

  const types = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(types[0]).toBe("rich_text");
  expect(types[1]).toBe("hero");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.getByTestId("preview-item")).toHaveCount(2);
  const typesAfter = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(typesAfter[0]).toBe("rich_text");
  expect(typesAfter[1]).toBe("hero");
});

test("sections can be reordered via drag and drop in Preview", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_preview_section_dnd_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  const handles = page.getByTestId("preview-section-handle");
  const wraps = page.getByTestId("preview-section-wrap");
  await expect(handles).toHaveCount(2);
  await expect(wraps).toHaveCount(2);

  // Move first section after the second by dropping to the bottom half of the target.
  const targetBox = await wraps.nth(1).boundingBox();
  if (!targetBox) throw new Error("Missing section target bounding box");
  await handles.nth(0).dragTo(wraps.nth(1), { targetPosition: { x: Math.max(2, Math.floor(targetBox.width / 2)), y: Math.max(2, Math.floor(targetBox.height - 2)) } });

  const types = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(types[0]).toBe("rich_text");
  expect(types[1]).toBe("hero");
});

test("components can be moved across sections via drag and drop in Preview", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_cross_section_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  const hero = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  const text = page.locator('[data-testid="preview-item"][data-component-type="rich_text"]');
  await hero.dragTo(text);

  await ensurePaletteTab(page, "sections");
  const cards = page.getByTestId("sections-section-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("2 components");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await ensurePaletteTab(page, "sections");
  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("2 components");
});

test("selection follows component when moved across sections in Preview", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_cross_section_selection_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  const hero = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  const text = page.locator('[data-testid="preview-item"][data-component-type="rich_text"]');
  await hero.click();

  await expect(page.locator(".previewItemSelected")).toHaveCount(1);
  await expect(page.locator(".previewItemSelected")).toHaveAttribute("data-component-type", "hero");

  await hero.dragTo(text);

  await expect(page.locator(".previewItemSelected")).toHaveCount(1);
  await expect(page.locator(".previewItemSelected")).toHaveAttribute("data-component-type", "hero");
});

test("components can be moved across sections via Sections list drop", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_structure_cross_section_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  await ensurePaletteTab(page, "sections");
  const cards = page.getByTestId("sections-section-card");
  await expect(cards).toHaveCount(2);

  const hero = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  await hero.click();
  await cards.nth(1).getByRole("button", { name: "Move here" }).click();

  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("2 components");
});

test("components can be reordered via drag and drop within a section (Inspector list)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_preview_reorder_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();

  await ensurePaletteTab(page, "sections");
  const sectionCard = page.getByTestId("sections-section-card").first();
  await sectionCard.getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Form" }).click();

  const text = page.locator('[data-testid="preview-item"][data-component-type="rich_text"]');
  const form = page.locator('[data-testid="preview-item"][data-component-type="contact_form"]');
  await expect(text).toHaveCount(1);
  await expect(form).toHaveCount(1);

  await text.scrollIntoViewIfNeeded();
  await form.scrollIntoViewIfNeeded();

  const rows = page.getByTestId("inspector-component-row");
  await expect(rows).toHaveCount(2);
  const handles = page.getByTestId("inspector-component-drag-handle");
  await expect(handles).toHaveCount(2);
  await handles.nth(1).dragTo(rows.nth(0));

  await expect
    .poll(async () => await page.getByTestId("preview-item").first().getAttribute("data-component-type"))
    .toBe("contact_form");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect
    .poll(async () => await page.getByTestId("preview-item").first().getAttribute("data-component-type"))
    .toBe("contact_form");
});

test("hero can be edited inline in Preview and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_inline_hero_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  await page.locator('[data-testid="preview-item"][data-component-type="hero"]').click();

  const headline = page.locator(".hero h1");
  await headline.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Hello from inline hero");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.locator(".hero h1")).toContainText("Hello from inline hero");
});

test("section style (background + padding) persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_section_style_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await ensurePaletteTab(page, "sections");
  await page.getByTestId("sections-section-card").first().getByRole("button", { name: "Select" }).click();

  await page.getByTestId("section-bg").fill("#ff0000");
  await page.getByTestId("section-padding").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "24");

  const section = page.getByTestId("preview-section").first();
  const bg = await section.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 0, 0)");
  const pad = await section.evaluate((el) => getComputedStyle(el).paddingTop);
  expect(pad).toBe("24px");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  const bgAfter = await section.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgAfter).toBe("rgb(255, 0, 0)");
  const padAfter = await section.evaluate((el) => getComputedStyle(el).paddingTop);
  expect(padAfter).toBe("24px");
});

test("section visibility hides in Preview and export", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_section_visible_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  await ensurePaletteTab(page, "sections");
  await page.getByTestId("sections-section-card").first().getByRole("button", { name: "Select" }).click();
  await page.getByTestId("section-visible").uncheck();

  await expect(page.locator("text=Design. Compose. Publish.")).toHaveCount(0);
  await expect(page.getByTestId("preview-section")).toHaveCount(1);

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.locator("text=Design. Compose. Publish.")).toHaveCount(0);
  await expect(page.getByTestId("preview-section")).toHaveCount(1);

  await page.getByTestId("export-site").click();
  await expect(page.getByTestId("export-output-dir")).toHaveText(`projects/${projectId}/output`);

  const htmlRes = await page.request.get(`/projects/${projectId}/output/index.html`);
  expect(htmlRes.ok()).toBeTruthy();
  const html = await htmlRes.text();
  expect(html).not.toContain("Design. Compose. Publish.");
  expect(html).toContain("Write something compelling.");
});

test("section label can be renamed from Sections and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_section_label_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  await ensurePaletteTab(page, "sections");
  const sectionCard = page.getByTestId("sections-section-card").first();
  await sectionCard.getByTestId("section-label").dblclick();
  await page.getByTestId("section-label-input").fill("Above the fold");
  await page.getByTestId("section-label-input").press("Enter");
  await expect(sectionCard).toContainText("Above the fold");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await ensurePaletteTab(page, "sections");
  await expect(page.getByTestId("sections-section-card").first()).toContainText("Above the fold");
});

test("preview drag-and-drop uses before/after drop position", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_preview_drop_pos_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();

  await ensurePaletteTab(page, "sections");
  const sectionCard = page.getByTestId("sections-section-card").first();
  await sectionCard.getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Form" }).click();

  const text = page.locator('[data-testid="preview-item"][data-component-type="rich_text"]');
  const form = page.locator('[data-testid="preview-item"][data-component-type="contact_form"]');
  await expect(text).toHaveCount(1);
  await expect(form).toHaveCount(1);

  const box = await form.boundingBox();
  if (!box) throw new Error("Missing form bounding box");

  // Drop in bottom half => insert after.
  await text.dragTo(form, {
    targetPosition: { x: Math.max(2, Math.floor(box.width / 2)), y: Math.max(2, Math.floor(box.height - 2)) },
  });

  const types = await page.getByTestId("preview-item").evaluateAll((els) => els.map((el) => el.getAttribute("data-component-type")));
  expect(types[0]).toBe("contact_form");
  expect(types[1]).toBe("rich_text");

  const box2 = await form.boundingBox();
  if (!box2) throw new Error("Missing form bounding box after reorder");

  // Drop in top half => insert before.
  await text.dragTo(form, { targetPosition: { x: Math.max(2, Math.floor(box2.width / 2)), y: 2 } });
  const types2 = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(types2[0]).toBe("rich_text");
  expect(types2[1]).toBe("contact_form");

  const dropzone = page.getByTestId("preview-dropzone").first();
  await text.dragTo(dropzone);
  const types3 = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(types3[0]).toBe("contact_form");
  expect(types3[1]).toBe("rich_text");
});

test("can duplicate and delete a component from Preview toolbar", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_toolbar_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  const heroItem = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  await heroItem.click();

  await page.getByTestId("preview-duplicate").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(2);

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(2);

  await heroItem.first().click();
  await page.getByTestId("preview-delete").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(1);

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(1);
});

test("rich text can be edited inline in Preview and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_inline_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();

  await page.locator('[data-testid="preview-item"][data-component-type="rich_text"]').click();

  const editable = page.locator(".richTextEditable");
  await expect(editable).toBeVisible();
  await editable.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Hello inline editor");

  // Blur to trigger sanitization + model update.
  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.locator(".richText")).toContainText("Hello inline editor");
});

test("rich text formatting toolbar can bold selection and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_rich_toolbar_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();

  await page.locator('[data-testid="preview-item"][data-component-type="rich_text"]').click();
  await expect(page.getByTestId("richtext-toolbar")).toBeVisible();

  const editable = page.locator(".richTextEditable");
  await editable.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Hello world");

  // Select "world" and apply bold.
  await editable.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current.textContent?.includes("world")) {
        textNode = current as Text;
        break;
      }
    }
    if (!textNode) throw new Error("Missing text node containing 'world'");

    const content = textNode.textContent ?? "";
    const start = content.indexOf("world");
    if (start < 0) throw new Error("Missing 'world' in rich text content");

    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + "world".length);

    const selection = window.getSelection();
    if (!selection) throw new Error("Missing window selection");
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.getByTestId("richtext-bold").click();

  // Blur + persist.
  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  const pageJson = (await fetchPageJson(page, projectId)) as {
    sections: Array<{ components: Array<{ type: string; html?: string }> }>;
  };
  const html = pageJson.sections[0]?.components[0]?.html ?? "";
  expect(html).toContain("<strong>");
  expect(html).toContain("world");
});

test("image can be replaced from Preview toolbar (uploads new asset)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_img_replace_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "images");
  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  const img = page.locator(".imageBlock img");
  await expect(img).toHaveCount(1);
  const before = await img.getAttribute("src");
  if (!before) throw new Error("missing img src");

  await page.locator('[data-testid="preview-item"][data-component-type="image"]').click();
  await page.getByTestId("preview-image-replace-input").setInputFiles({
    name: "tiny2.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  await expect(img).not.toHaveAttribute("src", before);
  const afterReplace = await img.getAttribute("src");
  if (!afterReplace) throw new Error("missing img src after replace");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect(page.locator(".imageBlock img")).toHaveCount(1);
  await expect(page.locator(".imageBlock img")).toHaveAttribute("src", afterReplace);
});

test("asset file can be replaced (keeps same asset id)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_asset_replace_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "images");
  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  await expect(page.locator(".imageBlock img")).toHaveCount(1);
  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await ensurePaletteTab(page, "images");

  type RawImageAsset = { type: "image"; id: string; width: number | null; height: number | null; filename: string };
  type RawPage = {
    assets?: RawImageAsset[];
    sections?: Array<{ components?: Array<{ type: string; assetId?: string }> }>;
  };

  const pageBefore = (await fetchPageJson(page, projectId)) as RawPage;
  const imgAssetBefore = (pageBefore.assets ?? []).find((a) => a.type === "image");
  if (!imgAssetBefore) throw new Error("missing image asset before replace");
  expect(imgAssetBefore.width).toBe(1);
  expect(imgAssetBefore.height).toBe(1);

  await page.getByTestId("asset-replace-input").first().setInputFiles({
    name: "bigger.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_2X2_BASE64, "base64"),
  });

  await expect
    .poll(async () => {
      const p = (await fetchPageJson(page, projectId)) as RawPage;
      const a = (p.assets ?? []).find((x) => x.type === "image" && x.id === imgAssetBefore.id);
      return a ? { w: a.width, h: a.height } : null;
    })
    .toEqual({ w: 2, h: 2 });

  const pageAfter = (await fetchPageJson(page, projectId)) as RawPage;
  const imgAssetAfter = (pageAfter.assets ?? []).find((a) => a.type === "image" && a.id === imgAssetBefore.id);
  if (!imgAssetAfter) throw new Error("missing image asset after replace");
  expect(imgAssetAfter.id).toBe(imgAssetBefore.id);
  expect(imgAssetAfter.filename).toBe(imgAssetBefore.filename);

  const imageComponent = (pageAfter.sections ?? []).flatMap((s) => s.components ?? []).find((c) => c.type === "image");
  if (!imageComponent) throw new Error("missing image component after replace");
  expect(imageComponent.assetId).toBe(imgAssetBefore.id);
});

test("image style (radius + max width) persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_img_style_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "images");
  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  const imageItem = page.locator('[data-testid="preview-item"][data-component-type="image"]');
  await imageItem.click();

  await page.getByTestId("image-style-maxwidth").selectOption("480");
  await page.getByTestId("image-style-radius").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "20");

  const block = page.locator(".imageBlock").first();
  const maxWidth = await block.evaluate((el) => getComputedStyle(el).maxWidth);
  expect(maxWidth).toBe("480px");
  const radius = await page.locator(".imageBlock img").first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radius).toBe("20px");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await page.locator('[data-testid="preview-item"][data-component-type="image"]').click();
  const maxWidthAfter = await block.evaluate((el) => getComputedStyle(el).maxWidth);
  expect(maxWidthAfter).toBe("480px");
  const radiusAfter = await page.locator(".imageBlock img").first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radiusAfter).toBe("20px");
});

test("page theme affects Preview and export CSS vars", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_theme_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  // Change accent color and verify Preview reflects it.
  await ensurePaletteTab(page, "theme");
  await page.getByTestId("theme-accent").fill("#ff0000");
  const cta = page.locator(".cta").first();
  const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 0, 0)");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("export-site").click();
  await expect(page.getByTestId("export-output-dir")).toHaveText(`projects/${projectId}/output`);

  const cssRes = await page.request.get(`/projects/${projectId}/output/styles.css`);
  expect(cssRes.ok()).toBeTruthy();
  const css = await cssRes.text();
  expect(css).toContain("--site-accent:#ff0000;");
});

test("exported HTML includes section + image styles", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_export_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  await ensurePaletteTab(page, "images");
  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  await ensurePaletteTab(page, "sections");
  await page.getByTestId("sections-section-card").first().getByRole("button", { name: "Select" }).click();
  await page.getByTestId("section-bg").fill("#ff0000");
  await page.getByTestId("section-padding").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "24");

  const imageItem = page.locator('[data-testid="preview-item"][data-component-type="image"]');
  await imageItem.click();
  await page.getByTestId("image-style-maxwidth").selectOption("480");
  await page.getByTestId("image-style-radius").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "20");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await expect(page.getByTestId("save-page")).toBeEnabled();
  await expect(page.getByTestId("save-page")).toHaveText("Save page.json");
  await page.getByTestId("export-site").click();

  await expect(page.getByTestId("export-output-dir")).toHaveText(`projects/${projectId}/output`);

  const htmlRes = await page.request.get(`/projects/${projectId}/output/index.html`);
  expect(htmlRes.ok()).toBeTruthy();
  const html = await htmlRes.text();
  expect(html).toContain('background:#ff0000;');
  expect(html).toContain('padding:24px;');
  expect(html).toContain('max-width:480px;');
  expect(html).toContain('border-radius:20px;');
});

test("exported HTML includes component box styles", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_export_component_styles_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  // Add a form into the first section so we have hero + rich_text + contact_form.
  await ensurePaletteTab(page, "sections");
  await page.getByTestId("sections-section-card").first().getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Form" }).click();

  const heroItem = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  const textItem = page.locator('[data-testid="preview-item"][data-component-type="rich_text"]');
  const formItem = page.locator('[data-testid="preview-item"][data-component-type="contact_form"]');
  await expect(heroItem).toHaveCount(1);
  await expect(textItem).toHaveCount(1);
  await expect(formItem).toHaveCount(1);

  await heroItem.click();
  await page.getByTestId("component-style-align").selectOption("center");
  await page.getByTestId("component-style-maxwidth").selectOption("480");
  await page.getByTestId("component-style-padding").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "40");
  await page.getByTestId("component-style-bg").fill("#00ff00");

  await textItem.click();
  await page.getByTestId("component-style-align").selectOption("right");
  await page.getByTestId("component-style-maxwidth").selectOption("720");

  await formItem.click();
  await page.getByTestId("component-style-align").selectOption("center");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await expect(page.getByTestId("save-page")).toBeEnabled();
  await page.getByTestId("export-site").click();

  await expect(page.getByTestId("export-output-dir")).toHaveText(`projects/${projectId}/output`);

  const htmlRes = await page.request.get(`/projects/${projectId}/output/index.html`);
  expect(htmlRes.ok()).toBeTruthy();
  const html = await htmlRes.text();
  expect(html).toContain("max-width:480px;");
  expect(html).toContain("text-align:center;");
  expect(html).toContain("padding:40px;");
  expect(html).toContain("background-color:#00ff00;");
  expect(html).toContain("max-width:720px;");
  expect(html).toContain("justify-self:center;");
});

test("exported HTML includes gradients and button styles", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_export_gradients_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  // Add a form into the first section so we have contact_form button styling too.
  await ensurePaletteTab(page, "sections");
  await page.getByTestId("sections-section-card").first().getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Form" }).click();

  // Section gradient background
  await page.getByTestId("section-bg-gradient-enabled").check();
  await page.getByTestId("section-bg-gradient-from").fill("#111111");
  await page.getByTestId("section-bg-gradient-to").fill("#222222");
  await page.getByTestId("section-bg-gradient-angle").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "90");

  // Component gradient + hero CTA styles
  const heroItem = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  await heroItem.click();
  await page.getByTestId("component-style-bg-gradient-enabled").check();
  await page.getByTestId("component-style-bg-gradient-from").fill("#abcdef");
  await page.getByTestId("component-style-bg-gradient-to").fill("#123456");
  await page.getByTestId("component-style-bg-gradient-angle").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "180");

  await page.getByTestId("hero-cta-variant").selectOption("outline");
  await page.getByTestId("hero-cta-text").fill("#ff0000");
  await page.getByTestId("hero-cta-border").fill("#00ff00");
  await page.getByTestId("hero-cta-radius").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "18");

  // Contact form submit button styles
  const formItem = page.locator('[data-testid="preview-item"][data-component-type="contact_form"]');
  await formItem.click();
  await page.getByTestId("contact-submit-bg").fill("#0000ff");
  await page.getByTestId("contact-submit-radius").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "6");

  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await page.getByTestId("export-site").click();

  await expect(page.getByTestId("export-output-dir")).toHaveText(`projects/${projectId}/output`);

  const htmlRes = await page.request.get(`/projects/${projectId}/output/index.html`);
  expect(htmlRes.ok()).toBeTruthy();
  const html = await htmlRes.text();
  expect(html).toContain("background:linear-gradient(90deg, #111111, #222222);");
  expect(html).toContain("background:linear-gradient(180deg, #abcdef, #123456);");
  expect(html).toContain("background:transparent;");
  expect(html).toContain("color:#ff0000;");
  expect(html).toContain("border-color:#00ff00;");
  expect(html).toContain("background:#0000ff;");
  expect(html).toContain("border-radius:6px;");
});

test("can capture a preview screenshot (server Playwright required)", async ({ page }) => {
  test.skip(!process.env.CAC_E2E_SCREENSHOT, "Set CAC_E2E_SCREENSHOT=1 to enable.");

  await page.goto("/");
  const projectId = `e2e_shot_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  await ensurePaletteTab(page, "project");
  await page.getByTestId("capture-screenshot").click();

  await expect(page.getByTestId("preview-screenshot")).toBeVisible();
});

test("agent can apply a simple edit (requires OPENAI_API_KEY on server)", async ({ page }) => {
  test.skip(!process.env.CAC_E2E_AGENT, "Set CAC_E2E_AGENT=1 to enable.");

  await page.goto("/");
  const projectId = `e2e_agent_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await expect(page.locator(".hero h1")).toBeVisible();

  const headline = `E2E Agent Headline ${Date.now()}`;

  await ensurePaletteTab(page, "agent");
  await page.getByTestId("agent-run-mode").selectOption("apply");
  await expect(page.getByTestId("agent-run")).toHaveText("Run agent");
  await page.getByTestId("agent-text").fill(
    `Set the hero headline exactly to "${headline}". Do not change anything else.`
  );
  await page.getByTestId("agent-run").click();

  await expect(page.locator(".hero h1")).toContainText(headline, { timeout: 60_000 });
});
