/**
 * src/pages/Delete.tsx
 *
 * Страница удаления записи по одноразовому токену.
 *
 * Исправления из аудита:
 *   КРИТ-3: Вся логика удаления делегирована edge function delete-eyes.
 *           Нет прямых вызовов Supabase Storage/DB из браузера.
 *           Race condition устранён на уровне edge function
 *           (атомарный DELETE...RETURNING).
 *   СРД-1:  Дублирование логики удалено — единственная точка ответственности.
 */

import { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";

// ─── Локальные переводы страницы удаления ────────────────────────
// Хранятся здесь, а не в LanguageContext — страница изолирована
const translations = {
  ru: {
    title: "Удаление записи",
    description:
      "Это действие необратимо.\nВаш взгляд будет удалён навсегда из вечного полотна.",
    deleting: "Удаление...",
    successMessage: "Запись удалена навсегда.",
    errorMessage: "Ошибка удаления",
    tokenMissing: "Ссылка недействительна или уже была использована.",
    deleteButton: "Удалить навсегда",
    back: "← Вернуться на главную",
    switchLang: "EN",
  },
  en: {
    title: "Delete Recording",
    description:
      "This action is irreversible.\nYour gaze will be permanently removed from the eternal canvas.",
    deleting: "Deleting...",
    successMessage: "Recording permanently deleted.",
    errorMessage: "Delete error",
    tokenMissing: "Link is invalid or has already been used.",
    deleteButton: "Delete Forever",
    back: "← Back to Home",
    switchLang: "RU",
  },
} as const;

type Status = "idle" | "deleting" | "success" | "error";

// ─── UUID v4 валидация на клиенте — ранняя защита ────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

// ─── Компонент ───────────────────────────────────────────────────
const Delete = () => {
  const { language, setLanguage } = useLanguage();
  const t = translations[language] ?? translations.ru;

  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  // Ранняя валидация токена
  useEffect(() => {
    if (!token || !isValidUUID(token)) {
      setStatus("error");
      setMessage(t.tokenMissing);
    }
  }, [token, t.tokenMissing]);

  // ── КРИТ-3: Удаление через edge function — не напрямую Supabase ──
  const handleDelete = async () => {
    if (!token || !isValidUUID(token)) return;

    setStatus("deleting");

    try {
      const url = new URL(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-eyes`
      );
      url.searchParams.set("token", token);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });

      if (res.status === 404) {
        throw new Error(t.tokenMissing);
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t.errorMessage);
      }

      setStatus("success");
      setMessage(t.successMessage);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : t.errorMessage;
      setStatus("error");
      setMessage(message);
    }
  };

  const toggleLanguage = () =>
    setLanguage(language === "ru" ? "en" : "ru");

  // ─── UI ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
      <div className="text-center max-w-md p-8 relative">
        {/* Переключатель языка */}
        <button
          onClick={toggleLanguage}
          aria-label={language === "ru" ? "Switch to English" : "Переключить на русский"}
          className="absolute top-4 right-4 px-3 py-1 bg-white/10 hover:bg-white/20 transition-colors text-sm"
        >
          {t.switchLang}
        </button>

        <h1 className="text-2xl md:text-3xl mb-8">{t.title}</h1>

        {/* Ожидание подтверждения */}
        {status === "idle" && (
          <>
            <p className="text-white/60 mb-10 leading-relaxed">
              {t.description.split("\n").map((line, i) => (
                <span key={i}>
                  {line}
                  <br />
                </span>
              ))}
            </p>
            <button
              onClick={handleDelete}
              className="px-12 py-5 bg-red-900/80 hover:bg-red-800 text-white text-lg uppercase tracking-widest transition-colors"
            >
              {t.deleteButton}
            </button>
          </>
        )}

        {/* Процесс удаления */}
        {status === "deleting" && (
          <div role="status" aria-live="polite">
            <p className="text-white/60 text-lg">{t.deleting}</p>
            <div className="mt-4 w-6 h-6 border border-white/20 border-t-white/70 rounded-full animate-spin mx-auto" />
          </div>
        )}

        {/* Успех */}
        {status === "success" && (
          <>
            <div
              className="text-green-400 text-4xl mb-6"
              aria-hidden="true"
            >
              ✓
            </div>
            <p
              role="status"
              className="text-green-400 text-xl mb-8"
            >
              {message}
            </p>
            <Link
              to="/"
              className="text-white/60 hover:text-white underline transition-colors"
            >
              {t.back}
            </Link>
          </>
        )}

        {/* Ошибка */}
        {status === "error" && (
          <>
            <p
              role="alert"
              className="text-red-400 text-xl mb-8"
            >
              {message}
            </p>
            <Link
              to="/"
              className="text-white/60 hover:text-white underline transition-colors"
            >
              {t.back}
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

export default Delete;
