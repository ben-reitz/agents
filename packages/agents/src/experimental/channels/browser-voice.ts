import type { Channel, ChannelMessage, DeliveryResult } from "./channel";

/** Wire-protocol discriminator for browser voice delivery messages. */
export const BROWSER_VOICE_MESSAGE_TYPE = "cf_agent_channel_browser_voice";

/** Message sent over an Agent WebSocket for a browser voice surface to render. */
export type BrowserVoiceMessage = {
  type: typeof BROWSER_VOICE_MESSAGE_TYPE;
  deliveryId: string;
  message: ChannelMessage;
  speechText: string;
};

/** The subset of an Agent WebSocket connection needed for voice delivery. */
export type BrowserVoiceConnection = {
  id: string;
  send(message: string): void;
};

/** Configuration for a browser voice channel. */
export type BrowserVoiceChannelOptions = {
  /** Return the browser surfaces connected at the moment of inspection. */
  getConnections: () => Iterable<BrowserVoiceConnection>;
  /** Project the canonical message into text for browser speech synthesis. */
  toSpeechText?: (message: ChannelMessage) => string;
  /** Choose one surface when multiple browser connections are available. */
  selectConnection?: (
    connections: readonly BrowserVoiceConnection[]
  ) => BrowserVoiceConnection | undefined;
};

function connections(options: BrowserVoiceChannelOptions) {
  return Array.from(options.getConnections());
}

function unavailable(): DeliveryResult {
  return {
    status: "failed",
    retryable: true,
    error: {
      code: "BROWSER_VOICE_UNAVAILABLE",
      message: "No browser voice surface is connected"
    }
  };
}

function deliveryFailure(error: unknown): DeliveryResult {
  if (
    error instanceof TypeError &&
    error.message.includes("WebSocket send() after close")
  ) {
    return {
      status: "failed",
      retryable: true,
      error: {
        code: "BROWSER_VOICE_CONNECTION_CLOSED",
        message: "The browser voice surface disconnected before delivery"
      }
    };
  }

  return {
    status: "uncertain",
    error: {
      code: "BROWSER_VOICE_DELIVERY_ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Browser voice delivery failed with an unknown outcome"
    }
  };
}

/**
 * Create a channel that sends one text utterance to one browser voice surface.
 *
 * This adapter only defines delivery over an existing Agent WebSocket. The
 * browser owns speech synthesis, playback controls, and voice selection.
 */
export function browserVoice(options: BrowserVoiceChannelOptions): Channel {
  const toSpeechText = options.toSpeechText ?? ((message) => message.markdown);
  const selectConnection =
    options.selectConnection ?? ((available) => available[0]);

  return {
    isAvailable() {
      return selectConnection(connections(options)) !== undefined;
    },

    async deliver(message) {
      const connection = selectConnection(connections(options));
      if (!connection) return unavailable();

      const deliveryId = crypto.randomUUID();
      const payload: BrowserVoiceMessage = {
        type: BROWSER_VOICE_MESSAGE_TYPE,
        deliveryId,
        message,
        speechText: toSpeechText(message)
      };

      try {
        connection.send(JSON.stringify(payload));
        return { status: "delivered", reference: deliveryId };
      } catch (error) {
        return deliveryFailure(error);
      }
    }
  };
}

/** Parse an Agent WebSocket frame intended for a browser voice surface. */
export function parseBrowserVoiceMessage(
  data: unknown
): BrowserVoiceMessage | undefined {
  if (typeof data !== "string") return undefined;

  try {
    const value: unknown = JSON.parse(data);
    if (value === null || typeof value !== "object") return undefined;

    const candidate = value as {
      type?: unknown;
      deliveryId?: unknown;
      message?: unknown;
      speechText?: unknown;
    };
    if (
      candidate.type !== BROWSER_VOICE_MESSAGE_TYPE ||
      typeof candidate.deliveryId !== "string" ||
      typeof candidate.speechText !== "string" ||
      candidate.message === null ||
      typeof candidate.message !== "object"
    ) {
      return undefined;
    }

    const message = candidate.message as {
      title?: unknown;
      markdown?: unknown;
    };
    if (
      typeof message.markdown !== "string" ||
      (message.title !== undefined && typeof message.title !== "string")
    ) {
      return undefined;
    }

    return {
      type: BROWSER_VOICE_MESSAGE_TYPE,
      deliveryId: candidate.deliveryId,
      message: {
        title: message.title,
        markdown: message.markdown
      },
      speechText: candidate.speechText
    };
  } catch {
    return undefined;
  }
}
