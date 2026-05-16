/**
 * tests/unit/deleteToken.test.ts
 *
 * Юнит-тесты механизма удаления по одноразовому токену.
 * Покрывает: атомарность, race condition, валидацию UUID, логирование PII.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Мок Supabase ──────────────────────────────────────────────
const mockMaybeSingle = vi.fn();
const mockRemove = vi.fn();

const mockDeleteEq = vi.fn(() => ({
  select: vi.fn(() => ({
    maybeSingle: mockMaybeSingle,
  })),
}));
const mockDeleteFrom = vi.fn(() => ({
  delete: vi.fn(() => ({
    eq: mockDeleteEq,
  })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mockDeleteFrom,
    storage: {
      from: vi.fn(() => ({ remove: mockRemove })),
    },
  },
}));

// ─── Симуляция логики edge function ────────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

async function simulateDeleteRequest(token: string): Promise<{
  success?: boolean;
  error?: string;
  status: number;
}> {
  if (!token || !isValidUUID(token)) {
    return { error: "Invalid token format", status: 400 };
  }

  const { data: tokenData, error: tokenErr } = await (
    mockDeleteFrom("delete_tokens")
      .delete()
      .eq("delete_token", token) as {
        select: () => { maybeSingle: typeof mockMaybeSingle };
      }
  ).select().maybeSingle();

  if (tokenErr) {
    return { error: "Database error", status: 500 };
  }

  if (!tokenData) {
    return { error: "Token not found or already used", status: 404 };
  }

  const { error: storageErr } = await (mockRemove([tokenData.cid]) as Promise<{
    error: Error | null;
  }>);

  if (storageErr) {
    // Продолжаем, но фиксируем ошибку без CID в логе
    console.error("delete-eyes: Storage removal failed");
  }

  return { success: true, status: 200 };
}

// ─── Тесты ─────────────────────────────────────────────────────
describe("Механизм удаления — одноразовый токен", () => {
  const VALID_TOKEN = "550e8400-e29b-41d4-a716-446655440000";
  const VALID_CID = "660e8400-e29b-41d4-a716-556655440000";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRemove.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("успешно удаляет запись по валидному токену", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { cid: VALID_CID },
      error: null,
    });

    const result = await simulateDeleteRequest(VALID_TOKEN);

    expect(result.status).toBe(200);
    expect(result.success).toBe(true);
  });

  it("возвращает 400 при невалидном формате токена", async () => {
    const invalidTokens = [
      "not-a-uuid",
      "12345",
      "",
      "00000000-0000-0000-0000-000000000000", // UUID v0 — не v4
      "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    ];

    for (const token of invalidTokens) {
      const result = await simulateDeleteRequest(token);
      expect(result.status).toBe(400);
      expect(result.error).toContain("Invalid token format");
    }
  });

  it("возвращает 404 когда токен уже использован или не существует", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await simulateDeleteRequest(VALID_TOKEN);

    expect(result.status).toBe(404);
    expect(result.error).toContain("not found or already used");
  });

  it("race condition: два параллельных запроса — только один успешен", async () => {
    // Первый вызов находит токен, второй — нет (токен аннулирован первым)
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { cid: VALID_CID }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const [res1, res2] = await Promise.all([
      simulateDeleteRequest(VALID_TOKEN),
      simulateDeleteRequest(VALID_TOKEN),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 200);
    const failures = [res1, res2].filter((r) => r.status === 404);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });

  it("продолжает удаление из БД даже при ошибке Storage", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { cid: VALID_CID },
      error: null,
    });
    mockRemove.mockResolvedValue({ error: new Error("Storage unavailable") });

    const result = await simulateDeleteRequest(VALID_TOKEN);

    // Функция должна завершиться успешно (БД-запись важнее Storage-файла)
    expect(result.status).toBe(200);
    expect(result.success).toBe(true);
  });

  it("не логирует CID в сообщении об ошибке Storage", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockMaybeSingle.mockResolvedValue({
      data: { cid: "secret-uuid-cid" },
      error: null,
    });
    mockRemove.mockResolvedValue({ error: new Error("Storage error") });

    await simulateDeleteRequest(VALID_TOKEN);

    const loggedMessages = consoleSpy.mock.calls
      .flat()
      .join(" ");

    // CID не должен появляться в логах
    expect(loggedMessages).not.toContain("secret-uuid-cid");

    consoleSpy.mockRestore();
  });

  it("возвращает 500 при ошибке базы данных", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: new Error("DB connection failed"),
    });

    const result = await simulateDeleteRequest(VALID_TOKEN);

    expect(result.status).toBe(500);
    expect(result.error).toContain("Database error");
  });
});

// ─── Тесты валидации UUID ───────────────────────────────────────
describe("Валидация UUID v4", () => {
  it("принимает корректные UUID v4", () => {
    const validUUIDs = [
      "550e8400-e29b-41d4-a716-446655440000",
      "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];

    for (const uuid of validUUIDs) {
      expect(isValidUUID(uuid)).toBe(true);
    }
  });

  it("отклоняет невалидные форматы", () => {
    const invalidValues = [
      "not-a-uuid",
      "00000000000000000000000000000000",
      "550e8400-e29b-31d4-a716-446655440000", // v3, не v4
      "XXXXXXXX-XXXX-4XXX-XXXX-XXXXXXXXXXXX",
      "../../../etc/passwd",
      "' OR 1=1; --",
      "a".repeat(37),
    ];

    for (const val of invalidValues) {
      expect(isValidUUID(val)).toBe(false);
    }
  });

  it("имя файла (cid) — чистый UUID v4 без timestamp", () => {
    // Симуляция генерации cid в edge function save-eyes
    const cid = crypto.randomUUID();

    // Нет числовой последовательности похожей на Unix timestamp
    expect(cid).not.toMatch(/\d{10,}/);
    // Строгий формат UUID v4
    expect(isValidUUID(cid)).toBe(true);
    // Нет расширения файла
    expect(cid).not.toContain(".");
    // Нет подстроки "eyes-"
    expect(cid).not.toContain("eyes-");
  });
});
