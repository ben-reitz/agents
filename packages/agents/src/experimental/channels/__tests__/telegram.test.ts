import { describe, expect, it, vi } from "vitest";
import { fallback, telegram, type Channel } from "..";

const BOT_TOKEN = "secret-bot-token";

function createChannel(fetch: typeof globalThis.fetch) {
  return telegram({
    botToken: BOT_TOKEN,
    chatId: "123456",
    fetch
  });
}

describe("experimental Telegram channel", () => {
  it("sends a destination-bound message and returns its Telegram message id", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: { message_id: 42 } })
    );
    const channel = createChannel(fetch);

    await expect(
      channel.deliver({ title: "Build blocked", markdown: "Please **help**" })
    ).resolves.toEqual({ status: "delivered", reference: "42" });

    expect(fetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        body: JSON.stringify({
          chat_id: "123456",
          text: "Build blocked\n\nPlease **help**"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }
    );
  });

  it("rejects messages over Telegram's limit before attempting delivery", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const channel = createChannel(fetch);

    await expect(
      channel.deliver({ markdown: "x".repeat(4097) })
    ).resolves.toEqual({
      status: "failed",
      retryable: false,
      error: {
        code: "TELEGRAM_MESSAGE_TOO_LONG",
        message: "Telegram message exceeds the configured 4096-character limit"
      }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports a lower application limit", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const channel = telegram({
      botToken: BOT_TOKEN,
      chatId: "123456",
      fetch,
      maxLength: 256
    });

    await expect(
      channel.deliver({ markdown: "x".repeat(257) })
    ).resolves.toEqual({
      status: "failed",
      retryable: false,
      error: {
        code: "TELEGRAM_MESSAGE_TOO_LONG",
        message: "Telegram message exceeds the configured 256-character limit"
      }
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, 4097, 1.5])(
    "rejects an invalid maximum length: %s",
    (maxLength) => {
      expect(() =>
        telegram({ botToken: BOT_TOKEN, chatId: "123456", maxLength })
      ).toThrow("maxLength must be an integer between 1 and 4096");
    }
  );

  it("classifies an explicit Telegram rate limit as retryable", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 30"
        },
        { status: 429 }
      )
    );

    await expect(
      createChannel(fetch).deliver({ markdown: "Help" })
    ).resolves.toEqual({
      status: "failed",
      retryable: true,
      error: {
        code: "TELEGRAM_API_ERROR_429",
        message: "Too Many Requests: retry after 30"
      }
    });
  });

  it("classifies an explicit invalid destination as non-retryable", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          ok: false,
          error_code: 400,
          description: "Bad Request: chat not found"
        },
        { status: 400 }
      )
    );

    await expect(
      createChannel(fetch).deliver({ markdown: "Help" })
    ).resolves.toEqual({
      status: "failed",
      retryable: false,
      error: {
        code: "TELEGRAM_API_ERROR_400",
        message: "Bad Request: chat not found"
      }
    });
  });

  it("falls through to another channel after Telegram rejects the bot token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { ok: false, error_code: 401, description: "Unauthorized" },
        { status: 401 }
      )
    );
    const email: Channel = {
      deliver: vi.fn(async () => ({
        status: "delivered" as const,
        reference: "email-1"
      }))
    };
    const channel = fallback([createChannel(fetch), email]);
    const message = { markdown: "Help" };

    await expect(channel.deliver(message)).resolves.toEqual({
      status: "delivered",
      reference: "email-1"
    });
    expect(email.deliver).toHaveBeenCalledWith(message);
  });

  it("treats an unconfirmed request as uncertain without exposing the bot token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError(
        `fetch failed for https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`
      );
    });

    const result = await createChannel(fetch).deliver({ markdown: "Help" });

    expect(result).toEqual({
      status: "uncertain",
      error: {
        code: "TELEGRAM_DELIVERY_ERROR",
        message: "Telegram delivery failed with an unknown outcome"
      }
    });
    expect(JSON.stringify(result)).not.toContain(BOT_TOKEN);
  });

  it("treats a malformed success response as uncertain", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ok: true, result: {} })
    );

    await expect(
      createChannel(fetch).deliver({ markdown: "Help" })
    ).resolves.toEqual({
      status: "uncertain",
      error: {
        code: "TELEGRAM_DELIVERY_ERROR",
        message: "Telegram returned an invalid delivery response"
      }
    });
  });
});
