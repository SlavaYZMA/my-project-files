import NavModal from './NavModal';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ArtistStatementModal = ({ isOpen, onClose }: Props) => {
  const { language, t } = useLanguage();

  const contentRu = (
    <div className="space-y-6 text-sm leading-relaxed text-white/60">
      <p>
        «Присутствуют» — партиципаторная цифровая видео-инсталляция, собранная из анонимных пятисекундных крупноплановых записей глаз женщин, переживших гендерное насилие.
      </p>
      <p>
        Я намеренно отказываюсь от рассказа и описания травмы. В этом проекте остаётся только взгляд как неотчуждаемая форма присутствия. Глаза здесь не предназначены для демонстрации насилия и не служат его объяснением. Они фиксируют факт существования тех, кто его пережил.
      </p>
      <p>
        Каждый фрагмент это акт свидетельства, исключающий повествования. Анонимность позволяет выйти за пределы индивидуальной истории и быть воспринятым как часть общего, коллективного присутствия.
      </p>
      <p>
        Инсталляция существует как постоянно расширяющееся цифровое поле, состоящее из отдельных взглядов в непрерывном визуальном потоке. Зритель оказывается внутри этого поля, где каждая пара глаз представляет уникальное присутствие, не сводимое к личной истории, статистике или образу жертвы.
      </p>
      <p className="text-white/40 italic">
        Это не история и не статистика. Этот проект не документирует насилие. Он документирует устойчивость присутствия после него.
      </p>
    </div>
  );

  const contentEn = (
    <div className="space-y-6 text-sm leading-relaxed text-white/60">
      <p>
        "Present" is a participatory digital video installation composed of anonymous five-second close-up recordings of the eyes of women who have experienced gender-based violence.
      </p>
      <p>
        I intentionally refrain from telling stories or depicting trauma. In this project, only the gaze remains — an inalienable form of presence. The eyes are not intended to show violence or explain it. They record the fact of existence of those who have survived it.
      </p>
      <p>
        Each fragment is an act of witnessing without narrative. Anonymity allows it to go beyond individual stories and be perceived as part of a collective presence.
      </p>
      <p>
        The installation exists as a constantly expanding digital field, where individual gazes connect into a continuous visual flow. The viewer is immersed in this field, where each pair of eyes represents a unique presence, not reducible to personal story, statistics, or victimhood.
      </p>
      <p className="text-white/40 italic">
        This is not a story or statistics. This project does not document violence. It documents the persistence of presence after it.
      </p>
    </div>
  );

  return (
    <NavModal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={t('nav.statement')}
    >
      {language === 'ru' ? contentRu : contentEn}
    </NavModal>
  );
};

export default ArtistStatementModal;
