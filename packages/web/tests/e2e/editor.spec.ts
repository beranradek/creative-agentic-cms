import { expect, test } from "@playwright/test";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Gd0sAAAAASUVORK5CYII=";
const PNG_2X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=";
const PNG_2X2_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwHwyBNBAw/AcAR8oI+ItOQ4UAAAAASUVORK5CYII=";

async function fetchPageJson(page: import("@playwright/test").Page, projectId: string) {
  return await page.evaluate(async (pid) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/page`);
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
  tab: "project" | "agent" | "add" | "images"
) {
  const titleByTab: Record<typeof tab, string> = {
    project: "Project",
    agent: "Agent",
    add: "Add blocks",
    images: "Images + Assets",
  };
  const testIdByTab: Record<typeof tab, string> = {
    project: "palette-tab-project",
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

async function saveAndWait(page: import("@playwright/test").Page) {
  await ensurePaletteTab(page, "project");
  await page.getByTestId("save-page").click();
  await expect(page.getByTestId("save-status")).toHaveText("saved");
}

async function saveAndReload(page: import("@playwright/test").Page) {
  await saveAndWait(page);
  await page.getByTestId("reload-page").click();
  await expect(page.getByTestId("load-state")).toHaveText("ready");
}

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

  await saveAndReload(page);

  await expect(page.locator("text=Design. Compose. Publish.")).toBeVisible();
  await expect(page.locator(".imageBlock img")).toHaveCount(1);
});

test("editor can create placeholder image (SVG), save and reload", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_placeholder_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "images");
  await page.getByTestId("placeholder-size").selectOption("hero");
  await page.getByTestId("placeholder-text").fill("Product screenshot");
  await page.getByTestId("placeholder-create").click();

  await expect(page.locator(".imageBlock img")).toHaveCount(1);

  await saveAndReload(page);
  await expect(page.locator(".imageBlock img")).toHaveCount(1);

  const json = (await fetchPageJson(page, projectId)) as {
    assets?: Array<{ mimeType?: string; filename?: string; width?: number | null; height?: number | null }>;
  };
  const assets = json.assets ?? [];
  expect(
    assets.some(
      (a) =>
        a.mimeType === "image/svg+xml" &&
        typeof a.filename === "string" &&
        a.filename.endsWith(".svg") &&
        a.width === 1200 &&
        a.height === 630
    )
  ).toBe(true);
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

test("sections can be reordered via drag and drop (Structure panel)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_reorder_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  const cards = page.getByTestId("structure-section-card");
  await expect(cards).toHaveCount(2);

  // Swap order: drag first section handle onto second.
  const handles = page.getByTestId("structure-section-drag-handle");
  await expect(handles).toHaveCount(2);
  await handles.nth(0).dragTo(cards.nth(1));

  const types = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(types[0]).toBe("rich_text");
  expect(types[1]).toBe("hero");

  await saveAndReload(page);

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

test("server-rendered preview can be opened (renderer parity spot-check)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_server_preview_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  await page.getByTestId("preview-renderer-server").click();
  const frame = page.frameLocator('[data-testid="server-preview-frame"]');
  await expect(frame.locator("text=Design. Compose. Publish.")).toBeVisible();

  await page.getByTestId("preview-renderer-react").click();
  await expect(page.locator("text=Design. Compose. Publish.")).toBeVisible();
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

  const cards = page.getByTestId("structure-section-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("2 components");

  await saveAndReload(page);
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

test("components can be moved across sections via Structure list drop", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_structure_cross_section_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  const cards = page.getByTestId("structure-section-card");
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

  const sectionCard = page.getByTestId("structure-section-card").first();
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

  await saveAndReload(page);
  await expect
    .poll(async () => await page.getByTestId("preview-item").first().getAttribute("data-component-type"))
    .toBe("contact_form");
});

test("inspector supports multi-select (shift) and bulk remove", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_inspector_multiselect_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();

  const sectionCard = page.getByTestId("structure-section-card").first();
  await sectionCard.getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Form" }).click();
  await page.getByRole("button", { name: "+ Hero" }).click();

  const rows = page.getByTestId("inspector-component-row");
  const selects = page.getByTestId("inspector-component-select");
  await expect(rows).toHaveCount(3);
  await expect(selects).toHaveCount(3);

  await selects.nth(0).click();
  await page.keyboard.down("Shift");
  await selects.nth(2).click();
  await page.keyboard.up("Shift");

  await expect(rows.nth(0)).toHaveAttribute("data-selected", "true");
  await expect(rows.nth(1)).toHaveAttribute("data-selected", "true");
  await expect(rows.nth(2)).toHaveAttribute("data-selected", "true");

  await rows.nth(1).getByRole("button", { name: "Remove" }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId("preview-item")).toHaveCount(0);

  await saveAndReload(page);
  await expect(page.getByTestId("preview-item")).toHaveCount(0);
});

test("structure Move here moves multi-selected components", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_structure_move_multiselect_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();
  await page.getByTestId("add-text").click();

  const cards = page.getByTestId("structure-section-card");
  await expect(cards).toHaveCount(2);

  await cards.nth(0).getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Form" }).click();
  await page.getByRole("button", { name: "+ Hero" }).click();

  const selects = page.getByTestId("inspector-component-select");
  await expect(selects).toHaveCount(3);
  await selects.nth(0).click();
  await page.keyboard.down("Shift");
  await selects.nth(2).click();
  await page.keyboard.up("Shift");

  await cards.nth(1).getByRole("button", { name: "Move here" }).click();

  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("4 components");

  await saveAndReload(page);
  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("4 components");
});

test("structure dropzone moves multi-selected components as a group", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_structure_drop_multiselect_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();
  await page.getByTestId("add-text").click();

  const cards = page.getByTestId("structure-section-card");
  await expect(cards).toHaveCount(2);

  await cards.nth(0).getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Form" }).click();
  await page.getByRole("button", { name: "+ Hero" }).click();

  const selects = page.getByTestId("inspector-component-select");
  await expect(selects).toHaveCount(3);
  await selects.nth(0).click();
  await page.keyboard.down("Shift");
  await selects.nth(2).click();
  await page.keyboard.up("Shift");

  const dropzone = cards.nth(1).getByTestId("structure-component-dropzone");
  const hero = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  await expect(hero).toHaveCount(1);
  await hero.dragTo(dropzone, { force: true });

  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("4 components");
});

test("preview dropzone moves multi-selected components as a group", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_preview_drop_multiselect_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();
  await page.getByTestId("add-text").click();

  const cards = page.getByTestId("structure-section-card");
  await expect(cards).toHaveCount(2);

  await cards.nth(0).getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Form" }).click();
  await page.getByRole("button", { name: "+ Hero" }).click();

  const selects = page.getByTestId("inspector-component-select");
  await expect(selects).toHaveCount(3);
  await selects.nth(0).click();
  await page.keyboard.down("Shift");
  await selects.nth(2).click();
  await page.keyboard.up("Shift");

  const toSectionId = await cards.nth(1).getAttribute("data-section-id");
  const dropzone = toSectionId
    ? page.locator(`[data-testid="preview-dropzone"][data-section-id="${toSectionId}"]`)
    : page.locator('[data-testid="preview-dropzone"][data-section-id]').nth(1);
  const hero = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  await expect(hero).toHaveCount(1);
  await dropzone.scrollIntoViewIfNeeded();
  await hero.scrollIntoViewIfNeeded();
  await hero.dragTo(dropzone, { force: true });

  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("4 components");

  await saveAndReload(page);
  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("4 components");
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

  await saveAndReload(page);

  await expect(page.locator(".hero h1")).toContainText("Hello from inline hero");
});

test("section style (background + padding) persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_section_style_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("structure-section-card").first().getByRole("button", { name: "Select" }).click();

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

  await saveAndReload(page);

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

  await page.getByTestId("structure-section-card").first().getByRole("button", { name: "Select" }).click();
  await page.getByTestId("section-visible").uncheck();

  await expect(page.locator("text=Design. Compose. Publish.")).toHaveCount(0);
  await expect(page.getByTestId("preview-section")).toHaveCount(1);

  await saveAndReload(page);

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

test("section label can be renamed from Structure and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_section_label_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();

  const sectionCard = page.getByTestId("structure-section-card").first();
  await sectionCard.getByTestId("section-label").dblclick();
  await page.getByTestId("section-label-input").fill("Above the fold");
  await page.getByTestId("section-label-input").press("Enter");
  await expect(sectionCard).toContainText("Above the fold");

  await saveAndReload(page);

  await expect(page.getByTestId("structure-section-card").first()).toContainText("Above the fold");
});

test("preview drag-and-drop uses before/after drop position", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_preview_drop_pos_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-text").click();

  const sectionCard = page.getByTestId("structure-section-card").first();
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

  await saveAndReload(page);
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(2);

  await heroItem.first().click();
  await page.getByTestId("preview-delete").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(1);

  await saveAndReload(page);
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
  await saveAndReload(page);

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
  let applied = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await editable.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("Hello world");

    // Select "world" via DOM ranges (keyboard selection is flaky in CI/headless).
    await editable.evaluate((el) => {
      const p = el.querySelector("p");
      const textNode = p?.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) throw new Error("Missing rich text node");
      const text = textNode.textContent ?? "";
      const start = text.lastIndexOf("world");
      if (start < 0) throw new Error("Missing 'world' text");
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + "world".length);
      const sel = window.getSelection();
      if (!sel) throw new Error("Missing selection");
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.getByTestId("richtext-bold").click();

    const htmlNow = await editable.evaluate((el) => el.innerHTML);
    if (/<(strong|b)>\s*world\s*<\/(strong|b)>/i.test(htmlNow)) {
      applied = true;
      break;
    }
  }
  expect(applied).toBe(true);

  // Blur + persist.
  await saveAndReload(page);

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

  await saveAndReload(page);
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
  await saveAndWait(page);
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

test("image editor supports crop resize handles + keyboard nudges", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_img_edit_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "images");
  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  await expect(page.getByTestId("asset-edit-btn").first()).toBeVisible();
  await page.getByTestId("asset-edit-btn").first().click();

  await expect(page.getByTestId("image-editor-viewport")).toBeVisible();
  await expect(page.getByTestId("image-editor-cropbox")).toBeVisible();

  await page.getByTestId("image-editor-viewport").click({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId("image-editor-viewport")).toBeFocused();

  // Zoom in a bit to ensure there's enough slack for panning.
  await page.keyboard.press("=");
  await page.keyboard.press("=");

  const img = page.getByTestId("image-editor-image");
  const beforeOffset = await img.evaluate((el) => {
    const t = (el as HTMLImageElement).style.transform || "";
    const m = t.match(/translate\(-50%, -50%\)\s*translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
    if (!m) return { x: 0, y: 0 };
    return { x: Number(m[1]), y: Number(m[2]) };
  });

  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Shift");

  const afterOffset = await img.evaluate((el) => {
    const t = (el as HTMLImageElement).style.transform || "";
    const m = t.match(/translate\(-50%, -50%\)\s*translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
    if (!m) return { x: 0, y: 0 };
    return { x: Number(m[1]), y: Number(m[2]) };
  });

  expect(afterOffset.y).toBeGreaterThan(beforeOffset.y);

  const cropScale = page.getByTestId("image-editor-cropscale");
  const beforeScale = Number(await cropScale.inputValue());

  const handle = page.getByTestId("image-editor-crophandle-se");
  const hb = await handle.boundingBox();
  if (!hb) throw new Error("Missing crop handle bounding box");
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 80, hb.y - 80);
  await page.mouse.up();

  const afterScale = Number(await cropScale.inputValue());
  expect(afterScale).toBeLessThan(beforeScale);
});

test("image editor rotate swaps output aspect", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_img_rotate_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "images");
  await page.getByTestId("upload-image").setInputFiles({
    name: "wide.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_2X1_BASE64, "base64"),
  });

  await expect(page.getByTestId("asset-edit-btn").first()).toBeVisible();
  await saveAndWait(page);
  await ensurePaletteTab(page, "images");
  await expect(page.getByTestId("asset-edit-btn").first()).toBeVisible();

  await page.getByTestId("asset-edit-btn").first().click();
  await expect(page.getByTestId("image-editor-viewport")).toBeVisible();

  await page.getByTestId("image-editor-rotate-right").click();
  await page.getByTestId("image-editor-aspect").selectOption("original");

  await page.getByRole("button", { name: "Save as new asset" }).click();
  await expect(page.locator('[data-testid="image-editor-viewport"]')).toHaveCount(0);
  await saveAndWait(page);

  await expect
    .poll(async () => {
      const p = (await fetchPageJson(page, projectId)) as { assets?: Array<{ type: string; width: number | null; height: number | null }> };
      const images = (p.assets ?? []).filter((a) => a.type === "image");
      const rotated = images.find((a) => typeof a.width === "number" && typeof a.height === "number" && a.width > 0 && a.height > 0 && a.width < a.height);
      return rotated ? { w: rotated.width, h: rotated.height } : null;
    })
    .not.toBeNull();
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

  await page.getByTestId("structure-section-card").first().getByRole("button", { name: "Select" }).click();
  const imageRow = page.locator('[data-testid="inspector-component-row"][data-component-type="image"]');
  await expect(imageRow).toBeVisible();
  await imageRow.getByRole("button", { name: "image" }).click();
  await expect(page.getByTestId("image-style-maxwidth")).toBeVisible();

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

  await saveAndReload(page);

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
  await page.getByTestId("theme-accent").fill("#ff0000");
  const cta = page.locator(".cta").first();
  const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 0, 0)");

  await saveAndWait(page);
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
  await page.getByTestId("add-divider").click();

  await ensurePaletteTab(page, "images");
  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  await page.getByTestId("structure-section-card").first().getByRole("button", { name: "Select" }).click();
  await page.getByTestId("section-bg").fill("#ff0000");
  await page.getByTestId("section-padding").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "24");

  const sectionCards = page.getByTestId("structure-section-card");
  await expect(sectionCards).toHaveCount(3);
  await sectionCards.nth(2).getByRole("button", { name: "Select" }).click();

  const imageRow = page.locator('[data-testid="inspector-component-row"][data-component-type="image"]');
  await expect(imageRow).toBeVisible();
  await imageRow.getByRole("button", { name: "image" }).click();
  await expect(page.getByTestId("image-style-maxwidth")).toBeVisible();
  await page.getByTestId("image-style-maxwidth").selectOption("480");
  await page.getByTestId("image-style-radius").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "20");

  await saveAndWait(page);
  await page.getByTestId("export-site").click();

  await expect(page.getByTestId("export-output-dir")).toHaveText(`projects/${projectId}/output`);

  const htmlRes = await page.request.get(`/projects/${projectId}/output/index.html`);
  expect(htmlRes.ok()).toBeTruthy();
  const html = await htmlRes.text();
  expect(html).toContain('background:#ff0000;');
  expect(html).toContain('padding:24px;');
  expect(html).toContain('max-width:480px;');
  expect(html).toContain('border-radius:20px;');
  expect(html).toContain('class="divider"');
});

test("exported HTML includes component box styles", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_export_component_styles_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  // Add a form into the first section so we have hero + rich_text + contact_form.
  await page.getByTestId("structure-section-card").first().getByRole("button", { name: "Select" }).click();
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

  await saveAndWait(page);
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
  await page.getByTestId("structure-section-card").first().getByRole("button", { name: "Select" }).click();
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

  await saveAndWait(page);
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

test("exported HTML includes divider styles", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_export_divider_${Date.now()}`;
  await loadProject(page, projectId);

  await ensurePaletteTab(page, "add");
  await page.getByTestId("add-divider").click();

  const dividerItem = page.locator('[data-testid="preview-item"][data-component-type="divider"]');
  await expect(dividerItem).toHaveCount(1);
  await dividerItem.click();

  await page.getByTestId("divider-style-thickness").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "6");
  await page.getByTestId("divider-style-color").fill("#ff0000");
  await page.getByTestId("divider-style-opacity").evaluate((el, value) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Missing HTMLInputElement.value setter");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, "80");

  await saveAndWait(page);
  await page.getByTestId("export-site").click();
  await expect(page.getByTestId("export-output-dir")).toHaveText(`projects/${projectId}/output`);

  const htmlRes = await page.request.get(`/projects/${projectId}/output/index.html`);
  expect(htmlRes.ok()).toBeTruthy();
  const html = await htmlRes.text();
  expect(html).toContain('class="divider"');
  expect(html).toContain("height:6px;");
  expect(html).toContain("background:#ff0000;");
  expect(html).toContain("opacity:0.8;");
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
