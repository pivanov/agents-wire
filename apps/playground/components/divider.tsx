import { useStdout } from "ink";
import { ThemedText as Text } from "@app/theme/themed-text";

interface IProps {
  readonly width?: number;
  readonly color?: string;
  readonly char?: string;
  readonly padding?: number;
  readonly title?: string;
}

const DEFAULT_CHAR = "─";

export const Divider = (props: IProps) => {
  const { width, color, char = DEFAULT_CHAR, padding = 0, title } = props;
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const effective = Math.max(0, (width ?? cols) - padding);

  if (title) {
    const titleSlot = title.length + 2;
    const sides = Math.max(0, effective - titleSlot);
    const leftLen = Math.floor(sides / 2);
    const rightLen = sides - leftLen;
    return (
      <Text color={color} dimColor={!color}>
        {char.repeat(leftLen)} <Text dimColor>{title}</Text> {char.repeat(rightLen)}
      </Text>
    );
  }

  return (
    <Text color={color} dimColor={!color}>
      {char.repeat(effective)}
    </Text>
  );
};
