/**
 * src/pages/Canvas.tsx
 *
 * Полотно — отображение всех записей в виде сетки.
 *
 * Исправления из аудита:
 *   А-3: Видео подаётся через подписанные URLs (signed URLs) с ограниченным
 *        сроком действия, а не через постоянные публичные ссылки.
 *        Bucket переведён в режим private (см. миграцию).
 *        Это значительно усложняет массовое скачивание — ссылки протухают.
 *
 * Архитектура загрузки:
 *   1. Запрашиваем список CID из БД (READ разрешён всем через RLS SELECT).
 *   2. Батчами запрашиваем signed URLs у Supabase Storage.
 *   3. Signed URL действует 1 час. По истечении — видео не воспроизводится.
 *   4. При реалтайм INSERT/DELETE обновляем список в памяти без перезагрузки.
 */

import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

// ─── Типы ────────────────────────────────────────────────────────
interface EyeRecord {
  cid: string;
  created_at: string;
}

interface EyeWithUrl extends EyeRecord {
  /** Signed URL, действует SIGNED_URL_TTL_SECONDS */
  signedUrl: string;
}

// ─── Конфигурация ────────────────────────────────────────────────
const ITEMS_PER_PAGE = 100;
/** TTL в секундах для signed URL — 1 час */
const SIGNED_URL_TTL_SECONDS = 3600;
/** Максимум CID в одном батч-запросе signed URLs */
const SIGNED_URL_BATCH_SIZE = 50;

// ─── Хелпер: батчевое получение signed URLs ──────────────────────
async function fetchSignedUrls(
  cids: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // Разбиваем на батчи — Supabase ограничивает количество путей в одном вызове
  for (let i = 0; i < cids.length; i += SIGNED_URL_BATCH_SIZE) {
    const batch = cids.slice(i, i + SIGNED_URL_BATCH_SIZE);

    const { data, error } = await supabase.storage
      .from("eyes")
      .createSignedUrls(batch, SIGNED_URL_TTL_SECONDS);

    if (error) {
      console.error("Canvas: Failed to create signed URLs for batch");
      continue;
    }

    for (const item of data ?? []) {
      if (item.signedUrl && item.path) {
        result[item.path] = item.signedUrl;
      }
    }
  }

  return result;
}

// ─── Компонент ───────────────────────────────────────────────────
const Canvas = () => {
  const { t } = useLanguage();

  const [eyes, setEyes] = useState<EyeWithUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [, setPage] = useState(0);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // ── Загрузка страницы записей ──────────────────────────────────
  const loadEyes = useCallback(async (pageNum: number, append = false) => {
    try {
      const from = pageNum * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      const { data, error: queryError } = await supabase
        .from("eyes")
        .select("cid, created_at")
        .order("created_at", { ascending: false })
        .range(from, to);

      if (queryError) throw queryError;

      if (!data) return;

      // А-3: Получаем подписанные URLs для всех CID страницы
      const urlMap = await fetchSignedUrls(data.map((r) => r.cid));

      const eyesWithUrls: EyeWithUrl[] = data
        .filter((r) => urlMap[r.cid]) // пропускаем записи без URL (удалены?)
        .map((r) => ({ ...r, signedUrl: urlMap[r.cid] }));

      if (append) {
        setEyes((prev) => [...prev, ...eyesWithUrls]);
      } else {
        setEyes(eyesWithUrls);
      }

      setHasMore(data.length === ITEMS_PER_PAGE);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("Canvas: Load error");
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Реалтайм-подписка ──────────────────────────────────────────
  useEffect(() => {
    loadEyes(0);

    const channel = supabase
      .channel("eyes-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "eyes" },
        async (payload) => {
          if (payload.eventType === "INSERT") {
            const newRecord = payload.new as EyeRecord;
            // Запрашиваем signed URL для новой записи
            const urlMap = await fetchSignedUrls([newRecord.cid]);
            const signedUrl = urlMap[newRecord.cid];
            if (signedUrl) {
              setEyes((prev) => [{ ...newRecord, signedUrl }, ...prev]);
            }
          } else if (payload.eventType === "DELETE") {
            const deleted = payload.old as { cid?: string };
            if (deleted.cid) {
              setEyes((prev) => prev.filter((e) => e.cid !== deleted.cid));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadEyes]);

  // ── Infinite scroll ────────────────────────────────────────────
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          setPage((prev) => {
            const nextPage = prev + 1;
            loadEyes(nextPage, true);
            return nextPage;
          });
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [hasMore, loading, loadEyes]);

  // ── Стабилизация для мемоизации сетки ─────────────────────────
  const eyeItems = useMemo(() => eyes, [eyes]);

  // ─── Render ───────────────────────────────────────────────────
  if (loading && eyes.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono text-white">
        <p className="text-white/30 text-sm tracking-widest uppercase">
          {t("canvas.loading")}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono text-white">
        <p className="text-red-500/60 text-sm tracking-widest uppercase">
          {t("canvas.error") ?? "Ошибка загрузки"}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black font-mono">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black via-black/80 to-transparent pointer-events-none">
        <div className="flex items-center justify-between p-4 md:p-6 pointer-events-auto max-w-[1400px] mx-auto">
          <Link
            to="/"
            aria-label="Back to home"
            className="text-white/40 hover:text-white transition-colors"
          >
            <ArrowLeft size={24} />
          </Link>
        </div>
      </div>

      {eyeItems.length === 0 ? (
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-white/20 text-sm tracking-widest uppercase">
            {t("canvas.empty")}
          </p>
        </div>
      ) : (
        <main className="max-w-[1400px] mx-auto">
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-0"
            style={{ paddingTop: 80 }}
          >
            {eyeItems.map((eye) => (
              <div
                key={eye.cid}
                className="relative w-full aspect-[4/1] overflow-hidden bg-black"
              >
                {/*
                 * А-3: src — signed URL, не постоянный публичный URL.
                 * При истечении срока действия видео перестанет воспроизводиться —
                 * пользователь увидит чёрный кадр. При необходимости добавить
                 * механизм обновления URL (onError → перезапрос signed URL).
                 */}
                <video
                  src={eye.signedUrl}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain block"
                  onError={(e) => {
                    // При ошибке (протухший URL) скрываем элемент
                    (e.currentTarget as HTMLVideoElement).style.display = "none";
                  }}
                />
              </div>
            ))}
          </div>

          {hasMore && (
            <div
              ref={loadMoreRef}
              className="h-32 flex items-center justify-center"
              aria-label="Loading more"
            >
              <div className="w-4 h-4 border border-white/20 border-t-white/80 rounded-full animate-spin" />
            </div>
          )}
        </main>
      )}
    </div>
  );
};

export default Canvas;
