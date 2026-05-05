import type { DOMElement } from "ink";
import { Box, type BoxProps } from "ink";
import type { ReactNode, Ref } from "react";
import { useTheme } from "./context";
import type { ITheme, TThemeKey } from "./palette";

type TColorish = TThemeKey | string;

type TBaseBoxProps = Omit<
  BoxProps,
  "borderColor" | "borderTopColor" | "borderBottomColor" | "borderLeftColor" | "borderRightColor" | "backgroundColor"
>;

interface IThemedBoxProps extends TBaseBoxProps {
  readonly borderColor?: TColorish;
  readonly borderTopColor?: TColorish;
  readonly borderBottomColor?: TColorish;
  readonly borderLeftColor?: TColorish;
  readonly borderRightColor?: TColorish;
  readonly backgroundColor?: TColorish;
  readonly ref?: Ref<DOMElement>;
  readonly children?: ReactNode;
}

const isRawColor = (s: string): boolean =>
  s.startsWith("rgb(") || s.startsWith("#") || s.startsWith("ansi256(") || s.startsWith("ansi:");

const stripAnsiPrefix = (s: string): string => (s.startsWith("ansi:") ? s.slice(5) : s);

const resolve = (c: TColorish | undefined, theme: ITheme): string | undefined => {
  if (!c) {
    return undefined;
  }
  if (isRawColor(c)) {
    return stripAnsiPrefix(c);
  }
  const themed = (theme as unknown as Record<string, string | undefined>)[c];
  if (themed === undefined) {
    return c;
  }
  return stripAnsiPrefix(themed);
};

export const ThemedBox = (props: IThemedBoxProps) => {
  const { borderColor, borderTopColor, borderBottomColor, borderLeftColor, borderRightColor, backgroundColor, children, ...rest } = props;
  const theme = useTheme();
  return (
    <Box
      backgroundColor={resolve(backgroundColor, theme)}
      borderBottomColor={resolve(borderBottomColor, theme)}
      borderColor={resolve(borderColor, theme)}
      borderLeftColor={resolve(borderLeftColor, theme)}
      borderRightColor={resolve(borderRightColor, theme)}
      borderTopColor={resolve(borderTopColor, theme)}
      {...rest}
    >
      {children}
    </Box>
  );
};
