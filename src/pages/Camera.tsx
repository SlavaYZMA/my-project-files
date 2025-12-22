import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Plus, Minus } from 'lucide-react';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { Camera as MediaPipeCamera } from '@mediapipe/camera_utils';
import { useLanguage } from '@/contexts/LanguageContext';
import ConsentModal from '@/components/modals/ConsentModal';

type RecordingState = 'identity' | 'intro' | 'idle' | 'recording' | 'preview';
type BackgroundState = 'red' | 'orange' | 'green';

const CONFIG = {
  FRAME_WIDTH: 512,
  FRAME_HEIGHT: 128,
  RECORD_SECONDS: 5,
  FPS: 20,
  BITRATE: 1000000,
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
};

// ... (все константы и интерфейсы без изменений)

const Camera = () => {
  const { t, language } = useLanguage();

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [state, setState] = useState<RecordingState>('identity');
  const [recordTime, setRecordTime] = useState(CONFIG.RECORD_SECONDS);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [deleteUrl, setDeleteUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [zoom, setZoom] = useState(1.5);
  const [supportsHardwareZoom, setSupportsHardwareZoom] = useState(false);
  const [bgState, setBgState] = useState<BackgroundState>('red');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // ... все функции calculateGaze, calculateEyeData, onFaceMeshResults и т.д. — оставляем как в предыдущей версии

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'idle') return;

    console.log('→ START RECORDING');

    setState('recording');
    setRecordTime(CONFIG.RECORD_SECONDS);
    chunksRef.current = [];

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = CONFIG.FRAME_WIDTH * dpr;
    canvas.height = CONFIG.FRAME_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // ← КРИТИЧЕСКИ ВАЖНО: задаём видимые размеры
    canvas.style.width = CONFIG.FRAME_WIDTH + 'px';
    canvas.style.height = CONFIG.FRAME_HEIGHT + 'px';
    canvas.style.display = 'block';

    let active = true;

    const draw = () => {
      if (!active || !videoRef.current) return;

      ctx.clearRect(0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
      ctx.save();
      ctx.translate(CONFIG.FRAME_WIDTH, 0);
      ctx.scale(-1, 1);

      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      const effectiveZoom = supportsHardwareZoom ? 1 : zoom;
      const scale = Math.max(CONFIG.FRAME_WIDTH / (vw / effectiveZoom), CONFIG.FRAME_HEIGHT / (vh / effectiveZoom));
      const sw = CONFIG.FRAME_WIDTH / scale;
      const sh = CONFIG.FRAME_HEIGHT / scale;
      const sx = (vw - sw) / 2;
      const sy = (vh - sh) / 2;

      ctx.drawImage(videoRef.current, sx, sy, sw, sh, 0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
      ctx.restore();

      if (active) requestAnimationFrame(draw);
    };
    draw();

    const stream = canvas.captureStream(CONFIG.FPS);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: CONFIG.BITRATE });
    recorderRef.current = recorder;

    recorder.ondataavailable = e => e.data.size > 0 && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      active = false;
      if (chunksRef.current.length) {
        const blob = new Blob(chunksRef.current, { type: mime });
        setRecordedBlob(blob);
        setState('preview');
        if (previewRef.current) {
          previewRef.current.src = URL.createObjectURL(blob);
        }
      }
    };
    recorder.start(100);

    // Таймер — теперь 100% работает
    let seconds = CONFIG.RECORD_SECONDS;
    const timer = setInterval(() => {
      seconds--;
      setRecordTime(seconds);
      if (seconds <= 0) {
        clearInterval(timer);
        recorder.stop();
      }
    }, 1000);
  }, [zoom, supportsHardwareZoom]);

  // ... остальной код (resetRecording, saveForever и т.д.) без изменений

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center relative font-mono">
      {/* ... шапка, индикатор записи ... */}

      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full max-w-2xl pt-20">
        <div className="relative mb-8">
          <div
            className="relative overflow-hidden rounded-xl"
            style={{
              width: CONFIG.FRAME_WIDTH,
              height: CONFIG.FRAME_HEIGHT,
              boxShadow: bgState === 'green'
                ? 'inset 0 0 0 3px rgba(34,197,94,0.6)'
                : bgState === 'orange'
                ? 'inset 0 0 0 3px rgba(249,115,22,0.6)'
                : 'inset 0 0 0 3px rgba(239,68,68,0.6)',
            }}
          >
            {/* Чёрный фон */}
            <div className="absolute inset-0 bg-black" />

            {/* Обычное видео — видно только когда НЕ recording */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                transform: `scaleX(-1) scale(${supportsHardwareZoom ? 1 : zoom})`,
                zIndex: state === 'recording' ? 1 : 10,
                opacity: state === 'recording' ? 0 : 1,
              }}
            />

            {/* Canvas — видим ТОЛЬКО во время записи */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0"
              style={{
                transform: 'scaleX(-1)',
                zIndex: state === 'recording' ? 10 : 1,
                opacity: state === 'recording' ? 1 : 0,
                pointerEvents: 'none',
              }}
            />

            {/* Превью */}
            <video
              ref={previewRef}
              playsInline
              loop
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ zIndex: state === 'preview' ? 10 : 1 }}
            />

            {/* Оверлеи (гиды, countdown) */}
            {state !== 'preview' && (
              <div className="absolute inset-0 pointer-events-none z-20">
                {/* ... все линии, кружки, углы, countdown как раньше ... */}
                {countdown !== null && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-9xl font-bold text-white drop-shadow-2xl">{countdown}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Статус под рамкой */}
          <div className="mt-4 text-center text-sm font-medium text-green-400">
            {state === 'recording' ? 'Идёт запись...' : bgState === 'green' ? 'Готово' : bgState === 'orange' ? 'Смотрите в камеру' : 'Поместите глаза в рамку'}
          </div>
        </div>

        {/* Таймер записи — большой и всегда видим */}
        {state === 'recording' && (
          <div className="text-9xl font-bold tabular-nums text-white">
            {recordTime}
          </div>
        )}

        {/* ... зум, превью, кнопки сохранения — без изменений ... */}
      </div>

      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

export default Camera;
