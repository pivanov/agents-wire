import { WireError } from "@/errors";

interface IPendingResult<T> {
  resolve: (value: IteratorResult<T>) => void;
  reject: (reason: unknown) => void;
}

export interface IAsyncQueue<T> extends AsyncIterable<T> {
  push: (value: T) => void;
  end: () => void;
  fail: (reason: unknown) => void;
  readonly closed: boolean;
}

interface IAsyncQueueOptions {
  /** Hard cap on buffered items. Overflow fails the queue with a stream-error. */
  readonly maxBuffer?: number;
}

const DEFAULT_MAX_BUFFER = 10_000;

export const createAsyncQueue = <T>(options: IAsyncQueueOptions = {}): IAsyncQueue<T> => {
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const buffer: T[] = [];
  const consumers: IPendingResult<T>[] = [];
  let endSignal = false;
  let errorSignal: { reason: unknown } | undefined;

  const drainConsumers = (): void => {
    while (consumers.length > 0) {
      const consumer = consumers.shift();
      if (!consumer) {
        continue;
      }
      if (errorSignal) {
        consumer.reject(errorSignal.reason);
      } else if (buffer.length > 0) {
        consumer.resolve({ value: buffer.shift() as T, done: false });
      } else if (endSignal) {
        consumer.resolve({ value: undefined as never, done: true });
      } else {
        consumers.unshift(consumer);
        return;
      }
    }
  };

  const push = (value: T): void => {
    if (endSignal || errorSignal) {
      return;
    }
    if (buffer.length >= maxBuffer && consumers.length === 0) {
      const overflow = new WireError(
        "stream-error",
        `Async queue overflow: producer pushed > ${maxBuffer} items without a consumer. Increase maxBuffer or apply backpressure upstream.`,
      );
      errorSignal = { reason: overflow };
      drainConsumers();
      return;
    }
    buffer.push(value);
    drainConsumers();
  };

  const end = (): void => {
    endSignal = true;
    drainConsumers();
  };

  const fail = (reason: unknown): void => {
    if (errorSignal) {
      return;
    }
    errorSignal = { reason };
    drainConsumers();
  };

  const next = (): Promise<IteratorResult<T>> => {
    if (errorSignal) {
      return Promise.reject(errorSignal.reason);
    }
    if (buffer.length > 0) {
      return Promise.resolve({ value: buffer.shift() as T, done: false });
    }
    if (endSignal) {
      return Promise.resolve({ value: undefined as never, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      consumers.push({ resolve, reject });
    });
  };

  return {
    push,
    end,
    fail,
    get closed() {
      return endSignal || errorSignal !== undefined;
    },
    [Symbol.asyncIterator]() {
      return {
        next,
        return: async (): Promise<IteratorResult<T>> => {
          end();
          return { value: undefined as never, done: true };
        },
      };
    },
  };
};
