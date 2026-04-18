import { expect, test } from "@playwright/test";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Gd0sAAAAASUVORK5CYII=";

test("editor can add content, upload image, save and reload", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_${Date.now()}`;
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  await page.getByTestId("upload-image").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1X1_BASE64, "base64"),
  });

  await expect(page.locator("img")).toHaveCount(1);

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();

  await expect(page.locator("text=Design. Compose. Publish.")).toBeVisible();
  await expect(page.locator("img")).toHaveCount(1);
});

test("sections can be reordered via drag and drop (Structure panel)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_reorder_${Date.now()}`;
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

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
});

test("components can be moved across sections via drag and drop in Preview", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_cross_section_${Date.now()}`;
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

  await page.getByTestId("add-hero").click();
  await page.getByTestId("add-text").click();

  const hero = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  const text = page.locator('[data-testid="preview-item"][data-component-type="rich_text"]');
  await hero.dragTo(text);

  const cards = page.getByTestId("structure-section-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("0 components");
  await expect(cards.nth(1)).toContainText("2 components");
});

test("components can be reordered via drag and drop in Preview (within a section)", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_preview_reorder_${Date.now()}`;
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

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
});

test("hero can be edited inline in Preview and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_inline_hero_${Date.now()}`;
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

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

test("can duplicate and delete a component from Preview toolbar", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_toolbar_${Date.now()}`;
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

  await page.getByTestId("add-hero").click();

  const heroItem = page.locator('[data-testid="preview-item"][data-component-type="hero"]');
  await heroItem.click();

  await page.getByTestId("preview-duplicate").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(2);

  await heroItem.first().click();
  await page.getByTestId("preview-delete").click();
  await expect(page.locator('[data-testid="preview-item"][data-component-type="hero"]')).toHaveCount(1);
});

test("rich text can be edited inline in Preview and persists", async ({ page }) => {
  await page.goto("/");

  const projectId = `e2e_inline_${Date.now()}`;
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

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
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

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

  await page.getByTestId("save-page").click();
  await page.getByTestId("reload-page").click();
  await expect(page.locator(".imageBlock img")).toHaveCount(1);
});

test("can capture a preview screenshot (server Playwright required)", async ({ page }) => {
  test.skip(!process.env.CAC_E2E_SCREENSHOT, "Set CAC_E2E_SCREENSHOT=1 to enable.");

  await page.goto("/");
  const projectId = `e2e_shot_${Date.now()}`;
  await page.getByTestId("project-id").fill(projectId);
  await page.getByTestId("project-load").click();

  await page.getByTestId("add-hero").click();
  await page.getByTestId("capture-screenshot").click();

  await expect(page.getByTestId("preview-screenshot")).toBeVisible();
});
