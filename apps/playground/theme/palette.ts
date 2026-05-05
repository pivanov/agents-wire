export interface ITheme {
  accent: string;
  permission: string;
  professionalBlue: string;
  systemSpinner: string;
  suggestion: string;
  text: string;
  inverseText: string;
  inactive: string;
  subtle: string;
  success: string;
  error: string;
  warning: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedWord: string;
  diffRemovedWord: string;
  userMessageBg: string;
  border: string;
}

export const THEME_NAMES = ["dark", "light", "dark-daltonized", "light-daltonized", "dark-ansi", "light-ansi"] as const;
export type TThemeId = (typeof THEME_NAMES)[number];
export const THEME_IDS: readonly TThemeId[] = THEME_NAMES;

const dark: ITheme = {
  accent: "rgb(129,140,248)",
  permission: "rgb(129,140,248)",
  professionalBlue: "rgb(129,140,248)",
  systemSpinner: "rgb(147,165,255)",
  suggestion: "rgb(129,140,248)",
  text: "rgb(229,231,235)",
  inverseText: "rgb(0,0,0)",
  inactive: "rgb(156,163,175)",
  subtle: "rgb(80,80,80)",
  success: "rgb(78,186,101)",
  error: "rgb(255,107,128)",
  warning: "rgb(252,211,77)",
  diffAdded: "rgb(34,92,43)",
  diffRemoved: "rgb(122,41,54)",
  diffAddedWord: "rgb(56,166,96)",
  diffRemovedWord: "rgb(179,89,107)",
  userMessageBg: "rgb(26,26,26)",
  border: "rgb(80,80,80)",
};

const light: ITheme = {
  accent: "rgb(79,70,229)",
  permission: "rgb(79,70,229)",
  professionalBlue: "rgb(79,70,229)",
  systemSpinner: "rgb(87,105,247)",
  suggestion: "rgb(79,70,229)",
  text: "rgb(17,24,39)",
  inverseText: "rgb(255,255,255)",
  inactive: "rgb(102,102,102)",
  subtle: "rgb(175,175,175)",
  success: "rgb(44,122,57)",
  error: "rgb(171,43,63)",
  warning: "rgb(180,83,9)",
  diffAdded: "rgb(105,219,124)",
  diffRemoved: "rgb(255,168,180)",
  diffAddedWord: "rgb(47,157,68)",
  diffRemovedWord: "rgb(209,69,75)",
  userMessageBg: "rgb(240,240,240)",
  border: "rgb(175,175,175)",
};

const darkDaltonized: ITheme = {
  ...dark,
  systemSpinner: "rgb(153,204,255)",
  success: "rgb(51,153,255)",
  error: "rgb(255,102,102)",
  warning: "rgb(252,211,77)",
  diffAdded: "rgb(0,68,102)",
  diffRemoved: "rgb(102,0,0)",
  diffAddedWord: "rgb(0,119,179)",
  diffRemovedWord: "rgb(179,0,0)",
};

const lightDaltonized: ITheme = {
  ...light,
  systemSpinner: "rgb(51,102,255)",
  success: "rgb(0,102,153)",
  error: "rgb(204,0,0)",
  warning: "rgb(180,83,9)",
  diffAdded: "rgb(153,204,255)",
  diffRemoved: "rgb(255,204,204)",
  diffAddedWord: "rgb(51,102,204)",
  diffRemovedWord: "rgb(153,51,51)",
  userMessageBg: "rgb(220,220,220)",
};

const darkAnsi: ITheme = {
  accent: "ansi:blueBright",
  permission: "ansi:blueBright",
  professionalBlue: "ansi:blueBright",
  systemSpinner: "ansi:blueBright",
  suggestion: "ansi:blueBright",
  text: "ansi:whiteBright",
  inverseText: "ansi:black",
  inactive: "ansi:white",
  subtle: "ansi:white",
  success: "ansi:greenBright",
  error: "ansi:redBright",
  warning: "ansi:yellowBright",
  diffAdded: "ansi:green",
  diffRemoved: "ansi:red",
  diffAddedWord: "ansi:greenBright",
  diffRemovedWord: "ansi:redBright",
  userMessageBg: "ansi:blackBright",
  border: "ansi:white",
};

const lightAnsi: ITheme = {
  accent: "ansi:blueBright",
  permission: "ansi:blueBright",
  professionalBlue: "ansi:blueBright",
  systemSpinner: "ansi:blue",
  suggestion: "ansi:blueBright",
  text: "ansi:black",
  inverseText: "ansi:white",
  inactive: "ansi:blackBright",
  subtle: "ansi:blackBright",
  success: "ansi:green",
  error: "ansi:red",
  warning: "ansi:yellow",
  diffAdded: "ansi:green",
  diffRemoved: "ansi:red",
  diffAddedWord: "ansi:greenBright",
  diffRemovedWord: "ansi:redBright",
  userMessageBg: "ansi:white",
  border: "ansi:blackBright",
};

export const THEMES: Readonly<Record<TThemeId, ITheme>> = {
  dark,
  light,
  "dark-daltonized": darkDaltonized,
  "light-daltonized": lightDaltonized,
  "dark-ansi": darkAnsi,
  "light-ansi": lightAnsi,
};

export const THEME_LABELS: Readonly<Record<TThemeId, string>> = {
  dark: "Dark",
  light: "Light",
  "dark-daltonized": "Dark (colorblind-friendly)",
  "light-daltonized": "Light (colorblind-friendly)",
  "dark-ansi": "Dark (ANSI only)",
  "light-ansi": "Light (ANSI only)",
};

export const isThemeId = (value: string): value is TThemeId => {
  return (THEME_NAMES as readonly string[]).includes(value);
};

export const getTheme = (id: TThemeId): ITheme => THEMES[id] ?? dark;

export type TThemeKey = keyof ITheme;
