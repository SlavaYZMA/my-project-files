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

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { bgStateRef.current = bgState; }, [bgState]);

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
    if (currentState === 'identity' || currentState === 'preview' || currentState === 'intro') return;

    const now = Date.now();
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (blinkStartRef.current === null) {
        blinkStartRef.current = now;
      } else if (now - blinkStartRef.current > CONFIG.BLINK_TOLERANCE_MS) {
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
    const detectionValid = eyeData.leftEye && eyeData.rightEye && eyeData.bothInFrame && eyeData.hasValidSize;
    const detectionStable = updateWindow(detectionWindowRef.current, detectionValid);
    const gazeStable = updateWindow(gazeWindowRef.current, gazeValid);

    let newBgState: BackgroundState;
    if (!detectionStable) newBgState = 'red';
    else if (!gazeStable) newBgState = 'orange';
    else newBgState = 'green';
    setBgState(newBgState);

    if (currentState === 'idle' && newBgState === 'green') startRecording();
    else if (currentState === 'recording' && !detectionStable) {
      if (recorderRef.current) recorderRef.current.stop();
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
      chunksRef.current = [];
      setState('idle');
      setRecordTime(CONFIG.RECORD_SECONDS);
      setIsRecording(false);
      detectionWindowRef.current = [];
      gazeWindowRef.current = [];
    }
  }, [calculateEyeData, calculateGaze]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => { onFaceMeshResultsRef.current = onFaceMeshResults; }, [onFaceMeshResults]);

  useEffect(() => {
    if (state === 'identity' || state === 'intro') return;

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities?.() as Record<string, unknown>;
        if (capabilities && 'zoom' in capabilities) setSupportsHardwareZoom(true);
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }

        const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
        faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        faceMesh.onResults((results) => onFaceMeshResultsRef.current(results));
        faceMeshRef.current = faceMesh;

        if (videoRef.current) {
          const mpCamera = new MediaPipeCamera(videoRef.current, { onFrame: async () => { if (videoRef.current && faceMeshRef.current) await faceMeshRef.current.send({ image: videoRef.current }); }, width: 1280, height: 720 });
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
  }, [state]);

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
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: CONFIG.BITRATE });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      isActive = false;
      if (chunksRef.current.length > 0) {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setRecordedBlob(blob);
        setState('preview');
        if (previewRef.current) { previewRef.current.src = URL.createObjectURL(blob); previewRef.current.play().catch(() => {}); }
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
          if (count <= 0) { if (recordIntervalRef.current) clearInterval(recordIntervalRef.current); if (recorder.state === 'recording') recorder.stop(); }
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
    if (previewRef.current) previewRef.current.src = '';
  };

  const saveForever = async () => {
    if (!recordedBlob || !consentAccepted) return;
    setIsSaving(true);
    try {
      const fileId = crypto.randomUUID();
      const fileName = `eyes-${Date.now()}-${fileId.slice(0, 8)}.webm`;
      const { error: uploadError } = await supabase.storage.from('eyes').upload(fileName, recordedBlob, { contentType: 'video/webm', upsert: false });
      if (uploadError) throw uploadError;
      const { error: eyesError } = await supabase.from('eyes').insert({ cid: fileName });
      if (eyesError) console.warn('Insert error:', eyesError);

      const deleteToken = crypto.randomUUID();
      const { error: tokenError } = await supabase.from('delete_tokens').insert({ cid: fileName, delete_token: deleteToken });
      if (tokenError) console.warn('Delete token error:', tokenError);

      const siteUrl = window.location.origin;
      setDeleteUrl(`${siteUrl}/delete?token=${deleteToken}`);
    } catch (err: any) { console.error(err); }
    setIsSaving(false);
  };

  const confirmIdentity = () => setState('intro'); // Новый экран intro после подтверждения
  const goToRecording = () => setState('idle'); // После intro → idle
  const backToIdentity = () => setState('identity');

  // === UI Rendering ===
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
          <button onClick={confirmIdentity} className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
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
        <div className="max-w-lg text-center space-y-6">
          <p className="text-white/70 text-sm leading-relaxed">
            {t('camera.introText')} {/* Текст инструкции */}
          </p>
          <button onClick={goToRecording} className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">
            {t('camera.startRecording')}
          </button>
          <button onClick={backToIdentity} className="px-12 py-3 border border-white/30 text-white/60 text-sm uppercase tracking-widest hover:bg-white/10 transition-colors">
            {language === 'ru' ? 'Назад' : 'Back'}
          </button>
        </div>
      </div>
    );
  }

  // === idle, recording, preview screens ===
  return (
    <div className={`min-h-screen flex flex-col items-center justify-center bg-${bgStateRef.current} transition-colors`}>
      <video ref={videoRef} className="hidden" />
      <canvas ref={canvasRef} className="w-full max-w-lg" />
      {state === 'preview' && recordedBlob && (
        <div className="mt-4">
          <video ref={previewRef} controls className="max-w-lg w-full" />
          <ConsentModal show={showConsent} onAccept={() => setConsentAccepted(true)} onClose={() => setShowConsent(false)} />
          <button onClick={saveForever} disabled={!consentAccepted || isSaving}>
            {isSaving ? 'Saving...' : t('camera.save')}
          </button>
          {deleteUrl && <p>Delete URL: {deleteUrl}</p>}
          <button onClick={resetRecording}>{t('camera.retry')}</button>
        </div>
      )}
    </div>
  );
};

export default Camera;
