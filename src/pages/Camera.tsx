import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Plus, Minus } from 'lucide-react';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { Camera as MediaPipeCamera } from '@mediapipe/camera_utils';
import { useLanguage } from '@/contexts/LanguageContext';
import ConsentModal from '@/components/modals/ConsentModal';

type RecordingState = 'identity' | 'idle' | 'recording' | 'preview';
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

  const [state, setState] = useState<RecordingState>('identity');
  const [recordTime, setRecordTime] = useState(CONFIG.RECORD_SECONDS);
  const [prepTimer, setPrepTimer] = useState<number | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [deleteUrl, setDeleteUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [zoom, setZoom] = useState(1.5);
  const [supportsHardwareZoom, setSupportsHardwareZoom] = useState(false);
  const [bgState, setBgState] = useState<BackgroundState>('red');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [identityConfirmed, setIdentityConfirmed] = useState(false); // Для первого экрана
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
    return leftGazeX <= CONFIG.GAZE_THRESHOLD_X && leftGazeY <= CONFIG.GAZE_THRESHOLD_Y &&
           rightGazeX <= CONFIG.GAZE_THRESHOLD_X && rightGazeY <= CONFIG.GAZE_THRESHOLD_Y;
  }, []);

  const calculateEyeData = useCallback((landmarks: Results['multiFaceLandmarks'][0]): EyeData => {
    if (!landmarks || landmarks.length < 478) return { leftEye: null, rightEye: null, bothInFrame: false, hasValidSize: false };
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
    const leftInFrame = leftBounds.minX > margin && leftBounds.maxX < (1 - margin) && leftBounds.minY > margin && leftBounds.maxY < (1 - margin);
    const rightInFrame = rightBounds.minX > margin && rightBounds.maxX < (1 - margin) && rightBounds.minY > margin && rightBounds.maxY < (1 - margin);
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
    return window.filter(v => v).length >= CONFIG.STABILITY_MIN_VALID;
  };

  const onFaceMeshResults = useCallback((results: Results) => {
    const currentState = stateRef.current;
    if (currentState === 'identity' || currentState === 'preview') return;
    const now = Date.now();
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (blinkStartRef.current === null) blinkStartRef.current = now;
      else if (now - blinkStartRef.current > CONFIG.BLINK_TOLERANCE_MS) {
        detectionWindowRef.current = [];
        gazeWindowRef.current = [];
        setBgState('red');
        if (currentState === 'recording' && recorderRef.current?.state === 'recording') {
          recorderRef.current.pause();
          setIsRecording(false);
        }
      }
      return;
    }
    blinkStartRef.current = null;
    lastDetectionRef.current = now;
    const landmarks = results.multiFaceLandmarks[0];
    const eyeData = calculateEyeData(landmarks);
    const gazeValid = calculateGaze(landmarks);
    const detectionValid = eyeData.leftEye !== null && eyeData.rightEye !== null && eyeData.bothInFrame && eyeData.hasValidSize;
    const detectionStable = updateWindow(detectionWindowRef.current, detectionValid);
    const gazeStable = updateWindow(gazeWindowRef.current, gazeValid);

    let newBgState: BackgroundState = !detectionStable ? 'red' : (!gazeStable ? 'orange' : 'green');
    setBgState(newBgState);

    if (currentState === 'idle' && newBgState === 'green') {
      startRecording();
    } else if (currentState === 'recording') {
      if (!detectionStable) {
        if (recorderRef.current) recorderRef.current.stop();
        if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
        chunksRef.current = [];
        setState('idle');
        setRecordTime(CONFIG.RECORD_SECONDS);
        setPrepTimer(null);
        setIsRecording(false);
      }
    }
  }, [calculateEyeData, calculateGaze]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => { onFaceMeshResultsRef.current = onFaceMeshResults; }, [onFaceMeshResults]);

  useEffect(() => {
    if (state === 'identity') return;
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false
        });
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities?.() as Record<string, unknown>;
        if (capabilities && 'zoom' in capabilities) setSupportsHardwareZoom(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
        faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        faceMesh.onResults((results) => { onFaceMeshResultsRef.current(results); });
        faceMeshRef.current = faceMesh;
        if (videoRef.current) {
          const mpCamera = new MediaPipeCamera(videoRef.current, {
            onFrame: async () => { if (videoRef.current && faceMeshRef.current) await faceMeshRef.current.send({ image: videoRef.current }); },
            width: 1280, height: 720,
          });
          mpCamera.start();
          mediaPipeCameraRef.current = mpCamera;
        }
      } catch (err) { console.error('Camera error:', err); }
    };
    initCamera();
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
      if (mediaPipeCameraRef.current) mediaPipeCameraRef.current.stop();
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    };
  }, [state === 'identity']);

  useEffect(() => {
    if (supportsHardwareZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      // @ts-expect-error
      track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    }
  }, [zoom, supportsHardwareZoom]);

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'idle') return;
    setState('recording');
    setIsRecording(false);
    let prepCount = 3;
    setPrepTimer(prepCount);
    const prepInterval = setInterval(() => {
      prepCount--;
      if (prepCount > 0) setPrepTimer(prepCount);
      else {
        clearInterval(prepInterval);
        setPrepTimer(null);
        proceedToActualRecording();
      }
    }, 1000);

    const proceedToActualRecording = () => {
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
        const scale = Math.max(CONFIG.FRAME_WIDTH / (videoW / effectiveZoom), CONFIG.FRAME_HEIGHT / (videoH / effectiveZoom));
        const sw = Math.round(CONFIG.FRAME_WIDTH / scale);
        const sh = Math.round(CONFIG.FRAME_HEIGHT / scale);
        ctx.drawImage(videoRef.current, Math.round((videoW - sw) / 2), Math.round((videoH - sh) / 2), sw, sh, 0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
        ctx.restore();
        if (isActive) requestAnimationFrame(drawFrame);
      };
      drawFrame();
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      const recorder = new MediaRecorder(canvas.captureStream(CONFIG.FPS), { mimeType, videoBitsPerSecond: CONFIG.BITRATE });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
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
              clearInterval(recordIntervalRef.current!);
              if (recorder.state === 'recording') recorder.stop();
            }
          }
        }
      }, 100);
    };
  }, [zoom, supportsHardwareZoom]);

  const resetRecording = () => {
    setState('idle');
    setRecordedBlob(null);
    setDeleteUrl(null);
    setRecordTime(CONFIG.RECORD_SECONDS);
    setPrepTimer(null);
    setConsentAccepted(false);
    setIsRecording(false);
    if (previewRef.current) previewRef.current.src = '';
  };

  const saveForever = async () => {
    if (!recordedBlob || !consentAccepted) return;
    setIsSaving(true);
    try {
      const fileName = `eyes-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webm`;
      const { error: uploadError } = await supabase.storage.from('eyes').upload(fileName, recordedBlob, { contentType: 'video/webm' });
      if (uploadError) throw uploadError;
      await supabase.from('eyes').insert({ cid: fileName });
      const deleteToken = crypto.randomUUID();
      await supabase.from('delete_tokens').insert({ cid: fileName, delete_token: deleteToken });
      setDeleteUrl(`${window.location.origin}/delete?token=${deleteToken}`);
    } catch (err: any) { alert('Ошибка: ' + err.message); }
    finally { setIsSaving(false); }
  };

  if (state === 'identity') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <div className="max-w-lg text-center">
          <div className="mb-6">
            <div className="w-16 h-16 border-2 border-white/20 rounded-full flex items-center justify-center mx-auto">
              <div className="w-8 h-8 border border-white/40 rounded-full" />
            </div>
          </div>
          
          <div className="mb-8 bg-white/5 p-5 rounded-lg border border-white/10 text-left opacity-70">
            <h3 className="text-white/90 font-bold text-[10px] uppercase tracking-widest mb-3">
              {language === 'ru' ? 'Инструкция:' : 'Instruction:'}
            </h3>
            <ul className="space-y-2 text-white/60 text-[11px] leading-snug">
              <li>• {language === 'ru' ? 'Сядьте так, чтобы глаза были в рамке.' : 'Eyes should be in the frame.'}</li>
              <li>• {language === 'ru' ? 'Индикатор: Красный (нет глаз) / Желтый (взгляд в сторону) / Зеленый (готов).' : 'Indicator: Red / Yellow / Green.'}</li>
              <li>• {language === 'ru' ? 'Запись начнется автоматически на 5 секунд.' : 'Recording starts automatically.'}</li>
            </ul>
          </div>

          <div className="mb-10 px-4">
            <p className="text-white text-lg md:text-xl font-medium leading-relaxed mb-6">
              {language === 'ru' 
                ? 'Я подтверждаю, что идентифицирую себя как женщина, пережившая гендерное насилие.' 
                : 'I confirm that I identify as a woman who has experienced gender-based violence.'}
            </p>
            
            <label className="flex items-center justify-center gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={identityConfirmed}
                onChange={(e) => setIdentityConfirmed(e.target.checked)}
                className="w-5 h-5 accent-white cursor-pointer"
              />
              <span className="text-white/50 text-xs group-hover:text-white/80 transition-colors uppercase tracking-widest">
                {language === 'ru' ? 'Я подтверждаю' : 'I confirm'}
              </span>
            </label>
          </div>

          <button
            onClick={() => setState('idle')}
            disabled={!identityConfirmed}
            className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-all active:scale-95 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed"
          >
            {t('camera.confirm')}
          </button>

          <Link to="/" className="block mt-8 text-white/30 text-xs hover:text-white/60">
            ← {language === 'ru' ? 'Назад' : 'Back'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center relative font-mono">
      <Link to="/" className="absolute top-6 left-6 text-white/40 hover:text-white z-50">
        <ArrowLeft size={24} />
      </Link>

      {state === 'recording' && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-600 animate-pulse' : 'bg-yellow-500'}`} />
          <span className="text-xs text-white/60 tracking-widest uppercase">
            {isRecording ? t('camera.recording') : (prepTimer !== null ? (language === 'ru' ? 'Приготовьтесь' : 'Ready') : t('camera.paused'))}
          </span>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full max-w-2xl pt-20">
        <div className="relative mb-8">
          <div 
            className={`relative overflow-hidden rounded-xl transition-shadow duration-300 ${state === 'recording' && bgState === 'green' ? 'animate-pulse' : ''}`}
            style={{
              width: CONFIG.FRAME_WIDTH, height: CONFIG.FRAME_HEIGHT,
              boxShadow: bgState === 'green' ? 'inset 0 0 0 3px rgba(34, 197, 94, 0.6)' : bgState === 'orange' ? 'inset 0 0 0 3px rgba(249, 115, 22, 0.6)' : 'inset 0 0 0 3px rgba(239, 68, 68, 0.6)'
            }}
          >
            <video ref={videoRef} autoPlay playsInline muted className={`absolute top-1/2 left-1/2 min-w-full min-h-full object-cover ${state === 'preview' ? 'hidden' : ''}`} style={{ transform: `translate(-50%, -50%) scaleX(-1) scale(${supportsHardwareZoom ? 1 : zoom})` }} />
            <video ref={previewRef} playsInline loop muted className={`w-full h-full object-cover ${state !== 'preview' ? 'hidden' : ''}`} />
            {state !== 'preview' && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                <div className="absolute top-1/2 -translate-y-1/2 left-[15%] w-[30%] h-[60%] border border-dashed rounded-full border-white/20" />
                <div className="absolute top-1/2 -translate-y-1/2 right-[15%] w-[30%] h-[60%] border border-dashed rounded-full border-white/20" />
              </div>
            )}
          </div>
          <div className="mt-3 text-center">
            <p className={`text-[10px] uppercase tracking-widest ${isRecording ? 'text-green-400' : (bgState === 'green' ? 'text-green-400' : (bgState === 'orange' ? 'text-orange-400' : 'text-red-400'))}`}>
              {isRecording ? t('camera.statusRecording') : (bgState === 'green' ? t('camera.statusGreen') : (bgState === 'orange' ? t('camera.statusOrange') : t('camera.statusRed')))}
            </p>
          </div>
        </div>

        {state === 'recording' && (
          <div className="flex flex-col items-center mb-8">
            {prepTimer !== null ? (
              <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                <div className="flex flex-col items-center text-center mb-4">
                   <span className="text-sm uppercase tracking-[0.3em] text-yellow-500 font-bold mb-1">
                    {language === 'ru' ? 'Приготовьтесь' : 'Get Ready'}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.1em] text-yellow-500/80">
                    {language === 'ru' ? 'смотрите в камеру, пожалуйста' : 'please look at the camera'}
                  </span>
                </div>
                <div className="text-8xl md:text-9xl font-bold text-yellow-500 tabular-nums">
                  {prepTimer}
                </div>
              </div>
            ) : (
              <div className={`text-8xl md:text-9xl font-bold tabular-nums ${isRecording ? 'text-white' : 'text-white/30'}`}>
                {recordTime}
              </div>
            )}
          </div>
        )}

        {state === 'idle' && !supportsHardwareZoom && (
          <div className="flex items-center gap-4 mb-6">
            <button onClick={() => setZoom(z => Math.max(1, z - 0.1))} className="w-10 h-10 border border-white/20 rounded flex items-center justify-center hover:bg-white/10"><Minus size={16} /></button>
            <span className="text-white/40 text-sm w-16 text-center">{zoom.toFixed(1)}×</span>
            <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="w-10 h-10 border border-white/20 rounded flex items-center justify-center hover:bg-white/10"><Plus size={16} /></button>
          </div>
        )}

        {state === 'preview' && !deleteUrl && (
          <div className="flex flex-col gap-4 w-full max-w-xs">
            <div className="border border-white/10 p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={consentAccepted} onChange={(e) => setConsentAccepted(e.target.checked)} className="mt-1 w-4 h-4 accent-white" />
                <span className="text-white/60 text-[10px] uppercase leading-relaxed">
                  {t('camera.consent')}
                  <button onClick={() => setShowConsent(true)} className="block text-white/40 underline mt-1">{t('camera.viewConsent')}</button>
                </span>
              </label>
            </div>
            <button onClick={saveForever} disabled={isSaving || !consentAccepted} className="w-full py-4 bg-white text-black text-sm font-bold uppercase hover:bg-white/90 disabled:opacity-20">{t('camera.save')}</button>
            <button onClick={resetRecording} className="w-full py-3 border border-white/30 text-white/60 text-sm uppercase hover:bg-white/10">{t('camera.retake')}</button>
          </div>
        )}

        {deleteUrl && (
          <div className="text-center max-w-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-green-500 mb-4 text-2xl">✓</div>
            <p className="text-white/60 text-[10px] uppercase mb-2">{t('camera.deleteLink')}</p>
            <code className="block bg-white/5 p-3 text-[10px] break-all text-white/40 mb-6">{deleteUrl}</code>
            <Link to="/canvas" className="inline-block px-12 py-4 bg-white text-black text-sm font-bold uppercase">{t('camera.viewCanvas')}</Link>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

export default Camera;
