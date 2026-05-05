import { Box, useStdout } from "ink";
import { memo } from "react";
import { ThemedText as Text } from "@app/theme/themed-text";
import type { ICommandSpec } from "@app/commands/registry";

const OVERLAY_MAX_ITEMS = 6;
const NAME_PAD_BUMP = 5;
const NAME_DESC_GAP = 4;

interface IProps {
  readonly matches: readonly ICommandSpec[];
  readonly selectedIndex: number;
  readonly visible: boolean;
}

const SlashOverlayImpl = ({ matches, selectedIndex, visible }: IProps) => {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  if (!visible) {
    return null;
  }

  const total = matches.length;

  if (total === 0) {
    return (
      <Box flexDirection="column" paddingLeft={4}>
        <Text dimColor>no matches</Text>
      </Box>
    );
  }

  let start = 0;
  if (total > OVERLAY_MAX_ITEMS) {
    const half = Math.floor(OVERLAY_MAX_ITEMS / 2);
    start = Math.max(0, Math.min(selectedIndex - half, total - OVERLAY_MAX_ITEMS));
  }
  const visibleMatches = matches.slice(start, start + OVERLAY_MAX_ITEMS);

  // Pad against the longest visible name so the description column aligns.
  const longestDisplay = matches.reduce((max, m) => Math.max(max, `/${m.name}`.length), 0);
  const nameWidth = Math.min(longestDisplay + NAME_PAD_BUMP, Math.floor(columns * 0.4));

  return (
    <Box flexDirection="column" paddingLeft={4}>
      {start > 0 ? (
        <Text dimColor>↑ {start} more</Text>
      ) : null}
      {visibleMatches.map((match, i) => {
        const absIndex = start + i;
        const isSelected = absIndex === selectedIndex;
        const display = `/${match.name}`;
        const padded = display + " ".repeat(Math.max(0, nameWidth - display.length));
        const cleanDesc = match.description.replace(/\s+/g, " ");
        return (
          <Box key={match.name} flexDirection="row">
            <Box flexShrink={0}>
              <Text color={isSelected ? "suggestion" : undefined} dimColor={!isSelected}>
                {padded}
                {" ".repeat(NAME_DESC_GAP)}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={isSelected ? "suggestion" : undefined} dimColor={!isSelected} wrap="truncate-end">
                {cleanDesc}
              </Text>
            </Box>
          </Box>
        );
      })}
      {start + OVERLAY_MAX_ITEMS < total ? (
        <Text dimColor>↓ {total - start - OVERLAY_MAX_ITEMS} more</Text>
      ) : null}
    </Box>
  );
};

export const SlashOverlay = memo(SlashOverlayImpl);
SlashOverlay.displayName = "SlashOverlay";
