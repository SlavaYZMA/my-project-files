# VISTRUM / ГОРГОНА — Инструкция по применению исправлений безопасности

## ⚡ НЕМЕДЛЕННЫЕ ДЕЙСТВИЯ (до деплоя)

### Шаг 1 — Ротация скомпрометированных ключей

Ключи из `.env` находятся в публичном репозитории (commit `6849f336`).

1. Открыть **Supabase Dashboard → Settings → API**
2. Нажать **Regenerate** для `anon key`
3. Нажать **Regenerate** для `service_role key`
4. Обновить `.env` с новыми ключами (файл НЕ коммитить)
5. Обновить переменные в Supabase Edge Functions:
   ```
   supabase secrets set ADMIN_SECRET=<новый_сильный_пароль>
   supabase secrets set ALLOWED_ORIGINS=https://your-domain.com
   ```

### Шаг 2 — Удаление `.env` из истории Git

```bash
# Установить git-filter-repo
pip install git-filter-repo

# Удалить .env из всей истории
git filter-repo --path .env --invert-paths --force

# Принудительный пуш (предупредить коллег — история перезаписана)
git push origin --force --all
git push origin --force --tags
```

---

## 📁 Структура исправленных файлов

```
vistrum-fixed/
├── .gitignore                                  # КРИТ-1: .env в gitignore
├── .env.example                                # КРИТ-1: шаблон без реальных значений
├── vitest.config.ts                            # Конфигурация юнит-тестов
├── playwright.config.ts                        # Конфигурация e2e-тестов
│
├── supabase/
│   ├── functions/
│   │   ├── save-eyes/index.ts                 # КРИТ-4,5 + ВЫС-1,2,3,5 + А-2
│   │   └── delete-eyes/index.ts               # КРИТ-2,3,5 + ВЫС-3,5 + А-2
│   └── migrations/
│       └── 20260101000000_security_hardening.sql  # ВЫС-1: RLS + private bucket
│
├── src/
│   ├── integrations/supabase/
│   │   └── client.ts                          # ВЫС-4: без localStorage/persistSession
│   ├── hooks/
│   │   ├── useMediaRecorder.ts                # СРД-2: refactor, prepInterval fix
│   │   └── useFaceMesh.ts                     # А-4: self-hosted MediaPipe
│   ├── pages/
│   │   ├── Camera.tsx                         # КРИТ-4 + СРД-2,3 + UI-1,2,3,4 + А-5
│   │   ├── Delete.tsx                         # КРИТ-3 + СРД-1
│   │   └── Canvas.tsx                         # А-3: signed URLs
│   └── components/modals/
│       └── ConsentModal.tsx                   # А-1: честное раскрытие IP-логов
│
└── tests/
    ├── setup.ts
    ├── unit/
    │   ├── deleteToken.test.ts                # race condition, UUID, rate limit
    │   └── consent.test.ts                    # CORS, анонимность, валидация
    └── e2e/
        └── consent-flow.spec.ts               # идентификация, удаление, a11y
```

---

## 🚀 Деплой edge functions

```bash
# Переименовать директорию (СРД-4: пробел в имени)
mv "supabase/functions/delete-eyes " "supabase/functions/delete-eyes"

# Скопировать исправленные функции
cp vistrum-fixed/supabase/functions/save-eyes/index.ts supabase/functions/save-eyes/index.ts
cp vistrum-fixed/supabase/functions/delete-eyes/index.ts supabase/functions/delete-eyes/index.ts

# Установить секреты (КРИТ-2: без хардкода)
supabase secrets set ADMIN_SECRET=$(openssl rand -base64 32)
supabase secrets set ALLOWED_ORIGINS=https://your-production-domain.com

# Деплой функций
supabase functions deploy save-eyes
supabase functions deploy delete-eyes

# Применить миграцию безопасности
supabase db push
```

---

## 🎭 Self-hosting MediaPipe (А-4)

Вместо загрузки с CDN — разместить файлы локально:

```bash
# Скачать файлы MediaPipe в public/mediapipe/
mkdir -p public/mediapipe

MEDIAPIPE_VERSION=0.4.1633559619
BASE_URL="https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MEDIAPIPE_VERSION}"

wget "${BASE_URL}/face_mesh.js" -O public/mediapipe/face_mesh.js
wget "${BASE_URL}/face_mesh_solution_packed_assets.data" -O public/mediapipe/face_mesh_solution_packed_assets.data
wget "${BASE_URL}/face_mesh_solution_packed_assets_loader.js" -O public/mediapipe/face_mesh_solution_packed_assets_loader.js
wget "${BASE_URL}/face_mesh_solution_simd_wasm_bin.js" -O public/mediapipe/face_mesh_solution_simd_wasm_bin.js
wget "${BASE_URL}/face_mesh_solution_simd_wasm_bin.wasm" -O public/mediapipe/face_mesh_solution_simd_wasm_bin.wasm
```

После этого `locateFile: (file) => /mediapipe/${file}` в `useFaceMesh.ts` начнёт работать.

---

## 🧪 Запуск тестов

```bash
# Установить зависимости тестирования
npm install -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom
npm install -D @playwright/test
npx playwright install

# Юнит-тесты
npx vitest run

# Юнит-тесты с покрытием
npx vitest run --coverage

# E2E-тесты (требует запущенного dev-сервера)
npm run dev &
npx playwright test

# E2E в UI-режиме
npx playwright test --ui
```

---

## 📋 Чеклист после деплоя

- [ ] Ключи Supabase ротированы
- [ ] `.env` удалён из истории Git
- [ ] `ADMIN_SECRET` установлен в Supabase Secrets (не хардкод)
- [ ] `ALLOWED_ORIGINS` установлен в Supabase Secrets
- [ ] Миграция `20260101000000_security_hardening.sql` применена
- [ ] Bucket `eyes` переведён в `public: false`
- [ ] Edge functions `save-eyes` и `delete-eyes` передеплоены
- [ ] Директория переименована из `delete-eyes ` → `delete-eyes`
- [ ] Файлы MediaPipe размещены self-hosted в `public/mediapipe/`
- [ ] Юнит-тесты проходят: `npx vitest run`
- [ ] E2E-тесты проходят: `npx playwright test`
- [ ] Canvas отображает видео через signed URLs (не публичные постоянные)
- [ ] Текст согласия обновлён (раздел об IP-логах)

---

## ⚠️ Известные ограничения после исправлений

**Canvas — протухание signed URLs:**
Signed URLs действуют 1 час. Если страница Canvas открыта более 1 часа без перезагрузки — видео перестанут воспроизводиться. При необходимости добавить механизм автообновления URL через `onError` → повторный запрос.

**Rate limiting в edge functions:**
Текущая реализация — in-memory. При перезапуске edge function счётчики сбрасываются. Для продакшн-уровня рекомендуется использовать Supabase KV или Redis для хранения rate limit состояния.

**Self-hosted MediaPipe:**
Файлы MediaPipe (~15 МБ) нужно скачать вручную (см. выше). Без этого шага `useFaceMesh` будет пытаться загрузить файлы с `/mediapipe/` и получит 404. Временная альтернатива — откатиться на CDN URL в `useFaceMesh.ts`, осознавая компромисс с анонимностью.
