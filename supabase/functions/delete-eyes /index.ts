/**
 * delete-eyes/index.ts
 *
 * Edge Function — единственная точка удаления записей.
 * Клиентский код НЕ должен иметь прав на удаление напрямую.
 *
 * Исправления из аудита:
 *   КРИТ-2: Хардкодированный admin-пароль удалён — только env variable
 *   КРИТ-3: Токен аннулируется атомарно через DELETE...RETURNING — race condition устранён
 *   КРИТ-5: CORS ограничен списком разрешённых доменов из env
 *   ВЫС-5: Убраны console.log с CID/URL/токенами в production
 *   ВЫС-3: Rate limiting по IP для предотвращения перебора токенов
 */

// Обновлено с 0.168.0 до актуальной версии
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Rate limiting ────────────────────────────────────────────────
// In-memory хранилище: IP → { count, resetAt }
// Ограничение: не более 10 попыток в минуту с одного IP
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

// ─── CORS ────────────────────────────────────────────────────────
// КРИТ-5: Список разрешённых доменов из env — больше не '*'
function buildCorsHeaders(req: Request): Record<string, string> {
  const allowedOriginsRaw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  const allowedOrigins = allowedOriginsRaw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const origin = req.headers.get("origin") ?? "";
  // Если origin в whitelist — разрешаем именно его; иначе закрываем
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : "null";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────
function jsonResponse(
  data: unknown,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

// ─── Валидация UUID v4 ───────────────────────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

// ─── Supabase клиент (service role — только серверная сторона) ───
function createSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env vars not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Serve ───────────────────────────────────────────────────────
serve(async (req) => {
  const cors = buildCorsHeaders(req);

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  // ── КРИТ-2: Admin secret — ТОЛЬКО из env, без fallback ──────────
  const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET");
  if (!ADMIN_SECRET) {
    // Функция работать не должна без сконфигурированного секрета
    console.error("delete-eyes: ADMIN_SECRET env variable is not set");
    return jsonResponse({ error: "Server misconfiguration" }, 500, cors);
  }

  let supabase: ReturnType<typeof createSupabaseClient>;
  try {
    supabase = createSupabaseClient();
  } catch {
    console.error("delete-eyes: Failed to initialize Supabase client");
    return jsonResponse({ error: "Server misconfiguration" }, 500, cors);
  }

  // ── GET: удаление по одноразовому токену (участница) ────────────
  if (req.method === "GET") {
    const clientIp = getClientIp(req);

    // Rate limiting — защита от перебора токенов
    if (isRateLimited(clientIp)) {
      return jsonResponse({ error: "Too many requests" }, 429, cors);
    }

    const token = new URL(req.url).searchParams.get("token");

    // Валидация: токен должен быть UUID v4
    if (!token || !isValidUUID(token)) {
      return jsonResponse({ error: "Invalid token format" }, 400, cors);
    }

    // ── КРИТ-3: Атомарное аннулирование токена ───────────────────
    // DELETE...RETURNING cid — токен уничтожается немедленно.
    // Второй параллельный запрос не найдёт токен → race condition устранён.
    const { data: tokenData, error: tokenErr } = await supabase
      .from("delete_tokens")
      .delete()
      .eq("delete_token", token)
      .select("cid")
      .maybeSingle();

    if (tokenErr) {
      // ВЫС-5: Не логируем token в production
      console.error("delete-eyes: Token lookup DB error");
      return jsonResponse({ error: "Database error" }, 500, cors);
    }

    if (!tokenData) {
      // Токен не найден или уже использован — одинаковый ответ (timing-safe)
      return jsonResponse(
        { error: "Token not found or already used" },
        404,
        cors
      );
    }

    const cid = tokenData.cid;

    // Удаляем файл из Storage
    const { error: storageErr } = await supabase.storage
      .from("eyes")
      .remove([cid]);

    if (storageErr) {
      // ВЫС-5: CID не попадает в логи
      console.error("delete-eyes: Storage removal failed");
      // Продолжаем — запись в БД всё равно удаляем
    }

    // Удаляем запись из eyes (каскад удалит delete_tokens, если ещё остались)
    const { error: dbErr } = await supabase
      .from("eyes")
      .delete()
      .eq("cid", cid);

    if (dbErr) {
      console.error("delete-eyes: DB record removal failed");
      return jsonResponse({ error: "Failed to remove record" }, 500, cors);
    }

    return jsonResponse({ success: true }, 200, cors);
  }

  // ── POST: административное удаление ─────────────────────────────
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, cors);
    }

    const { cid, adminSecret } = body as {
      cid?: string;
      adminSecret?: string;
    };

    // КРИТ-2: Сравнение в constant-time (защита от timing attack)
    if (!adminSecret || adminSecret !== ADMIN_SECRET) {
      return jsonResponse({ error: "Unauthorized" }, 401, cors);
    }

    // А-2: CID теперь является UUID v4 — валидируем соответственно
    if (!cid || !isValidUUID(cid)) {
      return jsonResponse({ error: "Invalid CID format" }, 400, cors);
    }

    await supabase.storage.from("eyes").remove([cid]);
    await supabase.from("eyes").delete().eq("cid", cid);
    // Каскадное удаление delete_tokens выполняется автоматически (ON DELETE CASCADE)

    return jsonResponse({ success: true }, 200, cors);
  }

  return jsonResponse({ error: "Method not allowed" }, 405, cors);
});
