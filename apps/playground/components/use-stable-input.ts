import { type Key, useInput } from "ink";
import { useLayoutEffect, useRef } from "react";

type TInputHandler = (input: string, key: Key) => void;

interface IOptions {
  readonly isActive?: boolean;
}

// Ink's useInput attaches the handler in a useEffect that doesn't always
// re-run on every render, so closures captured at attach time go stale.
// useStableInput keeps the handler reference stable while always invoking
// the latest closure (refreshed in a layout effect each render).
export const useStableInput = (handler: TInputHandler, options: IOptions = {}): void => {
  const ref = useRef<TInputHandler>(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  useInput(
    (input, key) => {
      ref.current(input, key);
    },
    options,
  );
};
