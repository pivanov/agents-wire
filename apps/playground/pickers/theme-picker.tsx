import { Box } from "ink";
import { useEffect, useState } from "react";
import { CHECK, FILLED_CIRCLE, POINTER, SQUARE_FILLED } from "@app/components/figures";
import { useStableInput } from "@app/components/use-stable-input";
import { useTheme, useThemeControl, useThemePreview } from "@app/theme/context";
import { THEME_IDS, THEMES, THEME_LABELS } from "@app/theme/palette";
import { ThemedText as Text } from "@app/theme/themed-text";

interface IProps {
  readonly onResolve: (saved: string | undefined) => void;
}

const Swatch = ({ color }: { color: string }) => (
  <Text color={color}>
    {SQUARE_FILLED}
    {SQUARE_FILLED}
  </Text>
);

const Preview = () => {
  const theme = useTheme();
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} marginTop={1}>
      <Text color="accent" bold>
        Preview
      </Text>
      <Box marginTop={1}>
        <Text dimColor>The whole UI re-themes as you arrow.</Text>
      </Box>
      <Box marginTop={1} gap={1}>
        <Text dimColor>$0.0143</Text>
        <Text color="warning">claude</Text>
        <Text dimColor>{`›`}</Text>
        <Text color="text">Refactor src/auth.ts to use the new session API</Text>
      </Box>
      <Box marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="success">{CHECK}</Text>
          <Text dimColor>tool</Text>
          <Text color="text">Read src/auth.ts</Text>
        </Box>
      </Box>
      <Box marginTop={1} gap={2}>
        <Text color="success">{FILLED_CIRCLE} success</Text>
        <Text color="warning">{FILLED_CIRCLE} warning</Text>
        <Text color="error">{FILLED_CIRCLE} error</Text>
        <Text color="accent">{FILLED_CIRCLE} accent</Text>
      </Box>
    </Box>
  );
};

export const ThemePicker = ({ onResolve }: IProps) => {
  const [cursor, setCursor] = useState(0);
  const { committedId } = useThemeControl();
  const { setPreview, savePreview, cancelPreview } = useThemePreview();

  useEffect(() => {
    return (): void => cancelPreview();
  }, [cancelPreview]);

  useEffect(() => {
    setCursor(Math.max(0, THEME_IDS.indexOf(committedId)));
  }, [committedId]);

  useEffect(() => {
    const id = THEME_IDS[cursor];
    if (id !== undefined) {
      setPreview(id);
    }
  }, [cursor, setPreview]);

  useStableInput((_input, key) => {
    if (key.upArrow) {
      setCursor((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((i) => Math.min(THEME_IDS.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const saved = savePreview();
      onResolve(saved);
      return;
    }
    if (key.escape) {
      cancelPreview();
      onResolve(undefined);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color="accent" bold>
          Theme
        </Text>
        <Text dimColor>(↑↓ preview · enter save · esc cancel)</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {THEME_IDS.map((id, i) => {
          const t = THEMES[id];
          const selected = i === cursor;
          const isCurrent = id === committedId;
          return (
            <Box key={id} gap={1}>
              <Box width={2} flexShrink={0}>
                <Text color={selected ? "accent" : "subtle"}>{selected ? POINTER : " "}</Text>
              </Box>
              <Box width={28} flexShrink={0}>
                <Text color={selected ? "text" : "inactive"} bold={selected}>
                  {THEME_LABELS[id]}
                </Text>
              </Box>
              <Box flexShrink={0} flexDirection="row">
                <Swatch color={t.accent} />
                <Swatch color={t.success} />
                <Swatch color={t.warning} />
                <Swatch color={t.error} />
                <Swatch color={t.subtle} />
              </Box>
              {isCurrent ? (
                <Box flexShrink={0}>
                  <Text dimColor>· current</Text>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Preview />
    </Box>
  );
};
