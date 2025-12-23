import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import AboutModal from '@/components/modals/AboutModal';
import ArtistStatementModal from '@/components/modals/ArtistStatementModal';
import EthicsModal from '@/components/modals/EthicsModal';
import ParticipateModal from '@/components/modals/ParticipateModal';
import ContactsModal from '@/components/modals/ContactsModal';

interface EyeRecord {
  cid: string;
  created_at?: string;
}

type ModalType = 'about' | 'statement' | 'ethics' | 'participate' | 'contacts' | null;

const ITEMS_PER_PAGE = 100;

const Index = () => {
  const { t } = useLanguage();
  const [activeModal, setActiveModal] = useState<ModalType>(null);
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

    return () => supabase.removeChannel(channel);
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

  const navItems: { key: ModalType; labelKey: string }[] = [
    { key: 'about', labelKey: 'nav.about' },
    { key: 'statement', labelKey: 'nav.statement' },
    { key: 'ethics', labelKey: 'nav.ethics' },
    { key: 'participate', labelKey: 'nav.participate' },
    { key: 'contacts', labelKey: 'nav.contacts' },
  ];

  return (
    <div className="min-h-screen bg-black text-white relative font-mono">

      {/* Background Canvas */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 w-full">
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
                className="w-full h-full object-contain opacity-10 block"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="relative z-20 min-h-screen flex flex-col">

        {/* Header */}
        <header className="relative z-30 p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-base md:text-lg font-bold tracking-[0.3em] text-white/90">
              {t('index.title')}
            </h1>
            <LanguageSwitcher />
          </div>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 md:gap-x-6">
            {navItems.map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveModal(item.key)}
                className="relative z-40 text-white/40 text-xs tracking-widest hover:text-white/80 transition-colors py-2"
              >
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
        </header>

        {/* Main */}
        <main className="flex-1 flex flex-col items-center justify-center px-6 -mt-10">
          <div className="max-w-2xl text-center">
            <h2 className="text-3xl md:text-5xl lg:text-6xl font-light tracking-wide mb-8 leading-tight">
              <span className="text-white">{t('index.subtitle1')}</span>
              <span className="text-white/40 ml-4">{t('index.subtitle2')}</span>
            </h2>

            <div className="max-w-lg mx-auto mb-12">
              <p className="text-white/40 text-base md:text-base leading-relaxed mb-4 tracking-wide">
                {t('index.descriptionParagraph1')}
              </p>
              <p className="text-white/30 text-sm md:text-sm leading-relaxed tracking-wide">
                {t('index.descriptionParagraph2')}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/camera"
                className="px-10 py-4 border border-white text-white text-sm tracking-[0.2em] hover:bg-white hover:text-black transition-all duration-300"
              >
                {t('index.record')}
              </Link>
              <Link
                to="/canvas"
                className="px-10 py-4 border border-white/30 text-white/60 text-sm tracking-[0.2em] hover:border-white hover:text-white transition-all duration-300"
              >
                {t('index.watch')}
              </Link>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="p-4 md:p-6 flex items-center justify-center">
          <span className="text-white/20 text-xs tracking-widest">© 2025</span>
        </footer>
      </div>

      {/* Modals */}
      <AboutModal
        isOpen={activeModal === 'about'}
        onClose={() => setActiveModal(null)}
      />
      <ArtistStatementModal
        isOpen={activeModal === 'statement'}
        onClose={() => setActiveModal(null)}
      />
      <EthicsModal
        isOpen={activeModal === 'ethics'}
        onClose={() => setActiveModal(null)}
      />
      <ParticipateModal
        isOpen={activeModal === 'participate'}
        onClose={() => setActiveModal(null)}
      />
      <ContactsModal
        isOpen={activeModal === 'contacts'}
        onClose={() => setActiveModal(null)}
      />
    </div>
  );
};

export default Index;
