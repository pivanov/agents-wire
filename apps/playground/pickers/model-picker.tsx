// Single-pane model picker, cursor-cli style:
//   ↑ ↓  navigate model rows
//   ← →  cycle reasoning effort for the currently-focused model
//   ⏎    commit (model + currently-displayed effort for that model)
//   esc  cancel
//
// Effort UI dispatch (per `model.effort.kind`):
//   - enum    → inline ←→ cycler + bottom indicator
//   - budget  → inline ←→ stepper through declared values (rendered
//               same as enum; values are numeric strings)
//   - variant → no effort UI; effort is baked into the model id
//   - none / undefined → no effort UI

import { Box } from "ink";
import { useEffect, useMemo, useState } from "react";
import { BLACK_CIRCLE, POINTER } from "@app/components/figures";
import { agentHasAnyEnumEffort, cycleEffort, defaultEffortFor, effortLabel, effortSymbol } from "@app/components/effort";
import { Spinner } from "@app/components/spinner";
import { useStableInput } from "@app/components/use-stable-input";
import {
  agentConfigSnapshot,
  type IModelInfo,
  isAcpCompatible,
  loadAgentConfig,
  NONE_MODEL_ID,
  prettyModel,
} from "@app/config/models";
import { ThemedText as Text } from "@app/theme/themed-text";
import type { TAgentId } from "@pivanov/agents-wire";

interface IPickedModel {
  readonly model: string | undefined;
  readonly effort: string | undefined;
}

interface IProps {
  readonly agent: TAgentId;
  readonly currentModel?: string;
  readonly currentEffort?: string;
  readonly onResolve: (picked: IPickedModel | undefined) => void;
}

interface IRow {
  readonly id: string;
  readonly model?: IModelInfo;
}

// Max rows shown at once. Cursor returns 100+ models - rendering them
// all blows the dynamic frame past the terminal height and clobbers
// scrollback. Window the visible slice and scroll as the cursor moves.
const VISIBLE_WINDOW = 6;

/**
 * The catalog ships `{ id: "default", label: "Default" }` as a
 * cold-start placeholder so resolveModels can return source="static"
 * (not source="none") for agents whose live probe failed. The picker
 * already prepends an "Auto" sentinel meaning the same thing — so
 * rendering both produces a duplicated "Default" row. Filter the
 * placeholder out here. Real agent-declared rows whose id happens to
 * be `default` (e.g. Claude's `default :: "Default (recommended)"`)
 * carry a non-trivial label or description and survive the filter.
 */
const isStaticPlaceholder = (m: IModelInfo): boolean =>
  m.id === "default" && m.label === "Default" && !m.description && !m.effort;

const buildRows = (models: readonly IModelInfo[]): readonly IRow[] => [
  { id: NONE_MODEL_ID },
  ...models.filter((m) => !isStaticPlaceholder(m)).map((m) => ({ id: m.id, model: m })),
];

/**
 * Allowed values to cycle through for the focused row's effort axis.
 * Returns [] for `none` / `variant` / `undefined` (no inline cycler);
 * returns the enum values for `enum`; returns the boundary stops for
 * `budget` (treated like an enum of numeric strings).
 */
const allowedEfforts = (model: IModelInfo | undefined): readonly string[] => {
  const effort = model?.effort;
  if (!effort) {
    return [];
  }
  if (effort.kind === "enum") {
    return effort.values;
  }
  if (effort.kind === "budget") {
    return [String(effort.min), String(effort.max)];
  }
  return [];
};

export const ModelPicker = ({ agent, currentModel, currentEffort, onResolve }: IProps) => {
  // Probe the agent on mount: opens a throwaway session, reads
  // session.configOptions, closes. Cached module-level so subsequent
  // opens of the same agent are instant. Spinner shows during the
  // probe; while it's running we render the static-catalog snapshot
  // so the picker is interactive immediately.
  const [, forceRerender] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadAgentConfig(agent).finally(() => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      forceRerender((n) => n + 1);
    });
    return (): void => {
      cancelled = true;
    };
  }, [agent]);

  const config = agentConfigSnapshot(agent);
  const rows = useMemo(() => buildRows(config.models), [config.models]);
  const showEffortRow = useMemo(
    () => agentHasAnyEnumEffort(rows.flatMap((r) => (r.model ? [r.model] : []))),
    [rows],
  );

  const initialIdx = currentModel ? Math.max(0, rows.findIndex((r) => r.id === currentModel)) : 0;
  const [cursor, setCursor] = useState<number>(initialIdx);
  // Per-model effort overrides accumulated as the user cycles ←→ on a
  // row. Pressing Enter commits the override for the focused row;
  // unmodified rows fall back to currentEffort (if same row) or the
  // model's default-effort heuristic.
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    setCursor(initialIdx);
  }, [initialIdx]);

  const focused = rows[cursor];
  const focusedModel = focused?.model;
  const focusedAllowed = allowedEfforts(focusedModel);
  const focusedSupportsEffort = focusedAllowed.length > 0;

  const displayedEffort = useMemo<string | null>(() => {
    if (!focusedModel || focusedAllowed.length === 0) {
      return null;
    }
    const override = overrides[focusedModel.id];
    if (override && focusedAllowed.includes(override)) {
      return override;
    }
    if (focusedModel.id === currentModel && currentEffort && focusedAllowed.includes(currentEffort)) {
      return currentEffort;
    }
    return defaultEffortFor(focusedModel.effort);
  }, [focusedModel, focusedAllowed, currentModel, currentEffort, overrides]);

  useStableInput((_input, key) => {
    if (key.upArrow) {
      setCursor((i) => (i <= 0 ? rows.length - 1 : i - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((i) => (i >= rows.length - 1 ? 0 : i + 1));
      return;
    }
    if ((key.leftArrow || key.rightArrow) && focusedSupportsEffort && focusedModel && displayedEffort) {
      const dir: 1 | -1 = key.rightArrow ? 1 : -1;
      const next = cycleEffort(focusedAllowed, displayedEffort, dir);
      setOverrides((prev) => ({ ...prev, [focusedModel.id]: next }));
      return;
    }
    if (key.return) {
      const r = rows[cursor];
      if (!r) {
        return;
      }
      if (r.id === NONE_MODEL_ID) {
        onResolve({ model: undefined, effort: undefined });
        return;
      }
      const m = r.model;
      if (!m) {
        return;
      }
      const allowed = allowedEfforts(m);
      const effort = allowed.length > 0
        ? overrides[m.id] ?? (m.id === currentModel ? currentEffort : undefined) ?? defaultEffortFor(m.effort) ?? undefined
        : undefined;
      onResolve({ model: m.id, effort });
      return;
    }
    if (key.escape) {
      onResolve(undefined);
    }
  });

  const labelWidth = rows.reduce((m, r) => Math.max(m, (r.model ? prettyModel(r.model).label : "Auto").length), 0);

  // Sliding window over `rows` so we never render more than VISIBLE_WINDOW
  // rows at once. Anchor the window so the cursor row is always visible.
  const windowStart = useMemo(() => {
    if (rows.length <= VISIBLE_WINDOW) {
      return 0;
    }
    const half = Math.floor(VISIBLE_WINDOW / 2);
    const desired = cursor - half;
    return Math.max(0, Math.min(rows.length - VISIBLE_WINDOW, desired));
  }, [cursor, rows.length]);
  const windowEnd = Math.min(rows.length, windowStart + VISIBLE_WINDOW);
  const visibleRows = rows.slice(windowStart, windowEnd);
  const hasOverflowAbove = windowStart > 0;
  const hasOverflowBelow = windowEnd < rows.length;

  // Source badge: tiny "live" / "fallback" tag in the header so the
  // user knows whether they're seeing the agent's actual lineup or a
  // placeholder waiting on the probe. `live-list` and `session-config`
  // both count as live (real CLI / session truth); `static` is the
  // cold-start placeholder.
  const sourceTag = (() => {
    switch (config.source) {
      case "session-config":
      case "live-list":
        return "live";
      case "static":
        return "fallback";
      default:
        return undefined;
    }
  })();

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text color="accent" bold>
          Model
        </Text>
        <Text dimColor>
          · {agent} · ↑↓ navigate · ← → effort · enter select · esc cancel
        </Text>
        {loading ? (
          <Box flexDirection="row" gap={1}>
            <Spinner />
            <Text color="subtle">loading agent options…</Text>
          </Box>
        ) : sourceTag ? (
          <Text color="subtle">[{sourceTag}]</Text>
        ) : null}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {hasOverflowAbove ? (
          <Box paddingLeft={3}>
            <Text color="subtle">↑ {windowStart} more above</Text>
          </Box>
        ) : null}
        {visibleRows.map((row, vi) => {
          const i = windowStart + vi;
          const isDefaultRow = row.id === NONE_MODEL_ID;
          const pretty = row.model ? prettyModel(row.model) : { label: "Auto", description: "" };
          const label = pretty.label;
          const desc = isDefaultRow ? "let the agent pick its default" : pretty.description;
          const selected = i === cursor;
          const isCurrent = (currentModel === undefined && isDefaultRow) || currentModel === row.id;
          // Dot column: filled (in `success` green) ONLY on the row
          // matching the persisted selection. Glyph reflects the
          // selected effort via effortSymbol(). Other rows leave the
          // column blank so the active selection pops visually as you
          // scroll.
          const dotGlyph = isCurrent
            ? (currentEffort ? effortSymbol(currentEffort) : BLACK_CIRCLE)
            : " ";
          return (
            <Box key={row.id} gap={1}>
              <Box width={2} flexShrink={0}>
                <Text color="accent">{selected ? POINTER : " "}</Text>
              </Box>
              <Box width={2} flexShrink={0}>
                <Text bold color={isCurrent ? "success" : "subtle"}>{dotGlyph}</Text>
              </Box>
              <Box width={labelWidth + 2} flexShrink={0}>
                <Text color={selected ? "text" : "inactive"} bold={selected}>
                  {label}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor wrap="truncate-end">
                  {desc}
                </Text>
              </Box>
              {isCurrent ? (
                <Box flexShrink={0}>
                  <Text dimColor>· current</Text>
                </Box>
              ) : null}
            </Box>
          );
        })}
        {hasOverflowBelow ? (
          <Box paddingLeft={3}>
            <Text color="subtle">↓ {rows.length - windowEnd} more below</Text>
          </Box>
        ) : null}
        {rows.length > VISIBLE_WINDOW ? (
          <Box paddingLeft={3} marginTop={1}>
            <Text color="subtle">{cursor + 1} / {rows.length}</Text>
          </Box>
        ) : null}
      </Box>
      {showEffortRow ? (
        <Box marginTop={1}>
          {focusedSupportsEffort && displayedEffort ? (
            <Text dimColor>
              <Text color="accent">{effortSymbol(displayedEffort)}</Text>
              {` ${effortLabel(displayedEffort)} `}
              <Text color="subtle">← → to adjust</Text>
            </Text>
          ) : focusedModel?.effort?.kind === "variant" ? (
            <Text color="subtle">effort baked into the model id (cursor-style variants)</Text>
          ) : !isAcpCompatible(agent) ? (
            <Text color="subtle">{agent} does not implement ACP — model selection has no effect</Text>
          ) : config.source === "static" ? (
            <Text color="subtle">authenticate to see live effort options</Text>
          ) : (
            <Text color="subtle">
              {focusedModel ? `no reasoning effort for ${focusedModel.label}` : "no reasoning effort"}
            </Text>
          )}
        </Box>
      ) : !isAcpCompatible(agent) ? (
        <Box marginTop={1}>
          <Text color="subtle">{agent} does not implement ACP — model selection has no effect</Text>
        </Box>
      ) : config.source === "static" ? (
        <Box marginTop={1}>
          <Text color="subtle">authenticate to see live model + effort options</Text>
        </Box>
      ) : null}
    </Box>
  );
};
