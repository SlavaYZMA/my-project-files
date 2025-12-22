type RecordingState = 'identity' | 'intro' | 'idle' | 'recording' | 'preview';
...
const confirmIdentity = () => {
  setState('intro'); // Было 'idle', теперь сначала intro
};

const goToRecording = () => {
  setState('idle'); // После intro → idle
};

const backToIdentity = () => {
  setState('identity');
};

// Identity confirmation screen
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

// Intro screen with instructions
if (state === 'intro') {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6 font-mono">
      <div className="max-w-lg text-center space-y-6">
        <p className="text-white/70 text-sm leading-relaxed">
          {t('camera.introText')} {/* Здесь ваш текст инструкции */}
        </p>

        <button
          onClick={goToRecording}
          className="px-12 py-4 bg-white text-black text-sm font-bold uppercase tracking-widest hover:bg-white/90 transition-colors"
        >
          {t('camera.startRecording')}
        </button>

        <button
          onClick={backToIdentity}
          className="px-12 py-3 border border-white/30 text-white/60 text-sm uppercase tracking-widest hover:bg-white/10 transition-colors"
        >
          {language === 'ru' ? 'Назад' : 'Back'}
        </button>
      </div>
    </div>
  );
}
