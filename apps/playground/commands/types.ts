import type { ReactNode } from "react";
import type { TThemeId } from "@app/theme/palette";
import type { TTranscriptEvent } from "@app/components/transcript";
import type { ICostTracker, IAgentSession, IAgentPool, TAgentId, TPermissionPolicy } from "@pivanov/agents-wire";

export type TPlaygroundMode = "ask" | "stream" | "session";

export interface IAppState {
  readonly agent: TAgentId;
  readonly mode: TPlaygroundMode;
  readonly permission: TPermissionPolicy;
  readonly budget: number | undefined;
  readonly cost: ICostTracker;
  readonly session: IAgentSession | undefined;
  readonly pool: IAgentPool | undefined;
  readonly mock: boolean;
  readonly themeId: TThemeId;
  readonly model: string | undefined;
  readonly effort: string | undefined;
}

export interface IAppController {
  readonly getState: () => IAppState;
  readonly setAgent: (id: TAgentId) => void;
  readonly setMode: (mode: TPlaygroundMode) => void;
  readonly setPermission: (policy: TPermissionPolicy) => void;
  readonly setBudget: (usd: number | undefined) => void;
  readonly setMock: (mock: boolean) => void;
  readonly setTheme: (id: TThemeId) => void;
  readonly setModel: (model: string | undefined, effort: string | undefined) => void;
  readonly openSession: () => Promise<void>;
  readonly closeSession: () => Promise<void>;
  readonly openPool: (size: number) => Promise<void>;
  readonly closePool: () => Promise<void>;
  readonly emit: (event: TTranscriptEvent) => void;
  readonly clearLog: () => void;
  readonly showDialog: (node: ReactNode) => void;
  readonly closeDialog: () => void;
  readonly resetCost: () => void;
  /** Push text into the prompt input - used by orchestration commands to seed `/failover claude,codex ` after the multi-agent picker. */
  readonly setInputDraft: (text: string) => void;
  readonly exit: () => void;
}
