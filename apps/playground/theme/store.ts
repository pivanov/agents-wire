import { loadConfig, saveConfig } from "@app/config/store";
import { isThemeId, type TThemeId } from "./palette";

export const loadStoredTheme = (): TThemeId | undefined => {
  const cfg = loadConfig();
  if (cfg.theme && isThemeId(cfg.theme)) {
    return cfg.theme;
  }
  return undefined;
};

export const saveStoredTheme = (theme: TThemeId): void => {
  saveConfig({ theme });
};
