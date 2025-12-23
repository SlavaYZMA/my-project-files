import { useState } from 'react';
import { Link } from 'react-router-dom';
import NavModal from './NavModal';
import { useLanguage } from '@/contexts/LanguageContext';
import ConsentModal from './ConsentModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ParticipateModal = ({ isOpen, onClose }: Props) => {
  const { language, t } = useLanguage();
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  const contentRu = (
    <div className="space-y-6 text-sm leading-relaxed">
      <section>
        <h3 className="text-white/90 font-bold tracking-wider mb-4">Как участвовать</h3>
        <ol className="space-y-3 text-white/60 list-decimal list-inside">
          <li>
            <strong>Ознакомьтесь с условиями участия (Informed Consent)</strong><br />
            Важно понять, как будет использован ваш материал и что участие полностью добровольное.
          </li>
          <li>
            <strong>Подтвердите своё согласие</strong><br />
            Вы подтверждаете, что согласны с условиями проекта и готовы загрузить своё видео.
          </li>
        </ol>
      </section>

      {/* Блок с чекбоксом и ссылкой на Informed Consent после первых двух пунктов */}
      <section className="border border-white/10 p-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="consent-check"
            checked={consentAccepted}
            onChange={(e) => setConsentAccepted(e.target.checked)}
            className="mt-1 w-4 h-4 accent-white"
          />
          <label htmlFor="consent-check" className="text-white/60 cursor-pointer">
            Я подтверждаю, что согласна с{' '}
            <button 
              onClick={() => setShowConsent(true)}
              className="text-white/80 underline hover:text-white transition-colors"
            >
              условиями участия (Informed Consent)
            </button>
          </label>
        </div>
      </section>

      <section>
        <ol className="space-y-3 text-white/60 list-decimal list-inside start-3">
          <li>
            <strong>Перейдите на страницу записи</strong><br />
            Запись проходит дистанционно, в безопасной для вас обстановке.
          </li>
          <li>
            <strong>Запишите 5-секундное видео своих глаз</strong><br />
            Лицо и тело остаются вне кадра. Видео фиксирует только взгляд — минимальная форма присутствия.
          </li>
          <li>
            <strong>Сохраните одноразовую ссылку для удаления</strong><br />
            После загрузки вам будет показана ссылка для полного удаления видео. Она отображается только один раз, сохраните её в безопасном месте. Без этой ссылки удалить запись невозможно, чтобы сохранить анонимность.
          </li>
        </ol>
      </section>

      {/* Кнопка "Перейти к записи" сразу после текста о записи */}
      {consentAccepted && (
        <Link
          to="/camera"
          onClick={onClose}
          className="block w-full text-center py-4 bg-white text-black font-bold tracking-widest hover:bg-white/90 transition-colors"
        >
          ПЕРЕЙТИ К ЗАПИСИ
        </Link>
      )}

      <section className="bg-yellow-500/10 border border-yellow-500/20 p-4">
        <p className="text-yellow-500/80 text-xs font-bold mb-2">⚠️ Предупреждение о триггерах</p>
        <p className="text-white/50 text-xs">
          Проект затрагивает темы гендерного насилия. Сильные эмоции во время участия — это нормальная реакция. Вы всегда можете остановить участие и воспользоваться ссылкой для удаления видео.
        </p>
      </section>

      <section className="border border-white/10 p-4">
        <p className="text-white/60 text-xs mb-1">Контакт для связи:</p>
        <p className="text-white/40 text-xs">
          По вопросам участия, отзыва видео или другим вопросам, связанным с проектом, пишите на: <br />
          <strong>vistrum.netlify@gmail.com</strong>
        </p>
        <p className="text-white/50 text-xs mt-2">
          Мы стремимся к прозрачности, уважению и безопасности участников даже в дистанционном формате.
        </p>
      </section>
    </div>
  );

  const contentEn = (
    <div className="space-y-6 text-sm leading-relaxed">
      <section>
        <h3 className="text-white/90 font-bold tracking-wider mb-4">How to participate</h3>
        <ol className="space-y-3 text-white/60 list-decimal list-inside">
          <li>
            <strong>Read the terms of participation (Informed Consent)</strong><br />
            It is important to understand how your material will be used and that participation is completely voluntary.
          </li>
          <li>
            <strong>Confirm your agreement</strong><br />
            You confirm that you agree to the terms of the project and are ready to upload your video.
          </li>
        </ol>
      </section>

      {/* Checkbox block after first two points */}
      <section className="border border-white/10 p-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="consent-check-en"
            checked={consentAccepted}
            onChange={(e) => setConsentAccepted(e.target.checked)}
            className="mt-1 w-4 h-4 accent-white"
          />
          <label htmlFor="consent-check-en" className="text-white/60 cursor-pointer">
            I confirm that I agree to the{' '}
            <button 
              onClick={() => setShowConsent(true)}
              className="text-white/80 underline hover:text-white transition-colors"
            >
              terms of participation (Informed Consent)
            </button>
          </label>
        </div>
      </section>

      <section>
        <ol className="space-y-3 text-white/60 list-decimal list-inside start-3">
          <li>
            <strong>Go to the recording page</strong><br />
            Recording is done remotely, in a safe environment.
          </li>
          <li>
            <strong>Record a 5-second video of your eyes</strong><br />
            Face and body remain out of frame. The video records only your gaze — a minimal form of presence.
          </li>
          <li>
            <strong>Save the one-time delete link</strong><br />
            After uploading, you will see a link to permanently delete your video. It will only be shown once, save it in a safe place. Without this link, deletion is not possible to maintain anonymity.
          </li>
        </ol>
      </section>

      {/* Button after recording text */}
      {consentAccepted && (
        <Link
          to="/camera"
          onClick={onClose}
          className="block w-full text-center py-4 bg-white text-black font-bold tracking-widest hover:bg-white/90 transition-colors"
        >
          GO TO RECORDING
        </Link>
      )}

      <section className="bg-yellow-500/10 border border-yellow-500/20 p-4">
        <p className="text-yellow-500/80 text-xs font-bold mb-2">⚠️ Trigger warning</p>
        <p className="text-white/50 text-xs">
          This project addresses themes of gender-based violence. Strong emotions during participation are a normal reaction. You can always stop participation and use the delete link.
        </p>
      </section>

      <section className="border border-white/10 p-4">
        <p className="text-white/60 text-xs mb-1">Contact:</p>
        <p className="text-white/40 text-xs">
          For questions about participation, deleting your video, or other project-related matters, please write to: <br />
          <strong>vistrum.netlify@gmail.com</strong>
        </p>
        <p className="text-white/50 text-xs mt-2">
          We are committed to transparency, respect, and participant safety even in a fully remote format.
        </p>
      </section>
    </div>
  );

  return (
    <>
      <NavModal 
        isOpen={isOpen} 
        onClose={onClose} 
        title={t('nav.participate')}
      >
        {language === 'ru' ? contentRu : contentEn}
      </NavModal>
      
      <ConsentModal 
        isOpen={showConsent} 
        onClose={() => setShowConsent(false)} 
      />
    </>
  );
};

export default ParticipateModal;
