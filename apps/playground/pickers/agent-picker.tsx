import { Box } from "ink";
import { useEffect, useMemo, useState } from "react";
import { BLACK_CIRCLE, POINTER } from "@app/components/figures";
import { effortLabel, effortSymbol } from "@app/components/effort";
import { useStableInput } from "@app/components/use-stable-input";
import { useDetections } from "@app/components/use-detections";
import { findModel, prettyModel, refreshAgentConfig } from "@app/config/models";
import { getStoredEffort, getStoredModel } from "@app/config/store";
import { ThemedText } from "@app/theme/themed-text";
import { BUILT_IN_AGENT_IDS, type TAgentId } from "@pivanov/agents-wire";

interface IProps {
  readonly current: TAgentId;
  readonly onResolve: (picked: TAgentId | undefined) => void;
}

export const AgentPicker = ({ current, onResolve }: IProps) => {
  const { entries: detections, refresh } = useDetections();

  // Sort: available agents first, then unavailable. Preserve the
  // original BUILT_IN_AGENT_IDS order within each group so the same
  // agent always lands at a predictable position relative to its peers.
  // Pre-detection: keep the original order so the picker doesn't
  // reshuffle once detections arrive.
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

  const findIndex = (id: TAgentId): number => Math.max(0, orderedIds.indexOf(id));
  const [cursor, setCursor] = useState<number>(() => findIndex(current));

  // When detections land (or refresh), the order can change - re-anchor
  // the cursor on whichever agent it was pointing at, so the highlight
  // stays on the same agent rather than the same row index.
  const anchoredIdRef = orderedIds[cursor];
  useEffect(() => {
    if (anchoredIdRef !== undefined) {
      const next = orderedIds.indexOf(anchoredIdRef);
      if (next !== -1 && next !== cursor) {
        setCursor(next);
      }
    }
  }, [orderedIds, anchoredIdRef, cursor]);

  const isDisabled = (index: number): boolean => {
    if (!detections) {
      return false;
    }
    const id = orderedIds[index];
    if (!id) {
      return true;
    }
    const found = detections.find((entry) => entry.id === id);
    return found ? !found.available : true;
  };

  const allDisabled = detections !== undefined && orderedIds.every((_, i) => isDisabled(i));

  const move = (delta: number): void => {
    if (allDisabled) {
      return;
    }
    setCursor((prev) => {
      let next = prev;
      for (let step = 0; step < orderedIds.length; step += 1) {
        next = (next + delta + orderedIds.length) % orderedIds.length;
        if (!isDisabled(next)) {
          return next;
        }
      }
      return prev;
    });
  };

  useStableInput((input, key) => {
    if (key.upArrow) {
      move(-1);
      return;
    }
    if (key.downArrow) {
      move(1);
      return;
    }
    if (key.return) {
      if (isDisabled(cursor)) {
        return;
      }
      const picked = orderedIds[cursor];
      onResolve(picked);
      return;
    }
    if (key.escape) {
      onResolve(undefined);
      return;
    }
    if (input === "r") {
      refresh();
      // Drop the cached agent-config (configOptions probe + live
      // models + static fallback) for every built-in so the next
      // /model open re-probes. Cheap - no spawn until the picker
      // actually opens for that agent.
      for (const id of BUILT_IN_AGENT_IDS) {
        refreshAgentConfig(id);
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <ThemedText color="accent" bold>
          Agents
        </ThemedText>
        <ThemedText dimColor>(↑↓ navigate · enter select · r refresh · esc cancel)</ThemedText>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {orderedIds.map((id, index) => {
          const selected = index === cursor;
          const disabled = isDisabled(index);
          const detection = detections?.find((entry) => entry.id === id);
          // Dot column:
          //   - current agent: success green ⏺. Effort shows in the
          //     description text (e.g. "(High effort)"), not the dot,
          //     so the picker's job stays "pick an agent" without
          //     overloading the dot with another axis.
          //   - other available agents: subtle gray ⏺.
          //   - unavailable agents: error red ◌ (faintest glyph +
          //     danger color = "missing/dim" semantically).
          //   - pre-detection: subtle gray ⏺.
          const isCurrentAgent = id === current;
          const storedEffort = getStoredEffort(id);
          let dotColor: "success" | "error" | "subtle";
          let dotGlyph: string;
          if (isCurrentAgent) {
            dotColor = "success";
            dotGlyph = BLACK_CIRCLE;
          } else if (!detections) {
            dotColor = "subtle";
            dotGlyph = BLACK_CIRCLE;
          } else if (detection?.available) {
            dotColor = "subtle";
            dotGlyph = BLACK_CIRCLE;
          } else {
            dotColor = "error";
            dotGlyph = "◌";
          }
          const statusGlyph = <ThemedText bold color={dotColor}>{dotGlyph}</ThemedText>;
          // Description: for available / current agents, surface the
          // pretty-formatted model name (with effort suffix) + the
          // model's tail description. `prettyModel` swaps generic
          // labels like "Default (recommended)" out of the way so the
          // actual model name leads.
          let rowDesc: string;
          if (disabled && detection?.reason) {
            rowDesc = detection.reason;
          } else if (detection?.available || isCurrentAgent) {
            const storedModelId = getStoredModel(id);
            const storedModel = findModel(id, storedModelId);
            const pretty = storedModel ? prettyModel(storedModel) : { label: "Auto", description: "" };
            const effortSuffix = storedEffort ? ` (${effortLabel(storedEffort)} effort)` : "";
            const tail = pretty.description.length > 0 ? pretty.description : detection?.label ?? "";
            rowDesc = tail.length > 0
              ? `${pretty.label}${effortSuffix} · ${tail}`
              : `${pretty.label}${effortSuffix}`;
          } else {
            rowDesc = detection?.label ?? "probing…";
          }
          return (
            <Box key={id} gap={1}>
              <Box width={2} flexShrink={0}>
                <ThemedText color={selected && !disabled ? "accent" : "subtle"}>{selected && !disabled ? POINTER : " "}</ThemedText>
              </Box>
              <Box width={2} flexShrink={0}>
                {statusGlyph}
              </Box>
              <Box width={11} flexShrink={0}>
                <ThemedText color={disabled ? "inactive" : selected ? "text" : "inactive"} bold={selected && !disabled}>
                  {id}
                </ThemedText>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <ThemedText dimColor wrap="truncate-end">
                  {rowDesc}
                </ThemedText>
              </Box>
              {id === current ? (
                <Box flexShrink={0}>
                  <ThemedText dimColor>· current</ThemedText>
                </Box>
              ) : null}
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
