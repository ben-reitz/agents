import { describe, expect, it, vi } from "vitest";
import {
  BROWSER_VOICE_MESSAGE_TYPE,
  browserVoice,
  parseBrowserVoiceMessage,
  type BrowserVoiceConnection
} from "..";

describe("experimental browser voice channel", () => {
  it("sends one rendered utterance to one currently connected surface", async () => {
    const first = { id: "browser-1", send: vi.fn() };
    const second = { id: "browser-2", send: vi.fn() };
    const channel = browserVoice({
      getConnections: () => [first, second],
      toSpeechText: (message) => message.markdown.replaceAll("**", "")
    });

    const result = await channel.deliver({
      title: "Update",
      markdown: "It **works**"
    });

    expect(result).toMatchObject({ status: "delivered" });
    const reference = result.status === "delivered" ? result.reference : null;
    expect(reference).toEqual(expect.any(String));
    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).not.toHaveBeenCalled();
    expect(parseBrowserVoiceMessage(first.send.mock.calls[0]?.[0])).toEqual({
      type: BROWSER_VOICE_MESSAGE_TYPE,
      deliveryId: reference,
      message: { title: "Update", markdown: "It **works**" },
      speechText: "It works"
    });
  });

  it("looks up live connections for each availability check and delivery", async () => {
    const connection = { id: "browser-1", send: vi.fn() };
    let available: BrowserVoiceConnection[] = [];
    const channel = browserVoice({ getConnections: () => available });

    expect(await channel.isAvailable?.()).toBe(false);
    await expect(channel.deliver({ markdown: "First" })).resolves.toEqual({
      status: "failed",
      retryable: true,
      error: {
        code: "BROWSER_VOICE_UNAVAILABLE",
        message: "No browser voice surface is connected"
      }
    });

    available = [connection];
    expect(await channel.isAvailable?.()).toBe(true);
    await expect(
      channel.deliver({ markdown: "Second" })
    ).resolves.toMatchObject({ status: "delivered" });
  });

  it("classifies a connection that closes before send as safely retryable", async () => {
    const stale = {
      id: "stale",
      send: vi.fn(() => {
        throw new TypeError("WebSocket send() after close");
      })
    };
    const channel = browserVoice({ getConnections: () => [stale] });

    await expect(channel.deliver({ markdown: "Hello" })).resolves.toEqual({
      status: "failed",
      retryable: true,
      error: {
        code: "BROWSER_VOICE_CONNECTION_CLOSED",
        message: "The browser voice surface disconnected before delivery"
      }
    });
  });

  it.each([
    new Error("Unexpected transport error"),
    new Error("WebSocket send() after close")
  ])("treats unknown send errors as uncertain", async (error) => {
    const connection = {
      id: "browser-1",
      send() {
        throw error;
      }
    };
    const channel = browserVoice({ getConnections: () => [connection] });

    await expect(channel.deliver({ markdown: "Hello" })).resolves.toEqual({
      status: "uncertain",
      error: {
        code: "BROWSER_VOICE_DELIVERY_ERROR",
        message: error.message
      }
    });
  });

  it("ignores unrelated and malformed WebSocket frames", () => {
    expect(parseBrowserVoiceMessage("not json")).toBeUndefined();
    expect(
      parseBrowserVoiceMessage(JSON.stringify({ type: "rpc" }))
    ).toBeUndefined();
    expect(
      parseBrowserVoiceMessage(
        JSON.stringify({
          type: BROWSER_VOICE_MESSAGE_TYPE,
          deliveryId: "delivery-1",
          message: { markdown: 42 },
          speechText: "Hello"
        })
      )
    ).toBeUndefined();
  });
});
