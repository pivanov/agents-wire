import { Box } from "ink";
import { useStableInput } from "@app/components/use-stable-input";
import { ThemedText } from "@app/theme/themed-text";
import { COMMANDS } from "@app/commands/registry";

interface IProps {
  readonly onClose: () => void;
}

export const HelpDialog = ({ onClose }: IProps) => {
  useStableInput((_input, key) => {
    if (key.escape || key.return) {
      onClose();
    }
  });

  const widest = COMMANDS.reduce((acc, cmd) => Math.max(acc, `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}`.length), 0);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <ThemedText color="accent" bold>
          Commands
        </ThemedText>
        <ThemedText color="muted">(esc to close)</ThemedText>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {COMMANDS.map((cmd) => {
          const sig = `/${cmd.name}${cmd.args ? ` ${cmd.args}` : ""}`;
          return (
            <Box key={cmd.name} flexDirection="row" gap={2}>
              <Box width={widest + 2} flexShrink={0}>
                <ThemedText color="dimFg">{sig}</ThemedText>
              </Box>
              <Box flexGrow={1}>
                <ThemedText color="muted" wrap="wrap">
                  {cmd.description}
                </ThemedText>
              </Box>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <ThemedText color="muted">type / to filter via popup · ↑↓ to navigate · tab to fill · enter to run</ThemedText>
      </Box>
    </Box>
  );
};
