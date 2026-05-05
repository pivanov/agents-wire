import { useEffect, useState } from "react";
import { ThemedText } from "@app/theme/themed-text";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 80;

interface IProps {
  readonly color?: string;
}

export const Spinner = ({ color = "systemSpinner" }: IProps = {}) => {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(t);
  }, []);
  return <ThemedText color={color}>{FRAMES[i]}</ThemedText>;
};
