import { Box } from "ink";
import { Spinner } from "./spinner";
import { ThemedText } from "@app/theme/themed-text";

interface IProps {
  readonly message: string;
  readonly bold?: boolean;
  readonly dimColor?: boolean;
  readonly subtitle?: string;
}

export const LoadingState = ({ message, bold, dimColor, subtitle }: IProps) => {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Spinner />
        <ThemedText bold={bold} dimColor={dimColor}>
          {" "}
          {message}
        </ThemedText>
      </Box>
      {subtitle ? <ThemedText dimColor>{subtitle}</ThemedText> : null}
    </Box>
  );
};
