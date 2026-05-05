import { agents } from "@/api/agents";

const log = (label: string, value: unknown): void => {
  console.log(`[${label}]`, value);
};

const checkAsk = async (): Promise<void> => {
  console.log("\n=== ask ===");
  const startedAt = Date.now();
  const result = await agents.ask("claude", "Reply with exactly the four characters: pong", {
    permission: "auto-allow",
    maxCostUsd: 0.5,
  });
  log("ask.elapsedMs", Date.now() - startedAt);
  log("ask.stopReason", result.stopReason);
  log("ask.text", result.text);
  log("ask.cost.totalUsd", result.cost?.totalUsd);
};

const checkStream = async (): Promise<void> => {
  console.log("\n=== stream ===");
  const startedAt = Date.now();
  const stream = agents.stream("claude", "Count from 1 to 5, separated by spaces. No prose.", {
    permission: "auto-allow",
    maxCostUsd: 0.5,
  });
  const seenTypes = new Set<string>();
  let charCount = 0;
  for await (const event of stream) {
    seenTypes.add(event.type);
    if (event.type === "text-delta") {
      charCount += event.text.length;
    }
  }
  const result = await stream.result();
  log("stream.elapsedMs", Date.now() - startedAt);
  log("stream.eventTypes", [...seenTypes].sort());
  log("stream.streamedChars", charCount);
  log("stream.text", result.text);
  log("stream.cost.totalUsd", result.cost?.totalUsd);
};

const checkSession = async (): Promise<void> => {
  console.log("\n=== session (two turns, shared subprocess) ===");
  const startedAt = Date.now();
  await using session = await agents.session("claude", {
    permission: "auto-allow",
    maxCostUsd: 1.0,
  });
  const turn1 = await session.ask("Remember the secret word 'porcupine'. Reply only with: ok.");
  log("session.turn1.text", turn1.text);
  const turn2 = await session.ask("What was the secret word? Reply with just the word.");
  log("session.turn2.text", turn2.text);
  log("session.elapsedMs", Date.now() - startedAt);
  log("session.cost.totalUsd", session.cost.snapshot.totalUsd);
  log("session.cost.turns", session.cost.snapshot.turns);
};

const main = async (): Promise<void> => {
  await checkAsk();
  await checkStream();
  await checkSession();
  console.log("\n[smoke] all checks passed");
};

main().catch((cause: unknown) => {
  console.error("[smoke] failed:", cause);
  process.exit(1);
});
