import NavModal from './NavModal';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const EthicsModal = ({ isOpen, onClose }: Props) => {
  const { language, t } = useLanguage();

  const contentRu = (
    <div className="space-y-8 text-sm leading-relaxed">
      <section>
        <p>
          Проект <strong>«Присутствуют»</strong> построен на принципах бережного и травмо-информированного взаимодействия с участницами. Этика здесь не просто сопровождает работу — она определяет её форму и границы, обеспечивая безопасность и уважение к личному опыту.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold tracking-wider mb-4">Основные принципы</h3>
        <ul className="space-y-3 text-white/60">
          <li>• Анонимность: проект не собирает и не хранит персональные данные. В кадре присутствует только взгляд, исключающий возможность идентификации.</li>
          <li>• Добровольное и информированное участие: участие полностью добровольное. Участница решает, загружать ли видео, и понимает, как материал будет использован. Любые сомнения или колебания — нормальная реакция.</li>
          <li>• Право на отзыв: каждой участнице предоставляется одноразовая ссылка для удаления записи. Только с этой ссылки возможно отозвать видео; после удаления запись навсегда удаляется из проекта.</li>
          <li>• Отсутствие коммерческого использования: материалы проекта не используются в коммерческих целях.</li>
          <li>• Травмо-информированный подход: проект исключает репрезентацию насилия, детализацию травматического опыта и повторную виктимизацию. Участие не требует рассказа или объяснения пережитого. Любые эмоциональные реакции признаны нормальными.</li>
          <li>• Минимизация данных: собирается только необходимый материал. Любые формы дополнительного сбора информации исключены для обеспечения конфиденциальности.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-white/90 font-bold tracking-wider mb-4">Контакт для связи</h3>
        <p className="text-white/60">
          По вопросам участия, отзыва видео или другим вопросам, связанным с проектом, пишите на:{' '}
          <a 
            href="mailto:eternalcanvas@proton.me" 
            className="text-white/80 hover:text-white transition-colors underline"
          >
            eternalcanvas@proton.me
          </a>
        </p>
        <p className="text-white/60 mt-2">
          Ответы будут предоставлены в порядке поступления сообщений. Мы стремимся к прозрачности и уважению к участницам, учитывая особенности дистанционной работы.
        </p>
      </section>
    </div>
  );

  const contentEn = (
    <div className="space-y-8 text-sm leading-relaxed">
      <section>
        <p>
          The project <strong>"Present"</strong> is based on principles of careful and trauma-informed interaction with participants. Ethics here do not merely accompany the work — they define its structure and boundaries, ensuring safety and respect for personal experience.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold tracking-wider mb-4">Core Principles</h3>
        <ul className="space-y-3 text-white/60">
          <li>• Anonymity: the project does not collect or store personal data. Only the eyes are filmed, preventing identification.</li>
          <li>• Voluntary and informed participation: participation is fully voluntary. Participants decide whether to upload a video and understand how the material will be used. Any hesitation or uncertainty is normal.</li>
          <li>• Right to withdraw: each participant receives a one-time link to delete their video. Only with this link can the video be removed; once deleted, it is permanently erased from the project.</li>
          <li>• Non-commercial use: project materials are not used for commercial purposes.</li>
          <li>• Trauma-informed approach: the project avoids representing violence, detailing traumatic experiences, or retraumatization. Participation does not require storytelling or explaining experiences. Emotional reactions are recognized as normal.</li>
          <li>• Data minimization: only material necessary for the installation is collected. Any additional data collection is excluded to ensure confidentiality.</li>
        </ul>
      </section>

      <section>
        <h3 className="text-white/90 font-bold tracking-wider mb-4">Contact</h3>
        <p className="text-white/60">
          For questions about participation, video withdrawal, or other project-related inquiries, contact:{' '}
          <a 
            href="mailto:eternalcanvas@proton.me" 
            className="text-white/80 hover:text-white transition-colors underline"
          >
            eternalcanvas@proton.me
          </a>
        </p>
        <p className="text-white/60 mt-2">
          Responses will be provided in the order messages are received. We aim for transparency and respect for participants, considering the remote nature of the project.
        </p>
      </section>
    </div>
  );

  return (
    <NavModal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={t('nav.ethics')}
    >
      {language === 'ru' ? contentRu : contentEn}
    </NavModal>
  );
};

export default EthicsModal;
