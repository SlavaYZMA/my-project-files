/**
 * src/components/modals/ConsentModal.tsx
 *
 * Исправления из аудита:
 *   А-1: Честное раскрытие: инфраструктурный провайдер (Supabase/AWS) может
 *        хранить IP-адреса в технических логах — это указано явно.
 *        Предыдущая формулировка "не собирает IP" была технически неточной.
 */

import NavModal from "./NavModal";
import { useLanguage } from "@/contexts/LanguageContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAccept?: () => void;
}

const ConsentModal = ({ isOpen, onClose, onAccept }: Props) => {
  const { language } = useLanguage();

  const contentRu = (
    <div className="space-y-6 text-sm leading-relaxed text-white/60">
      <h2 className="text-white/90 font-bold mb-4">
        ИНФОРМИРОВАННОЕ СОГЛАСИЕ / INFORMED CONSENT
      </h2>

      <section>
        <h3 className="text-white/90 font-bold mb-2">1. ДОБРОВОЛЬНОСТЬ</h3>
        <p>Ваше участие в проекте полностью добровольно.</p>
        <p>
          Вы можете прекратить участие на любом этапе, включая уже записанное
          видео, без объяснения причин и без каких-либо последствий.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">
          2. АНОНИМНОСТЬ И ИДЕНТИФИЦИРУЮЩИЕ ЭЛЕМЕНТЫ
        </h3>
        <p>
          Видео идентифицируется только уникальным кодом, сгенерированным
          системой.
        </p>
        <p>
          Кадр фокусируется на глазах, но участница сама выбирает, что попадает
          в рамку. Глаза могут содержать уникальные признаки, позволяющие
          идентифицировать человека.
        </p>
        {/* А-1: Честное раскрытие инфраструктурных логов */}
        <p className="text-yellow-500/70 border border-yellow-500/20 p-3 mt-2">
          <strong className="text-yellow-500/90">Технические ограничения анонимности:</strong>{" "}
          Проект не собирает и не хранит IP-адреса намеренно. Однако
          инфраструктурный провайдер (Supabase / AWS) может фиксировать
          технические данные соединений, включая IP-адреса, в своих системных
          логах в соответствии со своей политикой конфиденциальности. Мы не
          контролируем эти логи. Если для вас критически важна полная анонимность
          подключения, рекомендуем использовать Tor Browser или доверенный VPN.
        </p>
        <p>
          Проект не несёт ответственности, если участница добровольно добавляет
          в кадр лицо, тело или другие идентифицирующие элементы.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">3. ПРАВО НА ОТЗЫВ</h3>
        <p>
          После загрузки видео вы получите уникальную одноразовую ссылку для
          полного удаления записи.
        </p>
        <p>
          Ссылка отображается только один раз — сохраните её в безопасном месте.
        </p>
        <p>
          Используя эту ссылку, вы можете полностью удалить своё видео из проекта
          в любое время. После удаления видео полностью удаляется и восстановлению
          не подлежит.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">
          4. ИСПОЛЬЗОВАНИЕ МАТЕРИАЛОВ
        </h3>
        <p>Видео будет частью цифровой коллективной инсталляции.</p>
        <p>
          В настоящее время проект не используется в коммерческих целях и не будет
          использовать материалы без отдельного согласия участников.
        </p>
        <p>
          Участие не требует раскрытия личной истории, лица или имени.
        </p>
        <p>
          Проект может демонстрировать видео на выставках или в интернете в рамках
          инсталляции, сохраняя анонимность участников.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">
          5. ТЕХНИЧЕСКИЕ ОГРАНИЧЕНИЯ
        </h3>
        <p>
          Проект прилагает усилия для защиты видео и минимизации сбора
          дополнительных данных.
        </p>
        <p>
          Проект не несёт ответственности за технические сбои, утрату видео или
          случайное раскрытие материалов.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">
          6. ПРЕДУПРЕЖДЕНИЕ О ТРИГГЕРАХ
        </h3>
        <p>Проект затрагивает темы гендерного насилия.</p>
        <p>Участие может вызвать сильные эмоции.</p>
        <p>
          Если вам необходима поддержка, обратитесь к специализированной горячей
          линии.
        </p>
        <p>
          Участник принимает на себя ответственность за своё эмоциональное
          состояние во время участия.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">7. СОГЛАСИЕ</h3>
        <p>Отправляя видео, вы подтверждаете, что:</p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            Идентифицируете себя как женщину, пережившую гендерное насилие.
          </li>
          <li>
            Добровольно предоставляете анонимное видео для проекта.
          </li>
          <li>
            Понимаете, что глаза могут быть идентифицирующим элементом.
          </li>
          <li>
            Понимаете, что инфраструктурный провайдер может фиксировать
            технические данные соединения (включая IP) в системных логах.
          </li>
          <li>
            Понимаете, что после удаления запись полностью удаляется и
            восстановлению не подлежит.
          </li>
          <li>
            Понимаете, что проект не требует раскрытия деталей травмы или
            личной истории.
          </li>
        </ul>
      </section>
    </div>
  );

  const contentEn = (
    <div className="space-y-6 text-sm leading-relaxed text-white/60">
      <h2 className="text-white/90 font-bold mb-4">
        INFORMED CONSENT / ИНФОРМИРОВАННОЕ СОГЛАСИЕ
      </h2>

      <section>
        <h3 className="text-white/90 font-bold mb-2">
          1. VOLUNTARY PARTICIPATION
        </h3>
        <p>Your participation in this project is entirely voluntary.</p>
        <p>
          You can withdraw at any time, including already recorded videos,
          without explanation or consequences.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">
          2. ANONYMITY & IDENTIFYING ELEMENTS
        </h3>
        <p>
          The video is identified only by a unique system-generated code.
        </p>
        <p>
          The frame focuses on eyes, but the participant chooses what is in the
          frame. Eyes may contain unique features that could identify a person.
        </p>
        {/* А-1: Honest disclosure of infrastructure logging */}
        <p className="text-yellow-500/70 border border-yellow-500/20 p-3 mt-2">
          <strong className="text-yellow-500/90">Technical anonymity limitations:</strong>{" "}
          This project does not intentionally collect or store IP addresses.
          However, our infrastructure provider (Supabase / AWS) may log
          technical connection data, including IP addresses, in their system
          logs according to their own privacy policy. We do not control these
          logs. If complete connection anonymity is critical for you, we
          recommend using Tor Browser or a trusted VPN.
        </p>
        <p>
          The project is not responsible if the participant voluntarily includes
          face, body, or other identifying elements.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">3. RIGHT TO WITHDRAW</h3>
        <p>
          After uploading your video, you will receive a unique one-time link to
          permanently delete the recording.
        </p>
        <p>The link is shown only once — save it in a safe place.</p>
        <p>
          Using this link, you can delete your video at any time. Once deleted,
          the video is permanently removed and cannot be restored.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">4. USE OF MATERIALS</h3>
        <p>The video will be part of a collective digital installation.</p>
        <p>
          The project is currently non-commercial and will not use materials
          without separate participant consent.
        </p>
        <p>
          Participation does not require disclosure of personal story, face, or
          name.
        </p>
        <p>
          The project may display videos in exhibitions or online within the
          installation, preserving participant anonymity.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">
          5. TECHNICAL LIMITATIONS
        </h3>
        <p>
          The project takes measures to protect videos and minimize the
          collection of additional data.
        </p>
        <p>
          The project is not responsible for technical failures, loss of videos,
          or accidental disclosure of materials.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">6. TRIGGER WARNING</h3>
        <p>This project addresses themes of gender-based violence.</p>
        <p>Participation may evoke strong emotions.</p>
        <p>
          If you need support, please contact a specialized helpline.
        </p>
        <p>
          Participants take responsibility for their emotional state during
          participation.
        </p>
      </section>

      <section>
        <h3 className="text-white/90 font-bold mb-2">7. CONSENT</h3>
        <p>By submitting your video, you confirm that:</p>
        <ul className="list-disc list-inside space-y-1 mt-2">
          <li>
            You identify as a woman who has experienced gender-based violence.
          </li>
          <li>
            You voluntarily contribute an anonymous recording to the project.
          </li>
          <li>You understand that eyes may be an identifying element.</li>
          <li>
            You understand that the infrastructure provider may log technical
            connection data (including IP addresses) in their system logs.
          </li>
          <li>
            You understand that once deleted, the video cannot be restored.
          </li>
          <li>
            You understand that the project does not require disclosure of
            trauma details or personal history.
          </li>
        </ul>
      </section>
    </div>
  );

  return (
    <NavModal
      isOpen={isOpen}
      onClose={onClose}
      title="INFORMED CONSENT / ИНФОРМИРОВАННОЕ СОГЛАСИЕ"
    >
      {language === "ru" ? contentRu : contentEn}
      {onAccept && (
        <div className="mt-6 flex gap-4">
          <button
            onClick={onAccept}
            className="flex-1 px-6 py-3 bg-white text-black hover:bg-white/90 transition-colors font-medium uppercase tracking-widest text-sm"
          >
            {language === "ru" ? "ПРИНЯТЬ И СОХРАНИТЬ" : "ACCEPT AND SAVE"}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 border border-white/30 hover:bg-white/10 transition-colors text-sm"
          >
            {language === "ru" ? "ОТМЕНА" : "CANCEL"}
          </button>
        </div>
      )}
    </NavModal>
  );
};

export default ConsentModal;
