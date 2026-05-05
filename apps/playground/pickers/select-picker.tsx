import { Box } from "ink";
import { useState } from "react";
import { POINTER } from "@app/components/figures";
import { useStableInput } from "@app/components/use-stable-input";
import { ThemedText as Text } from "@app/theme/themed-text";

export interface ISelectOption<T extends string = string> {
  readonly id: T;
  readonly label: string;
  readonly description?: string;
}

interface IProps<T extends string = string> {
  readonly title: string;
  readonly subtitle?: string;
  readonly options: readonly ISelectOption<T>[];
  readonly current?: T;
  readonly onResolve: (picked: T | undefined) => void;
}

export const SelectPicker = <T extends string = string>(props: IProps<T>) => {
  const { title, subtitle, options, current, onResolve } = props;
  const initial = Math.max(0, current ? options.findIndex((o) => o.id === current) : 0);
  const [cursor, setCursor] = useState(initial);

  useStableInput((_input, key) => {
    if (key.upArrow) {
      setCursor((i) => (i <= 0 ? options.length - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((i) => (i >= options.length - 1 ? 0 : i + 1));
      return;
    }
    if (key.return) {
      const picked = options[cursor];
      if (picked) {
        onResolve(picked.id);
      }
      return;
    }
    if (key.escape) {
      onResolve(undefined);
    }
  });

  const labelWidth = options.reduce((max, o) => Math.max(max, o.label.length), 0);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color="accent" bold>
          {title}
        </Text>
        <Text dimColor>(↑↓ navigate · enter select · esc cancel)</Text>
      </Box>
      {subtitle ? (
        <Box marginTop={1}>
          <Text dimColor>{subtitle}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const selected = i === cursor;
          const isCurrent = opt.id === current;
          return (
            <Box key={opt.id} gap={1}>
              <Box width={2} flexShrink={0}>
                <Text color={selected ? "accent" : "subtle"}>{selected ? POINTER : " "}</Text>
              </Box>
              <Box width={labelWidth + 2} flexShrink={0}>
                <Text color={selected ? "text" : "inactive"} bold={selected}>
                  {opt.label}
                </Text>
              </Box>
              {opt.description ? (
                <Box flexGrow={1} flexShrink={1}>
                  <Text dimColor wrap="truncate-end">
                    {opt.description}
                  </Text>
                </Box>
              ) : null}
              {isCurrent ? (
                <Box flexShrink={0}>
                  <Text dimColor>· current</Text>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
