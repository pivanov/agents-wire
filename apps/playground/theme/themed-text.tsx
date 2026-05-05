import { Text } from "ink";
import type { ReactNode } from "react";
import { useTheme } from "./context";
import type { ITheme, TThemeKey } from "./palette";

type TColorish = TThemeKey | string;

interface IThemedTextProps {
  readonly color?: TColorish;
  readonly backgroundColor?: TColorish;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly inverse?: boolean;
  readonly wrap?: "wrap" | "truncate" | "truncate-end" | "truncate-middle" | "truncate-start";
  readonly dimColor?: boolean;
  readonly children?: ReactNode;
}

const isRawColor = (s: string): boolean => {
  if (s.startsWith("rgb(") || s.startsWith("#") || s.startsWith("ansi256(")) {
    return true;
  }
  if (s.startsWith("ansi:")) {
    return true;
  }
  return false;
};

const stripAnsiPrefix = (s: string): string => (s.startsWith("ansi:") ? s.slice(5) : s);

const resolve = (value: TColorish | undefined, theme: ITheme): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (isRawColor(value)) {
    return stripAnsiPrefix(value);
  }
  const fromTheme = (theme as unknown as Record<string, string | undefined>)[value];
  if (fromTheme === undefined) {
    return value;
  }
  return stripAnsiPrefix(fromTheme);
};

export const ThemedText = (props: IThemedTextProps): ReactNode => {
  const { color, backgroundColor, bold, italic, underline, strikethrough, inverse, wrap, dimColor, children } = props;
  const theme = useTheme();
  const effectiveColor = color !== undefined ? resolve(color, theme) : dimColor ? stripAnsiPrefix(theme.inactive) : undefined;
  const effectiveBg = backgroundColor !== undefined ? resolve(backgroundColor, theme) : undefined;
  return (
    <Text
      backgroundColor={effectiveBg}
      bold={bold}
      color={effectiveColor}
      inverse={inverse}
      italic={italic}
      strikethrough={strikethrough}
      underline={underline}
      wrap={wrap}
    >
      {children}
    </Text>
  );
};
