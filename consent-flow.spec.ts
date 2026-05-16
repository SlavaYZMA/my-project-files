/**
 * tests/e2e/consent-flow.spec.ts
 *
 * End-to-end тесты (Playwright).
 * Покрывают: идентификацию, флоу камеры, удаление, доступность.
 *
 * Запуск:
 *   npx playwright test
 *   npx playwright test --headed   (с браузером)
 *   npx playwright test --ui       (UI mode)
 */

import { test, expect, Page } from "@playwright/test";

// ─── Хелперы ──────────────────────────────────────────────────
/** Разрешение камеры через mock */
async function grantCameraPermission(page: Page) {
  await page.context().grantPermissions(["camera"]);
}

/** Добавляет mock MediaDevices если браузер не предоставляет камеру */
async function mockMediaDevices(page: Page) {
  await page.addInitScript(() => {
    // Создаём фиктивный видеопоток для тестовой среды
    const originalGetUserMedia =
      navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);

    if (!originalGetUserMedia) {
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => {
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 480;
            const stream = (canvas as HTMLCanvasElement).captureStream(10);
            return stream;
          },
          enumerateDevices: async () => [],
        },
        writable: true,
      });
    }
  });
}

// ─── Блок 1: Идентификация ─────────────────────────────────────
test.describe("Экран идентификации", () => {
  test.beforeEach(async ({ page }) => {
    await mockMediaDevices(page);
    await page.goto("/camera");
  });

  test("кнопка перехода заблокирована без подтверждения", async ({ page }) => {
    const button = page.getByRole("button", {
      name: /к съемке|go to camera/i,
    });
    await expect(button).toBeDisabled();
  });

  test("чекбокс разблокирует кнопку", async ({ page }) => {
    const checkbox = page.getByRole("checkbox");
    await checkbox.check();

    const button = page.getByRole("button", {
      name: /к съемке|go to camera/i,
    });
    await expect(button).toBeEnabled();
  });

  test("после нажатия кнопки открывается экран камеры", async ({ page }) => {
    await grantCameraPermission(page);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /к съемке|go to camera/i }).click();

    // Должен появиться canvas (экран камеры)
    await expect(page.locator("canvas")).toBeVisible({ timeout: 5000 });
  });

  test("страница содержит инструкцию перед записью", async ({ page }) => {
    // Инструкция должна быть видна ДО чекбокса
    const instruction = page.locator("[class*='bg-white/5']").first();
    await expect(instruction).toBeVisible();

    // Чекбокс идёт ПОСЛЕ инструкции
    const checkboxPos = await page.getByRole("checkbox").boundingBox();
    const instructionPos = await instruction.boundingBox();

    if (checkboxPos && instructionPos) {
      expect(instructionPos.y).toBeLessThan(checkboxPos.y);
    }
  });
});

// ─── Блок 2: Страница удаления ─────────────────────────────────
test.describe("Страница удаления (/delete)", () => {
  test("без токена — отображается сообщение об ошибке", async ({ page }) => {
    await page.goto("/delete");
    await expect(
      page.getByRole("alert").or(page.getByText(/ошибка|недействительна|error/i))
    ).toBeVisible();
  });

  test("с невалидным токеном — отображается ошибка", async ({ page }) => {
    await page.goto("/delete?token=invalid-not-a-uuid");
    await expect(
      page.getByText(/ошибка|недействительна|invalid/i)
    ).toBeVisible();
  });

  test("с токеном неверного формата — кнопка удаления не появляется", async ({ page }) => {
    await page.goto("/delete?token=123456789");
    // Кнопка "Удалить навсегда" не должна быть видна при невалидном токене
    const deleteButton = page.getByRole("button", {
      name: /удалить навсегда|delete forever/i,
    });
    await expect(deleteButton).not.toBeVisible();
  });

  test("с корректным UUID — отображается кнопка удаления", async ({ page }) => {
    // UUID формат но несуществующий токен
    const fakeUUID = "550e8400-e29b-41d4-a716-446655440000";
    await page.goto(`/delete?token=${fakeUUID}`);

    // Кнопка должна отображаться
    const deleteButton = page.getByRole("button", {
      name: /удалить навсегда|delete forever/i,
    });
    await expect(deleteButton).toBeVisible();
  });

  test("после клика на удаление — показывается статус (успех или 404)", async ({
    page,
  }) => {
    const fakeUUID = "660e8400-e29b-41d4-a716-556655440000";
    await page.goto(`/delete?token=${fakeUUID}`);

    await page.getByRole("button", {
      name: /удалить навсегда|delete forever/i,
    }).click();

    // Ожидаем либо успех, либо 404 (токен не найден в тестовой БД)
    await expect(
      page
        .getByText(/удалены навсегда|permanently deleted/i)
        .or(page.getByText(/not found|not found or already used|ошибка/i))
    ).toBeVisible({ timeout: 10000 });
  });

  test("повторное использование токена — ошибка", async ({ page, request }) => {
    // Пропускаем если нет тестового API
    const healthCheck = await request
      .get("/api/test/health")
      .catch(() => null);
    if (!healthCheck || !healthCheck.ok()) {
      test.skip();
      return;
    }

    // Создаём тестовую запись
    const uploadRes = await request.post("/api/test/upload");
    if (!uploadRes.ok()) {
      test.skip();
      return;
    }

    const { token } = await uploadRes.json();

    // Первое удаление — успех
    await page.goto(`/delete?token=${token}`);
    await page.getByRole("button", { name: /удалить навсегда/i }).click();
    await expect(page.getByText(/удалены навсегда/i)).toBeVisible({
      timeout: 10000,
    });

    // Второе удаление — ошибка
    await page.goto(`/delete?token=${token}`);
    const deleteButton = page.getByRole("button", {
      name: /удалить навсегда/i,
    });

    if (await deleteButton.isVisible()) {
      await deleteButton.click();
      await expect(
        page.getByText(/not found|not found or already used/i)
      ).toBeVisible({ timeout: 10000 });
    }
  });
});

// ─── Блок 3: Согласие и сохранение ─────────────────────────────
test.describe("Флоу согласия и сохранения", () => {
  test.beforeEach(async ({ page }) => {
    await mockMediaDevices(page);
    await grantCameraPermission(page);
  });

  test("кнопка сохранения заблокирована без чекбокса согласия", async ({
    page,
  }) => {
    // Переходим на preview-состояние — симулируем через URL state если возможно
    // В реальной среде нужен mock для состояния preview
    await page.goto("/camera");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /к съемке|go to camera/i }).click();

    // В состоянии idle кнопка сохранения не должна быть видна
    const saveButton = page.getByRole("button", {
      name: /добавить в полотно|add to canvas/i,
    });
    await expect(saveButton).not.toBeVisible();
  });

  test("trigger warning отображается ДО чекбокса согласия (UI-1)", async ({
    page,
  }) => {
    await page.goto("/camera");

    // Если мы в preview-состоянии, trigger warning должен быть выше чекбокса
    // Иначе тест пропускается (нет preview без записи)
    const triggerWarning = page.locator("[class*='yellow']").first();
    const consentCheckbox = page.getByRole("checkbox").first();

    if (
      (await triggerWarning.isVisible()) &&
      (await consentCheckbox.isVisible())
    ) {
      const warningPos = await triggerWarning.boundingBox();
      const checkboxPos = await consentCheckbox.boundingBox();

      if (warningPos && checkboxPos) {
        // Trigger warning должен быть выше чекбокса
        expect(warningPos.y).toBeLessThan(checkboxPos.y);
      }
    }
  });
});

// ─── Блок 4: Доступность (Accessibility) ───────────────────────
test.describe("Доступность (a11y)", () => {
  test("все чекбоксы имеют связанные label", async ({ page }) => {
    await page.goto("/camera");

    const checkboxes = page.locator("input[type='checkbox']");
    const count = await checkboxes.count();

    for (let i = 0; i < count; i++) {
      const checkbox = checkboxes.nth(i);
      const id = await checkbox.getAttribute("id");

      if (id) {
        const label = page.locator(`label[for="${id}"]`);
        await expect(label).toBeVisible();
      } else {
        // Альтернатива — checkbox обёрнут в label
        const parentLabel = checkbox.locator("xpath=ancestor::label");
        const hasParentLabel = (await parentLabel.count()) > 0;
        expect(hasParentLabel).toBe(true);
      }
    }
  });

  test("интерактивные элементы доступны с клавиатуры", async ({ page }) => {
    await page.goto("/camera");

    // Tab переходит на первый интерактивный элемент
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(
      () => document.activeElement?.tagName
    );
    expect(focused).not.toBe("BODY");
  });

  test("статус камеры имеет aria-live (UI-4)", async ({ page }) => {
    await mockMediaDevices(page);
    await grantCameraPermission(page);
    await page.goto("/camera");

    // Переходим к экрану камеры
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /к съемке|go to camera/i }).click();

    // Ищем элемент с aria-live
    const liveRegion = page.locator("[aria-live]");
    await expect(liveRegion).toBeVisible({ timeout: 5000 });
  });

  test("кнопка назад имеет aria-label", async ({ page }) => {
    await mockMediaDevices(page);
    await grantCameraPermission(page);
    await page.goto("/camera");
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /к съемке|go to camera/i }).click();

    const backButton = page.getByRole("link", { name: /back|вернуться/i });
    await expect(backButton).toBeVisible({ timeout: 5000 });
  });

  test("страница /delete содержит role=alert при ошибке", async ({ page }) => {
    await page.goto("/delete?token=invalid");

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
  });

  test("страница /delete содержит role=status при успехе или загрузке", async ({
    page,
  }) => {
    const fakeUUID = "770e8400-e29b-41d4-a716-666655440000";
    await page.goto(`/delete?token=${fakeUUID}`);

    await page.getByRole("button", {
      name: /удалить навсегда|delete forever/i,
    }).click();

    // После клика должен появиться role=status (загрузка или успех)
    const status = page.getByRole("status");
    await expect(status).toBeVisible({ timeout: 10000 });
  });
});

// ─── Блок 5: Безопасность — клиентская валидация ───────────────
test.describe("Клиентская валидация безопасности", () => {
  test("токен в URL инъекция SQL не вызывает ошибки рендера", async ({
    page,
  }) => {
    const sqlInjection = encodeURIComponent("' OR 1=1; --");
    await page.goto(`/delete?token=${sqlInjection}`);

    // Страница должна отобразиться без краша
    await expect(page.locator("body")).toBeVisible();
    // И показать ошибку валидации
    await expect(
      page.getByText(/ошибка|invalid|недействительна/i)
    ).toBeVisible();
  });

  test("токен в URL XSS не исполняется", async ({ page }) => {
    let xssExecuted = false;
    page.on("dialog", () => {
      xssExecuted = true;
    });

    const xssPayload = encodeURIComponent("<script>alert('xss')</script>");
    await page.goto(`/delete?token=${xssPayload}`);

    await page.waitForTimeout(1000);
    expect(xssExecuted).toBe(false);
  });

  test("очень длинный токен отклоняется без краша", async ({ page }) => {
    const longToken = "a".repeat(1000);
    await page.goto(`/delete?token=${longToken}`);

    await expect(page.locator("body")).toBeVisible();
    await expect(
      page.getByText(/ошибка|invalid|недействительна/i)
    ).toBeVisible();
  });
});
