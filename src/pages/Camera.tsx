import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Plus, Minus } from 'lucide-react';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { Camera as MediaPipeCamera } from '@mediapipe/camera_utils';
import { useLanguage } from '@/contexts/LanguageContext';
import ConsentModal from '@/components/modals/ConsentModal';

type RecordingState = 'identity' | 'intro' | 'idle' | 'preparing' | 'recording' | 'preview';
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
  // Detection thresholds
  MIN_EYE_WIDTH: 0.08,
  MAX_EYE_WIDTH: 0.35,
  FRAME_MARGIN: 0.05,
  // Sliding window for stability
  STABILITY_WINDOW: 5,
  STABILITY_MIN_VALID: 4,
  // Blink tolerance
  BLINK_TOLERANCE_MS: 600,
  PREPARE_SECONDS: 3,
};

// FaceMesh landmark indices
const LEFT_EYE_INDICES = [33, 133, 160, 159, 158, 157, 173, 246, 161, 163];
const RIGHT_EYE_INDICES = [362, 263, 387, 386, 385, 384, 398, 466, 388, 390];

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

  // Stability windows
  const detectionWindowRef = useRef<boolean[]>([]);
  const blinkStartRef = useRef<number | null>(null);
  const lastDetectionRef = useRef<number>(Date.now());

  const [state, setState] = useState<RecordingState>('identity');
  const [prepareTime, setPrepareTime] = useState(CONFIG.PREPARE_SECONDS);
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

  const prepareIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recordIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef(state);
  const bgStateRef = useRef(bgState);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    bgStateRef.current = bgState;
  }, [bgState]);

  // Calculate eye data
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

  // Update sliding window
  const updateWindow = (window: boolean[], value: boolean): boolean => {
    window.push(value);
    if (window.length > CONFIG.STABILITY_WINDOW) window.shift();
    const validCount = window.filter(v => v).length;
    return validCount >= CONFIG.STABILITY_MIN_VALID;
  };

  // Process FaceMesh results
  const onFaceMeshResults = useCallback((results: Results) => {
    const currentState = stateRef.current;
    if (currentState === 'identity' || currentState === 'intro' || currentState === 'preview') return;

    const now = Date.now();

    // No face detected
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (blinkStartRef.current === null) {
        blinkStartRef.current = now;
      } else if (now - blinkStartRef.current > CONFIG.BLINK_TOLERANCE_MS) {
        detectionWindowRef.current = [];
        setBgState('red');

        // Reset preparing if active
        if (currentState === 'preparing') {
          if (prepareIntervalRef.current) clearInterval(prepareIntervalRef.current);
          setPrepareTime(CONFIG.PREPARE_SECONDS);
          setState('idle');
        }

        // Stop recording if active
        if (currentState === 'recording' && recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
        }
      }
      return;
    }

    // Face detected
    blinkStartRef.current = null;
    lastDetectionRef.current = now;

    const landmarks = results.multiFaceLandmarks[0];
    const eyeData = calculateEyeData(landmarks);
    const eyesDetected = eyeData.leftEye !== null && eyeData.rightEye !== null;
    const eyesInFrame = eyeData.bothInFrame;
    const validSize = eyeData.hasValidSize;
    const detectionValid = eyesDetected && eyesInFrame && validSize;
    const detectionStable = updateWindow(detectionWindowRef.current, detectionValid);

    setBgState(detectionStable ? 'green' : 'red');

    // Logic for preparing countdown
    if (currentState === 'idle' && detectionStable) {
      setState('preparing');
      setPrepareTime(CONFIG.PREPARE_SECONDS);

      let count = CONFIG.PREPARE_SECONDS;
      let lastSecond = Date.now();

      prepareIntervalRef.current = setInterval(() => {
        const now = Date.now();
        if (now - lastSecond >= 1000) {
          lastSecond = now;
          count--;
          setPrepareTime(count);
          if (count <= 0) {
            if (prepareIntervalRef.current) clearInterval(prepareIntervalRef.current);
            startRecording();
          }
        }
      }, 100);
    } else if (currentState === 'preparing' && !detectionStable) {
      // Eyes left frame during countdown → reset
      if (prepareIntervalRef.current) clearInterval(prepareIntervalRef.current);
      setPrepareTime(CONFIG.PREPARE_SECONDS);
      setState('idle');
    }

    // During recording: only check eyes in frame
    if (currentState === 'recording' && !detectionStable) {
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
    }
  }, [calculateEyeData]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => {
    onFaceMeshResultsRef.current = onFaceMeshResults;
  }, [onFaceMeshResults]);

  // Initialize camera
  useEffect(() => {
    if (state === 'identity' || state === 'intro') return;

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false
        });
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities?.() as Record<string, unknown>;
        if (capabilities && 'zoom' in capabilities) {
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
        faceMesh.onResults((results) => {
          onFaceMeshResultsRef.current(results);
        });
        faceMeshRef.current = faceMesh;

        if (videoRef.current) {
          const mpCamera = new MediaPipeCamera(videoRef.current, {
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
        }
      } catch (err) {
        console.error('Camera error:', err);
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
      if (prepareIntervalRef.current) clearInterval(prepareIntervalRef.current);
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    };
  }, [state]);

  useEffect(() => {
    if (supportsHardwareZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      // @ts-expect-error
      track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    }
  }, [zoom, supportsHardwareZoom]);

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'preparing') return;

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
      if (stateRef.current === 'recording' && recorderRef.current?.state === 'recording') {
        const now = Date.now();
        if (now - lastSecond >= 1000) {
          lastSecond = now;
          count--;
          setRecordTime(count);
          if (count <= 0) {
            if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
            recorder.stop();
          }
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
    setBgState('red');
    setIsRecording(false);
    if (previewRef.current) {
      previewRef.current.src = '';
    }
    if (prepareIntervalRef.current) clearInterval(prepareIntervalRef.current);
    if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
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

      const { error: eyesError } = await supabase
        .from('eyes')
        .insert({ cid: fileName });
      if (eyesError) console.warn('Не удалось добавить в таблицу eyes:', eyesError);

      const deleteToken = crypto.randomUUID();
      const { error: tokenError } = await supabase
        .from('delete_tokens')
        .insert({
          cid: fileName,
          delete_token: deleteToken,
        });
      if (tokenError) console.warn('Не удалось создать токен удаления:', tokenError);

      const siteUrl = window.location.origin;
      const deleteUrl = `${siteUrl}/delete?token=${deleteToken}`;
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

  const confirmIdentity = () => setState('intro');
  const startCamera = () => setState('idle');

  // Identity screen
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
            onClick={confirmIdentity}
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

  // Intro screen
  if (state === 'intro') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <div className="max-w-lg text-center">
          <h2 className="text-2xl mb-8">{t('camera.instructionTitle')}</h2>
          <ul className="text-white/60 text-sm space-y-4 mb-12 text-left">
            <li>• {t('camera.instructionWhite')}</li>
            <li>• {t('camera.instructionRed')}</li>
            <li>• {t('camera.instructionYellow')}</li>
            <li>• {t('camera.instructionGreen')}</li>
          </ul>
          <button
            onClick={startCamera}
            className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors"
          >
            Перейти к съёмке
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

      {/* Look at camera hint */}
      {(state === 'idle' || state === 'preparing' || state === 'recording') && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 text-center">
          <p className="text-white/80 text-lg font-bold">Смотри в камеру</p>
        </div>
      )}

      {/* Preparing countdown */}
      {state === 'preparing' && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 text-center">
          <div className="text-9xl font-bold tabular-nums text-white animate-pulse">
            {prepareTime}
          </div>
        </div>
      )}

      {/* Recording timer */}
      {state === 'recording' && (
        <div className="absolute top-32 left-1/2 -translate-x-1/2 z-50 text-center">
          <div className="text-8xl font-bold tabular-nums text-white">
            {recordTime}
          </div>
        </div>
      )}

      {/* Main video frame */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full max-w-2xl pt-20">
        <div className="relative mb-8">
          <div
            className={`relative overflow-hidden rounded-xl transition-shadow duration-300`}
            style={{
              width: CONFIG.FRAME_WIDTH,
              height: CONFIG.FRAME_HEIGHT,
              boxShadow:
                bgState === 'green'
                  ? 'inset 0 0 0 3px rgba(34, 197, 94, 0.6)'
                  : 'inset 0 0 0 3px rgba(239, 68, 68, 0.6)'
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute top-1/2 left-1/2 min-w-full min-h-full object-cover ${state === 'preview' ? 'hidden' : ''}`}
              style={{
                transform: `translate(-50%, -50%) scaleX(-1) scale(${supportsHardwareZoom ? 1 : zoom})`,
              }}
            />
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
                  className="absolute top-1/2 -translate-y-1/2 left-[15%] w-[30%] h-[60%] border border-dashed rounded-full"
                  style={{
                    borderColor: bgState === 'green' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.3)'
                  }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 right-[15%] w-[30%] h-[60%] border border-dashed rounded-full"
                  style={{
                    borderColor: bgState === 'green' ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.3)'
                  }}
                />
                <div className="absolute top-2 left-2 w-3 h-3 border-l border-t border-white/30" />
                <div className="absolute top-2 right-2 w-3 h-3 border-r border-t border-white/30" />
                <div className="absolute bottom-2 left-2 w-3 h-3 border-l border-b border-white/30" />
                <div className="absolute bottom-2 right-2 w-3 h-3 border-r border-b border-white/30" />
              </div>
            )}
          </div>

          <div className="mt-3 text-center">
            <p className={`text-xs ${bgState === 'green' ? 'text-green-400' : 'text-red-400'}`}>
              {bgState === 'green' ? t('camera.statusGreen') : t('camera.statusRed')}
            </p>
          </div>
        </div>

        {/* Zoom controls */}
        {(state === 'idle' || state === 'preparing') && !supportsHardwareZoom && (
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

        {/* Preview actions */}
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
                  <button onClick={() => setShowConsent(true)} className="block text-white/40 underline hover:text-white/60 transition-colors mt-1">
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

        {/* Success with delete link */}
        {deleteUrl && (
          <div className="text-center max-w-sm">
            <div className="text-green-500 mb-4 text-2xl">✓</div>
            <p className="text-white/60 text-xs mb-2">{t('camera.deleteLink')}</p>
            <code className="block bg-white/5 p-3 text-xs break-all text-white/60 mb-6">
              {deleteUrl}
            </code>
            <Link
              to="/canvas"
              className="inline-block px-8 py-3 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90"
            >
              {t('camera.viewCanvas')}
            </Link>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

export default Camera;
