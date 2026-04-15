import { test, expect, type Page } from "@playwright/test";
import {
  mockConfigResponse,
  mockEnvResponse,
  mockLogsResponse,
  mockMessagesResponse,
  mockOverviewResponse,
  mockPlaygroundTemplatesResponse,
  mockV1ModelsResponse,
} from "./fixtures/admin-api";

async function setupApiMocks(page: Page) {
  await page.route(
    (url) => {
      try {
        const pathname = new URL(url).pathname;
        return pathname.startsWith("/admin") || pathname.startsWith("/v1");
      } catch {
        return false;
      }
    },
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      const method = req.method();

      if (path === "/v1/models" && method === "GET") {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mockV1ModelsResponse),
        });
        return;
      }

      if (path === "/v1/chat/completions") {
        await route.fulfill({
          status: 501,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            error: { message: "VRT mock: chat not exercised in visual test" },
          }),
        });
        return;
      }

      if (!path.startsWith("/admin")) {
        await route.fulfill({
          status: 404,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: { message: `VRT mock: unhandled ${path}` } }),
        });
        return;
      }

      if (path === "/admin/playground/templates") {
        if (method === "GET") {
          await route.fulfill({
            status: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(mockPlaygroundTemplatesResponse),
          });
          return;
        }
        if (method === "PUT") {
          const raw = req.postData() ?? "{}";
          await route.fulfill({
            status: 200,
            headers: { "content-type": "application/json" },
            body: raw,
          });
          return;
        }
        await route.fulfill({
          status: 405,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: { message: "VRT mock: unexpected method" } }),
        });
        return;
      }

      if (path === "/admin/test-connection" && method === "POST") {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ok: true,
            status: 200,
            message: "OK (mock)",
            baseUrl: "http://127.0.0.1:11434",
          }),
        });
        return;
      }

      if (path === "/admin/discover-upstream-models" && method === "POST") {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ok: true, models: ["mock-model-a", "mock-model-b"] }),
        });
        return;
      }

      if (method !== "GET") {
        await route.fulfill({
          status: 405,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: { message: "VRT mock: unexpected method" } }),
        });
        return;
      }

      if (path === "/admin/config") {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mockConfigResponse),
        });
        return;
      }
      if (path === "/admin/env") {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mockEnvResponse),
        });
        return;
      }
      if (path === "/admin/metrics/overview") {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mockOverviewResponse),
        });
        return;
      }
      if (path === "/admin/logs/models") {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mockLogsResponse),
        });
        return;
      }
      const msgMatch = /^\/admin\/models\/([^/]+)\/debug\/messages$/.exec(path);
      if (msgMatch) {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mockMessagesResponse),
        });
        return;
      }

      await route.fulfill({
        status: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: { message: `VRT mock: unhandled ${path}` } }),
      });
    },
  );
}

test.beforeEach(async ({ page }) => {
  await setupApiMocks(page);
});

test.describe("UI visual regression (hash routes)", () => {
  test("configuration", async ({ page }) => {
    await page.goto("/ui/#/configuration");
    await expect(page.locator("main h1").first()).toHaveText("Configuration");
    await expect(page.getByText("Loading…")).toHaveCount(0);
    await expect(page).toHaveScreenshot("configuration.png", { fullPage: true });
  });

  test("monitoring", async ({ page }) => {
    await page.goto("/ui/#/monitoring");
    await expect(page.locator("main h1").first()).toHaveText("Monitoring");
    await expect(page.getByText("Loading…")).toHaveCount(0);
    await expect(page.getByText("Total requests")).toBeVisible();
    await expect(page).toHaveScreenshot("monitoring.png", { fullPage: true });
  });

  test("models", async ({ page }) => {
    await page.goto("/ui/#/models");
    await expect(page.locator("main h1").first()).toHaveText("Models");
    await expect(page.getByRole("cell", { name: "demo-model" })).toBeVisible();
    await expect(page.getByText("Hello snapshot")).toBeVisible();
    await expect(page).toHaveScreenshot("models.png", { fullPage: true });
  });

  test("playground", async ({ page }) => {
    await page.goto("/ui/#/playground");
    await expect(page.locator("main h1").first()).toHaveText("Playground");
    await expect(page.getByText("Loading templates…")).toHaveCount(0);
    await expect(page.getByTestId("pg-model-trigger")).toBeEnabled();
    await page.getByRole("button", { name: "Templates library" }).click();
    await expect(page.getByText("Snapshot template")).toBeVisible();
    await expect(page).toHaveScreenshot("playground.png", { fullPage: true });
  });

  test("endpoint probe", async ({ page }) => {
    await page.goto("/ui/#/probe");
    await expect(page.locator("main h1").first()).toHaveText("Endpoint probe");
    await expect(page.getByRole("button", { name: "Fetch models" })).toBeVisible();
    await expect(page).toHaveScreenshot("probe.png", { fullPage: true });
  });
});
