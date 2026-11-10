export type CodeLanguage = 'en' | 'ru';
export type Translation = readonly [string, string];
export const both = (en: string, ru: string): Translation => [en, ru];
export const translated = (value: Translation, language: CodeLanguage) =>
  value[language === 'en' ? 0 : 1];
