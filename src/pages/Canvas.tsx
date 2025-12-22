import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface EyeVideo {
  id: string;
  url: string;
  x: number;
  y: number;
}

const Canvas = () => {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [videos, setVideos] = useState<EyeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const loadVideos = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.storage.from('eyes').list('', {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });

      if (error) throw error;

      const videoFiles = data?.filter(file => file.name.endsWith('.webm')) || [];
      
      const loadedVideos: EyeVideo[] = videoFiles.map((file, index) => {
        const { data: urlData } = supabase.storage.from('eyes').getPublicUrl(file.name);
        return {
          id: file.id || file.name,
          url: urlData.publicUrl,
          x: Math.random() * 80 + 10,
          y: Math.random() * 80 + 10,
        };
      });

      setVideos(loadedVideos);
    } catch (err) {
      console.error('Error loading videos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVideos();
  }, []);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <header className="p-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-white/70 hover:text-white transition-colors">
          <ArrowLeft size={20} />
          <span>{t('common.back')}</span>
        </Link>
        
        <button
          onClick={loadVideos}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span>{t('canvas.refresh')}</span>
        </button>
      </header>
      
      <main ref={containerRef} className="flex-1 relative overflow-hidden">
        {loading && videos.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-white/50">{t('canvas.loading')}</div>
          </div>
        ) : videos.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <p className="text-white/50">{t('canvas.empty')}</p>
            <Link
              to="/camera"
              className="px-6 py-2 bg-white text-black rounded-full hover:bg-white/90 transition-colors"
            >
              {t('canvas.addFirst')}
            </Link>
          </div>
        ) : (
          videos.map((video) => (
            <div
              key={video.id}
              className="absolute"
              style={{
                left: `${video.x}%`,
                top: `${video.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <video
                src={video.url}
                className="w-32 h-8 object-cover rounded"
                autoPlay
                loop
                muted
                playsInline
              />
            </div>
          ))
        )}
      </main>
    </div>
  );
};

export default Canvas;
