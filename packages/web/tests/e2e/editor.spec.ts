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

