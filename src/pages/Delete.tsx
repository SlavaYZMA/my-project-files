import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

const translations = {
  ru: {
    title: 'Удаление глаз',
    description: 'Это действие необратимо.\nВаш взгляд будет удалён навсегда из вечного полотна.',
    deleting: 'Удаление...',
    successMessage: 'Глаза удалены навсегда.',
    errorMessage: 'Ошибка удаления',
    deleteButton: 'Удалить навсегда',
    back: '← Вернуться на главную',
    switchLang: 'EN',
  },
  en: {
    title: 'Delete Eyes',
    description: 'This action is irreversible.\nYour gaze will be permanently removed from the eternal canvas.',
    deleting: 'Deleting...',
    successMessage: 'Eyes permanently deleted.',
    errorMessage: 'Delete error',
    deleteButton: 'Delete Forever',
    back: '← Back to Home',
    switchLang: 'RU',
  },
};

const Delete = () => {
  const { language, setLanguage } = useLanguage(); // предполагаем, что context поддерживает setLanguage
  const t = translations[language] || translations.ru;

  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'idle' | 'deleting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage(t.errorMessage);
    }
  }, [token, t.errorMessage]);

  const handleDelete = async () => {
    if (!token) return;

    setStatus('deleting');

    try {
      const { data: tokenData, error: tokenError } = await supabase
        .from('delete_tokens')
        .select('cid')
        .eq('delete_token', token)
        .single();

      if (tokenError || !tokenData) {
        throw new Error(t.errorMessage);
      }

      const cid = tokenData.cid;

      const { error: storageError } = await supabase.storage
        .from('eyes')
        .remove([cid]);

      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from('eyes')
        .delete()
        .eq('cid', cid);

      if (dbError) throw dbError;

      setStatus('success');
      setMessage(t.successMessage);

    } catch (err: any) {
      console.error('Delete error:', err);
      setStatus('error');
      setMessage(err.message || t.errorMessage);
    }
  };

  const toggleLanguage = () => {
    setLanguage(language === 'ru' ? 'en' : 'ru');
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center font-mono">
      <div className="text-center max-w-md p-8 relative">
        <button
          onClick={toggleLanguage}
          className="absolute top-4 right-4 px-3 py-1 bg-white/10 hover:bg-white/20 rounded transition"
        >
          {t.switchLang}
        </button>

        <h1 className="text-2xl md:text-3xl mb-8">{t.title}</h1>

        {status === 'idle' && (
          <>
            <p className="text-white/60 mb-10 leading-relaxed">
              {t.description.split('\n').map((line, i) => <span key={i}>{line}<br/></span>)}
            </p>
            <button
              onClick={handleDelete}
              className="px-12 py-5 bg-red-900/80 hover:bg-red-800 text-white text-lg uppercase tracking-widest transition-colors"
            >
              {t.deleteButton}
            </button>
          </>
        )}

        {status === 'deleting' && (
          <p className="text-white/60 text-lg">{t.deleting}</p>
        )}

        {status === 'success' && (
          <>
            <p className="text-green-400 text-xl mb-8">{message}</p>
            <Link to="/" className="text-white/60 hover:text-white underline transition-colors">
              {t.back}
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <p className="text-red-400 text-xl mb-8">{message}</p>
            <Link to="/" className="text-white/60 hover:text-white underline transition-colors">
              {t.back}
            </Link>
          </>
        )}
      </div>
    </div>
  );
};

export default Delete;
