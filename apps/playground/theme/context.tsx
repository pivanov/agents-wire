import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { type ITheme, THEMES, type TThemeId } from "./palette";

interface IThemeContext {
  readonly theme: ITheme;
  readonly committedId: TThemeId;
  readonly setTheme: (id: TThemeId) => void;
}

interface IPreviewContext {
  readonly setPreview: (id: TThemeId) => void;
  readonly savePreview: () => TThemeId;
  readonly cancelPreview: () => void;
}

const ThemeContext = createContext<IThemeContext>({
  theme: THEMES.dark,
  committedId: "dark",
  setTheme: () => {},
});

const PreviewContext = createContext<IPreviewContext>({
  setPreview: () => {},
  savePreview: () => "dark",
  cancelPreview: () => {},
});

interface IProviderProps {
  readonly initial: TThemeId;
  readonly onCommit?: (id: TThemeId) => void;
  readonly children: ReactNode;
}

export const ThemeProvider = (props: IProviderProps) => {
  const { initial, onCommit, children } = props;

  const [committedId, setCommittedId] = useState<TThemeId>(initial);
  const [previewId, setPreviewId] = useState<TThemeId | null>(null);

  const activeId = previewId ?? committedId;
  const activeTheme = THEMES[activeId];

  const setTheme = useCallback(
    (id: TThemeId): void => {
      setCommittedId(id);
      setPreviewId(null);
      onCommit?.(id);
    },
    [onCommit],
  );

  const setPreview = useCallback((id: TThemeId): void => {
    setPreviewId(id);
  }, []);

  const savePreview = useCallback((): TThemeId => {
    const next = previewId ?? committedId;
    setCommittedId(next);
    setPreviewId(null);
    onCommit?.(next);
    return next;
  }, [committedId, previewId, onCommit]);

  const cancelPreview = useCallback((): void => {
    setPreviewId(null);
  }, []);

  const themeValue = useMemo<IThemeContext>(
    () => ({ theme: activeTheme, committedId, setTheme }),
    [activeTheme, committedId, setTheme],
  );

  const previewValue = useMemo<IPreviewContext>(
    () => ({ setPreview, savePreview, cancelPreview }),
    [setPreview, savePreview, cancelPreview],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <PreviewContext.Provider value={previewValue}>{children}</PreviewContext.Provider>
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ITheme => useContext(ThemeContext).theme;
export const useThemeControl = (): IThemeContext => useContext(ThemeContext);
export const useThemePreview = (): IPreviewContext => useContext(PreviewContext);
