import { Box } from "ink";
import { useEffect, useState } from "react";
import { BLACK_CIRCLE } from "./figures";
import { ThemedText } from "@app/theme/themed-text";

const BLINK_INTERVAL_MS = 500;

interface IProps {
  readonly inProgress: boolean;
  readonly isError?: boolean;
}

// Module-level shared blink clock - every visible InProgressDot
// subscribes to one source so all dots flip in sync and a single
// timer drives the UI even with many in-flight tools. Auto-stops
// when no dots are mounted.
let blinkOn = true;
let blinkTimer: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();

const startTimerIfNeeded = (): void => {
  if (blinkTimer !== null) {
    return;
  }
  blinkTimer = setInterval(() => {
    blinkOn = !blinkOn;
    for (const cb of subscribers) {
      cb();
    }
  }, BLINK_INTERVAL_MS);
};

const stopTimerIfIdle = (): void => {
  if (subscribers.size > 0 || blinkTimer === null) {
    return;
  }
  clearInterval(blinkTimer);
  blinkTimer = null;
  blinkOn = true;
};

const subscribe = (cb: () => void): (() => void) => {
  subscribers.add(cb);
  startTimerIfNeeded();
  return () => {
    subscribers.delete(cb);
    stopTimerIfIdle();
  };
};

const useBlink = (): boolean => {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), []);
  return blinkOn;
};

const DoneDot = ({ isError }: { isError: boolean }) => (
  <Box minWidth={2}>
    <ThemedText color={isError ? "error" : "success"}>{BLACK_CIRCLE}</ThemedText>
  </Box>
);

const InProgressDot = () => {
  const on = useBlink();
  return (
    <Box minWidth={2}>
      <ThemedText dimColor>{on ? BLACK_CIRCLE : " "}</ThemedText>
    </Box>
  );
};

export const ToolUseLoader = ({ inProgress, isError = false }: IProps) => {
  if (!inProgress || isError) {
    return <DoneDot isError={isError} />;
  }
  return <InProgressDot />;
};
