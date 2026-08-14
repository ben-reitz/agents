import type {
  Channel,
  ChannelApprovalRequestOptions,
  DeliveryResult
} from "./channel";
import type { ChannelApprovalResponse, ChannelIngressEvent } from "./ingress";

export type ChannelApprovalResponseEvent = {
  channelId: string;
  interactionId: string;
  decision: ChannelApprovalResponse["decision"];
};

export type ChannelHostOptions = {
  channels: Record<string, Channel>;
  onApprovalResponse(event: ChannelApprovalResponseEvent): void | Promise<void>;
};

export type HostedDeliveryResult = {
  channelId: string;
  result: DeliveryResult;
};

/**
 * Routes approval requests through named Channels and correlates their ingress
 * responses with the interaction that produced each provider message.
 *
 * Correlation and replay suppression are intentionally in-memory. Providers
 * can include a recovered interaction id in an ingress response when their
 * reply content supports correlation after isolate recreation.
 */
export class ChannelHost {
  readonly #channels: Record<string, Channel>;
  readonly #onApprovalResponse: ChannelHostOptions["onApprovalResponse"];
  readonly #interactionsByReference = new Map<string, string>();
  readonly #inFlightApprovalResponses = new Map<string, Promise<void>>();
  readonly #processedInboundReferences = new Set<string>();
  #approvalRequestsChannelId: string | undefined;

  constructor(options: ChannelHostOptions) {
    this.#channels = { ...options.channels };
    this.#onApprovalResponse = options.onApprovalResponse;

    const ingressPaths = new Set<string>();
    for (const channel of Object.values(this.#channels)) {
      const path = channel.ingress?.path;
      if (!path) continue;
      if (ingressPaths.has(path)) {
        throw new Error(`Duplicate Channel ingress path "${path}"`);
      }
      ingressPaths.add(path);
    }
  }

  setApprovalRequestsChannel(channelId?: string): void {
    if (channelId !== undefined && !this.#channels[channelId]) {
      throw new Error(`Unknown channel "${channelId}"`);
    }
    this.#approvalRequestsChannelId = channelId;
  }

  async requestApproval(
    options: ChannelApprovalRequestOptions
  ): Promise<HostedDeliveryResult | undefined> {
    const channelId = this.#approvalRequestsChannelId;
    if (!channelId) return undefined;

    const channel = this.#channels[channelId];
    if (!channel.requestApproval) {
      throw new Error(
        `Channel "${channelId}" does not support approval requests`
      );
    }

    const available = await channel.isAvailable?.();
    const result: DeliveryResult =
      available === false
        ? {
            status: "failed",
            retryable: true,
            error: {
              code: "CHANNEL_UNAVAILABLE",
              message: `Channel "${channelId}" is unavailable`
            }
          }
        : await channel.requestApproval(options);

    if (result.status === "delivered" && result.reference) {
      this.#interactionsByReference.set(
        `${channelId}:${result.reference}`,
        options.interactionId
      );
    }

    return { channelId, result };
  }

  async handleRequest(request: Request): Promise<Response | undefined> {
    const path = new URL(request.url).pathname;
    const entry = Object.entries(this.#channels)
      .filter(([, channel]) => {
        const ingressPath = channel.ingress?.path;
        return (
          ingressPath !== undefined &&
          (path === ingressPath || path.endsWith(ingressPath))
        );
      })
      .sort(
        ([, left], [, right]) =>
          (right.ingress?.path.length ?? 0) - (left.ingress?.path.length ?? 0)
      )[0];
    if (!entry) return undefined;

    const [channelId, channel] = entry;
    const ingress = channel.ingress;
    if (!ingress) return undefined;

    const result = await ingress.receive(request);
    try {
      for (const event of result.events) {
        await this.#handleEvent(channelId, event);
      }
      return result.response;
    } catch {
      return new Response("Failed to handle Channel event", { status: 500 });
    }
  }

  async #handleEvent(
    channelId: string,
    event: ChannelIngressEvent
  ): Promise<void> {
    if (event.type !== "approval-response") return;

    const inboundKey = `${channelId}:${event.reference}`;
    if (this.#processedInboundReferences.has(inboundKey)) return;
    const inFlight = this.#inFlightApprovalResponses.get(inboundKey);
    if (inFlight) {
      await inFlight;
      return;
    }

    const handling = this.#dispatchApprovalResponse(channelId, event);
    this.#inFlightApprovalResponses.set(inboundKey, handling);
    try {
      await handling;
    } finally {
      if (this.#inFlightApprovalResponses.get(inboundKey) === handling) {
        this.#inFlightApprovalResponses.delete(inboundKey);
      }
    }
  }

  async #dispatchApprovalResponse(
    channelId: string,
    response: ChannelApprovalResponse
  ): Promise<void> {
    const inboundKey = `${channelId}:${response.reference}`;
    const replyKey = response.replyToReference
      ? `${channelId}:${response.replyToReference}`
      : undefined;
    const interactionId =
      (replyKey && this.#interactionsByReference.get(replyKey)) ||
      response.interactionId;
    if (!interactionId) return;

    await this.#onApprovalResponse({
      channelId,
      interactionId,
      decision: response.decision
    });
    this.#processedInboundReferences.add(inboundKey);
    if (replyKey) this.#interactionsByReference.delete(replyKey);
  }
}
