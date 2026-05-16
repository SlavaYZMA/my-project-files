/**
 * src/hooks/useMediaRecorder.ts
 *
 * Хук управления MediaRecorder.
 * Выделен из Camera.tsx — разделение ответственности (Р-2).
 *
 * Исправления из аудита:
 *   СРД-2: prepIntervalRef вынесен наружу → очищается при сбросе записи
 *   А-5:   имя файла скачивания не содержит timestamp
 */

import { useRef, useCallback } from "react";

// ─── Типы ────────────────────────────────────────────────────────
interface MediaRecorderHookReturn {
  recorderRef: React.MutableRefObject<MediaRecorder | null>;
  chunksRef: React.MutableRefObject<Blob[]>;
  start: (
    canvas: HTMLCanvasElement,
    fps: number,
    bitrate: number,
    onStop: (blob: Blob) => void
  ) => void;
  stop: () => void;
  reset: () => void;
  selectedMimeType: () => string;
}

// ─── Определение поддерживаемого кодека ──────────────────────────
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

// ─── Хук ─────────────────────────────────────────────────────────
export function useMediaRecorder(): MediaRecorderHookReturn {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(
    (
      canvas: HTMLCanvasElement,
      fps: number,
      bitrate: number,
      onStop: (blob: Blob) => void
    ) => {
      const mimeType = selectMimeType();
      const stream = canvas.captureStream(fps);
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

      const options: MediaRecorderOptions = { mimeType };
      if (!isMobile) {
        options.videoBitsPerSecond = bitrate;
      }

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch (err) {
        throw new Error(
          `MediaRecorder init failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      chunksRef.current = [];
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        onStop(blob);
      };

      recorder.onerror = (e) => {
        console.error("MediaRecorder error:", e);
      };

      recorder.start(100); // интервал сбора chunk — 100мс
    },
    []
  );

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const reset = useCallback(() => {
    if (recorderRef.current) {
      if (recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
    }
    chunksRef.current = [];
  }, []);

  return {
    recorderRef,
    chunksRef,
    start,
    stop,
    reset,
    selectedMimeType: selectMimeType,
  };
}
