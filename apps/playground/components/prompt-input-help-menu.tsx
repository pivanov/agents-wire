import { Box } from "ink";
import { memo } from "react";
import { ThemedText as Text } from "@app/theme/themed-text";

const COL_TRIGGERS: readonly string[] = [
  "/ for commands",
  "@ for file paths",
  "Cmd+V to paste image",
  "↑↓ for history",
];

const COL_KEYS: readonly string[] = [
  "Tab to autocomplete",
  "Enter to send · Shift+Enter for newline",
  "Esc to cancel · double-tap to clear",
  "Ctrl+C to interrupt · twice to exit",
];

const HelpColumn = ({ entries, width }: { entries: readonly string[]; width: number }) => (
  <Box flexDirection="column" width={width}>
    {entries.map((e) => (
      <Text dimColor key={e}>
        {e}
      </Text>
    ))}
  </Box>
);

const PromptInputHelpMenuImpl = () => (
  <Box flexDirection="row" gap={2} marginTop={1} paddingLeft={4}>
    <HelpColumn entries={COL_TRIGGERS} width={20} />
    <HelpColumn entries={COL_KEYS} width={42} />
  </Box>
);

export const PromptInputHelpMenu = memo(PromptInputHelpMenuImpl);
PromptInputHelpMenu.displayName = "PromptInputHelpMenu";
