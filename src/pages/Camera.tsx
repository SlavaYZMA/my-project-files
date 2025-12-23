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
  const recordIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef<RecordingState>('identity');
  const bgStateRef = useRef<BackgroundState>('red');
  const isStartingRef = useRef(false);
  const frameCounterRef = useRef(0); // Для лога первого кадра
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
  const [showConsent, setShowConsent] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isIdentified, setIsIdentified] = useState(false);
  // Debug логи
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    const logLine = `[${timestamp}] ${message}`;
    console.log(logLine);
    setDebugLogs(prev => {
      const newLogs = [...prev, logLine];
      return newLogs.slice(-100);
    });
  }, []);

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

  const onFaceMeshResults = useCallback((results: Results) => {
    const currentState = stateRef.current;
    if (currentState === 'identity' || currentState === 'preview') return;
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
    const eyesDetected = eyeData.leftEye !== null && eyeData.rightEye !== null;
    const eyesInFrame = eyeData.bothInFrame;
    const validSize = eyeData.hasValidSize;
    const detectionValid = eyesDetected && eyesInFrame && validSize;
    const detectionStable = updateWindow(detectionWindowRef.current, detectionValid);
    const gazeStable = updateWindow(gazeWindowRef.current, gazeValid);
    let newBgState: BackgroundState;
    if (!detectionStable) {
      newBgState = 'red';
    } else if (!gazeStable) {
      newBgState = 'orange';
    } else {
      newBgState = 'green';
    }
    setBgState(newBgState);
    if (currentState === 'idle' && newBgState === 'green') {
      startRecording();
    } else if (currentState === 'recording') {
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
        setPrepTimer(null);
        setIsRecording(false);
        detectionWindowRef.current = [];
        gazeWindowRef.current = [];
      }
    }
  }, [calculateEyeData, calculateGaze]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => {
    onFaceMeshResultsRef.current = onFaceMeshResults;
  }, [onFaceMeshResults]);

  const drawLoop = useCallback(() => {
    if (stateRef.current === 'preview' || !videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d', { alpha: false, desynchronized: true })!;
    const video = videoRef.current;
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    // Новый надёжный расчёт кропа
    const scaleX = CONFIG.FRAME_WIDTH / videoW;
    const scaleY = CONFIG.FRAME_HEIGHT / videoH;
    const baseScale = Math.max(scaleX, scaleY); // cover
    const effectiveZoom = supportsHardwareZoom ? 1 : zoom;
    const finalScale = baseScale * effectiveZoom;
    const sw = CONFIG.FRAME_WIDTH / finalScale;
    const sh = CONFIG.FRAME_HEIGHT / finalScale;
    const sx = (videoW - sw) / 2;
    const sy = (videoH - sh) / 2;
    // Лог на первом кадре
    frameCounterRef.current += 1;
    if (frameCounterRef.current === 1) {
      addLog(`[Crop Calc] Video:${videoW}x${videoH} | Crop: sx:${sx.toFixed(1)} sy:${sy.toFixed(1)} sw:${sw.toFixed(1)} sh:${sh.toFixed(1)} | Zoom:${effectiveZoom}`);
    }
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
    ctx.save();
    ctx.translate(CONFIG.FRAME_WIDTH, 0);
    ctx.scale(-1, 1);
    try {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
    } catch (e) {}
    ctx.restore();
    requestAnimationFrame(drawLoop);
  }, [zoom, supportsHardwareZoom, addLog]);

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'idle' || isStartingRef.current) {
      console.log('Recording start blocked: already active');
      return;
    }
    isStartingRef.current = true;
    setState('recording');
    setIsRecording(false);
    let prepCount = 3;
    setPrepTimer(prepCount);
    const prepInterval = setInterval(() => {
      prepCount--;
      if (prepCount > 0) {
        setPrepTimer(prepCount);
      } else {
        clearInterval(prepInterval);
        setPrepTimer(null);
        proceedToActualRecording();
      }
    }, 1000);
    const proceedToActualRecording = () => {
      isStartingRef.current = false;
      frameCounterRef.current = 0; // Сброс счётчика кадров
      addLog('=== START ACTUAL RECORDING ===');
      setRecordTime(CONFIG.RECORD_SECONDS);
      chunksRef.current = [];
      setIsRecording(true);
      const canvas = canvasRef.current!;
      canvas.width = CONFIG.FRAME_WIDTH;
      canvas.height = CONFIG.FRAME_HEIGHT;
      const canvasStream = canvas.captureStream(CONFIG.FPS);
      let mimeType = '';
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobile) {
        if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
          addLog('Selected codec: video/mp4 (Mobile)');
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
          mimeType = 'video/webm;codecs=h264';
          addLog('Selected codec: h264 (Mobile)');
        } else {
          mimeType = 'video/webm';
          addLog('Selected codec: generic webm');
        }
      } else {
        if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
          mimeType = 'video/webm;codecs=vp9';
        } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
          mimeType = 'video/webm;codecs=vp8';
        } else {
          mimeType = 'video/webm';
        }
        addLog(`Selected codec: ${mimeType} (Desktop)`);
      }
      const recorderOptions: MediaRecorderOptions = { mimeType };
      if (!isMobile) recorderOptions.videoBitsPerSecond = CONFIG.BITRATE;
      try {
        const recorder = new MediaRecorder(canvasStream, recorderOptions);
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          addLog(`Stopped. Size: ${blob.size}, Type: ${mimeType}`);
          setRecordedBlob(blob);
          setState('preview');
          if (previewRef.current) {
            if (previewRef.current.src) URL.revokeObjectURL(previewRef.current.src);
            const url = URL.createObjectURL(blob);
            previewRef.current.src = url;
            const playPromise = previewRef.current.play();
            if (playPromise !== undefined) {
              playPromise.catch(error => {
                addLog('Preview Play Error: ' + error.message);
              });
            }
          }
        };
        recorder.start(100);
        addLog('MediaRecorder started');
        let secondsLeft = CONFIG.RECORD_SECONDS;
        const startTime = Date.now();
        const timerId = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const newSecondsLeft = CONFIG.RECORD_SECONDS - elapsed;
          if (newSecondsLeft !== secondsLeft) {
            secondsLeft = newSecondsLeft;
            if (secondsLeft >= 0) {
              setRecordTime(secondsLeft);
            }
          }
          if (secondsLeft <= 0) {
            clearInterval(timerId);
            if (recorderRef.current?.state === 'recording') {
              recorderRef.current.stop();
            }
          }
        }, 100);
        recordIntervalRef.current = timerId;
      } catch (e: any) {
        addLog(`Recorder init failed: ${e.message}`);
        isStartingRef.current = false;
        setState('idle');
      }
    };
  }, [zoom, supportsHardwareZoom, addLog]);

  useEffect(() => {
    if (state === 'identity') return;
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            aspectRatio: { ideal: 1280 / 720 } // Или 16 / 9 ≈ 1.777 для landscape
          },
          audio: false
        });
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        addLog(`Stream dims: ${settings.width}x${settings.height} | aspect: ${(settings.width / settings.height).toFixed(3)}`);
        const capabilities = track.getCapabilities?.() as Record<string, unknown>;
        if (capabilities && 'zoom' in capabilities) {
          setSupportsHardwareZoom(true);
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          addLog(`Video element: ${videoRef.current.videoWidth}x${videoRef.current.videoHeight}`);
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
        drawLoop();
      } catch (err) {
        console.error('Camera error:', err);
        addLog(`Camera init error: ${err}`);
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
    };
  }, [state === 'identity', drawLoop]);

  useEffect(() => {
    if (supportsHardwareZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      // @ts-expect-error
      track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    }
  }, [zoom, supportsHardwareZoom]);

  const resetRecording = () => {
    setState('idle');
    setRecordedBlob(null);
    setDeleteUrl(null);
    setRecordTime(CONFIG.RECORD_SECONDS);
    setPrepTimer(null);
    setConsentAccepted(false);
    detectionWindowRef.current = [];
    gazeWindowRef.current = [];
    setBgState('red');
    setIsRecording(false);
    if (previewRef.current) {
      previewRef.current.src = '';
    }
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

  const confirmIdentity = () => {
    setState('idle');
  };

  if (state === 'identity') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <div className="max-w-lg text-center">
          <div className="mb-8">
            <div className="w-16 h-16 border-2 border-white/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <div className="w-8 h-8 border border-white/40 rounded-full" />
            </div>
          </div>
          <div className="mb-10 bg-white/5 p-6 rounded-lg border border-white/10 text-left opacity-80">
            <h3 className="text-white/90 font-bold text-xs uppercase tracking-widest mb-4">
              {language === 'ru' ? 'Как записывать видео:' : 'How to record video:'}
            </h3>
            <ul className="space-y-3 text-white/60 text-[11px] leading-relaxed">
              <li>• {language === 'ru' ? 'Сядьте перед камерой, только ваши глаза должны быть в рамке.' : 'Sit in front of the camera, only your eyes should be in the frame.'}</li>
              <li>• {language === 'ru' ? 'Следите за надписью снизу:' : 'Follow the status text below:'}
                <ul className="ml-4 mt-2 space-y-1">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-red-600 rounded-full" />
                    {language === 'ru' ? 'Красный – лицо/глаза не в кадре.' : 'Red – face/eyes not in frame.'}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                    {language === 'ru' ? 'Жёлтый – глаза в кадре, взгляд не прямо.' : 'Yellow – eyes in frame, not looking straight.'}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                    {language === 'ru' ? 'Зелёный – можно записывать.' : 'Green – ready to record.'}
                  </li>
                </ul>
              </li>
              <li>• {language === 'ru' ? 'Когда индикатор зелёный, запись начнётся автоматически (5 секунд).' : 'When the indicator is green, recording starts automatically (5 seconds).'}</li>
              <li>• {language === 'ru' ? 'Держите глаза в рамке до конца записи.' : 'Keep your eyes in the frame until the end.'}</li>
              <li>• {language === 'ru' ? 'После записи можно предпросмотреть, сохранить или повторить.' : 'After recording, you can preview, save, or retake.'}</li>
              <li>• {language === 'ru' ? 'Для сохранения нужно дать согласие.' : 'Consent is required to save.'}</li>
            </ul>
          </div>
          <div className="mb-10 border border-white/10 p-5 text-left bg-white/[0.02]">
            <div className="flex items-start gap-4">
              <input
                type="checkbox"
                id="identity-confirm"
                checked={isIdentified}
                onChange={(e) => setIsIdentified(e.target.checked)}
                className="mt-1.5 w-4 h-4 accent-white cursor-pointer"
              />
              <label htmlFor="identity-confirm" className="text-white text-base md:text-lg leading-snug cursor-pointer select-none">
                {language === 'ru'
                  ? 'Я подтверждаю, что идентифицирую себя как женщина, пережившая гендерное насилие.'
                  : 'I confirm that I identify as a woman who has experienced gender-based violence.'}
              </label>
            </div>
          </div>
          <button
            onClick={confirmIdentity}
            disabled={!isIdentified}
            className={`px-12 py-4 text-sm font-bold uppercase tracking-widest transition-all active:scale-95 ${
              isIdentified
                ? 'bg-white text-black hover:bg-white/90'
                : 'bg-white/10 text-white/20 cursor-not-allowed'
            }`}
          >
            {language === 'ru' ? 'К СЪЕМКЕ' : 'GO TO CAMERA'}
          </button>
          <Link
            to="/"
            className="block mt-8 text-white/30 text-xs hover:text-white/60 transition-colors"
          >
            ← {language === 'ru' ? 'Назад' : 'Back'}
          </Link>
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
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 w-full max-w-xs text-center">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              isRecording ? 'bg-red-600 animate-pulse' : 'bg-yellow-500'
            }`} />
            <span className="text-xs text-white/60 tracking-widest uppercase">
              {isRecording
                ? t('camera.recording')
                : (prepTimer !== null
                    ? (language === 'ru' ? 'ПРИГОТОВЬТЕСЬ' : 'GET READY')
                    : t('camera.paused'))
              }
            </span>
          </div>
          {!isRecording && prepTimer !== null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-white/40 leading-tight">
                {language === 'ru' ? 'Смотрите в камеру, пожалуйста' : 'Please look into the camera'}
              </span>
              <span className="text-[10px] text-white/40 leading-tight">
                {language === 'ru' ? 'Запись начнется автоматически' : 'Recording will start automatically'}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full max-w-2xl pt-20">
        <div className="relative mb-8">
          <div
            className={`relative overflow-hidden rounded-xl transition-shadow duration-300 ${
              state === 'recording' && bgState === 'green' ? 'animate-pulse' : ''
            }`}
            style={{
              width: CONFIG.FRAME_WIDTH,
              height: CONFIG.FRAME_HEIGHT,
              boxShadow:
                bgState === 'green'
                  ? 'inset 0 0 0 3px rgba(34, 197, 94, 0.6)'
                  : bgState === 'orange'
                  ? 'inset 0 0 0 3px rgba(249, 115, 22, 0.6)'
                  : 'inset 0 0 0 3px rgba(239, 68, 68, 0.6)'
            }}
          >
            <canvas
              ref={canvasRef}
              width={CONFIG.FRAME_WIDTH}
              height={CONFIG.FRAME_HEIGHT}
              className={`${state === 'preview' ? 'hidden' : ''}`}
            />
            <video
              ref={previewRef}
              playsInline
              loop
              muted
              autoPlay
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                addLog(`[Preview Vid] Video Resolution: ${v.videoWidth}x${v.videoHeight}`);
                addLog(`[Preview Element] Display Size: ${v.clientWidth}x${v.clientHeight}`);
              }}
              className={`${state !== 'preview' ? 'hidden' : 'w-full h-full object-contain'}`}
              style={{
                border: '2px solid yellow',
              }}
            />
            {state !== 'preview' && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/10" />
                <div
                  className="absolute top-1/2 -translate-y-1/2 left-[15%] w-[30%] h-[60%] border border-dashed rounded-full transition-colors duration-300"
                  style={{
                    borderColor: bgState === 'green'
                      ? 'rgba(34, 197, 94, 0.4)'
                      : bgState === 'orange'
                        ? 'rgba(249, 115, 22, 0.3)'
                        : 'rgba(239, 68, 68, 0.3)'
                  }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 right-[15%] w-[30%] h-[60%] border border-dashed rounded-full transition-colors duration-300"
                  style={{
                    borderColor: bgState === 'green'
                      ? 'rgba(34, 197, 94, 0.4)'
                      : bgState === 'orange'
                        ? 'rgba(249, 115, 22, 0.3)'
                        : 'rgba(239, 68, 68, 0.3)'
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
            <p className={`text-xs transition-colors duration-300 ${
              state === 'recording' && isRecording
                ? 'text-green-400'
                : bgState === 'green'
                  ? 'text-green-400'
                  : bgState === 'orange'
                    ? 'text-orange-400'
                    : 'text-red-400'
            }`}>
              {state === 'recording' && isRecording
                ? t('camera.statusRecording')
                : bgState === 'green'
                  ? t('camera.statusGreen')
                  : bgState === 'orange'
                    ? t('camera.statusOrange')
                    : t('camera.statusRed')
              }
            </p>
          </div>
        </div>
        {state === 'recording' && (
          <div className="flex flex-col items-center mb-8">
            {prepTimer !== null ? (
              <div className="flex flex-col items-center">
                <span className="text-xs uppercase tracking-[0.3em] text-yellow-500 mb-2 animate-pulse">
                  {language === 'ru' ? 'Приготовьтесь' : 'Get Ready'}
                </span>
                <div className="text-8xl md:text-9xl font-bold text-yellow-500 tabular-nums">
                  {prepTimer}
                </div>
              </div>
            ) : (
              <div className={`text-8xl md:text-9xl font-bold tabular-nums transition-colors duration-200 ${
                isRecording ? 'text-white' : 'text-white/30'
              }`}>
                {recordTime}
              </div>
            )}
          </div>
        )}
        {state === 'idle' && !supportsHardwareZoom && (
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={() => adjustZoom(-CONFIG.ZOOM_STEP)}
              className="w-10 h-10 border border-white/20 rounded flex items-center justify-center hover:bg-white/10 transition-colors"
            >
              <Minus size={16} />
            </button>
            <span className="text-white/40 text-sm w-16 text-center font-mono tabular-nums">
              {zoom.toFixed(1)}×
            </span>
            <button
              onClick={() => adjustZoom(CONFIG.ZOOM_STEP)}
              className="w-10 h-10 border border-white/20 rounded flex items-center justify-center hover:bg-white/10 transition-colors"
            >
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
                  <button
                    onClick={() => setShowConsent(true)}
                    className="block text-white/40 underline hover:text-white/60 transition-colors mt-1"
                  >
                    {t('camera.viewConsent')}
                  </button>
                </label>
              </div>
            </div>
            <button
              onClick={saveForever}
              disabled={isSaving || !consentAccepted}
              className="w-full px-8 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('camera.save')}
            </button>
            <button
              onClick={resetRecording}
              disabled={isSaving}
              className="w-full px-8 py-3 border border-white/30 text-white/60 text-sm uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {t('camera.retake')}
            </button>
            <button
              onClick={downloadVideo}
              className="w-full px-8 py-3 border border-white/20 text-white/40 text-xs uppercase tracking-widest hover:bg-white/5 transition-colors"
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
            <code className="block bg-white/5 p-3 text-xs break-all text-white/60 mb-6">
              {deleteUrl}
            </code>
            <Link
              to="/canvas"
              className="inline-block px-8 py-3 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors"
            >
              {t('camera.viewCanvas')}
            </Link>
          </div>
        )}
      </div>
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

export default Camera;
