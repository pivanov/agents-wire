import { useStdout } from "ink";
import { useLayoutEffect, useState } from "react";

// One stdout has one resize event. Each `useColumns()` / `useRows()`
// caller used to register its own listener on that stream, so any
// component tree with N subscribers paid N listener slots — Node warns
// past 10 ("MaxListenersExceededWarning"), which fired the moment
// Ctrl+O expanded enough tool rows to mount their CodeBlocks at once.
//
// The sharing pattern below registers ONE listener on stdout per
// dimension (cols, rows) regardless of subscriber count. React
// callers subscribe to an in-memory Set instead.

interface IDimensionStore {
  current: number;
  hookedStdout: NodeJS.WriteStream | undefined;
  hookedListener: (() => void) | undefined;
  subscribers: Set<(value: number) => void>;
}

const colsStore: IDimensionStore = {
  current: 80,
  hookedStdout: undefined,
  hookedListener: undefined,
  subscribers: new Set(),
};

const rowsStore: IDimensionStore = {
  current: 24,
  hookedStdout: undefined,
  hookedListener: undefined,
  subscribers: new Set(),
};

const ensureHooked = (
  store: IDimensionStore,
  stdout: NodeJS.WriteStream | undefined,
  read: (s: NodeJS.WriteStream) => number,
): void => {
  if (!stdout) {
    return;
  }
  if (store.hookedStdout === stdout) {
    store.current = read(stdout);
    return;
  }
  if (store.hookedStdout && store.hookedListener) {
    // Stdout reference changed (rare — e.g. test harness swap). Drop
    // the old listener so we don't leak across stdout swaps.
    store.hookedStdout.off("resize", store.hookedListener);
  }
  store.hookedStdout = stdout;
  store.current = read(stdout);
  const broadcast = (): void => {
    const next = read(stdout);
    if (next === store.current) {
      return;
    }
    store.current = next;
    for (const fn of store.subscribers) {
      fn(next);
    }
  };
  store.hookedListener = broadcast;
  stdout.on("resize", broadcast);
};

const useDimension = (
  store: IDimensionStore,
  read: (s: NodeJS.WriteStream) => number,
  fallback: number,
): number => {
  const { stdout } = useStdout();
  const [value, setValue] = useState<number>(stdout ? read(stdout) : fallback);
  useLayoutEffect(() => {
    if (!stdout) {
      setValue(fallback);
      return;
    }
    ensureHooked(store, stdout, read);
    store.subscribers.add(setValue);
    // Late-mount sync: subscribers added after a resize event missed
    // the broadcast, so resync from the cached current value.
    setValue((prev) => (prev === store.current ? prev : store.current));
    return (): void => {
      store.subscribers.delete(setValue);
    };
  }, [fallback, read, store, stdout]);
  return value;
};

const readColumns = (s: NodeJS.WriteStream): number => s.columns ?? 80;
const readRows = (s: NodeJS.WriteStream): number => s.rows ?? 24;

export const useColumns = (): number =>
  useDimension(colsStore, readColumns, 80);

export const useRows = (): number =>
  useDimension(rowsStore, readRows, 24);
