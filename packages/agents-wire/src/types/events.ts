import type { SessionConfigOption, SessionUpdate } from "@agentclientprotocol/sdk";
import type { ICostSnapshot, IUsageReport, TStopReason } from "./results";

export interface IToolCallLocation {
  readonly path: string;
  readonly line?: number;
}

export interface IPlanEntry {
  readonly id?: string;
  readonly title: string;
  readonly status: "pending" | "in_progress" | "completed" | (string & {});
  readonly priority?: string;
}

export interface IPermissionOption {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
}

export interface IPendingPermission {
  readonly toolCallId: string;
  readonly tool: string | undefined;
  readonly options: readonly IPermissionOption[];
  readonly raw: unknown;
  respond: (optionId: string) => void;
  cancel: () => void;
}

export interface IAvailableCommand {
  readonly name: string;
  readonly description?: string;
}

export type TAgentEvent =
  | { readonly type: "text-delta"; readonly text: string; readonly messageId: string | undefined }
  | { readonly type: "thinking-delta"; readonly text: string; readonly messageId: string | undefined }
  | {
      readonly type: "tool-call";
      readonly toolCallId: string;
      readonly tool: string;
      readonly kind: string | undefined;
      readonly status: string | undefined;
      readonly input: unknown;
      readonly locations: readonly IToolCallLocation[] | undefined;
    }
  | {
      readonly type: "tool-call-update";
      readonly toolCallId: string;
      readonly title: string | undefined;
      readonly status: string | undefined;
      readonly input: unknown;
      readonly output: unknown;
      readonly locations: readonly IToolCallLocation[] | undefined;
    }
  | { readonly type: "permission-request"; readonly request: IPendingPermission }
  | { readonly type: "plan"; readonly entries: readonly IPlanEntry[] }
  | { readonly type: "mode-changed"; readonly modeId: string }
  | { readonly type: "available-commands"; readonly commands: readonly IAvailableCommand[] }
  | { readonly type: "config-options"; readonly options: readonly SessionConfigOption[] }
  | { readonly type: "session-info"; readonly title: string | undefined; readonly updatedAt: string | undefined }
  | { readonly type: "usage"; readonly usage: IUsageReport }
  | { readonly type: "cost"; readonly cost: ICostSnapshot }
  | {
      readonly type: "finish";
      readonly stopReason: TStopReason;
      readonly usage: IUsageReport | undefined;
      readonly cost: ICostSnapshot | undefined;
    }
  | { readonly type: "raw"; readonly update: SessionUpdate };

export type TAgentEventType = TAgentEvent["type"];
