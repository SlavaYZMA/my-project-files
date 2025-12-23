import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface EyeRecord {
  cid: string;
  created_at: string;
}

const ITEMS_PER_PAGE = 100;

const Canvas = () => {
  const { t } = useLanguage();
  const [eyes, setEyes] = useState<EyeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [, setPage] = useState(0);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const storageUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/eyes/`;

  const loadEyes = useCallback(async (pageNum: number, append = false) => {
    try {
      const from = pageNum * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;

      const { data, error: queryError } = await supabase
        .from('eyes')
        .select('cid, created_at')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (queryError) throw queryError;

      if (data) {
        if (append) {
          setEyes(prev => [...prev, ...data]);
        } else {
          setEyes(data);
        }
        setHasMore(data.length === ITEMS_PER_PAGE);
      }
    } catch (err: any) {
      console.error('Load error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEyes(0);

    const channel = supabase
      .channel('eyes-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'eyes'
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setEyes(prev => [payload.new as EyeRecord, ...prev]);
          } else if (payload.eventType === 'DELETE') {
            setEyes(prev =>
              prev.filter(e => e.cid !== (payload.old as EyeRecord).cid)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadEyes]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          setPage(prev => {
            const nextPage = prev + 1;
            loadEyes(nextPage, true);
            return nextPage;
          });
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, [hasMore, loading, loadEyes]);

  if (loading && eyes.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono text-white">
        <p className="text-white/30 text-sm tracking-widest uppercase">
          {t('canvas.loading')}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono text-white">
        <p className="text-red-500/60 text-sm tracking-widest uppercase">Ошибка загрузки</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black font-mono">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-black via-black/80 to-transparent pointer-events-none">
        <div className="flex items-center justify-between p-4 md:p-6 pointer-events-auto max-w-[1400px] mx-auto">
          <Link to="/" className="text-white/40 hover:text-white transition-colors">
            <ArrowLeft size={24} />
          </Link>
        </div>
      </div>

      {eyes.length === 0 ? (
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-white/20 text-sm tracking-widest uppercase">
            {t('canvas.empty')}
          </p>
        </div>
      ) : (
        <main className="max-w-[1400px] mx-auto">
          {/* Сетка: 2 колонки на мобильных, 4 на десктопах, без зазоров (gap-0) */}
          <div
            className="
              grid
              grid-cols-2
              md:grid-cols-4
              gap-0
            "
            style={{ paddingTop: 80 }}
          >
            {eyes.map((eye) => (
              <div
                key={eye.cid}
                className="relative w-full aspect-[4/1] overflow-hidden bg-black border-none"
              >
                <video
                  src={`${storageUrl}${eye.cid}`}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain block"
                />
              </div>
            ))}
          </div>

          {/* Индикатор подгрузки при скролле */}
          {hasMore && (
            <div
              ref={loadMoreRef}
              className="h-32 flex items-center justify-center"
            >
              <div className="w-4 h-4 border border-white/20 border-t-white/80 rounded-full animate-spin" />
            </div>
          )}
        </main>
      )}
    </div>
  );
};

export default Canvas;
