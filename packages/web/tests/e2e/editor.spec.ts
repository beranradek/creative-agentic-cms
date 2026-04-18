import { expect, test } from "@playwright/test";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Gd0sAAAAASUVORK5CYII=";

async function loadProject(page: import("@playwright/test").Page, projectId: string) {
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();
  await expect(page.getByTestId("loaded-project")).toHaveText(`loaded: ${projectId}`);
  await expect(page.getByTestId("load-state")).toHaveText("ready");
}

test("editor can add content, upload image, save and reload", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_${Date.now()}`;
  await loadProject(page, projectId);

  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  await expect(page.locator(".imageBlock img")).toHaveCount(1);

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.locator("text=Design. Compose. Publish.")).toBeVisible();
  await expect(page.locator(".imageBlock img")).toHaveCount(1);
});

test("sections can be reordered via drag and drop (Structure panel)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_reorder_${Date.now()}`;
  await loadProject(page, projectId);

  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  const cards = page.getByTestId("structure-section-card");
  await expect(cards).toHaveCount(2);

  // Swap order: move first card onto second.
  await cards.nth(0).dragTo(cards.nth(1));

  const types = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(types[0]).toBe("rich_text");
  expect(types[1]).toBe("hero");

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.getByTestId("preview-item")).toHaveCount(2);
  const typesAfter = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(typesAfter[0]).toBe("rich_text");
  expect(typesAfter[1]).toBe("hero");
});

test("components can be moved across sections via drag and drop in Preview", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_cross_section_${Date.now()}`;
  await loadProject(page, projectId);

  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  const hero = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  const text = page.locator('[data-testid="preview-item"][data-component-type="rich_text"]');
  await hero.dragTo(text);

  const cards = page.getByTestId("structure-section-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("2 components");

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("2 components");
});

test("components can be reordered via drag and drop in Preview (within a section)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_preview_reorder_${Date.now()}`;
  await loadProject(page, projectId);

  await page.getByTestId("add-hero").click();

  const sectionCard = page.getByTestId("structure-section-card").first();
  await sectionCard.getByRole("button", { name: "Select" }).click();
  await page.getByRole("button", { name: "+ Text" }).click();

  const hero = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  const text = page.locator('[data-testid="preview-item"][data-component-type="rich_text"]');
  await expect(hero).toHaveCount(1);
  await expect(text).toHaveCount(1);

  await text.dragTo(hero);

  const types = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(types[0]).toBe("rich_text");

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  const typesAfter = await page.getByTestId("preview-item").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-component-type"))
  );
  expect(typesAfter[0]).toBe("rich_text");
});

test("hero can be edited inline in Preview and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_inline_hero_${Date.now()}`;
  await loadProject(page, projectId);

  await page.getByTestId("add-hero").click();

  await page.locator('[data-testid="preview-item"][data-component-type="hero"]').click();

  const headline = page.locator(".hero h1");
  await headline.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Hello from inline hero");

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.locator(".hero h1")).toContainText("Hello from inline hero");
});

test("section style (background + padding) persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_section_style_${Date.now()}`;
  await loadProject(page, projectId);

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

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  const bgAfter = await section.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bgAfter).toBe("rgb(255, 0, 0)");
  const padAfter = await section.evaluate((el) => getComputedStyle(el).paddingTop);
  expect(padAfter).toBe("24px");
});

test("can duplicate and delete a component from Preview toolbar", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_toolbar_${Date.now()}`;
  await loadProject(page, projectId);

  await page.getByTestId("add-hero").click();

  const heroItem = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  await heroItem.click();

  await page.getByTestId("preview-duplicate").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(2);

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(2);

  await heroItem.first().click();
  await page.getByTestId("preview-delete").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(1);

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(1);
});

test("rich text can be edited inline in Preview and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_inline_${Date.now()}`;
  await loadProject(page, projectId);

  await page.getByTestId("add-text").click();

  await page.locator('[data-testid="preview-item"][data-component-type="rich_text"]').click();

  const editable = page.locator(".richTextEditable");
  await expect(editable).toBeVisible();
  await editable.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Hello inline editor");

  // Blur to trigger sanitization + model update.
  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.locator(".richText")).toContainText("Hello inline editor");
});

test("image can be replaced from Preview toolbar (uploads new asset)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_img_replace_${Date.now()}`;
  await loadProject(page, projectId);

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

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect(page.locator(".imageBlock img")).toHaveCount(1);
  await expect(page.locator(".imageBlock img")).toHaveAttribute("src", afterReplace);
});

test("image style (radius + max width) persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_img_style_${Date.now()}`;
  await loadProject(page, projectId);

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

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await page.locator('[data-testid="preview-item"][data-component-type="image"]').click();
  const maxWidthAfter = await block.evaluate((el) => getComputedStyle(el).maxWidth);
  expect(maxWidthAfter).toBe("480px");
  const radiusAfter = await page.locator(".imageBlock img").first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  expect(radiusAfter).toBe("20px");
});

test("can capture a preview screenshot (server Playwright required)", async ({ page }) => {
  test.skip(!process.env.CAC_E2E_SCREENSHOT, "Set CAC_E2E_SCREENSHOT=1 to enable.");

  await page.goto("/");
  const projectId = `e2e_shot_${Date.now()}`;
  await loadProject(page, projectId);

  await page.getByTestId("add-hero").click();
  await page.getByTestId("capture-screenshot").click();

  await expect(page.getByTestId("preview-screenshot")).toBeVisible();
});
