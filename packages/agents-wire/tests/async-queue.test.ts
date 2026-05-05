import { describe, expect, test } from "bun:test";
import { createAsyncQueue } from "@/internal/async-queue";

describe("createAsyncQueue", () => {
  test("yields buffered values and ends", async () => {
    const queue = createAsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.end();
    const collected: number[] = [];
    for await (const value of queue) {
      collected.push(value);
    }
    expect(collected).toEqual([1, 2]);
    expect(queue.closed).toBe(true);
  });

  test("delivers async values to a waiting consumer", async () => {
    const queue = createAsyncQueue<string>();
    const consumed: string[] = [];
    const consumer = (async () => {
      for await (const value of queue) {
        consumed.push(value);
      }
    })();
    queue.push("a");
    queue.push("b");
    queue.end();
    await consumer;
    expect(consumed).toEqual(["a", "b"]);
  });

  test("propagates failure to the consumer", async () => {
    const queue = createAsyncQueue<number>();
    const failure = new Error("boom");
    queue.fail(failure);
    let caught: unknown;
    try {
      for await (const _value of queue) {
        /* drain */
      }
    } catch (cause) {
      caught = cause;
    }
    expect(caught).toBe(failure);
  });

  test("ignores push after end", async () => {
    const queue = createAsyncQueue<number>();
    queue.push(1);
    queue.end();
    queue.push(2);
    const collected: number[] = [];
    for await (const value of queue) {
      collected.push(value);
    }
    expect(collected).toEqual([1]);
  });
});
