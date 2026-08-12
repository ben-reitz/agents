import type { Channel, ChannelMessage, DeliveryResult } from "./channel";

/** Configuration for a destination-bound Telegram channel. */
export type TelegramChannelOptions = {
  /** Bot token issued by BotFather. */
  botToken: string;
  /** User, group, or channel chat id that receives every message. */
  chatId: string | number;
  /** Telegram Bot API origin. @default "https://api.telegram.org" */
  apiBaseUrl?: string;
  /** Maximum text length accepted by this route. @default 4096 */
  maxLength?: number;
  /** Project the canonical message into plain Telegram text. */
  toText?: (message: ChannelMessage) => string;
  /** Override fetch for testing or custom network routing. */
  fetch?: typeof globalThis.fetch;
};

type TelegramApiResponse = {
  ok?: unknown;
  result?: unknown;
  error_code?: unknown;
  description?: unknown;
};

const TELEGRAM_MESSAGE_LIMIT = 4096;

function defaultText(message: ChannelMessage): string {
  return message.title
    ? `${message.title}\n\n${message.markdown}`
    : message.markdown;
}

function uncertain(message: string): DeliveryResult {
  return {
    status: "uncertain",
    error: { code: "TELEGRAM_DELIVERY_ERROR", message }
  };
}

function asApiResponse(value: unknown): TelegramApiResponse | undefined {
  return value !== null && typeof value === "object"
    ? (value as TelegramApiResponse)
    : undefined;
}

function classifyResponse(
  response: Response,
  payload: TelegramApiResponse
): DeliveryResult {
  if (payload.ok === true) {
    const result = asApiResponse(payload.result) as
      | { message_id?: unknown }
      | undefined;
    if (typeof result?.message_id === "number") {
      return { status: "delivered", reference: String(result.message_id) };
    }
    return uncertain("Telegram returned an invalid delivery response");
  }

  if (payload.ok === false) {
    const errorCode =
      typeof payload.error_code === "number"
        ? payload.error_code
        : response.status;
    const message =
      typeof payload.description === "string"
        ? payload.description
        : "Telegram rejected the message";
    return {
      status: "failed",
      retryable: errorCode === 429 || errorCode >= 500,
      error: { code: `TELEGRAM_API_ERROR_${errorCode}`, message }
    };
  }

  return uncertain("Telegram returned an invalid delivery response");
}

/** Create a configured outbound Telegram Bot API route. */
export function telegram(options: TelegramChannelOptions): Channel {
  if (!options.botToken.trim()) {
    throw new Error("botToken is required to create a Telegram channel");
  }
  if (!String(options.chatId).trim()) {
    throw new Error("chatId is required to create a Telegram channel");
  }

  const fetch = options.fetch ?? globalThis.fetch;
  const apiBaseUrl = (options.apiBaseUrl ?? "https://api.telegram.org").replace(
    /\/$/,
    ""
  );
  const maxLength = options.maxLength ?? TELEGRAM_MESSAGE_LIMIT;
  if (
    !Number.isInteger(maxLength) ||
    maxLength < 1 ||
    maxLength > TELEGRAM_MESSAGE_LIMIT
  ) {
    throw new Error(
      `maxLength must be an integer between 1 and ${TELEGRAM_MESSAGE_LIMIT}`
    );
  }
  const toText = options.toText ?? defaultText;

  return {
    async deliver(message) {
      const text = toText(message);
      if (text.length > maxLength) {
        return {
          status: "failed",
          retryable: false,
          error: {
            code: "TELEGRAM_MESSAGE_TOO_LONG",
            message: `Telegram message exceeds the configured ${maxLength}-character limit`
          }
        };
      }

      let response: Response;
      try {
        response = await fetch(
          `${apiBaseUrl}/bot${options.botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: options.chatId,
              text
            })
          }
        );
      } catch {
        return uncertain("Telegram delivery failed with an unknown outcome");
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return uncertain("Telegram returned an invalid delivery response");
      }

      const apiResponse = asApiResponse(payload);
      return apiResponse
        ? classifyResponse(response, apiResponse)
        : uncertain("Telegram returned an invalid delivery response");
    }
  };
}
