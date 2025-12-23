import { createContext, useContext, useState, ReactNode } from 'react';

type Language = 'ru' | 'en';

interface Translations {
  [key: string]: {
    ru: string;
    en: string;
  };
}

export const translations: Translations = {
  // Navigation
  'nav.about': { ru: 'О проекте', en: 'About' },
  'nav.statement': { ru: 'Заявление художника', en: 'Artist Statement' },
  'nav.ethics': { ru: 'Этика', en: 'Ethics' },
  'nav.participate': { ru: 'Как участвовать', en: 'How to Participate' },
  'nav.contacts': { ru: 'Контакты', en: 'Contacts' },

  // Index page
  'index.title': { ru: 'ГОРГОНА', en: 'GORGONA' },
  'index.subtitle1': { ru: 'Присутствуют', en: 'Present' },
  'index.subtitle2': { ru: '', en: '' },
  'index.descriptionParagraph1': {
  ru: 'Цифровая видео-инсталляция, основанная на анонимном участии женщин, переживших гендерное насилие.',
  en: 'A digital video installation based on the anonymous participation of women who have experienced gender-based violence.'
},
'index.descriptionParagraph2': {
  ru: 'Пространство фиксирует существование тех, кто пережил травму, без требования быть увиденными определённым образом.',
  en: 'This space records the existence of those who have survived trauma, without requiring them to be seen in any particular way.'
},
'index.descriptionParagraph3': {
  ru: 'Проект не репрезентирует насилие и не предлагает его визуального образа.',
  en: 'The project does not represent violence or provide its visual depiction.'
},
  'index.record': { ru: 'ЗАПИСАТЬ', en: 'RECORD' },
  'index.watch': { ru: 'СМОТРЕТЬ', en: 'VIEW' },

  // Camera page
  'camera.instruction': { 
    ru: 'Смотрите прямо в камеру. Запись начнётся автоматически.',
    en: 'Look directly at the camera. Recording will start automatically.'
  },
  'camera.lookAtCamera': { ru: 'Смотрите прямо в камеру', en: 'Look at the camera' },
  'camera.recording': { ru: 'ЗАПИСЬ', en: 'REC' },
  'camera.paused': { ru: 'ПАУЗА', en: 'PAUSED' },
  'camera.statusGreen': { ru: 'Глаза в рамке, смотрят в камеру → идёт запись', en: 'Eyes in frame, looking at camera → recording' },
  'camera.statusOrange': { ru: 'Глаза в рамке, но взгляд не в камеру', en: 'Eyes in frame, but not looking at camera' },
  'camera.statusRed': { ru: 'Глаза не в рамке / один глаз закрыт / слишком далеко', en: 'Eyes not in frame / one eye closed / too far' },
  'camera.statusBlack': { ru: 'Глаза не в рамке / слишком далеко', en: 'Eyes not in frame / too far' },
  'camera.statusRecording': { ru: 'Запись идёт — можете смотреть в любую сторону', en: 'Recording — you can look anywhere' },
  'camera.instructionBlack': { ru: 'Чёрный фон: глаза не в рамке / слишком далеко', en: 'Black background: eyes not in frame / too far' },
  'camera.instructionTitle': { ru: 'Инструкция:', en: 'Instructions:' },
  'camera.instructionWhite': { ru: 'Белая рамка: место для глаз', en: 'White frame: place for eyes' },
  'camera.instructionRed': { ru: 'Красный фон: глаза не в рамке / один глаз закрыт', en: 'Red background: eyes not in frame / one eye closed' },
  'camera.instructionYellow': { ru: 'Жёлтый фон: глаза в рамке, но взгляд не в камеру', en: 'Yellow background: eyes in frame, but not looking at camera' },
  'camera.instructionGreen': { ru: 'Зелёный фон: глаза в рамке, смотрят в камеру → запись', en: 'Green background: eyes in frame, looking at camera → recording' },
  'camera.saved': { ru: 'СОХРАНЕНО', en: 'SAVED' },
  'camera.deleteLink': { 
    ru: 'Ссылка для удаления: Ссылка отображается один раз. С её помощью запись будет полностью удалена из проекта. Сохраняйте её в безопасном месте.', 
    en: 'Delete link: The link is displayed only once. Using it will permanently delete the recording from the project. Please keep it in a safe place.' 
  },
  'camera.viewCanvas': { ru: 'СМОТРЕТЬ ПОЛОТНО', en: 'VIEW CANVAS' },

  // Identity confirmation
  'camera.identity': {
    ru: 'Я подтверждаю, что идентифицирую себя как женщина, пережившая гендерное насилие.',
    en: 'I confirm that I identify as a woman who has experienced gender-based violence.'
  },
  'camera.confirm': { ru: 'ПОДТВЕРДИТЬ', en: 'CONFIRM' },
  'camera.consent': { ru: 'Я принимаю условия участия', en: 'I accept the terms of participation' },
  'camera.viewConsent': { ru: 'Просмотреть условия', en: 'View terms' },
  'camera.save': { ru: 'ДОБАВИТЬ В ПОЛОТНО', en: 'ADD TO CANVAS' },
  'camera.retake': { ru: 'ПЕРЕСНЯТЬ', en: 'RETAKE' },
  'camera.download': { ru: 'СКАЧАТЬ', en: 'DOWNLOAD' },
  'camera.welcome': { ru: 'Добро пожаловать', en: 'Welcome' },
  'camera.start': { ru: 'НАЧАТЬ', en: 'START' },
  'camera.saving': { ru: 'СОХРАНЕНИЕ...', en: 'SAVING...' },
  'camera.saveForever': { ru: 'СОХРАНИТЬ НАВСЕГДА', en: 'SAVE FOREVER' },
  'camera.recordAnother': { ru: 'ЗАПИСАТЬ ЕЩЁ', en: 'RECORD ANOTHER' },
  'common.back': { ru: 'Назад', en: 'Back' },

  // Support
  'support.title': { ru: 'Ресурсы поддержки', en: 'Support Resources' },
  'support.trigger': { 
    ru: '⚠️ Предупреждение о триггерах: Сильные эмоции во время участия — это нормальная реакция.',
    en: '⚠️ Trigger Warning: Strong emotions during participation are normal.'
  },

  // Canvas
  'canvas.loading': { ru: 'ЗАГРУЗКА...', en: 'LOADING...' },
  'canvas.empty': { ru: 'НЕТ ЗАПИСЕЙ', en: 'NO RECORDINGS' },
  'canvas.admin': { ru: 'АДМИН', en: 'ADMIN' },
  'canvas.refresh': { ru: 'ОБНОВИТЬ', en: 'REFRESH' },
  'canvas.addFirst': { ru: 'ДОБАВИТЬ ПЕРВУЮ ЗАПИСЬ', en: 'ADD FIRST RECORDING' },

  // About modal
  'about.title': { ru: 'О ПРОЕКТЕ', en: 'ABOUT' },
  'about.p1': {
    ru: 'ГОРГОНА — анонимный цифровой мемориал для тех, кто пережил насилие.',
    en: 'GORGONA is an anonymous digital memorial for those who have experienced violence.'
  },
  'about.p2': {
    ru: 'Каждый посетитель может записать короткое видео своих глаз — без лица, без имени, без идентификации. Эти глаза становятся частью вечного полотна памяти.',
    en: 'Each visitor can record a short video of their eyes — without face, without name, without identification. These eyes become part of an eternal canvas of memory.'
  },
  'about.p3': {
    ru: 'Видео хранится навсегда. Единственный человек, который может его удалить — тот, кто его создал.',
    en: 'The video is stored forever. The only person who can delete it is the one who created it.'
  },
  'about.p4': {
    ru: 'Проект назван в честь Горгоны Медузы — существа, чей взгляд обращал в камень. Здесь взгляд становится символом несломленной воли.',
    en: 'The project is named after Gorgon Medusa — a being whose gaze turned others to stone. Here, the gaze becomes a symbol of unbroken will.'
  },
  'about.privacy': {
    ru: 'Никакие личные данные не собираются. Все записи полностью анонимны.',
    en: 'No personal data is collected. All recordings are completely anonymous.'
  },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>('ru');

  const t = (key: string): string => {
    const translation = translations[key];
    if (!translation) return key;
    return translation[language];
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};
