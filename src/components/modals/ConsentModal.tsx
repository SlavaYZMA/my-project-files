import NavModal from './NavModal';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const ConsentModal = ({ isOpen, onClose }: Props) => {
  const { language } = useLanguage();

  const contentRu = (
    <div className="space-y-6 text-sm leading-relaxed text-white/60">
      <section>
        <h3 className="text-white/90 font-bold mb-3">ДОБРОВОЛЬНОСТЬ</h3>
        <p>
          Ваше участие в проекте полностью добровольно. Вы можете прекратить участие на любом этапе, включая уже записанное видео, без объяснения причин и без каких-либо последствий.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">АНОНИМНОСТЬ И ИДЕНТИФИЦИРУЮЩИЕ ЭЛЕМЕНТЫ</h3>
        <p>
          Видео идентифицируется только уникальным кодом, сгенерированным системой. Кадр фокусируется на глазах, но участница сама выбирает, что попадает в рамку. Глаза могут содержать уникальные признаки, позволяющие идентифицировать человека. Проект не собирает IP-адреса, метаданные устройства или другие персональные данные для идентификации участников. Проект не несет ответственности, если участница добровольно добавляет в кадр лицо, тело или другие элементы, позволяющие идентифицировать её.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">ПРАВО НА ОТЗЫВ</h3>
        <p>
          После загрузки видео вы получите уникальную одноразовую ссылку для полного удаления записи. Ссылка отображается только один раз — сохраните её в безопасном месте. Используя эту ссылку, вы можете полностью удалить своё видео из проекта в любое время. После удаления видео полностью удаляется и восстановлению не подлежит.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">ИСПОЛЬЗОВАНИЕ МАТЕРИАЛОВ</h3>
        <p>
          Видео будет частью цифровой коллективной инсталляции. В настоящее время проект не используется в коммерческих целях и не будет использовать материалы без отдельного согласия участников. Участие не требует раскрытия личной истории, лица или имени. Проект может демонстрировать видео на выставках или в интернете в рамках инсталляции, сохраняя анонимность участников.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">ТЕХНИЧЕСКИЕ ОГРАНИЧЕНИЯ</h3>
        <p>
          Проект прилагает усилия для защиты видео и минимизации сбора дополнительных данных. Проект не несет ответственности за технические сбои, утрату видео или случайное раскрытие материалов.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">ПРЕДУПРЕЖДЕНИЕ О ТРИГГЕРАХ</h3>
        <p>
          Проект затрагивает темы гендерного насилия. Участие может вызвать сильные эмоции. Если вам необходима поддержка, обратитесь к специализированной горячей линии. Участник принимает на себя ответственность за своё эмоциональное состояние во время участия.
        </p>
      </section>

      <section className="border-t border-white/10 pt-6">
        <p className="text-white/80 font-medium">
          Отправляя видео, вы подтверждаете, что идентифицируете себя как женщину, пережившую гендерное насилие, добровольно предоставляете анонимное видео для проекта, понимаете, что глаза могут быть идентифицирующим элементом, и осознаёте условия удаления записи.
        </p>
      </section>
    </div>
  );

  const contentEn = (
    <div className="space-y-6 text-sm leading-relaxed text-white/60">
      <section>
        <h3 className="text-white/90 font-bold mb-3">VOLUNTARY PARTICIPATION</h3>
        <p>
          Your participation in this project is entirely voluntary. You can withdraw at any time, including already recorded videos, without explanation or consequences.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">ANONYMITY & IDENTIFYING ELEMENTS</h3>
        <p>
          The video is identified only by a unique system-generated code. The frame focuses on eyes, but the participant chooses what is in the frame. Eyes may contain unique features that could identify a person. The project does not collect IP addresses, device metadata, or other personal data for identification. The project is not responsible if the participant voluntarily includes face, body, or other identifying elements.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">RIGHT TO WITHDRAW</h3>
        <p>
          After uploading your video, you will receive a unique one-time link to permanently delete the recording. The link is shown only once — save it in a safe place. Using this link, you can delete your video at any time. Once deleted, the video is permanently removed and cannot be restored.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">USE OF MATERIALS</h3>
        <p>
          The video will be part of a collective digital installation. Currently, the project is not used for commercial purposes and will not use materials without separate participant consent. Participation does not require disclosure of personal story, face, or name. The project may display videos in exhibitions or online within the installation, preserving participant anonymity.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">TECHNICAL LIMITATIONS</h3>
        <p>
          The project takes measures to protect videos and minimize the collection of additional data. The project is not responsible for technical failures, loss of videos, or accidental disclosure of materials.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-3">TRIGGER WARNING</h3>
        <p>
          This project addresses themes of gender-based violence. Participation may evoke strong emotions. If you need support, please contact a specialized helpline. Participants take responsibility for their emotional state during participation.
        </p>
      </section>

      <section className="border-t border-white/10 pt-6">
        <p className="text-white/80 font-medium">
          By submitting your video, you confirm that you identify as a woman who has experienced gender-based violence, voluntarily contribute this anonymous recording to the project, understand that eyes may be an identifying element, and acknowledge the deletion conditions.
        </p>
      </section>
    </div>
  );

  return (
    <NavModal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={language === 'ru' ? 'INFORMED CONSENT' : 'INFORMED CONSENT'}
    >
      {language === 'ru' ? contentRu : contentEn}
    </NavModal>
  );
};

export default ConsentModal;
