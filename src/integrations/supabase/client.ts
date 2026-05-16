/**
 * src/integrations/supabase/client.ts
 *
 * Исправления из аудита:
 *   ВЫС-4: Убраны persistSession + localStorage — проект не использует Auth.
 *           Токены не сохраняются в браузере → нет риска XSS кражи сессии.
 *   ВЫС-4: Убран autoRefreshToken — нечего обновлять без сессии.
 *   Добавлен кастомный X-Client-Info без версии браузера (минимизация metadata).
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "Supabase environment variables are not configured. " +
      "Copy .env.example to .env and fill in the values."
  );
}

export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      // ВЫС-4: Проект анонимный — сессии не нужны
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        // Минимальный идентификатор клиента без версии браузера/ОС
        "X-Client-Info": "vistrum/1.0",
      },
    },
  }
);
