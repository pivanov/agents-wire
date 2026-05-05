import { Box, useStdout } from "ink";
import { memo } from "react";
import { ThemedText as Text } from "@app/theme/themed-text";

const OVERLAY_MAX_ITEMS = 5;
const PATH_PAD_BUMP = 2;

interface IProps {
  readonly matches: readonly string[];
  readonly selectedIndex: number;
  readonly visible: boolean;
}

const FileOverlayImpl = ({ matches, selectedIndex, visible }: IProps) => {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  if (!visible) {
    return null;
  }

  const total = matches.length;

  if (total === 0) {
    return (
      <Box flexDirection="column" paddingLeft={4}>
        <Text dimColor>no files</Text>
      </Box>
    );
  }

  let start = 0;
  if (total > OVERLAY_MAX_ITEMS) {
    const half = Math.floor(OVERLAY_MAX_ITEMS / 2);
    start = Math.max(0, Math.min(selectedIndex - half, total - OVERLAY_MAX_ITEMS));
  }
  const visibleMatches = matches.slice(start, start + OVERLAY_MAX_ITEMS);

  const longest = matches.reduce((max, s) => Math.max(max, s.length), 0);
  const width = Math.min(longest + PATH_PAD_BUMP, Math.max(10, columns - 4));

  return (
    <Box flexDirection="column" paddingLeft={4}>
      {visibleMatches.map((match, i) => {
        const isSelected = start + i === selectedIndex;
        const padded = match + " ".repeat(Math.max(0, width - match.length));
        return (
          <Box key={match} flexDirection="row">
            <Text color={isSelected ? "suggestion" : undefined} dimColor={!isSelected}>
              {padded}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

export const FileOverlay = memo(FileOverlayImpl);
FileOverlay.displayName = "FileOverlay";
