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
  BITRATE: 1_000_000,
  ZOOM_MIN: 1,
  ZOOM_MAX: 3,
  ZOOM_STEP: 0.1,
};

const Camera = () => {
  const { t, language } = useLanguage();

  /** === REFS === */
  const videoRef = useRef<HTMLVideoElement>(null); // hidden source
  const canvasRef = useRef<HTMLCanvasElement>(null); // single truth
  const previewRef = useRef<HTMLVideoElement>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationRef = useRef<number | null>(null);

  const faceMeshRef = useRef<FaceMesh | null>(null);
  const mpCameraRef = useRef<MediaPipeCamera | null>(null);

  /** === STATE === */
  const [state, setState] = useState<RecordingState>('identity');
  const [bgState, setBgState] = useState<BackgroundState>('red');
  const [zoom, setZoom] = useState(1.5);
  const [recordTime, setRecordTime] = useState(CONFIG.RECORD_SECONDS);
  const [prepTimer, setPrepTimer] = useState<number | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isIdentified, setIsIdentified] = useState(false);

  /** === CANVAS DRAW LOOP === */
  const drawLoop = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false })!;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (!vw || !vh) {
      animationRef.current = requestAnimationFrame(drawLoop);
      return;
    }

    const scale = Math.max(
      CONFIG.FRAME_WIDTH / vw,
      CONFIG.FRAME_HEIGHT / vh
    ) * zoom;

    const sw = CONFIG.FRAME_WIDTH / scale;
    const sh = CONFIG.FRAME_HEIGHT / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1); // mirror
    ctx.drawImage(
      video,
      sx, sy, sw, sh,
      0, 0,
      canvas.width, canvas.height
    );
    ctx.restore();

    animationRef.current = requestAnimationFrame(drawLoop);
  }, [zoom]);

  /** === CAMERA INIT === */
  useEffect(() => {
    if (state === 'identity') return;

    const init = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      if (canvasRef.current) {
        canvasRef.current.width = CONFIG.FRAME_WIDTH;
        canvasRef.current.height = CONFIG.FRAME_HEIGHT;
      }

      drawLoop();

      const faceMesh = new FaceMesh({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });

      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      faceMesh.onResults(() => {});
      faceMeshRef.current = faceMesh;

      mpCameraRef.current = new MediaPipeCamera(videoRef.current!, {
        onFrame: async () => {
          await faceMesh.send({ image: videoRef.current! });
        },
      });

      mpCameraRef.current.start();
    };

    init();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      mpCameraRef.current?.stop();
    };
  }, [state, drawLoop]);

  /** === RECORDING === */
  const startRecording = () => {
    if (!canvasRef.current) return;

    setState('recording');
    setIsRecording(false);

    let prep = 3;
    setPrepTimer(prep);

    const prepInt = setInterval(() => {
      prep -= 1;
      if (prep > 0) {
        setPrepTimer(prep);
      } else {
        clearInterval(prepInt);
        setPrepTimer(null);
        beginActualRecording();
      }
    }, 1000);
  };

  const beginActualRecording = () => {
    const canvas = canvasRef.current!;
    const stream = canvas.captureStream(CONFIG.FPS);

    chunksRef.current = [];
    setIsRecording(true);
    setRecordTime(CONFIG.RECORD_SECONDS);

    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm',
      videoBitsPerSecond: CONFIG.BITRATE,
    });

    recorderRef.current = recorder;

    recorder.ondataavailable = e => {
      if (e.data.size) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      setRecordedBlob(blob);
      setState('preview');

      if (previewRef.current) {
        previewRef.current.src = URL.createObjectURL(blob);
        previewRef.current.play();
      }
    };

    recorder.start();

    const start = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const left = CONFIG.RECORD_SECONDS - elapsed;
      setRecordTime(Math.max(left, 0));
      if (left <= 0) {
        clearInterval(timer);
        recorder.stop();
      }
    }, 200);
  };

  /** === SAVE / DOWNLOAD === */
  const downloadVideo = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eye-recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** === UI === */
  if (state === 'identity') {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <input type="checkbox" checked={isIdentified} onChange={e => setIsIdentified(e.target.checked)} />
        <button disabled={!isIdentified} onClick={() => setState('idle')}>
          {language === 'ru' ? 'К СЪЁМКЕ' : 'GO TO CAMERA'}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center relative font-mono">
      <Link to="/" className="absolute top-6 left-6 z-50"><ArrowLeft /></Link>

      <div className="pt-20 flex flex-col items-center">
        <canvas
          ref={canvasRef}
          style={{
            width: CONFIG.FRAME_WIDTH,
            height: CONFIG.FRAME_HEIGHT,
            border: `3px solid ${
              bgState === 'green' ? '#22c55e' :
              bgState === 'orange' ? '#f97316' :
              '#ef4444'
            }`,
            borderRadius: 12,
          }}
        />

        {state === 'idle' && (
          <div className="mt-4 flex gap-4">
            <button onClick={() => setZoom(z => Math.max(CONFIG.ZOOM_MIN, z - CONFIG.ZOOM_STEP))}><Minus /></button>
            <span>{zoom.toFixed(1)}×</span>
            <button onClick={() => setZoom(z => Math.min(CONFIG.ZOOM_MAX, z + CONFIG.ZOOM_STEP))}><Plus /></button>
          </div>
        )}

        {state === 'idle' && (
          <button className="mt-6" onClick={startRecording}>
            {language === 'ru' ? 'НАЧАТЬ' : 'START'}
          </button>
        )}

        {state === 'recording' && (
          <div className="mt-6 text-6xl">{prepTimer ?? recordTime}</div>
        )}

        {state === 'preview' && (
          <div className="mt-6 flex flex-col gap-4">
            <video ref={previewRef} loop muted playsInline />
            <button onClick={downloadVideo}>{t('camera.download')}</button>
          </div>
        )}
      </div>

      <video ref={videoRef} playsInline muted autoPlay className="hidden" />
      <ConsentModal isOpen={showConsent} onClose={() => setShowConsent(false)} />
    </div>
  );
};

export default Camera;
