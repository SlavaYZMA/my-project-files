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

    const li = landmarks[LEFT_IRIS_CENTER];
    const ri = landmarks[RIGHT_IRIS_CENTER];

    const lx = (landmarks[LEFT_EYE_INNER].x + landmarks[LEFT_EYE_OUTER].x) / 2;
    const ly = (landmarks[LEFT_EYE_TOP].y + landmarks[LEFT_EYE_BOTTOM].y) / 2;
    const rx = (landmarks[RIGHT_EYE_INNER].x + landmarks[RIGHT_EYE_OUTER].x) / 2;
    const ry = (landmarks[RIGHT_EYE_TOP].y + landmarks[RIGHT_EYE_BOTTOM].y) / 2;

    const lw = Math.abs(landmarks[LEFT_EYE_OUTER].x - landmarks[LEFT_EYE_INNER].x);
    const lh = Math.abs(landmarks[LEFT_EYE_TOP].y - landmarks[LEFT_EYE_BOTTOM].y);
    const rw = Math.abs(landmarks[RIGHT_EYE_OUTER].x - landmarks[RIGHT_EYE_INNER].x);
    const rh = Math.abs(landmarks[RIGHT_EYE_TOP].y - landmarks[RIGHT_EYE_BOTTOM].y);

    return (
      Math.abs(li.x - lx) / lw <= CONFIG.GAZE_THRESHOLD_X &&
      Math.abs(li.y - ly) / lh <= CONFIG.GAZE_THRESHOLD_Y &&
      Math.abs(ri.x - rx) / rw <= CONFIG.GAZE_THRESHOLD_X &&
      Math.abs(ri.y - ry) / rh <= CONFIG.GAZE_THRESHOLD_Y
    );
  }, []);

  const calculateEyeData = useCallback((landmarks: Results['multiFaceLandmarks'][0]): EyeData => {
    if (!landmarks || landmarks.length < 478) {
      return { leftEye: null, rightEye: null, bothInFrame: false, hasValidSize: false };
    }

    const getBounds = (indices: number[]) => {
      const pts = indices.map(i => landmarks[i]);
      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    };

    const l = getBounds(LEFT_EYE_INDICES);
    const r = getBounds(RIGHT_EYE_INDICES);

    const m = CONFIG.FRAME_MARGIN;
    const inFrame =
      l.minX > m && l.maxX < 1 - m && r.minX > m && r.maxX < 1 - m &&
      l.minY > m && l.maxY < 1 - m && r.minY > m && r.maxY < 1 - m;

    const avgWidth = (l.width + r.width) / 2;
    const validSize = avgWidth >= CONFIG.MIN_EYE_WIDTH && avgWidth <= CONFIG.MAX_EYE_WIDTH;

    return {
      leftEye: l,
      rightEye: r,
      bothInFrame: inFrame,
      hasValidSize: validSize,
    };
  }, []);

  const updateWindow = (w: boolean[], v: boolean) => {
    w.push(v);
    if (w.length > CONFIG.STABILITY_WINDOW) w.shift();
    return w.filter(Boolean).length >= CONFIG.STABILITY_MIN_VALID;
  };

  const onFaceMeshResults = useCallback((results: Results) => {
    if (stateRef.current === 'identity' || stateRef.current === 'preview') return;

    if (!results.multiFaceLandmarks?.length) {
      setBgState('red');
      return;
    }

    const lm = results.multiFaceLandmarks[0];
    const eye = calculateEyeData(lm);
    const gaze = calculateGaze(lm);

    const detStable = updateWindow(detectionWindowRef.current, eye.bothInFrame && eye.hasValidSize);
    const gazeStable = updateWindow(gazeWindowRef.current, gaze);

    if (!detStable) setBgState('red');
    else if (!gazeStable) setBgState('orange');
    else setBgState('green');

    if (stateRef.current === 'idle' && detStable && gazeStable) startRecording();
  }, [calculateEyeData, calculateGaze]);

  useEffect(() => {
    if (state === 'identity') return;

    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const fm = new FaceMesh({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });

      fm.setOptions({ refineLandmarks: true });
      fm.onResults(onFaceMeshResults);
      faceMeshRef.current = fm;

      if (videoRef.current) {
        const cam = new MediaPipeCamera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current && faceMeshRef.current) {
              await faceMeshRef.current.send({ image: videoRef.current });
            }
          },
        });
        cam.start();
        mediaPipeCameraRef.current = cam;
      }
    })();

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      mediaPipeCameraRef.current?.stop();
    };
  }, [state]);

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'idle') return;

    setState('recording');
    setIsRecording(true);
    setRecordTime(CONFIG.RECORD_SECONDS);
    chunksRef.current = [];

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    canvas.width = CONFIG.FRAME_WIDTH;
    canvas.height = CONFIG.FRAME_HEIGHT;

    let active = true;
    const draw = () => {
      if (!videoRef.current || !active) return;
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      requestAnimationFrame(draw);
    };
    draw();

    const rec = new MediaRecorder(canvas.captureStream(CONFIG.FPS));
    recorderRef.current = rec;

    rec.ondataavailable = e => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      active = false;
      setRecordedBlob(new Blob(chunksRef.current, { type: 'video/webm' }));
      setState('preview');
    };

    rec.start();
  }, []);

  const getBgStyle = (): React.CSSProperties => {
    if (state === 'preview' || state === 'identity') return { backgroundColor: 'black' };
    if (bgState === 'green') return { backgroundColor: 'rgba(34,197,94,0.3)' };
    if (bgState === 'orange') return { backgroundColor: 'rgba(249,115,22,0.3)' };
    return { backgroundColor: 'rgba(239,68,68,0.3)' };
  };

  return (
    <div style={getBgStyle()} className="min-h-screen text-white flex flex-col items-center relative font-mono">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`absolute inset-0 object-cover ${
          state === 'recording' || state === 'preview' ? 'hidden' : ''
        }`}
      />
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default Camera;
