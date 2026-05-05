import { cascade, type ICascadeOptions, type ICascadeResult, type ICascadeStage } from "@/orchestrate/cascade";
import { failover, type IFailoverOptions, type IFailoverResult } from "@/orchestrate/failover";
import { createAgentPool, type IAgentPool, type IPoolOptions } from "@/orchestrate/pool";
import { type IRaceOptions, type IRaceResult, race } from "@/orchestrate/race";
import type { TSchemaInput } from "@/schema/standard";
import type { IAgentCapabilities, TAgentId } from "@/types/agent";
import type { IAskOptions, ISessionOptions } from "@/types/options";
import type { IAskResult, IJsonResult } from "@/types/results";
import { createClient, type IAgentClient } from "./client";
import { detectAvailableAgents, type IDetectionEntry } from "./detect";
import { createSession, type IAgentSession } from "./session";
import type { IAgentStream } from "./stream";

export interface IAgentsNamespace {
  ask: (agent: TAgentId, prompt: string, options?: IAskOptions) => Promise<IAskResult>;
  askJson: <T>(agent: TAgentId, prompt: string, schema: TSchemaInput<T>, options?: IAskOptions) => Promise<IJsonResult<T>>;
  stream: (agent: TAgentId, prompt: string, options?: IAskOptions) => IAgentStream;
  session: (agent: TAgentId, options?: ISessionOptions) => Promise<IAgentSession>;
  capabilities: (agent: TAgentId) => Promise<IAgentCapabilities>;
  detect: () => Promise<readonly IDetectionEntry[]>;
  for: (agent: TAgentId, defaults?: IAskOptions) => IAgentClient;
  failover: (prompt: string, candidates: readonly TAgentId[], options?: IFailoverOptions) => Promise<IFailoverResult>;
  race: (prompt: string, candidates: readonly TAgentId[], options?: IRaceOptions) => Promise<IRaceResult>;
  cascade: (prompt: string, stages: readonly ICascadeStage[], options?: ICascadeOptions) => Promise<ICascadeResult>;
  pool: (options: IPoolOptions) => Promise<IAgentPool>;
}

export const agents: IAgentsNamespace = {
  ask: (agent, prompt, options) => createClient(agent).ask(prompt, options),
  askJson: (agent, prompt, schema, options) => createClient(agent).askJson(prompt, schema, options),
  stream: (agent, prompt, options) => createClient(agent).stream(prompt, options),
  session: (agent, options) => createSession(agent, options ?? {}),
  capabilities: (agent) => createClient(agent).capabilities(),
  detect: () => detectAvailableAgents(),
  for: (agent, defaults) => createClient(agent, defaults),
  failover: (prompt, candidates, options) => failover(prompt, candidates, options),
  race: (prompt, candidates, options) => race(prompt, candidates, options),
  cascade: (prompt, stages, options) => cascade(prompt, stages, options),
  pool: (options) => createAgentPool(options),
};
