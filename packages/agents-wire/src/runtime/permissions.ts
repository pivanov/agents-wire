import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { IPendingPermission, IPermissionOption } from "@/types/events";
import type { TPermissionPolicy } from "@/types/options";

const ALLOW_KINDS = ["allow_always", "allow_once"] as const;
const ALLOW_ONCE_KINDS = ["allow_once", "allow_always"] as const;
const REJECT_KINDS = ["reject_once", "reject_always"] as const;

const pickByKind = (options: readonly PermissionOption[], kinds: readonly string[]): string | undefined => {
  for (const kind of kinds) {
    const match = options.find((option) => option.kind === kind);
    if (match) {
      return match.optionId;
    }
  }
  return undefined;
};

const cancelled = (): RequestPermissionResponse => ({ outcome: { outcome: "cancelled" } });

const select = (optionId: string): RequestPermissionResponse => ({
  outcome: { outcome: "selected", optionId },
});

const buildAutoResolver =
  (preferredKinds: readonly string[]) =>
  async (request: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
    const optionId = pickByKind(request.options, preferredKinds) ?? request.options[0]?.optionId;
    return optionId ? select(optionId) : cancelled();
  };

type TPolicyResolver = (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;

export const allowGate: TPolicyResolver = buildAutoResolver(ALLOW_KINDS);
export const allowOnceGate: TPolicyResolver = buildAutoResolver(ALLOW_ONCE_KINDS);
export const denyGate: TPolicyResolver = buildAutoResolver(REJECT_KINDS);
// Off-stream fallback for `stream` policy — auto-allow here would bypass the consumer.
const cancelGate: TPolicyResolver = async () => cancelled();

const adaptPermissionOption = (option: PermissionOption): IPermissionOption => ({
  id: option.optionId,
  label: option.name,
  ...(option.kind ? { kind: option.kind } : {}),
});

export const toPendingPermission = (
  request: RequestPermissionRequest,
  respond: (optionId: string) => void,
  cancel: () => void,
): IPendingPermission => ({
  toolCallId: request.toolCall.toolCallId,
  tool: request.toolCall.title ?? undefined,
  options: request.options.map(adaptPermissionOption),
  raw: request,
  respond,
  cancel,
});

export const policyToResolver = (policy: TPermissionPolicy = "auto-allow"): TPolicyResolver => {
  if (typeof policy === "function") {
    return async (request) => {
      // Function policies decide via the RETURN VALUE, not via the
      // pending permission's respond()/cancel() callbacks (those exist for
      // the "stream" policy where the consumer drives decisions over the
      // event queue). If a function-policy implementation reaches for them
      // by mistake, throw loudly rather than silently no-op.
      const noopRespond = (): void => {
        throw new Error(
          'IPendingPermission.respond() is a no-op inside a function policy. Return { id, label } from the policy callback instead, or use permission: "stream".',
        );
      };
      const noopCancel = (): void => {
        throw new Error(
          'IPendingPermission.cancel() is a no-op inside a function policy. Return "cancel" from the policy callback instead, or use permission: "stream".',
        );
      };
      const decision = await policy(toPendingPermission(request, noopRespond, noopCancel));
      if (decision === "cancel") {
        return cancelled();
      }
      // Validate the decision shape before forwarding to ACP. A stray
      // undefined / null / non-{id} return value would otherwise emit
      // optionId: undefined, which is a protocol violation. Treat as
      // cancelled and surface the misuse via the runtime error.
      if (!decision || typeof decision !== "object" || typeof (decision as { id?: unknown }).id !== "string") {
        return cancelled();
      }
      return select(decision.id);
    };
  }
  switch (policy) {
    case "auto-allow":
      return allowGate;
    case "auto-allow-once":
      return allowOnceGate;
    case "auto-reject":
      return denyGate;
    case "stream":
      return cancelGate;
  }
};

export const isStreamingPolicy = (policy: TPermissionPolicy = "auto-allow"): boolean => policy === "stream";
