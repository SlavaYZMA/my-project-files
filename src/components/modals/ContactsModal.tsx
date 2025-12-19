import NavModal from './NavModal';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ContactsModal = ({ isOpen, onClose }: Props) => {
  const { language, t } = useLanguage();

  const content = (
    <div className="space-y-6 text-sm leading-relaxed">
      <section>
        <h3 className="text-white/90 font-bold tracking-wider mb-4">
          {language === 'ru' ? 'ЭЛЕКТРОННАЯ ПОЧТА' : 'EMAIL'}
        </h3>
        <a 
          href="mailto:vistrum@gmail.com"
          className="text-white/80 hover:text-white transition-colors text-lg"
        >
          vistrum@gmail.com
        </a>
      </section>

      <section>
        <h3 className="text-white/90 font-bold tracking-wider mb-4">
          INSTAGRAM
        </h3>
        <a 
          href="https://instagram.com/iconicyzma"
          target="_blank"
          rel="noopener noreferrer"
          className="text-white/80 hover:text-white transition-colors text-lg"
        >
          @iconicyzma
        </a>
      </section>

      <section className="pt-6 border-t border-white/10">
        <p className="text-white/40 text-xs">
          {language === 'ru' 
            ? 'По любым вопросам и предложениям, обращайтесь по электронной почте.'
            : 'For any questions or suggestions, please contact us by email.'
          }
        </p>
      </section>
    </div>
  );

  return (
    <NavModal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={t('nav.contacts')}
    >
      {content}
    </NavModal>
  );
};

export default ContactsModal;
