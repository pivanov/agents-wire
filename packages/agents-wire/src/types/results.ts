import type { TAgentId } from "./agent";

export type TStopReason = "end_turn" | "max_tokens" | "cancelled" | "refusal" | (string & {});

export interface ISessionInfo {
  readonly sessionId: string;
  readonly title?: string;
  readonly updatedAt?: string;
  readonly cwd?: string;
}

export interface ISessionListPage {
  readonly sessions: readonly ISessionInfo[];
  readonly nextCursor?: string;
}

export interface IUsageReport {
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly tokensCacheRead?: number;
  readonly tokensCacheWrite?: number;
  readonly contextSize?: number;
  readonly contextUsed?: number;
  readonly costUsd?: number;
}

export interface ICostBucket {
  readonly totalUsd: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensCacheRead: number;
  readonly tokensCacheWrite: number;
  readonly turns: number;
}

export interface ICostSnapshot extends ICostBucket {
  readonly byAgent: Readonly<Record<TAgentId, ICostBucket>>;
}

export interface IAskResult {
  readonly text: string;
  readonly thinking: string;
  readonly stopReason: TStopReason;
  readonly usage: IUsageReport | undefined;
  readonly cost: ICostSnapshot | undefined;
  readonly sessionId: string;
  readonly agent: TAgentId;
  readonly durationMs: number;
}

export interface IJsonResult<T> {
  readonly data: T;
  readonly raw: IAskResult;
}
