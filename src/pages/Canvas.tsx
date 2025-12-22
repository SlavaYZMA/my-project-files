import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Plus, Minus } from 'lucide-react';
import { FaceMesh, Results } from '@mediapipe/face_mesh';
import { Camera as MediaPipeCamera } from '@mediapipe/camera_utils';
import { useLanguage } from '@/contexts/LanguageContext';
import ConsentModal from '@/components/modals/ConsentModal';

type RecordingState = 'identity' | 'idle' | 'recording' | 'preview';
type BackgroundState = 'black' | 'orange' | 'green';

const CONFIG = {
  FRAME_WIDTH: 512,
  FRAME_HEIGHT: 128,
  RECORD_SECONDS: 5,
  FPS: 30,
  BITRATE: 2000000,
  ZOOM_MIN: 1,
  ZOOM_MAX: 3,
  ZOOM_STEP: 0.1,
  MIN_EYE_WIDTH: 0.08,
  MAX_EYE_WIDTH: 0.35,
  FRAME_MARGIN: 0.05,
  GAZE_THRESHOLD_X: 0.20,
  GAZE_THRESHOLD_Y: 0.20,
  STABILITY_WINDOW: 5,
  STABILITY_MIN_VALID: 4,
  BLINK_TOLERANCE_MS: 800,
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

const Camera = () => {
  const { t } = useLanguage();
  
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
  const lastFaceDetectionRef = useRef<number>(Date.now());
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [state, setState] = useState<RecordingState>('identity');
  const [recordTime, setRecordTime] = useState(CONFIG.RECORD_SECONDS);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [deleteUrl, setDeleteUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [zoom, setZoom] = useState(1.5);
  const [supportsHardwareZoom, setSupportsHardwareZoom] = useState(false);
  const [bgState, setBgState] = useState<BackgroundState>('black');
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  const stateRef = useRef(state);
  const bgStateRef = useRef(bgState);
  const zoomRef = useRef(zoom);
  const supportsHardwareZoomRef = useRef(supportsHardwareZoom);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { bgStateRef.current = bgState; }, [bgState]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { supportsHardwareZoomRef.current = supportsHardwareZoom; }, [supportsHardwareZoom]);

  // --- Helper functions ---
  const updateWindow = useCallback((window: boolean[], value: boolean): boolean => {
    window.push(value);
    if (window.length > CONFIG.STABILITY_WINDOW) window.shift();
    const validCount = window.filter(v => v).length;
    return validCount >= CONFIG.STABILITY_MIN_VALID;
  }, []);

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

    return leftGazeX <= CONFIG.GAZE_THRESHOLD_X && 
           leftGazeY <= CONFIG.GAZE_THRESHOLD_Y &&
           rightGazeX <= CONFIG.GAZE_THRESHOLD_X && 
           rightGazeY <= CONFIG.GAZE_THRESHOLD_Y;
  }, []);

  const calculateEyeData = useCallback((landmarks: Results['multiFaceLandmarks'][0]) => {
    if (!landmarks || landmarks.length < 478) {
      return { bothInFrame: false, hasValidSize: false };
    }

    const getEyeBounds = (indices: number[]) => {
      const points = indices.map(i => landmarks[i]);
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      return {
        width: Math.max(...xs) - Math.min(...xs),
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
      bothInFrame: leftInFrame && rightInFrame,
      hasValidSize,
    };
  }, []);

  // --- Recording functions ---
  const stopRecording = useCallback((save: boolean) => {
    isRecordingRef.current = false;
    
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      if (!save) {
        chunksRef.current = [];
        setState('idle');
        setRecordTime(CONFIG.RECORD_SECONDS);
      }
    }
    
    recorderRef.current = null;
  }, []);

  const startRecording = useCallback(() => {
    // ... (тот же код записи, что у тебя)
  }, [stopRecording]);

  // --- FaceMesh processing ---
  const onFaceMeshResults = useCallback((results: Results) => {
    // ... (тот же код обработки)
  }, [calculateEyeData, calculateGaze, updateWindow, startRecording, stopRecording]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => {
    onFaceMeshResultsRef.current = onFaceMeshResults;
  }, [onFaceMeshResults]);

  // --- Camera init ---
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
        if ('zoom' in track.getCapabilities?.()) {
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
          await mpCamera.start();
          mediaPipeCameraRef.current = mpCamera;
        }
      } catch (err) {
        console.error('Camera error:', err);
      }
    };

    initCamera();

    return () => {
      streamRef.current?.getTracks().forEach(track => track.stop());
      mediaPipeCameraRef.current?.stop();
      timerIntervalRef.current && clearInterval(timerIntervalRef.current);
      animationFrameRef.current && cancelAnimationFrame(animationFrameRef.current);
    };
  }, [state]);

  // --- Hardware Zoom ---
  useEffect(() => {
    if (supportsHardwareZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      // @ts-expect-error
      track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    }
  }, [zoom, supportsHardwareZoom]);

  // --- Other handlers ---
  const resetRecording = useCallback(() => {
    setRecordedBlob(null);
    setDeleteUrl(null);
    setState('idle');
    setRecordTime(CONFIG.RECORD_SECONDS);
    chunksRef.current = [];
    detectionWindowRef.current = [];
    gazeWindowRef.current = [];
    setBgState('black');
  }, []);

  const saveForever = async () => { /* ... */ };
  const downloadVideo = () => { /* ... */ };
  const handleConsentAccepted = () => { /* ... */ };
  const startExperience = () => setState('idle');
  const getBgClasses = () => { /* ... */ };
  const getFrameBorderColor = () => { /* ... */ };
  const getStatusText = () => { /* ... */ };

  // --- JSX rendering ---
  // ... (тот же JSX, что у тебя, включая состояния identity, preview и основной экран)
};

export default Camera;
