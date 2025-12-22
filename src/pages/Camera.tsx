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
  const previewAnimationRef = useRef<number | null>(null);

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
      if (save) {
        recorderRef.current.stop();
      } else {
        recorderRef.current.stop();
        chunksRef.current = [];
        setState('idle');
        setRecordTime(CONFIG.RECORD_SECONDS);
      }
    }
    
    recorderRef.current = null;
  }, []);

  const startRecording = useCallback(() => {
    if (stateRef.current !== 'idle' || isRecordingRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      console.log('Video not ready');
      return;
    }
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CONFIG.FRAME_WIDTH * dpr;
    canvas.height = CONFIG.FRAME_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    const drawFrame = () => {
      if (!video || video.readyState < 2) return false;
      
      const vW = video.videoWidth;
      const vH = video.videoHeight;
      if (vW === 0 || vH === 0) return false;
      
      const effZoom = supportsHardwareZoomRef.current ? 1 : zoomRef.current;
      const scW = vW / effZoom;
      const scH = vH / effZoom;
      const sc = Math.max(CONFIG.FRAME_WIDTH / scW, CONFIG.FRAME_HEIGHT / scH);
      const sw = Math.round(CONFIG.FRAME_WIDTH / sc);
      const sh = Math.round(CONFIG.FRAME_HEIGHT / sc);
      const sx = Math.round((vW - sw) / 2);
      const sy = Math.round((vH - sh) / 2);
      
      ctx.clearRect(0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
      ctx.save();
      ctx.translate(CONFIG.FRAME_WIDTH, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
      ctx.restore();
      
      return true;
    };
    
    if (!drawFrame()) {
      console.log('Failed to draw initial frame');
      return;
    }
    
    const imageData = ctx.getImageData(0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
    let nonBlackPixels = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i] > 10 || imageData.data[i + 1] > 10 || imageData.data[i + 2] > 10) {
        nonBlackPixels++;
      }
    }
    const totalPixels = CONFIG.FRAME_WIDTH * CONFIG.FRAME_HEIGHT;
    if (nonBlackPixels < totalPixels * 0.1) {
      console.log('Frame appears mostly black, skipping');
      return;
    }
    
    isRecordingRef.current = true;
    recordingStartTimeRef.current = Date.now();
    setState('recording');
    setRecordTime(CONFIG.RECORD_SECONDS);
    chunksRef.current = [];
    
    const animate = () => {
      if (!isRecordingRef.current) return;
      drawFrame();
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();
    
    timerIntervalRef.current = setInterval(() => {
      if (!isRecordingRef.current) {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        return;
      }
      
      const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000);
      const remaining = Math.max(0, CONFIG.RECORD_SECONDS - elapsed);
      setRecordTime(remaining);
      
      if (remaining <= 0) {
        stopRecording(true);
      }
    }, 100);
    
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
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };
    
    recorder.onstop = () => {
      isRecordingRef.current = false;
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      if (chunksRef.current.length === 0) {
        setState('idle');
        setRecordTime(CONFIG.RECORD_SECONDS);
        return;
      }
      
      const blob = new Blob(chunksRef.current, { type: mimeType });
      
      if (blob.size < 5000) {
        console.warn('Recorded blob too small:', blob.size);
        chunksRef.current = [];
        setState('idle');
        setRecordTime(CONFIG.RECORD_SECONDS);
        return;
      }
      
      setRecordedBlob(blob);
      setState('preview');
      setBgState('black');
      
      setTimeout(() => {
        if (previewRef.current) {
          const url = URL.createObjectURL(blob);
          previewRef.current.src = url;
          previewRef.current.load();
          previewRef.current.play().catch(console.error);
        }
      }, 100);
    };
    
    recorder.start(200);
  }, [stopRecording]);

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
        setBgState('black');
        
        if (isRecordingRef.current) {
          stopRecording(false);
        }
      }
      return;
    }

    blinkStartRef.current = null;
    lastFaceDetectionRef.current = now;

    const landmarks = results.multiFaceLandmarks[0];
    const eyeData = calculateEyeData(landmarks);
    const gazeValid = calculateGaze(landmarks);

    const detectionValid = eyeData.bothInFrame && eyeData.hasValidSize;
    const detectionStable = updateWindow(detectionWindowRef.current, detectionValid);
    const gazeStable = updateWindow(gazeWindowRef.current, gazeValid);

    if (currentState === 'recording') {
      if (!detectionStable) {
        setBgState('black');
        stopRecording(false);
      } else {
        setBgState('green');
      }
      return;
    }

    if (!detectionStable) {
      setBgState('black');
    } else if (!gazeStable) {
      setBgState('orange');
    } else {
      setBgState('green');
      if (currentState === 'idle' && !isRecordingRef.current) {
        startRecording();
      }
    }
  }, [calculateEyeData, calculateGaze, updateWindow, startRecording, stopRecording]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(() => {
    onFaceMeshResultsRef.current = onFaceMeshResults;
  }, [onFaceMeshResults]);

  // Постоянная отрисовка canvas для превью (только вне записи)
  const drawPreviewFrame = useCallback(() => {
    // Во время записи отрисовка идёт в startRecording animate loop
    if (isRecordingRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    if (vW === 0 || vH === 0) return;
    
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== CONFIG.FRAME_WIDTH * dpr) {
      canvas.width = CONFIG.FRAME_WIDTH * dpr;
      canvas.height = CONFIG.FRAME_HEIGHT * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    
    const effZoom = supportsHardwareZoomRef.current ? 1 : zoomRef.current;
    const scW = vW / effZoom;
    const scH = vH / effZoom;
    const sc = Math.max(CONFIG.FRAME_WIDTH / scW, CONFIG.FRAME_HEIGHT / scH);
    const sw = Math.round(CONFIG.FRAME_WIDTH / sc);
    const sh = Math.round(CONFIG.FRAME_HEIGHT / sc);
    const sx = Math.round((vW - sw) / 2);
    const sy = Math.round((vH - sh) / 2);
    
    ctx.clearRect(0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
    ctx.save();
    ctx.translate(CONFIG.FRAME_WIDTH, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT);
    ctx.restore();
  }, []);

  useEffect(() => {
    // Явная проверка состояния
    if (state === 'identity' || state === 'preview') return;

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
          
          // Запускаем постоянную отрисовку превью (останавливается при записи)
          const animatePreview = () => {
            drawPreviewFrame();
            previewAnimationRef.current = requestAnimationFrame(animatePreview);
          };
          animatePreview();
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
      if (previewAnimationRef.current) {
        cancelAnimationFrame(previewAnimationRef.current);
        previewAnimationRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (mediaPipeCameraRef.current) {
        mediaPipeCameraRef.current.stop();
      }
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [state, drawPreviewFrame]);

  useEffect(() => {
    if (supportsHardwareZoom && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      // @ts-expect-error - zoom is valid but not in TS types
      track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    }
  }, [zoom, supportsHardwareZoom]);

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

  const saveForever = async () => {
    if (!recordedBlob || !consentAccepted) {
      setShowConsent(true);
      return;
    }
    setIsSaving(true);
    
    try {
      const formData = new FormData();
      formData.append('video', recordedBlob, 'eyes.webm');
      
      const response = await supabase.functions.invoke('save-eyes', {
        body: formData,
      });
      
      if (response.error) throw response.error;
      setDeleteUrl(response.data.deleteUrl);
    } catch (error) {
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const downloadVideo = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eyes.webm';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConsentAccepted = () => {
    setConsentAccepted(true);
    setShowConsent(false);
    saveForever();
  };

  const startExperience = () => {
    setState('idle');
  };

  // Inline styles для гарантированной смены цвета (Tailwind JIT не генерирует динамические классы)
  const getBgStyle = (): React.CSSProperties => {
    switch (bgState) {
      case 'green': return { backgroundColor: 'rgba(20, 83, 45, 0.3)' };
      case 'orange': return { backgroundColor: 'rgba(124, 45, 18, 0.3)' };
      default: return { backgroundColor: '#000000' };
    }
  };

  const getFrameBorderColor = () => {
    switch (bgState) {
      case 'green': return '#22c55e';
      case 'orange': return '#f97316';
      default: return '#ffffff';
    }
  };

  const getStatusText = () => {
    if (state === 'recording') return t('camera.statusRecording');
    switch (bgState) {
      case 'green': return t('camera.statusGreen');
      case 'orange': return t('camera.statusOrange');
      default: return t('camera.statusBlack');
    }
  };

  if (state === 'identity') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col">
        <header className="p-4 flex items-center">
          <Link to="/" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
            <ArrowLeft size={20} />
            <span>{t('common.back')}</span>
          </Link>
        </header>
        
        <main className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="max-w-md text-center space-y-8">
            <h1 className="text-3xl font-light">{t('camera.welcome')}</h1>
            <p className="text-white/70 leading-relaxed">{t('camera.instruction')}</p>
            <button
              onClick={startExperience}
              className="px-8 py-3 bg-white text-black rounded-full hover:bg-white/90 transition-colors"
            >
              {t('camera.start')}
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (state === 'preview') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col">
        <header className="p-4 flex items-center">
          <Link to="/" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
            <ArrowLeft size={20} />
            <span>{t('common.back')}</span>
          </Link>
        </header>
        
        <main className="flex-1 flex flex-col items-center justify-center p-4 gap-6">
          <div 
            className="relative rounded-lg overflow-hidden"
            style={{ 
              width: CONFIG.FRAME_WIDTH, 
              height: CONFIG.FRAME_HEIGHT,
              border: '2px solid white'
            }}
          >
            <video
              ref={previewRef}
              className="w-full h-full object-cover"
              autoPlay
              loop
              muted
              playsInline
            />
          </div>
          
          {deleteUrl ? (
            <div className="text-center space-y-4">
              <p className="text-green-400">{t('camera.saved')}</p>
              <p className="text-white/50 text-sm break-all max-w-md">
                {t('camera.deleteLink')}: {deleteUrl}
              </p>
              <div className="flex gap-4 justify-center">
                <Link
                  to="/canvas"
                  className="px-6 py-2 bg-white text-black rounded-full hover:bg-white/90 transition-colors"
                >
                  {t('camera.viewCanvas')}
                </Link>
                <button
                  onClick={resetRecording}
                  className="px-6 py-2 border border-white/30 rounded-full hover:bg-white/10 transition-colors"
                >
                  {t('camera.recordAnother')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-4">
              <button
                onClick={saveForever}
                disabled={isSaving}
                className="px-6 py-2 bg-white text-black rounded-full hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {isSaving ? t('camera.saving') : t('camera.saveForever')}
              </button>
              <button
                onClick={downloadVideo}
                className="px-6 py-2 border border-white/30 rounded-full hover:bg-white/10 transition-colors"
              >
                {t('camera.download')}
              </button>
              <button
                onClick={resetRecording}
                className="px-6 py-2 border border-white/30 rounded-full hover:bg-white/10 transition-colors"
              >
                {t('camera.retake')}
              </button>
            </div>
          )}
        </main>
        
        <ConsentModal
          isOpen={showConsent}
          onClose={() => setShowConsent(false)}
          onAccept={handleConsentAccepted}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white flex flex-col transition-colors duration-300" style={getBgStyle()}>
      <header className="p-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
          <ArrowLeft size={20} />
          <span>{t('common.back')}</span>
        </Link>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(z => Math.max(CONFIG.ZOOM_MIN, z - CONFIG.ZOOM_STEP))}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <Minus size={16} />
          </button>
          <span className="text-sm w-12 text-center">{zoom.toFixed(1)}x</span>
          <button
            onClick={() => setZoom(z => Math.min(CONFIG.ZOOM_MAX, z + CONFIG.ZOOM_STEP))}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>
      </header>
      
      <main className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
        <div className="text-center text-sm text-white/70 space-y-1 max-w-sm">
          <p className="font-medium text-white">{t('camera.instructionTitle')}</p>
          <p>⬜ {t('camera.instructionWhite')}</p>
          <p>⬛ {t('camera.instructionBlack')}</p>
          <p>🟧 {t('camera.instructionYellow')}</p>
          <p>🟩 {t('camera.instructionGreen')}</p>
        </div>
        
        <div className="relative">
          <video
            ref={videoRef}
            className="hidden"
            autoPlay
            playsInline
            muted
          />
          
          <canvas
            ref={canvasRef}
            className="rounded-lg"
            style={{
              width: CONFIG.FRAME_WIDTH,
              height: CONFIG.FRAME_HEIGHT,
              border: `3px solid ${getFrameBorderColor()}`,
              boxShadow: bgState === 'green' 
                ? '0 0 20px rgba(34, 197, 94, 0.5)' 
                : bgState === 'orange'
                  ? '0 0 20px rgba(249, 115, 22, 0.5)'
                  : 'none',
              transform: 'scaleX(-1)',
            }}
          />
        </div>
        
        <div className="text-center space-y-2">
          <p className="text-lg">{getStatusText()}</p>
          {state === 'recording' && (
            <p className="text-4xl font-mono font-bold text-green-400">
              {recordTime}
            </p>
          )}
        </div>
      </main>
    </div>
  );
};

export default Camera;
