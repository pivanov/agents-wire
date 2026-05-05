// Multi-agent selector for orchestration commands (/race, /failover,
// /cascade). Renders the same dot-styled rows as `/agent`, but rows
// are toggleable with space, and the header shows a live preview of
// the API call shape. Resolves with the picked agent ids in selection
// order; caller composes the slash command and seeds the prompt
// input via app.setInputDraft.

import { Box } from "ink";
import { useMemo, useState } from "react";
import { BLACK_CIRCLE, POINTER } from "@app/components/figures";
import { effortLabel, effortSymbol } from "@app/components/effort";
import { useStableInput } from "@app/components/use-stable-input";
import { useDetections } from "@app/components/use-detections";
import { findModel, prettyModel } from "@app/config/models";
import { getStoredEffort, getStoredModel } from "@app/config/store";
import { ThemedText } from "@app/theme/themed-text";
import { BUILT_IN_AGENT_IDS, type TAgentId } from "@pivanov/agents-wire";

interface IProps {
  readonly kind: "race" | "failover" | "cascade";
  readonly onResolve: (picked: readonly TAgentId[] | undefined) => void;
}

export const MultiAgentPicker = ({ kind, onResolve }: IProps) => {
  const { entries: detections } = useDetections();

  const orderedIds = useMemo<readonly TAgentId[]>(() => {
    if (!detections) {
      return BUILT_IN_AGENT_IDS;
    }
    const available: TAgentId[] = [];
    const unavailable: TAgentId[] = [];
    for (const id of BUILT_IN_AGENT_IDS) {
      const found = detections.find((entry) => entry.id === id);
      if (found?.available) {
        available.push(id);
      } else {
        unavailable.push(id);
      }
    }
    return [...available, ...unavailable];
  }, [detections]);

  const [cursor, setCursor] = useState<number>(0);
  // Selection order matters for /failover (try-in-order) and
  // /cascade (escalation chain), so use an array, not a Set.
  const [selected, setSelected] = useState<TAgentId[]>([]);

  const isDisabled = (id: TAgentId): boolean => {
    if (!detections) {
      return false;
    }
    const found = detections.find((entry) => entry.id === id);
    return found ? !found.available : true;
  };

  const moveCursor = (delta: number): void => {
    setCursor((prev) => {
      const len = orderedIds.length;
      let next = prev;
      for (let step = 0; step < len; step += 1) {
        next = (next + delta + len) % len;
        const id = orderedIds[next];
        if (id && !isDisabled(id)) {
          return next;
        }
      }
      return prev;
    });
  };

  const toggle = (id: TAgentId): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  useStableInput((input, key) => {
    if (key.upArrow) {
      moveCursor(-1);
      return;
    }
    if (key.downArrow) {
      moveCursor(1);
      return;
    }
    if (input === " ") {
      const id = orderedIds[cursor];
      if (id && !isDisabled(id)) {
        toggle(id);
      }
      return;
    }
    if (key.return) {
      if (selected.length === 0) {
        // Auto-select the focused row on first Enter so users can
        // single-pick without ever pressing space.
        const id = orderedIds[cursor];
        if (id && !isDisabled(id)) {
          onResolve([id]);
          return;
        }
      }
      onResolve(selected);
      return;
    }
    if (key.escape) {
      onResolve(undefined);
    }
  });

  // API-shape preview line: shows what the resulting call will look
  // like once the user submits the prompt. The placeholder `<prompt>`
  // is replaced verbatim by whatever they type next in the REPL.
  const idsLiteral = selected.length === 0 ? "[…]" : `[${selected.map((s) => `"${s}"`).join(", ")}]`;
  const preview = `agents.${kind}("<prompt>", ${idsLiteral}, { permission, maxCostUsd })`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <ThemedText color="accent" bold>
          {kind}
        </ThemedText>
        <ThemedText dimColor>· space toggle · enter continue · esc cancel</ThemedText>
      </Box>
      <Box marginTop={1}>
        <ThemedText color="subtle" wrap="truncate-end">
          {preview}
        </ThemedText>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {orderedIds.map((id, index) => {
          const isSelected = selected.includes(id);
          const focused = index === cursor;
          const detection = detections?.find((entry) => entry.id === id);
          const disabled = isDisabled(id);

          let dotColor: "success" | "error" | "subtle";
          let dotGlyph: string;
          if (disabled) {
            dotColor = "error";
            dotGlyph = "◌";
          } else if (isSelected) {
            const storedEffort = getStoredEffort(id);
            dotColor = "success";
            dotGlyph = storedEffort ? effortSymbol(storedEffort) : BLACK_CIRCLE;
          } else {
            dotColor = "subtle";
            dotGlyph = BLACK_CIRCLE;
          }

          let rowDesc: string;
          if (disabled && detection?.reason) {
            rowDesc = detection.reason;
          } else if (detection?.available) {
            const storedModel = findModel(id, getStoredModel(id));
            const storedEffort = getStoredEffort(id);
            const pretty = storedModel ? prettyModel(storedModel) : { label: "Auto", description: "" };
            const effortSuffix = storedEffort ? ` (${effortLabel(storedEffort)} effort)` : "";
            const tail = pretty.description.length > 0 ? pretty.description : detection?.label ?? "";
            rowDesc = tail.length > 0 ? `${pretty.label}${effortSuffix} · ${tail}` : `${pretty.label}${effortSuffix}`;
          } else {
            rowDesc = detection?.label ?? "probing…";
          }

          // Selection ordinal so users see the order their picks will
          // be tried (matters for /failover and /cascade).
          const ordinal = isSelected ? selected.indexOf(id) + 1 : 0;

          return (
            <Box key={id} gap={1}>
              <Box width={2} flexShrink={0}>
                <ThemedText color={focused && !disabled ? "accent" : "subtle"}>
                  {focused && !disabled ? POINTER : " "}
                </ThemedText>
              </Box>
              <Box width={2} flexShrink={0}>
                <ThemedText bold color={dotColor}>{dotGlyph}</ThemedText>
              </Box>
              <Box width={3} flexShrink={0}>
                {ordinal > 0 ? <ThemedText color="accent">{ordinal}.</ThemedText> : <ThemedText> </ThemedText>}
              </Box>
              <Box width={11} flexShrink={0}>
                <ThemedText color={disabled ? "inactive" : focused ? "text" : "inactive"} bold={focused && !disabled}>
                  {id}
                </ThemedText>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <ThemedText dimColor wrap="truncate-end">
                  {rowDesc}
                </ThemedText>
              </Box>
            </Box>
          );
        })}
      </Box>
      {detections === undefined ? (
        <Box marginTop={1}>
          <ThemedText dimColor>detecting installed agents…</ThemedText>
        </Box>
      ) : null}
    </Box>
  );
};
