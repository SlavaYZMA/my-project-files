-- ─────────────────────────────────────────────────────────────────
-- Миграция: hardening безопасности
-- Исправления: ВЫС-1 (публичный bucket), ВЫС-2 (тип видео в БД),
--              КРИТ-4 (убираем права записи с клиента)
-- ─────────────────────────────────────────────────────────────────

-- 1. Обновляем таблицу eyes: type хранит MIME-тип (не просто 'video')
ALTER TABLE public.eyes
  ALTER COLUMN type TYPE TEXT,
  ALTER COLUMN type SET DEFAULT 'video/webm',
  ADD CONSTRAINT eyes_type_check
    CHECK (type IN ('video/webm', 'video/mp4'));

-- 2. RLS на таблице eyes:
--    Чтение (для Canvas) — разрешено всем
--    Запись/удаление — ТОЛЬКО через service role (edge functions)
--    Существующая политика SELECT уже есть, дополняем:

-- Запрет прямой записи с клиента (anon key)
-- Edge functions используют service role → RLS обходится на уровне role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'eyes'
      AND policyname = 'Service role can insert eyes'
  ) THEN
    CREATE POLICY "Service role can insert eyes"
      ON public.eyes
      FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'eyes'
      AND policyname = 'Service role can delete eyes'
  ) THEN
    CREATE POLICY "Service role can delete eyes"
      ON public.eyes
      FOR DELETE
      TO service_role
      USING (true);
  END IF;
END $$;

-- 3. RLS на delete_tokens — только service role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'delete_tokens'
      AND policyname = 'Service role manages delete tokens'
  ) THEN
    CREATE POLICY "Service role manages delete tokens"
      ON public.delete_tokens
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 4. Storage: bucket НЕ публичный — раздача через signed URLs
--    Если bucket уже создан — обновляем флаг public
UPDATE storage.buckets
  SET public = false
  WHERE id = 'eyes';

-- 5. Storage policies: убираем широкое чтение, оставляем только service role
-- Удаляем старую открытую политику чтения
DROP POLICY IF EXISTS "Anyone can view eye videos" ON storage.objects;

-- Service role может читать, загружать, удалять
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND policyname = 'Service role full access to eyes bucket'
  ) THEN
    CREATE POLICY "Service role full access to eyes bucket"
      ON storage.objects
      FOR ALL
      TO service_role
      USING (bucket_id = 'eyes')
      WITH CHECK (bucket_id = 'eyes');
  END IF;
END $$;

-- 6. Индекс на delete_tokens.delete_token для быстрого поиска при удалении
CREATE INDEX IF NOT EXISTS idx_delete_tokens_token
  ON public.delete_tokens (delete_token);

-- 7. Индекс на eyes.created_at для пагинации Canvas
CREATE INDEX IF NOT EXISTS idx_eyes_created_at
  ON public.eyes (created_at DESC);
