/**
 * src/pages/Camera.tsx
 *
 * Страница записи видео.
 *
 * Исправления из аудита:
 *   КРИТ-4: saveForever вызывает только edge function — нет прямых обращений к Supabase
 *   СРД-2:  prepIntervalRef очищается при сбросе — race condition в countdown устранён
 *   СРД-3:  ctx.drawImage ошибки обрабатываются — нет немого поглощения
 *   UI-1:   Trigger warning перемещён ПЕРЕД чекбоксом согласия
 *   UI-2:   Отладочная жёлтая рамка удалена
 *   UI-3:   alert() заменён на state-driven сообщение об ошибке
 *   UI-4:   aria-live добавлен для статуса камеры
 *   А-5:    Имя файла при скачивании не содержит timestamp
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Minus } from "lucide-react";
import { FaceMesh, Results } from "@mediapipe/face_mesh";
import { Camera as MediaPipeCamera } from "@mediapipe/camera_utils";
import { useLanguage } from "@/contexts/LanguageContext";
import ConsentModal from "@/components/modals/ConsentModal";

// ─── Типы ────────────────────────────────────────────────────────
type RecordingState = "identity" | "idle" | "recording" | "preview";
type BgState = "red" | "orange" | "green";

// ─── Конфигурация ─────────────────────────────────────────────────
const CONFIG = {
  FRAME_WIDTH: 512,
  FRAME_HEIGHT: 128,
  RECORD_SECONDS: 5,
  FPS: 20,
  BITRATE: 1_000_000,
  ZOOM_MIN: 1,
  ZOOM_MAX: 3,
  ZOOM_STEP: 0.1,
  MIN_EYE_WIDTH: 0.08,
  MAX_EYE_WIDTH: 0.35,
  FRAME_MARGIN: 0.05,
  GAZE_THRESHOLD_X: 0.15,
  GAZE_THRESHOLD_Y: 0.15,
  STABILITY_WINDOW: 5,
  STABILITY_MIN_VALID: 4,
  BLINK_TOLERANCE_MS: 600,
} as const;

// ─── Landmark indices ─────────────────────────────────────────────
const LEFT_EYE_INDICES = [33, 133, 160, 159, 158, 157, 173, 246, 161, 163];
const RIGHT_EYE_INDICES = [362, 263, 387, 386, 385, 384, 398, 466, 388, 390];
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;
const LEFT_EYE_INNER = 133;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
const LEFT_EYE_TOP = 159;
const LEFT_EYE_BOTTOM = 145;
const RIGHT_EYE_TOP = 386;
const RIGHT_EYE_BOTTOM = 374;

// ─── Helpers ─────────────────────────────────────────────────────
interface EyeData {
  leftEye: { x: number; y: number; width: number; height: number } | null;
  rightEye: { x: number; y: number; width: number; height: number } | null;
  bothInFrame: boolean;
  hasValidSize: boolean;
}

function calcEyeData(
  landmarks: Results["multiFaceLandmarks"][0]
): EyeData {
  const empty: EyeData = {
    leftEye: null,
    rightEye: null,
    bothInFrame: false,
    hasValidSize: false,
  };
  if (!landmarks || landmarks.length < 478) return empty;

  const getBounds = (indices: number[]) => {
    const pts = indices.map((i) => landmarks[i]);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
      centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  };

  const l = getBounds(LEFT_EYE_INDICES);
  const r = getBounds(RIGHT_EYE_INDICES);
  const m = CONFIG.FRAME_MARGIN;

  const inFrame = (b: ReturnType<typeof getBounds>) =>
    b.minX > m && b.maxX < 1 - m && b.minY > m && b.maxY < 1 - m;

  return {
    leftEye: { x: l.centerX, y: l.centerY, width: l.width, height: l.height },
    rightEye: {
      x: r.centerX,
      y: r.centerY,
      width: r.width,
      height: r.height,
    },
    bothInFrame: inFrame(l) && inFrame(r),
    hasValidSize:
      (l.width + r.width) / 2 >= CONFIG.MIN_EYE_WIDTH &&
      (l.width + r.width) / 2 <= CONFIG.MAX_EYE_WIDTH,
  };
}

function calcGaze(landmarks: Results["multiFaceLandmarks"][0]): boolean {
  if (!landmarks || landmarks.length < 478) return false;

  const check = (
    irisIdx: number,
    innerIdx: number,
    outerIdx: number,
    topIdx: number,
    bottomIdx: number
  ) => {
    const iris = landmarks[irisIdx];
    const inner = landmarks[innerIdx];
    const outer = landmarks[outerIdx];
    const top = landmarks[topIdx];
    const bottom = landmarks[bottomIdx];
    const w = Math.abs(outer.x - inner.x);
    const h = Math.abs(top.y - bottom.y);
    const cx = (inner.x + outer.x) / 2;
    const cy = (top.y + bottom.y) / 2;
    return (
      Math.abs(iris.x - cx) / w <= CONFIG.GAZE_THRESHOLD_X &&
      Math.abs(iris.y - cy) / h <= CONFIG.GAZE_THRESHOLD_Y
    );
  };

  return (
    check(
      LEFT_IRIS_CENTER,
      LEFT_EYE_INNER,
      LEFT_EYE_OUTER,
      LEFT_EYE_TOP,
      LEFT_EYE_BOTTOM
    ) &&
    check(
      RIGHT_IRIS_CENTER,
      RIGHT_EYE_INNER,
      RIGHT_EYE_OUTER,
      RIGHT_EYE_TOP,
      RIGHT_EYE_BOTTOM
    )
  );
}

function pushWindow(win: boolean[], value: boolean): boolean {
  win.push(value);
  if (win.length > CONFIG.STABILITY_WINDOW) win.shift();
  return win.filter(Boolean).length >= CONFIG.STABILITY_MIN_VALID;
}

// ─── Компонент ───────────────────────────────────────────────────
const Camera = () => {
  const { t, language } = useLanguage();

  // Refs — DOM
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Refs — стриминг / запись
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const faceMeshRef = useRef<FaceMesh | null>(null);
  const mpCameraRef = useRef<MediaPipeCamera | null>(null);

  // Refs — стабилизация детекции
  const detectionWinRef = useRef<boolean[]>([]);
  const gazeWinRef = useRef<boolean[]>([]);
  const blinkStartRef = useRef<number | null>(null);

  // Refs — синхронизация состояния (без перерендера)
  const stateRef = useRef<RecordingState>("identity");
  const bgStateRef = useRef<BgState>("red");
  const isStartingRef = useRef(false);

  // СРД-2: prepIntervalRef вынесен в ref — очищается при сбросе
  const prepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // State — UI
  const [state, setState] = useState<RecordingState>("identity");
  const [bgState, setBgState] = useState<BgState>("red");
  const [recordTime, setRecordTime] = useState(CONFIG.RECORD_SECONDS);
  const [prepTimer, setPrepTimer] = useState<number | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [deleteUrl, setDeleteUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null); // UI-3: вместо alert()
  const [zoom, setZoom] = useState(1.5);
  const [supportsHardwareZoom, setSupportsHardwareZoom] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isIdentified, setIsIdentified] = useState(false);

  // Синхронизация ref ↔ state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    bgStateRef.current = bgState;
  }, [bgState]);

  // ─── Отрисовка кадра ─────────────────────────────────────────
  const drawFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!ctx) return;

    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const scaleX = CONFIG.FRAME_WIDTH / video.videoWidth;
    const scaleY = CONFIG.FRAME_HEIGHT / video.videoHeight;
    const baseScale = Math.max(scaleX, scaleY);
    const effectiveZoom = supportsHardwareZoom ? 1 : zoom;
    const finalScale = baseScale * effectiveZoom;
    const sw = CONFIG.FRAME_WIDTH / finalScale;
    const sh = CONFIG.FRAME_HEIGHT / finalScale;
    const sx = (video.videoWidth - sw) / 2;
    const sy = (video.videoHeight - sh) / 2;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
    ctx.save();
    ctx.translate(CONFIG.FRAME_WIDTH, 0);
    ctx.scale(-1, 1);

    // СРД-3: Явная обработка ошибок drawImage
    try {
      ctx.drawImage(
        video,
        sx, sy, sw, sh,
        0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT
      );
    } catch (err) {
      // Видеопоток временно недоступен — оставляем чёрный кадр,
      // не скрываем ошибку молча
      if (process.env.NODE_ENV === "development") {
        console.warn("drawFrame: drawImage failed", err);
      }
    }

    ctx.restore();
  }, [zoom, supportsHardwareZoom]);

  // ─── Render loop ──────────────────────────────────────────────
  const drawLoopRef = useRef<number>(0);
  const drawLoop = useCallback(() => {
    if (stateRef.current === "preview") return;
    drawFrame();
    drawLoopRef.current = requestAnimationFrame(drawLoop);
  }, [drawFrame]);

  // ─── Запись — старт ──────────────────────────────────────────
  const startRecording = useCallback(() => {
    if (stateRef.current !== "idle" || isStartingRef.current) return;
    isStartingRef.current = true;
    setState("recording");
    setIsRecording(false);

    let prepCount = 3;
    setPrepTimer(prepCount);

    // СРД-2: Сохраняем в ref — очищается в resetRecording
    prepIntervalRef.current = setInterval(() => {
      prepCount -= 1;
      if (prepCount > 0) {
        setPrepTimer(prepCount);
      } else {
        clearInterval(prepIntervalRef.current!);
        prepIntervalRef.current = null;
        setPrepTimer(null);
        beginActualRecording();
      }
    }, 1000);

    function beginActualRecording() {
      isStartingRef.current = false;
      setRecordTime(CONFIG.RECORD_SECONDS);
      chunksRef.current = [];
      setIsRecording(true);

      const canvas = canvasRef.current!;
      canvas.width = CONFIG.FRAME_WIDTH;
      canvas.height = CONFIG.FRAME_HEIGHT;
      drawFrame();

      // Небольшая задержка — дать браузеру зафиксировать первый кадр
      setTimeout(() => {
        const mimeType = selectMimeType();
        const stream = canvas.captureStream(CONFIG.FPS);
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const options: MediaRecorderOptions = { mimeType };
        if (!isMobile) options.videoBitsPerSecond = CONFIG.BITRATE;

        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, options);
        } catch (err) {
          console.error("MediaRecorder init failed:", err);
          isStartingRef.current = false;
          setState("idle");
          return;
        }

        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data?.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          setRecordedBlob(blob);
          setState("preview");
          if (previewRef.current) {
            if (previewRef.current.src) URL.revokeObjectURL(previewRef.current.src);
            const url = URL.createObjectURL(blob);
            previewRef.current.src = url;
            previewRef.current
              .play()
              .catch(() => {/* автоплей может быть заблокирован */});
          }
        };

        recorder.start(100);

        const startTime = Date.now();
        let lastSecond = CONFIG.RECORD_SECONDS;
        recordIntervalRef.current = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const left = CONFIG.RECORD_SECONDS - elapsed;
          if (left !== lastSecond) {
            lastSecond = left;
            setRecordTime(Math.max(0, left));
          }
          if (left <= 0) {
            clearInterval(recordIntervalRef.current!);
            recordIntervalRef.current = null;
            if (recorderRef.current?.state === "recording") {
              recorderRef.current.stop();
            }
          }
        }, 100);
      }, 50);
    }
  }, [drawFrame]);

  // ─── FaceMesh results ─────────────────────────────────────────
  const onFaceMeshResults = useCallback(
    (results: Results) => {
      const cur = stateRef.current;
      if (cur === "identity" || cur === "preview") return;

      const now = Date.now();

      if (
        !results.multiFaceLandmarks ||
        results.multiFaceLandmarks.length === 0
      ) {
        if (blinkStartRef.current === null) {
          blinkStartRef.current = now;
        } else if (now - blinkStartRef.current > CONFIG.BLINK_TOLERANCE_MS) {
          detectionWinRef.current = [];
          gazeWinRef.current = [];
          setBgState("red");
          if (cur === "recording" && recorderRef.current?.state === "recording") {
            recorderRef.current.pause();
            setIsRecording(false);
          }
        }
        return;
      }

      blinkStartRef.current = null;
      const lm = results.multiFaceLandmarks[0];
      const eyeData = calcEyeData(lm);
      const gazeOk = calcGaze(lm);
      const detectionOk =
        eyeData.leftEye !== null &&
        eyeData.rightEye !== null &&
        eyeData.bothInFrame &&
        eyeData.hasValidSize;

      const detectionStable = pushWindow(detectionWinRef.current, detectionOk);
      const gazeStable = pushWindow(gazeWinRef.current, gazeOk);

      const newBg: BgState = !detectionStable
        ? "red"
        : !gazeStable
        ? "orange"
        : "green";

      setBgState(newBg);

      if (cur === "idle" && newBg === "green") {
        startRecording();
      } else if (cur === "recording" && !detectionStable) {
        // Лицо вышло из кадра во время записи — сбрасываем
        if (recorderRef.current) {
          recorderRef.current.stop();
          recorderRef.current = null;
        }
        if (recordIntervalRef.current) {
          clearInterval(recordIntervalRef.current);
          recordIntervalRef.current = null;
        }
        chunksRef.current = [];
        setState("idle");
        setRecordTime(CONFIG.RECORD_SECONDS);
        setPrepTimer(null);
        setIsRecording(false);
        detectionWinRef.current = [];
        gazeWinRef.current = [];
      }
    },
    [startRecording]
  );

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => {
    onFaceMeshResultsRef.current = onFaceMeshResults;
  }, [onFaceMeshResults]);

  // ─── Инициализация камеры ─────────────────────────────────────
  useEffect(() => {
    if (state === "identity") return;

    let cancelled = false;

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.() as Record<string, unknown>;
        if (caps && "zoom" in caps) setSupportsHardwareZoom(true);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // А-4: Self-hosted MediaPipe — не CDN
        const faceMesh = new FaceMesh({
          locateFile: (file) => `/mediapipe/${file}`,
        });
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        faceMesh.onResults((r) => onFaceMeshResultsRef.current(r));
        faceMeshRef.current = faceMesh;

        if (videoRef.current) {
          const mpCam = new MediaPipeCamera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current && faceMeshRef.current) {
                await faceMeshRef.current.send({ image: videoRef.current });
              }
            },
            width: 1280,
            height: 720,
          });
          mpCam.start();
          mpCameraRef.current = mpCam;
        }

        drawLoopRef.current = requestAnimationFrame(drawLoop);
      } catch (err) {
        console.error("Camera init error:", err);
      }
    };

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(drawLoopRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      mpCameraRef.current?.stop();
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
      if (prepIntervalRef.current) clearInterval(prepIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state === "identity"]);

  // ─── Hardware zoom ────────────────────────────────────────────
  useEffect(() => {
    if (!supportsHardwareZoom || !streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    // @ts-expect-error — zoom не в стандартных типах
    track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
  }, [zoom, supportsHardwareZoom]);

  // ─── КРИТ-4: Сохранение ТОЛЬКО через edge function ───────────
  const saveForever = async () => {
    if (!recordedBlob || !consentAccepted) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const formData = new FormData();
      // А-5: Имя файла анонимное — edge function переименует в UUID
      formData.append("video", recordedBlob, "video.webm");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-eyes`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: formData,
        }
      );

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? `Upload failed with status ${res.status}`
        );
      }

      const { deleteUrl: url } = await res.json();
      setDeleteUrl(url);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Ошибка сохранения";
      // UI-3: Вместо alert() — управляемое state-сообщение
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  // А-5: Скачивание без timestamp в имени файла
  const downloadVideo = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement("a");
    a.href = url;
    // А-5: Имя не содержит timestamp — только статичный identifier
    a.download = "eye-recording.webm";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Сброс записи ────────────────────────────────────────────
  const resetRecording = () => {
    // СРД-2: Очищаем prepInterval при сбросе
    if (prepIntervalRef.current) {
      clearInterval(prepIntervalRef.current);
      prepIntervalRef.current = null;
    }
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    if (recorderRef.current?.state !== "inactive") {
      recorderRef.current?.stop();
    }
    recorderRef.current = null;
    isStartingRef.current = false;

    setState("idle");
    setRecordedBlob(null);
    setDeleteUrl(null);
    setSaveError(null);
    setRecordTime(CONFIG.RECORD_SECONDS);
    setPrepTimer(null);
    setConsentAccepted(false);
    setIsRecording(false);
    detectionWinRef.current = [];
    gazeWinRef.current = [];
    setBgState("red");

    if (previewRef.current) {
      previewRef.current.src = "";
    }
  };

  const adjustZoom = (delta: number) =>
    setZoom((prev) =>
      Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, prev + delta))
    );

  // ─── Экран идентификации ──────────────────────────────────────
  if (state === "identity") {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <div className="max-w-lg text-center">
          <div className="mb-8">
            <div className="w-16 h-16 border-2 border-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <div className="w-8 h-8 border border-white/40 rounded-full" />
            </div>
          </div>

          <div className="mb-10 bg-white/5 p-6 rounded-lg border border-white/10 text-left opacity-80">
            <h3 className="text-white/90 font-bold text-xs uppercase tracking-widest mb-4">
              {language === "ru" ? "Как записывать видео:" : "How to record video:"}
            </h3>
            <ul className="space-y-3 text-white/60 text-[11px] leading-relaxed">
              <li>
                •{" "}
                {language === "ru"
                  ? "Сядьте перед камерой, только ваши глаза должны быть в рамке."
                  : "Sit in front of the camera, only your eyes should be in the frame."}
              </li>
              <li>
                •{" "}
                {language === "ru"
                  ? "Следите за надписью снизу:"
                  : "Follow the status text below:"}
                <ul className="ml-4 mt-2 space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-red-600 rounded-full" />
                    {language === "ru"
                      ? "Красный – лицо/глаза не в кадре."
                      : "Red – face/eyes not in frame."}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                    {language === "ru"
                      ? "Жёлтый – глаза в кадре, взгляд не прямо."
                      : "Yellow – eyes in frame, not looking straight."}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                    {language === "ru"
                      ? "Зелёный – можно записывать."
                      : "Green – ready to record."}
                  </li>
                </ul>
              </li>
              <li>
                •{" "}
                {language === "ru"
                  ? "Когда индикатор зелёный, запись начнётся автоматически (5 секунд)."
                  : "When the indicator is green, recording starts automatically (5 seconds)."}
              </li>
              <li>
                •{" "}
                {language === "ru"
                  ? "После записи можно предпросмотреть, сохранить или повторить."
                  : "After recording, you can preview, save, or retake."}
              </li>
            </ul>
          </div>

          <div className="mb-10 border border-white/10 p-5 text-left bg-white/[0.02]">
            <div className="flex items-start gap-4">
              <input
                type="checkbox"
                id="identity-confirm"
                checked={isIdentified}
                onChange={(e) => setIsIdentified(e.target.checked)}
                className="mt-1.5 w-4 h-4 accent-white cursor-pointer"
              />
              <label
                htmlFor="identity-confirm"
                className="text-white text-base md:text-lg leading-snug cursor-pointer select-none"
              >
                {language === "ru"
                  ? "Я подтверждаю, что идентифицирую себя как женщина, пережившая гендерное насилие."
                  : "I confirm that I identify as a woman who has experienced gender-based violence."}
              </label>
            </div>
          </div>

          <button
            onClick={() => setState("idle")}
            disabled={!isIdentified}
            className={`px-12 py-4 text-sm font-bold uppercase tracking-widest transition-all active:scale-95 ${
              isIdentified
                ? "bg-white text-black hover:bg-white/90"
                : "bg-white/10 text-white/20 cursor-not-allowed"
            }`}
          >
            {language === "ru" ? "К СЪЕМКЕ" : "GO TO CAMERA"}
          </button>

          <Link
            to="/"
            className="block mt-8 text-white/30 text-xs hover:text-white/60 transition-colors"
          >
            ← {language === "ru" ? "Назад" : "Back"}
          </Link>
        </div>
      </div>
    );
  }

  // ─── Основной экран камеры ────────────────────────────────────
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center relative font-mono">
      <Link
        to="/"
        aria-label={language === "ru" ? "Вернуться на главную" : "Back to home"}
        className="absolute top-6 left-6 text-white/40 hover:text-white transition-colors z-50"
      >
        <ArrowLeft size={24} />
      </Link>

      {/* Статус записи */}
      {state === "recording" && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 w-full max-w-xs text-center">
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                isRecording ? "bg-red-600 animate-pulse" : "bg-yellow-500"
              }`}
            />
            <span className="text-xs text-white/60 tracking-widest uppercase">
              {isRecording
                ? t("camera.recording")
                : prepTimer !== null
                ? language === "ru"
                  ? "ПРИГОТОВЬТЕСЬ"
                  : "GET READY"
                : t("camera.paused")}
            </span>
          </div>
          {!isRecording && prepTimer !== null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-white/40 leading-tight">
                {language === "ru"
                  ? "Смотрите в камеру, пожалуйста"
                  : "Please look into the camera"}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full max-w-2xl pt-20">
        {/* Фрейм камеры */}
        <div className="relative mb-8">
          <div
            className={`relative overflow-hidden rounded-xl transition-shadow duration-300 ${
              state === "recording" && bgState === "green" ? "animate-pulse" : ""
            }`}
            style={{
              width: CONFIG.FRAME_WIDTH,
              height: CONFIG.FRAME_HEIGHT,
              boxShadow:
                bgState === "green"
                  ? "inset 0 0 0 3px rgba(34, 197, 94, 0.6)"
                  : bgState === "orange"
                  ? "inset 0 0 0 3px rgba(249, 115, 22, 0.6)"
                  : "inset 0 0 0 3px rgba(239, 68, 68, 0.6)",
            }}
          >
            <canvas
              ref={canvasRef}
              width={CONFIG.FRAME_WIDTH}
              height={CONFIG.FRAME_HEIGHT}
              className={state === "preview" ? "hidden" : ""}
            />

            {/* UI-2: Убрана отладочная жёлтая рамка */}
            <video
              ref={previewRef}
              playsInline
              loop
              muted
              autoPlay
              className={
                state !== "preview"
                  ? "hidden"
                  : "w-full h-full object-contain block"
              }
            />

            {/* Прицельные маркеры */}
            {state !== "preview" && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                {(["left-[15%]", "right-[15%]"] as const).map((pos, i) => (
                  <div
                    key={i}
                    className={`absolute top-1/2 -translate-y-1/2 ${pos} w-[30%] h-[60%] border border-dashed rounded-full transition-colors duration-300`}
                    style={{
                      borderColor:
                        bgState === "green"
                          ? "rgba(34, 197, 94, 0.4)"
                          : bgState === "orange"
                          ? "rgba(249, 115, 22, 0.3)"
                          : "rgba(239, 68, 68, 0.3)",
                    }}
                  />
                ))}
                {[
                  "top-2 left-2 border-l border-t",
                  "top-2 right-2 border-r border-t",
                  "bottom-2 left-2 border-l border-b",
                  "bottom-2 right-2 border-r border-b",
                ].map((cls, i) => (
                  <div key={i} className={`absolute w-3 h-3 ${cls} border-white/30`} />
                ))}
              </div>
            )}
          </div>

          {/* UI-4: aria-live для статуса камеры */}
          <div className="mt-3 text-center">
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`text-xs transition-colors duration-300 ${
                state === "recording" && isRecording
                  ? "text-green-400"
                  : bgState === "green"
                  ? "text-green-400"
                  : bgState === "orange"
                  ? "text-orange-400"
                  : "text-red-400"
              }`}
            >
              {state === "recording" && isRecording
                ? t("camera.statusRecording")
                : bgState === "green"
                ? t("camera.statusGreen")
                : bgState === "orange"
                ? t("camera.statusOrange")
                : t("camera.statusRed")}
            </p>
          </div>
        </div>

        {/* Таймер обратного отсчёта */}
        {state === "recording" && (
          <div className="flex flex-col items-center mb-8">
            {prepTimer !== null ? (
              <div className="flex flex-col items-center">
                <span className="text-xs uppercase tracking-[0.3em] text-yellow-500 mb-2 animate-pulse">
                  {language === "ru" ? "Приготовьтесь" : "Get Ready"}
                </span>
                <div
                  className="text-8xl md:text-9xl font-bold text-yellow-500 tabular-nums"
                  aria-live="polite"
                >
                  {prepTimer}
                </div>
              </div>
            ) : (
              <div
                className={`text-8xl md:text-9xl font-bold tabular-nums transition-colors duration-200 ${
                  isRecording ? "text-white" : "text-white/30"
                }`}
                aria-live="polite"
              >
                {recordTime}
              </div>
            )}
          </div>
        )}

        {/* Управление зумом */}
        {(state === "idle" || state === "recording") && !supportsHardwareZoom && (
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => adjustZoom(-CONFIG.ZOOM_STEP)}
              aria-label={language === "ru" ? "Уменьшить зум" : "Zoom out"}
              className="w-8 h-8 border border-white/20 flex items-center justify-center text-white/40 hover:text-white hover:border-white/40 transition-colors"
            >
              <Minus size={14} />
            </button>
            <span className="text-xs text-white/30 w-10 text-center tabular-nums">
              {zoom.toFixed(1)}×
            </span>
            <button
              onClick={() => adjustZoom(CONFIG.ZOOM_STEP)}
              aria-label={language === "ru" ? "Увеличить зум" : "Zoom in"}
              className="w-8 h-8 border border-white/20 flex items-center justify-center text-white/40 hover:text-white hover:border-white/40 transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>
        )}

        {/* Блок preview — действия */}
        {state === "preview" && !deleteUrl && (
          <div className="flex flex-col gap-4 w-full max-w-xs">
            {/* UI-1: Trigger warning ПЕРЕД чекбоксом согласия */}
            <div className="py-3 px-4 border border-yellow-500/20 bg-yellow-500/5">
              <p className="text-yellow-500/70 text-xs leading-relaxed">
                {t("support.trigger")}
              </p>
            </div>

            <div className="border border-white/10 p-4">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="consent-save"
                  checked={consentAccepted}
                  onChange={(e) => setConsentAccepted(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-white"
                />
                <label
                  htmlFor="consent-save"
                  className="text-white/60 text-xs cursor-pointer"
                >
                  {t("camera.consent")}
                  <button
                    onClick={() => setShowConsent(true)}
                    className="block text-white/40 underline hover:text-white/60 transition-colors mt-1"
                  >
                    {t("camera.viewConsent")}
                  </button>
                </label>
              </div>
            </div>

            {/* UI-3: Сообщение об ошибке вместо alert() */}
            {saveError && (
              <div
                role="alert"
                className="px-4 py-3 border border-red-500/30 bg-red-500/5 text-red-400 text-xs"
              >
                {saveError}
              </div>
            )}

            <button
              onClick={saveForever}
              disabled={isSaving || !consentAccepted}
              className="w-full px-8 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving
                ? t("camera.saving")
                : t("camera.save")}
            </button>

            <button
              onClick={downloadVideo}
              className="w-full px-8 py-3 border border-white/20 text-white/40 text-xs uppercase tracking-widest hover:bg-white/5 transition-colors"
            >
              {t("camera.download")}
            </button>

            <button
              onClick={resetRecording}
              className="w-full px-8 py-3 text-white/20 text-xs uppercase tracking-widest hover:text-white/40 transition-colors"
            >
              {t("camera.retake")}
            </button>
          </div>
        )}

        {/* Успешное сохранение — ссылка удаления */}
        {deleteUrl && (
          <div className="text-center max-w-sm">
            <div className="text-green-500 mb-4 text-2xl" aria-hidden="true">
              ✓
            </div>
            <p className="text-white/60 text-xs mb-2">{t("camera.deleteLink")}</p>
            <code className="block bg-white/5 p-3 text-xs break-all text-white/60 mb-6">
              {deleteUrl}
            </code>
            <Link
              to="/canvas"
              className="inline-block px-8 py-3 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors"
            >
              {t("camera.viewCanvas")}
            </Link>
          </div>
        )}
      </div>

      {/* Скрытый видеоэлемент для камеры */}
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

// ─── Helper: определение кодека (используется внутри компонента) ──
function selectMimeType(): string {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const candidates = isMobile
    ? ["video/mp4", "video/webm;codecs=h264", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return (
    candidates.find((t) => {
      try {
        return MediaRecorder.isTypeSupported(t);
      } catch {
        return false;
      }
    }) ?? "video/webm"
  );
}

export default Camera;
