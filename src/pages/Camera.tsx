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
  const [countdown, setCountdown] = useState<number | null>(null);

  const recordIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef(state);
  const bgStateRef = useRef(bgState);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { bgStateRef.current = bgState; }, [bgState]);

  const calculateGaze = useCallback((landmarks: Results['multiFaceLandmarks'][0]): boolean => {
    if (!landmarks || landmarks.length < 478) return false;
    const lIris = landmarks[LEFT_IRIS_CENTER];
    const lInner = landmarks[LEFT_EYE_INNER];
    const lOuter = landmarks[LEFT_EYE_OUTER];
    const lTop = landmarks[LEFT_EYE_TOP];
    const lBottom = landmarks[LEFT_EYE_BOTTOM];
    const lWidth = Math.abs(lOuter.x - lInner.x);
    const lHeight = Math.abs(lTop.y - lBottom.y);
    const lCenterX = (lInner.x + lOuter.x)/2;
    const lCenterY = (lTop.y + lBottom.y)/2;
    const lGazeX = Math.abs(lIris.x - lCenterX)/lWidth;
    const lGazeY = Math.abs(lIris.y - lCenterY)/lHeight;

    const rIris = landmarks[RIGHT_IRIS_CENTER];
    const rInner = landmarks[RIGHT_EYE_INNER];
    const rOuter = landmarks[RIGHT_EYE_OUTER];
    const rTop = landmarks[RIGHT_EYE_TOP];
    const rBottom = landmarks[RIGHT_EYE_BOTTOM];
    const rWidth = Math.abs(rOuter.x - rInner.x);
    const rHeight = Math.abs(rTop.y - rBottom.y);
    const rCenterX = (rInner.x + rOuter.x)/2;
    const rCenterY = (rTop.y + rBottom.y)/2;
    const rGazeX = Math.abs(rIris.x - rCenterX)/rWidth;
    const rGazeY = Math.abs(rIris.y - rCenterY)/rHeight;

    return lGazeX <= CONFIG.GAZE_THRESHOLD_X && lGazeY <= CONFIG.GAZE_THRESHOLD_Y &&
           rGazeX <= CONFIG.GAZE_THRESHOLD_X && rGazeY <= CONFIG.GAZE_THRESHOLD_Y;
  }, []);

  const calculateEyeData = useCallback((landmarks: Results['multiFaceLandmarks'][0]): EyeData => {
    if (!landmarks || landmarks.length < 478) return { leftEye: null, rightEye: null, bothInFrame: false, hasValidSize: false };
    const getEyeBounds = (indices: number[]) => {
      const pts = indices.map(i => landmarks[i]);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), centerX: (Math.min(...xs)+Math.max(...xs))/2, centerY:(Math.min(...ys)+Math.max(...ys))/2, width: Math.max(...xs)-Math.min(...xs), height: Math.max(...ys)-Math.min(...ys) };
    };
    const l = getEyeBounds(LEFT_EYE_INDICES);
    const r = getEyeBounds(RIGHT_EYE_INDICES);
    const margin = CONFIG.FRAME_MARGIN;
    const leftInFrame = l.minX>margin && l.maxX<1-margin && l.minY>margin && l.maxY<1-margin;
    const rightInFrame = r.minX>margin && r.maxX<1-margin && r.minY>margin && r.maxY<1-margin;
    const avgWidth = (l.width+r.width)/2;
    return { leftEye:{x:l.centerX,y:l.centerY,width:l.width,height:l.height}, rightEye:{x:r.centerX,y:r.centerY,width:r.width,height:r.height}, bothInFrame:leftInFrame && rightInFrame, hasValidSize:avgWidth>=CONFIG.MIN_EYE_WIDTH && avgWidth<=CONFIG.MAX_EYE_WIDTH };
  }, []);

  const updateWindow = (window: boolean[], value: boolean): boolean => {
    window.push(value); if(window.length>CONFIG.STABILITY_WINDOW) window.shift();
    return window.filter(v=>v).length>=CONFIG.STABILITY_MIN_VALID;
  };

  const onFaceMeshResults = useCallback((results: Results) => {
    const currentState = stateRef.current;
    if(currentState==='identity'||currentState==='intro'||currentState==='preview') return;

    const now = Date.now();
    if(!results.multiFaceLandmarks || results.multiFaceLandmarks.length===0){
      if(blinkStartRef.current===null) blinkStartRef.current=now;
      else if(now-blinkStartRef.current>CONFIG.BLINK_TOLERANCE_MS){detectionWindowRef.current=[]; gazeWindowRef.current=[]; setBgState('red'); if(currentState==='recording' && recorderRef.current?.state==='recording'){recorderRef.current.pause(); setIsRecording(false);}}
      return;
    }
    blinkStartRef.current=null; lastDetectionRef.current=now;
    const landmarks = results.multiFaceLandmarks[0];
    const eyeData = calculateEyeData(landmarks);
    const gazeValid = calculateGaze(landmarks);
    const detectionValid = eyeData.leftEye!==null && eyeData.rightEye!==null && eyeData.bothInFrame && eyeData.hasValidSize;
    const detectionStable = updateWindow(detectionWindowRef.current,detectionValid);
    const gazeStable = updateWindow(gazeWindowRef.current,gazeValid);
    let newBgState:BackgroundState = !detectionStable?'red':!gazeStable?'orange':'green';
    setBgState(newBgState);

    if(currentState==='idle' && newBgState==='green' && countdown===null){
      setCountdown(3); // старт отсчёта
    }
    else if(currentState==='recording' && !detectionStable){
      if(recorderRef.current) recorderRef.current.stop();
      if(recordIntervalRef.current) clearInterval(recordIntervalRef.current);
      chunksRef.current=[];
      setState('idle'); setRecordTime(CONFIG.RECORD_SECONDS); setIsRecording(false);
      detectionWindowRef.current=[]; gazeWindowRef.current=[];
    }
  }, [calculateEyeData, calculateGaze, countdown]);

  const onFaceMeshResultsRef = useRef(onFaceMeshResults);
  useEffect(()=>{onFaceMeshResultsRef.current=onFaceMeshResults;},[onFaceMeshResults]);

  // Countdown effect
  useEffect(()=>{
    if(countdown===null) return;
    if(countdown===0){ setCountdown(null); startRecording(); return; }
    const t = setTimeout(()=>setCountdown(c=>c!==null?c-1:null),1000);
    return ()=>clearTimeout(t);
  },[countdown]);

  useEffect(()=>{
    if(bgState!=='green' && countdown!==null) setCountdown(null);
  },[bgState,countdown]);

  const initCamera = async () => {
    try{
      const stream = await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});
      streamRef.current=stream;
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.() as Record<string,unknown>;
      if(capabilities && 'zoom' in capabilities) setSupportsHardwareZoom(true);
      if(videoRef.current){videoRef.current.srcObject=stream; await videoRef.current.play();}
      const faceMesh = new FaceMesh({locateFile:(file)=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
      faceMesh.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:0.5,minTrackingConfidence:0.5});
      faceMesh.onResults((results)=>{onFaceMeshResultsRef.current(results);});
      faceMeshRef.current=faceMesh;
      if(videoRef.current){
        const mpCamera = new MediaPipeCamera(videoRef.current,{onFrame:async()=>{if(videoRef.current && faceMeshRef.current) await faceMeshRef.current.send({image:videoRef.current});}, width:1280, height:720});
        mpCamera.start(); mediaPipeCameraRef.current=mpCamera;
      }
    }catch(err){console.error('Camera error:',err);}
  };

  useEffect(()=>{
    if(state==='idle' || state==='recording'){
      initCamera();
    } else {
      if(streamRef.current) streamRef.current.getTracks().forEach(track=>track.stop());
      if(mediaPipeCameraRef.current) mediaPipeCameraRef.current.stop();
      if(recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    }
  },[state]);

  useEffect(()=>{
    if(supportsHardwareZoom && streamRef.current){
      const track = streamRef.current.getVideoTracks()[0];
      // @ts-expect-error
      track.applyConstraints({advanced:[{zoom}]}).catch(()=>{});
    }
  },[zoom,supportsHardwareZoom]);

  const startRecording = useCallback(()=>{
    if(stateRef.current!=='idle') return;
    setState('recording'); setRecordTime(CONFIG.RECORD_SECONDS); chunksRef.current=[]; setIsRecording(true);

    const canvas = canvasRef.current!; const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio||1; canvas.width=CONFIG.FRAME_WIDTH*dpr; canvas.height=CONFIG.FRAME_HEIGHT*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);

    let isActive=true;
    const drawFrame = () => {
      if(!videoRef.current || !isActive) return;
      ctx.fillStyle='black'; ctx.fillRect(0,0,CONFIG.FRAME_WIDTH,CONFIG.FRAME_HEIGHT);
      ctx.save(); ctx.translate(CONFIG.FRAME_WIDTH,0); ctx.scale(-1,1);
      const videoW = videoRef.current.videoWidth||CONFIG.FRAME_WIDTH;
      const videoH = videoRef.current.videoHeight||CONFIG.FRAME_HEIGHT;
      const effectiveZoom = supportsHardwareZoom?1:zoom;
      const scaledW = videoW/effectiveZoom; const scaledH = videoH/effectiveZoom;
      const scale = Math.max(CONFIG.FRAME_WIDTH/scaledW,CONFIG.FRAME_HEIGHT/scaledH);
      const sw=Math.round(CONFIG.FRAME_WIDTH/scale), sh=Math.round(CONFIG.FRAME_HEIGHT/scale);
      const sx=Math.round((videoW-sw)/2), sy=Math.round((videoH-sh)/2);
      ctx.drawImage(videoRef.current,sx,sy,sw,sh,0,0,CONFIG.FRAME_WIDTH,CONFIG.FRAME_HEIGHT);
      ctx.restore();
      if(isActive) requestAnimationFrame(drawFrame);
    };
    drawFrame();

    const canvasStream = canvas.captureStream(CONFIG.FPS);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    const recorder = new MediaRecorder(canvasStream,{mimeType,videoBitsPerSecond:CONFIG.BITRATE});
    recorderRef.current=recorder;
    recorder.ondataavailable=(e)=>{if(e.data?.size) chunksRef.current.push(e.data);}
    recorder.onstop=()=>{
      isActive=false;
      if(chunksRef.current.length>0){
        const blob = new Blob(chunksRef.current,{type:mimeType});
        setRecordedBlob(blob); setState('preview');
        if(previewRef.current){previewRef.current.src=URL.createObjectURL(blob); previewRef.current.play().catch(()=>{});}
      }
    };
    recorder.start(100);

    let count = CONFIG.RECORD_SECONDS; let lastSecond = Date.now();
    recordIntervalRef.current = setInterval(()=>{
      if(stateRef.current==='recording' && recorderRef.current?.state==='recording'){
        const now = Date.now(); if(now-lastSecond>=1000){ lastSecond=now; count--; setRecordTime(count); if(count<=0){if(recordIntervalRef.current) clearInterval(recordIntervalRef.current); recordIntervalRef.current=null; if(recorder.state==='recording') recorder.stop();}}
      }
    },100);
  },[zoom,supportsHardwareZoom]);

  const confirmIdentity = () => setState('intro');
  const proceedToCamera = () => setState('idle');

  const getBgColor = ()=>{return 'bg-black';};

  // --- JSX ---
  if(state==='identity'){
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <div className="max-w-lg text-center">
          <p className="text-white/70 text-sm leading-relaxed mb-8">{t('camera.identity')}</p>
          <button onClick={confirmIdentity} className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">{t('camera.confirm')}</button>
          <Link to="/" className="block mt-8 text-white/30 text-xs hover:text-white/60 transition-colors">← {language==='ru'?'Назад':'Back'}</Link>
        </div>
      </div>
    );
  }

  if(state==='intro'){
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
        <div className="max-w-lg text-center">
          <p className="mb-8">{t('camera.introText')}</p>
          <button onClick={proceedToCamera} className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors">{t('camera.startRecording')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen text-white flex flex-col items-center relative font-mono transition-colors duration-500 ${getBgColor()}`}>
      <Link to="/" className="absolute top-6 left-6 text-white/40 hover:text-white transition-colors z-50">
        <ArrowLeft size={24}/>
      </Link>

      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full max-w-2xl pt-20">
        <div className="relative mb-8" style={{width:CONFIG.FRAME_WIDTH,height:CONFIG.FRAME_HEIGHT}}>
          <video ref={videoRef} autoPlay playsInline muted className={`absolute top-1/2 left-1/2 min-w-full min-h-full object-cover ${state==='preview'?'hidden':''}`} style={{transform:`translate(-50%,-50%) scaleX(-1) scale(${supportsHardwareZoom?1:zoom})`}}/>
          <video ref={previewRef} playsInline loop muted className={`w-full h-full object-cover ${state!=='preview'?'hidden':''}`}/>
          {countdown!==null && <div className="absolute inset-0 flex items-center justify-center text-6xl font-bold">{countdown}</div>}
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden"/>
      <ConsentModal isOpen={showConsent} onClose={()=>setShowConsent(false)}/>
    </div>
  );
};

export default Camera;
