import { tool, type Tool } from "ai";
import { z } from "zod";

/** A transport-neutral outbound message whose canonical content is Markdown. */
export type ChannelMessage = {
  /** Optional topic. Each transport decides how to represent it. */
  title?: string;
  /** Canonical Markdown content. */
  markdown: string;
};

/** A transport failure safe to expose to an AI model. */
export type DeliveryFailure = {
  code: string;
  message: string;
};

/**
 * The result of a direct delivery attempt.
 *
 * `delivered` means the transport accepted the message, not that a person read
 * it. A caller should retry only `failed` results marked as retryable.
 * `uncertain` means retrying could produce a duplicate.
 */
export type DeliveryResult =
  | {
      status: "delivered";
      reference?: string;
    }
  | {
      status: "failed";
      retryable: boolean;
      error: DeliveryFailure;
    }
  | {
      status: "uncertain";
      error: DeliveryFailure;
    };

/** A configured outbound delivery route. */
export interface Channel {
  deliver(message: ChannelMessage): Promise<DeliveryResult>;
}

type ChannelTool = Tool<ChannelMessage, DeliveryResult>;

/** Model-facing options controlled by the caller creating the tool. */
export type CreateChannelToolOptions = {
  description?: string;
  inputExamples?: Array<{ input: ChannelMessage }>;
  metadata?: ChannelTool["metadata"];
  needsApproval?: ChannelTool["needsApproval"];
  providerOptions?: ChannelTool["providerOptions"];
  strict?: boolean;
};

const channelMessageSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("Optional title or topic for the message"),
  markdown: z.string().min(1).describe("Message content formatted as Markdown")
});

/**
 * Adapt a configured Channel to an AI SDK tool.
 *
 * The caller chooses the key used in its ToolSet and owns model-facing policy
 * such as the description, examples, metadata, and approval requirement.
 */
export function createChannelTool(
  channel: Channel,
  options: CreateChannelToolOptions = {}
): Tool<ChannelMessage, DeliveryResult> {
  return tool({
    ...options,
    inputSchema: channelMessageSchema,
    execute: (message) => channel.deliver(message)
  });
}
