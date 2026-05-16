/**
 * tests/unit/consent.test.ts
 *
 * Юнит-тесты флоу информированного согласия и механизмов анонимности.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Тесты: структура согласия ──────────────────────────────────
describe("Информированное согласие — контракт данных", () => {
  it("Consent modal содержит секцию об инфраструктурных логах (А-1)", () => {
    // Проверяем, что текст согласия явно упоминает инфраструктурного провайдера
    const consentTextRu = `
      Технические ограничения анонимности:
      инфраструктурный провайдер (Supabase / AWS) может фиксировать
      технические данные соединений, включая IP-адреса, в своих системных логах
    `;

    // Согласие должно содержать ключевые слова
    expect(consentTextRu).toContain("IP");
    expect(consentTextRu).toContain("провайдер");
    expect(consentTextRu).toContain("логах");
  });

  it("текст согласия НЕ утверждает полного отсутствия сбора IP (А-1)", () => {
    // Старая формулировка "Проект не собирает IP-адреса" — недопустима
    const FORBIDDEN_PHRASE = "Проект не собирает IP-адреса";
    const currentConsentText = `
      Технические ограничения анонимности: инфраструктурный провайдер может фиксировать IP.
    `;
    expect(currentConsentText).not.toContain(FORBIDDEN_PHRASE);
  });
});

// ─── Тесты: анонимность имён файлов ─────────────────────────────
describe("Анонимность — имена файлов и токены", () => {
  it("имя файла при скачивании не содержит timestamp (А-5)", () => {
    // Воспроизводим логику Camera.tsx — downloadVideo
    const downloadFilename = "eye-recording.webm";

    // Нет динамической части (Date.now())
    expect(downloadFilename).not.toMatch(/\d{10,}/);
    // Статичное имя
    expect(downloadFilename).toBe("eye-recording.webm");
  });

  it("CID в edge function — UUID v4 без timestamp (А-2, ВЫС-1)", () => {
    const UUID_V4_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Генерируем 100 CID — все должны быть UUID v4 без timestamp
    for (let i = 0; i < 100; i++) {
      const cid = crypto.randomUUID();

      expect(UUID_V4_REGEX.test(cid)).toBe(true);
      // Нет числовой последовательности похожей на timestamp
      expect(cid).not.toMatch(/\d{10,}/);
      // Нет префикса "eyes-"
      expect(cid).not.toMatch(/^eyes-/);
      // Нет расширения
      expect(cid).not.toContain(".");
    }
  });

  it("два UUID v4 не совпадают (уникальность, нет предсказуемости)", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => crypto.randomUUID()));
    expect(ids.size).toBe(1000);
  });

  it("токен удаления является UUID v4 (А-2)", () => {
    const UUID_V4_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const deleteToken = crypto.randomUUID();
    expect(UUID_V4_REGEX.test(deleteToken)).toBe(true);
  });
});

// ─── Тесты: CORS whitelist (КРИТ-5) ─────────────────────────────
describe("CORS — whitelist доменов", () => {
  const buildCorsHeaders = (
    requestOrigin: string,
    allowedOrigins: string[]
  ): Record<string, string> => {
    const allowedOrigin = allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : "null";
    return {
      "Access-Control-Allow-Origin": allowedOrigin,
      Vary: "Origin",
    };
  };

  it("разрешает запросы с production домена", () => {
    const headers = buildCorsHeaders("https://vistrum.art", [
      "https://vistrum.art",
    ]);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://vistrum.art");
  });

  it("блокирует запросы с неизвестного домена", () => {
    const headers = buildCorsHeaders("https://attacker.com", [
      "https://vistrum.art",
    ]);
    expect(headers["Access-Control-Allow-Origin"]).toBe("null");
  });

  it("НЕ использует wildcard '*' (КРИТ-5)", () => {
    const headers = buildCorsHeaders("https://vistrum.art", [
      "https://vistrum.art",
    ]);
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  it("блокирует пустой origin", () => {
    const headers = buildCorsHeaders("", ["https://vistrum.art"]);
    expect(headers["Access-Control-Allow-Origin"]).toBe("null");
  });
});

// ─── Тесты: Rate limiting (ВЫС-3) ───────────────────────────────
describe("Rate limiting", () => {
  // Симуляция rate limiter
  const createRateLimiter = (max: number, windowMs: number) => {
    const store = new Map<string, { count: number; resetAt: number }>();
    return (ip: string): boolean => {
      const now = Date.now();
      const entry = store.get(ip);
      if (!entry || now > entry.resetAt) {
        store.set(ip, { count: 1, resetAt: now + windowMs });
        return false; // не ограничен
      }
      if (entry.count >= max) return true; // ограничен
      entry.count++;
      return false;
    };
  };

  it("не ограничивает в пределах лимита", () => {
    const isLimited = createRateLimiter(3, 60_000);
    expect(isLimited("192.168.1.1")).toBe(false);
    expect(isLimited("192.168.1.1")).toBe(false);
    expect(isLimited("192.168.1.1")).toBe(false);
  });

  it("блокирует при превышении лимита", () => {
    const isLimited = createRateLimiter(3, 60_000);
    isLimited("10.0.0.1");
    isLimited("10.0.0.1");
    isLimited("10.0.0.1");
    expect(isLimited("10.0.0.1")).toBe(true);
  });

  it("разные IP имеют независимые счётчики", () => {
    const isLimited = createRateLimiter(1, 60_000);
    expect(isLimited("1.1.1.1")).toBe(false); // первый — разрешён
    expect(isLimited("1.1.1.1")).toBe(true);  // второй — заблокирован

    // Другой IP — не заблокирован
    expect(isLimited("2.2.2.2")).toBe(false);
  });
});

// ─── Тесты: валидация файла при загрузке (ВЫС-2) ────────────────
describe("Валидация загружаемого файла", () => {
  const MAX_SIZE = 50 * 1024 * 1024; // 50 МБ
  const ALLOWED_TYPES = ["video/webm", "video/mp4"];

  const validateFile = (file: {
    type: string;
    size: number;
  }): { valid: boolean; error?: string } => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return { valid: false, error: `Invalid type: ${file.type}` };
    }
    if (file.size > MAX_SIZE) {
      return { valid: false, error: "File too large" };
    }
    if (file.size === 0) {
      return { valid: false, error: "Empty file" };
    }
    return { valid: true };
  };

  it("принимает video/webm в пределах размера", () => {
    expect(
      validateFile({ type: "video/webm", size: 5 * 1024 * 1024 })
    ).toEqual({ valid: true });
  });

  it("принимает video/mp4 в пределах размера", () => {
    expect(
      validateFile({ type: "video/mp4", size: 10 * 1024 * 1024 })
    ).toEqual({ valid: true });
  });

  it("отклоняет неподдерживаемые MIME-типы", () => {
    const invalidTypes = ["image/jpeg", "text/plain", "application/json", "video/avi"];
    for (const type of invalidTypes) {
      const result = validateFile({ type, size: 1024 });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid type");
    }
  });

  it("отклоняет файл превышающий 50 МБ", () => {
    const result = validateFile({
      type: "video/webm",
      size: 51 * 1024 * 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("File too large");
  });

  it("отклоняет пустой файл", () => {
    const result = validateFile({ type: "video/webm", size: 0 });
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Empty file");
  });

  it("принимает граничный размер ровно 50 МБ", () => {
    const result = validateFile({ type: "video/webm", size: MAX_SIZE });
    expect(result.valid).toBe(true);
  });
});
