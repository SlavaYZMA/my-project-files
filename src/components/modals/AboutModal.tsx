import NavModal from './NavModal';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const AboutModal = ({ isOpen, onClose }: Props) => {
  const { language, t } = useLanguage();

  const contentRu = (
    <div className="space-y-6 text-sm leading-relaxed text-white/60">
      <p>
        <span className="text-white/80">«Присутствуют»</span> — партиципаторная цифровая видео-инсталляция, основанная на анонимном участии женщин, переживших гендерное насилие.
      </p>
      <p>
        Проект собирает пятисекундные крупноплановые записи глаз. Лицо, тело, голос и история остаются за пределами. Единственным визуальным элементом становится взгляд, определённый как минимальная форма присутствия, не требующая объяснения или доказательства.
      </p>
      <p>
        Участие в проекте добровольное и полностью анонимное. Каждая запись добавляется к инсталляции как равноправный фрагмент, не выделяемый и не иерархизируемый. Личные переживания существуют как факт присутствия.
      </p>
      <p>
        Инсталляция представляет собой постоянно расширяющееся цифровое поле взглядов, воспроизводимых в непрерывном цикле. Зритель оказывается внутри коллективного визуального пространства, где множественность взглядов формирует общее, но не обезличенное присутствие.
      </p>
      <p>
        Проект не стремится к репрезентации насилия и не предлагает его визуального образа. Он создаёт пространство, в котором фиксируется само существование тех, кто его пережил, без требования быть увиденными определённым образом.
      </p>
    </div>
  );

  const contentEn = (
    <div className="space-y-6 text-sm leading-relaxed text-white/60">
      <p>
        <span className="text-white/80">"Present"</span> is a participatory digital video installation based on the anonymous participation of women who have experienced gender-based violence.
      </p>
      <p>
        The project collects five-second close-up recordings of eyes. Face, body, voice, and personal stories remain outside the frame. The only visual element is the gaze, defined as a minimal form of presence that requires no explanation or proof.
      </p>
      <p>
        Participation is voluntary and fully anonymous. Each recording is added to the installation as an equal fragment, neither highlighted nor hierarchized. Personal experiences exist as a fact of presence.
      </p>
      <p>
        The installation represents a continuously expanding digital field of gazes, played in a seamless loop. The viewer is immersed in a collective visual space, where the multiplicity of gazes forms a shared but not depersonalized presence.
      </p>
      <p>
        The project does not aim to represent violence or provide visual depictions of it. It creates a space where the mere existence of those who have survived is recorded, without requiring them to be seen in any particular way.
      </p>
    </div>
  );

  return (
    <NavModal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={t('nav.about')}
    >
      {language === 'ru' ? contentRu : contentEn}
    </NavModal>
  );
};

export default AboutModal;
