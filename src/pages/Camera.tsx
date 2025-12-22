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

// FaceMesh indices
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

  const calculateGaze = useCallback((landmarks: Results['multiFaceLandmarks'][0]) => {
    if (!landmarks || landmarks.length < 478) return false;

    const calcEye = (
      iris: number,
      inner: number,
      outer: number,
      top: number,
      bottom: number
    ) => {
      const w = Math.abs(landmarks[outer].x - landmarks[inner].x);
      const h = Math.abs(landmarks[top].y - landmarks[bottom].y);
      const cx = (landmarks[inner].x + landmarks[outer].x) / 2;
      const cy = (landmarks[top].y + landmarks[bottom].y) / 2;
      return {
        x: Math.abs(landmarks[iris].x - cx) / w,
        y: Math.abs(landmarks[iris].y - cy) / h,
      };
    };

    const l = calcEye(
      LEFT_IRIS_CENTER,
      LEFT_EYE_INNER,
      LEFT_EYE_OUTER,
      LEFT_EYE_TOP,
      LEFT_EYE_BOTTOM
    );
    const r = calcEye(
      RIGHT_IRIS_CENTER,
      RIGHT_EYE_INNER,
      RIGHT_EYE_OUTER,
      RIGHT_EYE_TOP,
      RIGHT_EYE_BOTTOM
    );

    return (
      l.x <= CONFIG.GAZE_THRESHOLD_X &&
      l.y <= CONFIG.GAZE_THRESHOLD_Y &&
      r.x <= CONFIG.GAZE_THRESHOLD_X &&
      r.y <= CONFIG.GAZE_THRESHOLD_Y
    );
  }, []);

  const updateWindow = (window: boolean[], value: boolean) => {
    window.push(value);
    if (window.length > CONFIG.STABILITY_WINDOW) window.shift();
    return window.filter(Boolean).length >= CONFIG.STABILITY_MIN_VALID;
  };

  const onFaceMeshResults = useCallback(
    (results: Results) => {
      if (stateRef.current === 'identity' || stateRef.current === 'preview') return;

      const now = Date.now();

      if (!results.multiFaceLandmarks?.length) {
        if (blinkStartRef.current === null) {
          blinkStartRef.current = now;
        } else if (now - blinkStartRef.current > CONFIG.BLINK_TOLERANCE_MS) {
          detectionWindowRef.current = [];
          gazeWindowRef.current = [];
          setBgState('red');
        }
        return;
      }

      blinkStartRef.current = null;

      const gazeStable = updateWindow(
        gazeWindowRef.current,
        calculateGaze(results.multiFaceLandmarks[0])
      );
      const detectionStable = updateWindow(detectionWindowRef.current, true);

      if (!detectionStable) setBgState('red');
      else if (!gazeStable) setBgState('orange');
      else setBgState('green');

      if (stateRef.current === 'idle' && gazeStable && detectionStable) {
        startRecording();
      }
    },
    [calculateGaze]
  );

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => {
    onFaceMeshResultsRef.current = onFaceMeshResults;
  }, [onFaceMeshResults]);

  useEffect(() => {
    if (state === 'identity') return;

    (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      if (track.getCapabilities?.().zoom) setSupportsHardwareZoom(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const faceMesh = new FaceMesh({
        locateFile: (f) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults((r) => onFaceMeshResultsRef.current(r));
      faceMeshRef.current = faceMesh;

      const cam = new MediaPipeCamera(videoRef.current!, {
        onFrame: async () => {
          await faceMesh.send({ image: videoRef.current! });
        },
        width: 1280,
        height: 720,
      });

      cam.start();
      mediaPipeCameraRef.current = cam;
    })();

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      mediaPipeCameraRef.current?.stop();
    };
  }, [state]);

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'idle') return;

    setState('recording');
    setIsRecording(true);
    chunksRef.current = [];

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    canvas.width = CONFIG.FRAME_WIDTH;
    canvas.height = CONFIG.FRAME_HEIGHT;

    const draw = () => {
      if (!videoRef.current) return;
      ctx.save();
      ctx.translate(CONFIG.FRAME_WIDTH, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoRef.current, 0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
      ctx.restore();
      requestAnimationFrame(draw);
    };
    draw();

    const recorder = new MediaRecorder(canvas.captureStream(CONFIG.FPS));
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setRecordedBlob(blob);
      setState('preview');
      previewRef.current!.src = URL.createObjectURL(blob);
    };

    recorder.start();
  }, []);

  if (state === 'identity') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <button onClick={() => setState('idle')}>OK</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center relative font-mono">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />
      <video ref={previewRef} className={state === 'preview' ? '' : 'hidden'} />
      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

export default Camera;
