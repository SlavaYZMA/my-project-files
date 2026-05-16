/**
 * save-eyes/index.ts
 *
 * Edge Function — единственная точка записи видео.
 * Клиентский код НЕ должен обращаться к Storage/DB напрямую.
 *
 * Исправления из аудита:
 *   КРИТ-4: Вся логика записи перенесена сюда из Camera.tsx
 *   КРИТ-5: CORS ограничен whitelist из env
 *   ВЫС-1: Имя файла — чистый UUID v4 без timestamp (А-2)
 *   ВЫС-2: Валидация размера файла и MIME-типа
 *   ВЫС-3: Rate limiting по IP (не более 3 загрузок в минуту)
 *   ВЫС-5: Убраны console.log с publicUrl/fileName/cid
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Константы ───────────────────────────────────────────────────
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50 МБ — 5 сек ≈ 1-10 МБ, с запасом
const ALLOWED_MIME_TYPES = ["video/webm", "video/mp4"];
const RATE_LIMIT_MAX = 3;        // 3 загрузки с одного IP
const RATE_LIMIT_WINDOW_MS = 60_000; // за 60 секунд

// ─── Rate limiting ────────────────────────────────────────────────
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

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
// КРИТ-5: Whitelist из env — больше не '*'
function buildCorsHeaders(req: Request): Record<string, string> {
  const allowedOriginsRaw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  const allowedOrigins = allowedOriginsRaw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const origin = req.headers.get("origin") ?? "";
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : "null";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

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

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors);
  }

  // ── ВЫС-3: Rate limiting ─────────────────────────────────────────
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return jsonResponse(
      { error: "Too many uploads. Please try again later." },
      429,
      cors
    );
  }

  let supabase: ReturnType<typeof createSupabaseClient>;
  try {
    supabase = createSupabaseClient();
  } catch {
    console.error("save-eyes: Failed to initialize Supabase client");
    return jsonResponse({ error: "Server misconfiguration" }, 500, cors);
  }

  // ── Парсинг multipart ────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonResponse({ error: "Invalid form data" }, 400, cors);
  }

  const videoFile = formData.get("video") as File | null;

  if (!videoFile) {
    return jsonResponse({ error: "No video file provided" }, 400, cors);
  }

  // ── ВЫС-2: Валидация MIME-типа ───────────────────────────────────
  if (!ALLOWED_MIME_TYPES.includes(videoFile.type)) {
    return jsonResponse(
      { error: `Invalid file type: ${videoFile.type}` },
      415,
      cors
    );
  }

  // ── ВЫС-2: Валидация размера ─────────────────────────────────────
  if (videoFile.size > MAX_VIDEO_SIZE_BYTES) {
    return jsonResponse(
      { error: "File too large. Maximum size is 50 MB." },
      413,
      cors
    );
  }

  if (videoFile.size === 0) {
    return jsonResponse({ error: "Empty file" }, 400, cors);
  }

  // ── А-2: Имя файла — чистый UUID v4, без timestamp ───────────────
  // Было: `eyes-${Date.now()}-${fileId.slice(0,8)}.webm`
  // Стало: только UUID — время загрузки не раскрывается
  const fileId = crypto.randomUUID();

  // MIME-тип сохраняем в метаданных, но не в имени файла
  const arrayBuffer = await videoFile.arrayBuffer();

  // ── Загрузка в Storage ───────────────────────────────────────────
  const { error: uploadError } = await supabase.storage
    .from("eyes")
    .upload(fileId, arrayBuffer, {
      contentType: videoFile.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("save-eyes: Storage upload failed");
    return jsonResponse({ error: "Upload failed" }, 500, cors);
  }

  // ── Запись в БД ──────────────────────────────────────────────────
  const { error: dbError } = await supabase
    .from("eyes")
    .insert({ cid: fileId, type: videoFile.type });

  if (dbError) {
    console.error("save-eyes: DB insert failed");
    // Откат: удаляем уже загруженный файл
    await supabase.storage.from("eyes").remove([fileId]);
    return jsonResponse({ error: "Failed to register upload" }, 500, cors);
  }

  // ── Генерация токена удаления ────────────────────────────────────
  const deleteToken = crypto.randomUUID();

  const { error: tokenError } = await supabase
    .from("delete_tokens")
    .insert({ cid: fileId, delete_token: deleteToken });

  if (tokenError) {
    console.error("save-eyes: Failed to create delete token");
    // Критическая ошибка — участница потеряет право удаления.
    // Откат загрузки полностью.
    await supabase.from("eyes").delete().eq("cid", fileId);
    await supabase.storage.from("eyes").remove([fileId]);
    return jsonResponse(
      { error: "Failed to generate delete token. Please retry." },
      500,
      cors
    );
  }

  // ── ВЫС-5: Не логируем fileId, URL или токен ─────────────────────
  // Только технические события без идентификаторов
  console.log("save-eyes: Upload completed successfully");

  // Origin для построения URL удаления берём из whitelist, а не из заголовка запроса
  const allowedOriginsRaw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
  const primaryOrigin = allowedOriginsRaw.split(",")[0]?.trim() ?? "";
  const requestOrigin = req.headers.get("origin") ?? "";
  const siteOrigin = primaryOrigin || requestOrigin;

  return jsonResponse(
    {
      success: true,
      // cid не возвращаем клиенту — только токен и URL удаления
      deleteUrl: `${siteOrigin}/delete?token=${deleteToken}`,
    },
    200,
    cors
  );
});
