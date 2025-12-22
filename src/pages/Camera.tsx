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
  const lastDetectionRef = useRef<number>(Date.now());

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
  const bgStateRef = useRef(bgState);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    bgStateRef.current = bgState;
  }, [bgState]);

  const calculateGaze = useCallback((landmarks: Results['multiFaceLandmarks'][0]): boolean => {
    if (!landmarks || landmarks.length < 478) return false;

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
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
    setCountdown(null);
  };

  const onFaceMeshResults = useCallback((results: Results) => {
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
    lastDetectionRef.current = now;

    const landmarks = results.multiFaceLandmarks[0];
    const eyeData = calculateEyeData(landmarks);
    const gazeValid = calculateGaze(landmarks);

    const eyesDetected = eyeData.leftEye !== null && eyeData.rightEye !== null;
    const eyesInFrame = eyeData.bothInFrame;
    const validSize = eyeData.hasValidSize;

    const detectionValid = eyesDetected && eyesInFrame && validSize;
    const detectionStable = updateWindow(detectionWindowRef.current, detectionValid);
    const gazeStable = updateWindow(gazeWindowRef.current, gazeValid);

    let newBgState: BackgroundState = 'red';
    if (detectionStable) {
      newBgState = gazeStable ? 'green' : 'orange';
    }
    setBgState(newBgState);

    if (currentState === 'idle') {
      if (newBgState === 'green') {
        if (countdown === null) {
          startCountdown();
        }
      } else {
        resetCountdown();
      }
    }

    if (currentState === 'recording') {
      if (!detectionStable) {
        if (recorderRef.current) {
          recorderRef.current.stop();
          recorderRef.current = null;
        }
        if (recordIntervalRef.current) {
          clearInterval(recordIntervalRef.current);
          recordIntervalRef.current = null;
        }
        chunksRef.current = [];
        setState('idle');
        setRecordTime(CONFIG.RECORD_SECONDS);
        setIsRecording(false);
        detectionWindowRef.current = [];
        gazeWindowRef.current = [];
        setBgState('red');
      }
    }
  }, [calculateEyeData, calculateGaze, countdown]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => {
    onFaceMeshResultsRef.current = onFaceMeshResults;
  }, [onFaceMeshResults]);

  useEffect(() => {
    if (state !== 'idle') {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (mediaPipeCameraRef.current) {
        mediaPipeCameraRef.current.stop();
        mediaPipeCameraRef.current = null;
      }
      faceMeshRef.current = null;
      return;
    }

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false
        });
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities?.() as any;
        if (capabilities?.zoom) {
          setSupportsHardwareZoom(true);
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const faceMesh = new FaceMesh({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceMesh.onResults((results) => onFaceMeshResultsRef.current(results));
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
      } catch (err) {
        console.error('Camera initialization error:', err);
      }
    };

    initCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (mediaPipeCameraRef.current) {
        mediaPipeCameraRef.current.stop();
      }
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
      resetCountdown();
    };
  }, [state]);

  useEffect(() => {
    if (supportsHardwareZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      track.applyConstraints({ advanced: [{ zoom }] } as any).catch(() => {});
    }
  }, [zoom, supportsHardwareZoom]);

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'idle') return;

    setState('recording');
    setRecordTime(CONFIG.RECORD_SECONDS);
    chunksRef.current = [];
    setIsRecording(true);

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = CONFIG.FRAME_WIDTH * dpr;
    canvas.height = CONFIG.FRAME_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Важно: задаём видимые размеры canvas
    canvas.style.width = `${CONFIG.FRAME_WIDTH}px`;
    canvas.style.height = `${CONFIG.FRAME_HEIGHT}px`;

    let isActive = true;

    const drawFrame = () => {
      if (!videoRef.current || !isActive) return;

      ctx.clearRect(0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
      ctx.save();
      ctx.translate(CONFIG.FRAME_WIDTH, 0);
      ctx.scale(-1, 1);

      const videoW = videoRef.current.videoWidth || CONFIG.FRAME_WIDTH;
      const videoH = videoRef.current.videoHeight || CONFIG.FRAME_HEIGHT;
      const effectiveZoom = supportsHardwareZoom ? 1 : zoom;

      const scaledW = videoW / effectiveZoom;
      const scaledH = videoH / effectiveZoom;
      const scale = Math.max(CONFIG.FRAME_WIDTH / scaledW, CONFIG.FRAME_HEIGHT / scaledH);
      const sw = Math.round(CONFIG.FRAME_WIDTH / scale);
      const sh = Math.round(CONFIG.FRAME_HEIGHT / scale);
      const sx = Math.round((videoW - sw) / 2);
      const sy = Math.round((videoH - sh) / 2);

      ctx.drawImage(videoRef.current, sx, sy, sw, sh, 0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
      ctx.restore();

      if (isActive) requestAnimationFrame(drawFrame);
    };

    drawFrame();

    const canvasStream = canvas.captureStream(CONFIG.FPS);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    const recorder = new MediaRecorder(canvasStream, {
      mimeType,
      videoBitsPerSecond: CONFIG.BITRATE
    });

    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      isActive = false;
      if (chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        setState('preview');
        if (previewRef.current) {
          previewRef.current.src = URL.createObjectURL(blob);
          previewRef.current.play().catch(() => {});
        }
      }
    };

    recorder.start(100);

    let count = CONFIG.RECORD_SECONDS;
    let lastSecond = Date.now();

    recordIntervalRef.current = setInterval(() => {
      if (stateRef.current !== 'recording') return;
      const now = Date.now();
      if (now - lastSecond >= 1000) {
        lastSecond = now;
        count--;
        setRecordTime(count);
        if (count <= 0) {
          clearInterval(recordIntervalRef.current!);
          recordIntervalRef.current = null;
          recorder.stop();
        }
      }
    }, 100);
  }, [zoom, supportsHardwareZoom]);

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
  };

  const saveForever = async () => {
    if (!recordedBlob || !consentAccepted) return;
    setIsSaving(true);
    try {
      const fileId = crypto.randomUUID();
      const fileName = `eyes-${Date.now()}-${fileId.slice(0, 8)}.webm`;

      const { error: uploadError } = await supabase.storage
        .from('eyes')
        .upload(fileName, recordedBlob, {
          contentType: 'video/webm',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      await supabase.from('eyes').insert({ cid: fileName });

      const deleteToken = crypto.randomUUID();
      await supabase.from('delete_tokens').insert({
        cid: fileName,
        delete_token: deleteToken,
      });

      const deleteUrl = `${window.location.origin}/delete?token=${deleteToken}`;
      setDeleteUrl(deleteUrl);
    } catch (err: any) {
      console.error('Save error:', err);
      alert('Ошибка сохранения: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const downloadVideo = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eye-recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const adjustZoom = (delta: number) => {
    setZoom(prev => Math.max(CONFIG.ZOOM_MIN, Math.min(CONFIG.ZOOM_MAX, prev + delta)));
  };

  const goToIntro = () => setState('intro');
  const goToIdle = () => setState('idle');

  if (state === 'identity') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <div className="max-w-lg text-center">
          <div className="mb-8">
            <div className="w-16 h-16 border-2 border-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <div className="w-8 h-8 border border-white/40 rounded-full" />
            </div>
          </div>
          <p className="text-white/70 text-sm leading-relaxed mb-8">
            {t('camera.identity')}
          </p>
          <button
            onClick={goToIntro}
            className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors"
          >
            {t('camera.confirm')}
          </button>
          <Link to="/" className="block mt-8 text-white/30 text-xs hover:text-white/60 transition-colors">
            ← {language === 'ru' ? 'Назад' : 'Back'}
          </Link>
        </div>
      </div>
    );
  }

  if (state === 'intro') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <div className="max-w-lg text-center space-y-8">
          <h1 className="text-2xl font-bold uppercase tracking-wider">{t('camera.introTitle') || 'Как это работает'}</h1>
          <p className="text-white/80 text-sm leading-relaxed">
            {t('camera.introText') || 'Камера автоматически начнёт запись, когда вы посмотрите прямо в неё и ваши глаза будут в правильной зоне. Перед записью будет 3-секундный отсчёт. Запись длится 5 секунд и останавливается, если глаза выйдут из кадра.'}
          </p>
          <button
            onClick={goToIdle}
            className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors"
          >
            {t('camera.startFilming') || 'Перейти к съёмке'}
          </button>
          <button
            onClick={() => setState('identity')}
            className="block mt-8 text-white/30 text-xs hover:text-white/60 transition-colors"
          >
            ← Назад
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center relative font-mono">
      <Link to="/" className="absolute top-6 left-6 text-white/40 hover:text-white transition-colors z-50">
        <ArrowLeft size={24} />
      </Link>

      {state === 'recording' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-600 animate-pulse' : 'bg-yellow-500'}`} />
          <span className="text-xs text-white/60 tracking-widest">
            {isRecording ? t('camera.recording') : t('camera.paused')}
          </span>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full max-w-2xl pt-20">
        <div className="relative mb-8">
          <div
            className="relative overflow-hidden rounded-xl"
            style={{
              width: CONFIG.FRAME_WIDTH,
              height: CONFIG.FRAME_HEIGHT,
              boxShadow: bgState === 'green'
                ? 'inset 0 0 0 3px rgba(34, 197, 94, 0.6)'
                : bgState === 'orange'
                ? 'inset 0 0 0 3px rgba(249, 115, 22, 0.6)'
                : 'inset 0 0 0 3px rgba(239, 68, 68, 0.6)',
            }}
          >
            <div className="absolute inset-0 bg-black" />

            {/* Оригинальное видео — видно только в idle и countdown */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute top-1/2 left-1/2 min-w-full min-h-full object-cover ${
                state === 'recording' || state === 'preview' ? 'hidden' : ''
              }`}
              style={{
                transform: `translate(-50%, -50%) scaleX(-1) scale(${supportsHardwareZoom ? 1 : zoom})`,
              }}
            />

            {/* Canvas — показывается во время записи (то, что записывается) */}
            <canvas
              ref={canvasRef}
              className={`absolute top-1/2 left-1/2 ${state === 'recording' ? 'block' : 'hidden'}`}
              style={{
                transform: 'translate(-50%, -50%) scaleX(-1)',
                width: CONFIG.FRAME_WIDTH,
                height: CONFIG.FRAME_HEIGHT,
              }}
            />

            {/* Превью записанного видео */}
            <video
              ref={previewRef}
              playsInline
              loop
              muted
              className={`w-full h-full object-cover ${state !== 'preview' ? 'hidden' : ''}`}
            />

            {state !== 'preview' && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />

                <div
                  className="absolute top-1/2 -translate-y-1/2 left-[15%] w-[30%] h-[60%] border border-dashed rounded-full transition-colors duration-300"
                  style={{
                    borderColor: bgState === 'green' ? 'rgba(34, 197, 94, 0.4)'
                              : bgState === 'orange' ? 'rgba(249, 115, 22, 0.3)'
                              : 'rgba(239, 68, 68, 0.3)',
                  }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 right-[15%] w-[30%] h-[60%] border border-dashed rounded-full transition-colors duration-300"
                  style={{
                    borderColor: bgState === 'green' ? 'rgba(34, 197, 94, 0.4)'
                              : bgState === 'orange' ? 'rgba(249, 115, 22, 0.3)'
                              : 'rgba(239, 68, 68, 0.3)',
                  }}
                />

                <div className="absolute top-2 left-2 w-3 h-3 border-l border-t border-white/30" />
                <div className="absolute top-2 right-2 w-3 h-3 border-r border-t border-white/30" />
                <div className="absolute bottom-2 left-2 w-3 h-3 border-l border-b border-white/30" />
                <div className="absolute bottom-2 right-2 w-3 h-3 border-r border-b border-white/30" />

                {countdown !== null && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-9xl font-bold text-white drop-shadow-2xl">
                      {countdown}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 text-center">
            <p className={`text-sm font-medium ${
              state === 'recording' && isRecording ? 'text-green-400'
              : bgState === 'green' ? 'text-green-400'
              : bgState === 'orange' ? 'text-orange-400'
              : 'text-red-400'
            }`}>
              {state === 'recording' && isRecording
                ? t('camera.statusRecording')
                : bgState === 'green'
                ? t('camera.statusGreen') || 'Глаза в кадре и смотрят в камеру'
                : bgState === 'orange'
                ? t('camera.statusOrange') || 'Смотрите прямо в камеру'
                : t('camera.statusRed') || 'Поместите глаза в рамки'
              }
            </p>
          </div>
        </div>

        {state === 'recording' && (
          <div className={`text-8xl md:text-9xl font-bold mb-8 tabular-nums ${isRecording ? 'text-white' : 'text-white/30'}`}>
            {recordTime}
          </div>
        )}

        {state === 'idle' && !supportsHardwareZoom && (
          <div className="flex items-center gap-4 mb-6">
            <button onClick={() => adjustZoom(-CONFIG.ZOOM_STEP)} className="w-10 h-10 border border-white/20 rounded flex items-center justify-center hover:bg-white/10">
              <Minus size={16} />
            </button>
            <span className="text-white/40 text-sm w-16 text-center font-mono tabular-nums">{zoom.toFixed(1)}×</span>
            <button onClick={() => adjustZoom(CONFIG.ZOOM_STEP)} className="w-10 h-10 border border-white/20 rounded flex items-center justify-center hover:bg-white/10">
              <Plus size={16} />
            </button>
          </div>
        )}

        {state === 'preview' && !deleteUrl && (
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <div className="border border-white/10 p-4 mb-2">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="consent-save"
                  checked={consentAccepted}
                  onChange={(e) => setConsentAccepted(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-white"
                />
                <label htmlFor="consent-save" className="text-white/60 text-xs cursor-pointer">
                  {t('camera.consent')}
                  <button onClick={() => setShowConsent(true)} className="block text-white/40 underline hover:text-white/60 mt-1">
                    {t('camera.viewConsent')}
                  </button>
                </label>
              </div>
            </div>

            <button
              onClick={saveForever}
              disabled={isSaving || !consentAccepted}
              className="w-full px-8 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 disabled:opacity-50"
            >
              {t('camera.save')}
            </button>

            <button
              onClick={resetRecording}
              disabled={isSaving}
              className="w-full px-8 py-3 border border-white/30 text-white/60 text-sm uppercase tracking-widest hover:bg-white/10"
            >
              {t('camera.retake')}
            </button>

            <button
              onClick={downloadVideo}
              className="w-full px-8 py-3 border border-white/20 text-white/40 text-xs uppercase tracking-widest hover:bg-white/5"
            >
              {t('camera.download')}
            </button>

            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-yellow-500/60 text-xs mb-2">{t('support.trigger')}</p>
              <p className="text-white/30 text-xs">{t('support.hotlines')}</p>
              <p className="text-white/40 text-xs">🇷🇺 8-800-2000-122</p>
            </div>
          </div>
        )}

        {deleteUrl && (
          <div className="text-center max-w-sm">
            <div className="text-green-500 mb-4 text-2xl">✓</div>
            <p className="text-white/60 text-xs mb-2">{t('camera.deleteLink')}</p>
            <code className="block bg-white/5 p-3 text-xs break-all text-white/60 mb-6">{deleteUrl}</code>
            <Link
              to="/canvas"
              className="inline-block px-8 py-3 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90"
            >
              {t('camera.viewCanvas')}
            </Link>
          </div>
        )}
      </div>

      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

export default Camera;
