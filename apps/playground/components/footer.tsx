// Footer with mascot column on the left and a 4-row info column on the
// right. Sits at the bottom of the dynamic frame so it's always visible -
// banner-as-footer trick: cursor anchors to the bottom of the buffer, so
// the dynamic frame is always at the visible bottom. As old transcript
// grows, it scrolls into terminal scrollback above; the footer stays put.
//
// Row layout:
//   1. branding         agents-wire · agents-wire.dev
//   2. agent column     <agent> · <model> · <effort>
//   3. mode column      <mode> · <permission> · session? · pool?
//   4. cost column      <bar> <spent>/<budget> · <state hint>

import { Box } from "ink";
import { memo } from "react";
import { findModel, supportsEnumEffort } from "@app/config/models";
import { ThemedText as Text } from "@app/theme/themed-text";
import type { TAgentId, TPermissionPolicy } from "@pivanov/agents-wire";
import { BULLET_OPERATOR, SQUARE_FILLED, SQUARE_LIGHT } from "./figures";
import { createPlainHyperlink } from "./hyperlink";
import { Mascot, mascotWidth } from "./mascot";

interface ICostInfo {
  readonly totalUsd: number;
  readonly turns: number;
  readonly currentAgentTurns: number;
  readonly currentAgentSpent: number;
}

interface IExitMessage {
  readonly show: boolean;
  readonly key?: string;
}

interface IProps {
  readonly cols: number;
  readonly agent: TAgentId;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  readonly mode: "ask" | "stream" | "session";
  readonly permission: TPermissionPolicy;
  readonly budget: number | undefined;
  readonly cost: ICostInfo;
  readonly mock: boolean;
  readonly hasSession: boolean;
  readonly poolSize: number | undefined;
  readonly state: "idle" | "loading" | "cancelling";
  readonly exitMessage?: IExitMessage;
  /** Increments on every user submit; threaded to <Mascot> so the owl swaps and the gradient rotates. */
  readonly mascotBumpKey: number;
}

const SEP = ` ${BULLET_OPERATOR} `;
const MASCOT_GAP = 4;

const MADE_BY = "@pivanov";
const MADE_BY_URL = "https://github.com/pivanov";
const MADE_BY_LINK = createPlainHyperlink(MADE_BY_URL, MADE_BY);

const HOMEPAGE = "www.agents-wire.dev";
const HOMEPAGE_URL = "https://agents-wire.dev";
const HOMEPAGE_LINK = createPlainHyperlink(HOMEPAGE_URL, HOMEPAGE);

// Agents we have $/M-token pricing data for in the SDK's pricing table.
// Everything else is subscription-priced (Cursor, Copilot, Pi, Droid,
// OpenCode) - for those we show turn count instead of a $-bar so the
// number isn't misleading.
const METERED_AGENTS = new Set<TAgentId>(["claude", "codex", "gemini"]);

const formatPermission = (policy: TPermissionPolicy): string => {
  if (typeof policy === "function") {
    return "custom";
  }
  return policy;
};

const renderBar = (totalSpent: number, budget: number): { bar: string; ratio: number } => {
  const ratio = Math.min(1, totalSpent / budget);
  const filled = Math.round(ratio * 10);
  const bar = SQUARE_FILLED.repeat(filled) + SQUARE_LIGHT.repeat(10 - filled);
  return { bar, ratio };
};

const FooterImpl = (props: IProps) => {
  const { cols, agent, model, effort, mode, permission, budget, cost, mock, hasSession, poolSize, state, exitMessage, mascotBumpKey } = props;

  const mascotW = mascotWidth();
  const infoWidth = Math.max(20, cols - mascotW - MASCOT_GAP - 2);

  const agentSegments: string[] = [mock ? `${agent} (mock)` : agent];
  if (model !== undefined) {
    const info = findModel(agent, model);
    agentSegments.push(info?.label ?? model);
    if (effort !== undefined && (info ? supportsEnumEffort(info) : true)) {
      agentSegments.push(`${effort} effort`);
    }
  }
  const agentLine = agentSegments.join(SEP);

  const modeSegments: string[] = [mode, formatPermission(permission)];
  if (hasSession) {
    modeSegments.push("session");
  }
  if (poolSize !== undefined) {
    modeSegments.push(`pool=${poolSize}`);
  }
  const modeLine = modeSegments.join(SEP);

  // Row 4: cost bar + state hint, side-by-side. Subscription-priced
  // agents never report `costUsd`, so a $-bar of 0.0000/2.00 is
  // misleading - show turn count instead. Metered agents (with pricing
  // table entries) get the bar, even before any usage so the user knows
  // their budget upfront.
  let costNode: React.ReactNode;
  const isMetered = METERED_AGENTS.has(agent);
  if (!isMetered) {
    const turns = cost.currentAgentTurns;
    costNode = <Text dimColor>{`subscription${SEP}${turns} turn${turns === 1 ? "" : "s"}`}</Text>;
  } else if (cost.currentAgentTurns > 0 && cost.currentAgentSpent === 0) {
    costNode = <Text dimColor>{`${agent}: no cost reported`}</Text>;
  } else if (budget === undefined) {
    costNode = <Text dimColor>{`$${cost.totalUsd.toFixed(4)}${SEP}budget: off`}</Text>;
  } else {
    const { bar, ratio } = renderBar(cost.totalUsd, budget);
    const color = ratio >= 0.9 ? "error" : ratio >= 0.6 ? "warning" : "success";
    costNode = (
      <Box>
        <Text color={color}>{bar}</Text>
        <Text dimColor>{` ${cost.totalUsd.toFixed(4)}/${budget.toFixed(2)} usd`}</Text>
      </Box>
    );
  }

  let stateText: string;
  if (exitMessage?.show && exitMessage.key) {
    stateText = `Press ${exitMessage.key} again to exit`;
  } else if (state === "cancelling") {
    stateText = "Cancelling…";
  } else if (state === "loading") {
    stateText = "Esc to interrupt";
  } else {
    stateText = "? for shortcuts";
  }

  return (
    <Box flexDirection="row" gap={MASCOT_GAP} marginTop={1} paddingLeft={3}>
      <Box flexShrink={0} width={mascotW}>
        <Mascot agent={agent} bumpKey={mascotBumpKey} />
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} width={infoWidth}>
        <Text dimColor wrap="truncate-end">
          {agentLine}
        </Text>
        <Text dimColor wrap="truncate-end">
          {modeLine}
        </Text>
        <Box flexDirection="row" gap={2}>
          <Box flexShrink={0}>{costNode}</Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {SEP.trim()} {stateText}
            </Text>
          </Box>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="suggestion">
            {HOMEPAGE_LINK}
          </Text>
          <Text color="inactive">
            by
          </Text>
          <Text color="suggestion">
            {MADE_BY_LINK}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};

export const Footer = memo(FooterImpl);
Footer.displayName = "Footer";
