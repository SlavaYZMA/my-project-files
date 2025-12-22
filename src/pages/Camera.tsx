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

interface EyeData {
  leftEye: { x: number; y: number; width: number; height: number } | null;
  rightEye: { x: number; y: number; width: number; height: number } | null;
  bothInFrame: boolean;
  hasValidSize: boolean;
}

const Camera = () => {
  const { t, language } = useLanguage();

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const faceMeshRef = useRef<FaceMesh | null>(null);
  const mediaPipeCameraRef = useRef<MediaPipeCamera | null>(null);

  const detectionWindowRef = useRef<boolean[]>([]);
  const gazeWindowRef = useRef<boolean[]>([]);
  const blinkStartRef = useRef<number | null>(null);

  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
  const [isRecording, setIsRecording] = useState(false);

  const recordIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const calculateGaze = useCallback((landmarks: Results['multiFaceLandmarks'][0]): boolean => {
    if (!landmarks || landmarks.length < 478) return false;
    // ... (без изменений, как раньше)
    const leftIris = landmarks[LEFT_IRIS_CENTER];
    const leftInner = landmarks[LEFT_EYE_INNER];
    const leftOuter = landmarks[LEFT_EYE_OUTER];
    const leftTop = landmarks[LEFT_EYE_TOP];
    const leftBottom = landmarks[LEFT_EYE_BOTTOM];

    const leftEyeWidth = Math.abs(leftOuter.x - leftInner.x);
    const leftEyeHeight = Math.abs(leftTop.y - leftBottom.y);
    const leftCenterX = (leftInner.x + leftOuter.x) / 2;
    const leftCenterY = (leftTop.y + leftBottom.y) / 2;

    const leftGazeX = Math.abs(leftIris.x - leftCenterX) / leftEyeWidth;
    const leftGazeY = Math.abs(leftIris.y - leftCenterY) / leftEyeHeight;

    const rightIris = landmarks[RIGHT_IRIS_CENTER];
    const rightInner = landmarks[RIGHT_EYE_INNER];
    const rightOuter = landmarks[RIGHT_EYE_OUTER];
    const rightTop = landmarks[RIGHT_EYE_TOP];
    const rightBottom = landmarks[RIGHT_EYE_BOTTOM];

    const rightEyeWidth = Math.abs(rightOuter.x - rightInner.x);
    const rightEyeHeight = Math.abs(rightTop.y - rightBottom.y);
    const rightCenterX = (rightInner.x + rightOuter.x) / 2;
    const rightCenterY = (rightTop.y + rightBottom.y) / 2;

    const rightGazeX = Math.abs(rightIris.x - rightCenterX) / rightEyeWidth;
    const rightGazeY = Math.abs(rightIris.y - rightCenterY) / rightEyeHeight;

    const leftValid = leftGazeX <= CONFIG.GAZE_THRESHOLD_X && leftGazeY <= CONFIG.GAZE_THRESHOLD_Y;
    const rightValid = rightGazeX <= CONFIG.GAZE_THRESHOLD_X && rightGazeY <= CONFIG.GAZE_THRESHOLD_Y;

    return leftValid && rightValid;
  }, []);

  const calculateEyeData = useCallback((landmarks: Results['multiFaceLandmarks'][0]): EyeData => {
    if (!landmarks || landmarks.length < 478) {
      return { leftEye: null, rightEye: null, bothInFrame: false, hasValidSize: false };
    }
    // ... (без изменений)
    const getEyeBounds = (indices: number[]) => {
      const points = indices.map(i => landmarks[i]);
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
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

    const leftBounds = getEyeBounds(LEFT_EYE_INDICES);
    const rightBounds = getEyeBounds(RIGHT_EYE_INDICES);

    const margin = CONFIG.FRAME_MARGIN;
    const leftInFrame =
      leftBounds.minX > margin && leftBounds.maxX < (1 - margin) &&
      leftBounds.minY > margin && leftBounds.maxY < (1 - margin);
    const rightInFrame =
      rightBounds.minX > margin && rightBounds.maxX < (1 - margin) &&
      rightBounds.minY > margin && rightBounds.maxY < (1 - margin);

    const avgEyeWidth = (leftBounds.width + rightBounds.width) / 2;
    const hasValidSize = avgEyeWidth >= CONFIG.MIN_EYE_WIDTH && avgEyeWidth <= CONFIG.MAX_EYE_WIDTH;

    return {
      leftEye: { x: leftBounds.centerX, y: leftBounds.centerY, width: leftBounds.width, height: leftBounds.height },
      rightEye: { x: rightBounds.centerX, y: rightBounds.centerY, width: rightBounds.width, height: rightBounds.height },
      bothInFrame: leftInFrame && rightInFrame,
      hasValidSize,
    };
  }, []);

  const updateWindow = (window: boolean[], value: boolean): boolean => {
    window.push(value);
    if (window.length > CONFIG.STABILITY_WINDOW) window.shift();
    const validCount = window.filter(v => v).length;
    return validCount >= CONFIG.STABILITY_MIN_VALID;
  };

  const startCountdown = () => {
    setCountdown(3);
    let count = 3;
    const tick = () => {
      count -= 1;
      if (count > 0) {
        setCountdown(count);
        countdownTimeoutRef.current = setTimeout(tick, 1000);
      } else {
        setCountdown(null);
        startRecording();
      }
    };
    countdownTimeoutRef.current = setTimeout(tick, 1000);
  };

  const resetCountdown = () => {
    if (countdownTimeoutRef.current) clearTimeout(countdownTimeoutRef.current);
    setCountdown(null);
  };

  const onFaceMeshResults = useCallback((results: Results) => {
    // ... (логика без изменений, как в предыдущей версии)
    const currentState = stateRef.current;
    if (currentState === 'identity' || currentState === 'intro' || currentState === 'preview') return;

    const now = Date.now();

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (blinkStartRef.current === null) {
        blinkStartRef.current = now;
      } else if (now - blinkStartRef.current > CONFIG.BLINK_TOLERANCE_MS) {
        detectionWindowRef.current = [];
        gazeWindowRef.current = [];
        setBgState('red');
        resetCountdown();
        if (currentState === 'recording' && recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
        }
      }
      return;
    }

    blinkStartRef.current = null;

    const landmarks = results.multiFaceLandmarks[0];
    const eyeData = calculateEyeData(landmarks);
    const gazeValid = calculateGaze(landmarks);

    const detectionValid = eyeData.bothInFrame && eyeData.hasValidSize && eyeData.leftEye && eyeData.rightEye;
    const detectionStable = updateWindow(detectionWindowRef.current, detectionValid);
    const gazeStable = updateWindow(gazeWindowRef.current, gazeValid);

    let newBgState: BackgroundState = 'red';
    if (detectionStable) {
      newBgState = gazeStable ? 'green' : 'orange';
    }
    setBgState(newBgState);

    if (currentState === 'idle') {
      if (newBgState === 'green' && countdown === null) {
        startCountdown();
      } else if (newBgState !== 'green') {
        resetCountdown();
      }
    }

    if (currentState === 'recording' && !detectionStable) {
      recorderRef.current?.stop();
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
      chunksRef.current = [];
      setState('idle');
      setRecordTime(CONFIG.RECORD_SECONDS);
      setIsRecording(false);
      detectionWindowRef.current = [];
      gazeWindowRef.current = [];
      setBgState('red');
    }
  }, [calculateEyeData, calculateGaze, countdown]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => { onFaceMeshResultsRef.current = onFaceMeshResults; }, [onFaceMeshResults]);

  // Инициализация камеры только в idle
  useEffect(() => {
    if (state !== 'idle') {
      // cleanup
      streamRef.current?.getTracks().forEach(t => t.stop());
      mediaPipeCameraRef.current?.stop();
      return;
    }

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false
        });
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (track.getCapabilities()?.zoom) setSupportsHardwareZoom(true);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const faceMesh = new FaceMesh({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
        faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        faceMesh.onResults(onFaceMeshResultsRef.current);
        faceMeshRef.current = faceMesh;

        const mpCamera = new MediaPipeCamera(videoRef.current!, {
          onFrame: async () => {
            if (videoRef.current && faceMeshRef.current) {
              await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
          width: 1280,
          height: 720,
        });
        mpCamera.start();
        mediaPipeCameraRef.current = mpCamera;
      } catch (e) { console.error(e); }
    };

    init();

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      mediaPipeCameraRef.current?.stop();
      resetCountdown();
    };
  }, [state]);

  useEffect(() => {
    if (supportsHardwareZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      // @ts-ignore
      track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    }
  }, [zoom, supportsHardwareZoom]);

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'idle') return;

    console.log('Запуск записи');
    setState('recording');
    setRecordTime(CONFIG.RECORD_SECONDS);
    setIsRecording(true);
    chunksRef.current = [];

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = CONFIG.FRAME_WIDTH * dpr;
    canvas.height = CONFIG.FRAME_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Критически важно: видимые размеры
    canvas.style.width = `${CONFIG.FRAME_WIDTH}px`;
    canvas.style.height = `${CONFIG.FRAME_HEIGHT}px`;

    let active = true;

    const draw = () => {
      if (!active || !videoRef.current) return;

      ctx.clearRect(0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
      ctx.save();
      ctx.translate(CONFIG.FRAME_WIDTH, 0);
      ctx.scale(-1, 1);

      const vw = videoRef.current.videoWidth || 1280;
      const vh = videoRef.current.videoHeight || 720;
      const effectiveZoom = supportsHardwareZoom ? 1 : zoom;

      const scaledW = vw / effectiveZoom;
      const scaledH = vh / effectiveZoom;
      const scale = Math.max(CONFIG.FRAME_WIDTH / scaledW, CONFIG.FRAME_HEIGHT / scaledH);
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

    recorder.ondataavailable = e => e.data.size && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      active = false;
      if (chunksRef.current.length) {
        const blob = new Blob(chunksRef.current, { type: mime });
        setRecordedBlob(blob);
        setState('preview');
        if (previewRef.current) {
          previewRef.current.src = URL.createObjectURL(blob);
          previewRef.current.play().catch(() => {});
        }
      }
    };

    recorderRef.current = recorder;
    recorder.start(100);

    // Исправленный таймер
    let remaining = CONFIG.RECORD_SECONDS;
    setRecordTime(remaining);

    recordIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setRecordTime(remaining);
      console.log('Таймер:', remaining);
      if (remaining <= 0) {
        clearInterval(recordIntervalRef.current!);
        recorder.stop();
      }
    }, 1000);
  }, [zoom, supportsHardwareZoom]);

  // ... остальные функции (resetRecording, saveForever и т.д.) без изменений

  const resetRecording = () => {
    setState('idle');
    setRecordedBlob(null);
    setDeleteUrl(null);
    setRecordTime(CONFIG.RECORD_SECONDS);
    setConsentAccepted(false);
    detectionWindowRef.current = [];
    gazeWindowRef.current = [];
    setBgState('red');
    setIsRecording(false);
    resetCountdown();
    if (previewRef.current) previewRef.current.src = '';
    if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
  };

  // ... saveForever, downloadVideo, adjustZoom, goToIntro, goToIdle без изменений

  if (state === 'identity') { /* ... */ }
  if (state === 'intro') { /* ... */ }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center relative font-mono">
      <Link to="/" className="absolute top-6 left-6 text-white/40 hover:text-white z-50">
        <ArrowLeft size={24} />
      </Link>

      {state === 'recording' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
          <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse" />
          <span className="text-xs text-white/60 tracking-widest">{t('camera.recording')}</span>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full max-w-2xl pt-20">
        <div className="relative mb-8">
          <div
            className="relative overflow-hidden rounded-xl"
            style={{
              width: CONFIG.FRAME_WIDTH,
              height: CONFIG.FRAME_HEIGHT,
              boxShadow: bgState === 'green' ? 'inset 0 0 0 3px rgba(34,197,94,0.6)'
                : bgState === 'orange' ? 'inset 0 0 0 3px rgba(249,115,22,0.6)'
                : 'inset 0 0 0 3px rgba(239,68,68,0.6)',
            }}
          >
            {/* Чёрный фон */}
            <div className="absolute inset-0 bg-black" />

            {/* Видео — только в idle и countdown */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-cover ${state === 'recording' || state === 'preview' ? 'opacity-0' : 'opacity-100'} transition-opacity`}
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Canvas — только во время записи */}
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 ${state === 'recording' ? 'block' : 'hidden'}`}
              style={{ transform: 'scaleX(-1)' }}
            />

            {/* Превью */}
            <video
              ref={previewRef}
              playsInline
              loop
              muted
              className={`absolute inset-0 w-full h-full object-cover ${state === 'preview' ? 'block' : 'hidden'}`}
            />

            {/* Оверлеи */}
            {state !== 'preview' && (
              <div className="absolute inset-0 pointer-events-none">
                {/* ... гиды, линии, countdown как раньше ... */}
                {countdown !== null && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-9xl font-bold text-white drop-shadow-2xl">{countdown}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Статус */}
          <div className="mt-4 text-center">
            <p className={`text-sm ${state === 'recording' ? 'text-green-400' : bgState === 'green' ? 'text-green-400' : bgState === 'orange' ? 'text-orange-400' : 'text-red-400'}`}>
              {state === 'recording' ? t('camera.statusRecording') : /* ... */}
            </p>
          </div>
        </div>

        {/* Таймер записи */}
        {state === 'recording' && (
          <div className="text-8xl md:text-9xl font-bold mb-8 tabular-nums text-white">
            {recordTime}
          </div>
        )}

        {/* ... зум, превью, кнопки — без изменений ... */}
      </div>

      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

export default Camera;
