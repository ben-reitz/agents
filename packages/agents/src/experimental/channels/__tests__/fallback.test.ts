import { describe, expect, it, vi } from "vitest";
import { fallback, type Channel, type DeliveryResult } from "..";

function channel(
  result: DeliveryResult,
  available?: boolean
): Channel & { deliver: ReturnType<typeof vi.fn> } {
  return {
    ...(available === undefined ? {} : { isAvailable: () => available }),
    deliver: vi.fn(async () => result)
  };
}

describe("experimental fallback channel", () => {
  it("uses the first channel when it is available", async () => {
    const first = channel({ status: "delivered", reference: "voice-1" }, true);
    const second = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback([first, second]);

    await expect(compound.deliver({ markdown: "Hello" })).resolves.toEqual({
      status: "delivered",
      reference: "voice-1"
    });
    expect(second.deliver).not.toHaveBeenCalled();
  });

  it("uses the next channel when earlier channels are unavailable", async () => {
    const first = channel(
      {
        status: "failed",
        retryable: true,
        error: { code: "BROWSER_VOICE_UNAVAILABLE", message: "Disconnected" }
      },
      false
    );
    const second = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback([first, second]);
    const message = { title: "Update", markdown: "Hello" };

    await expect(compound.deliver(message)).resolves.toEqual({
      status: "delivered",
      reference: "email-1"
    });
    expect(first.deliver).not.toHaveBeenCalled();
    expect(second.deliver).toHaveBeenCalledWith(message);
  });

  it("selects the first available channel from a longer sequence", async () => {
    const first = channel({ status: "delivered" }, false);
    const second = channel({ status: "delivered", reference: "push-1" }, true);
    const third = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback([first, second, third]);

    await expect(compound.deliver({ markdown: "Hello" })).resolves.toEqual({
      status: "delivered",
      reference: "push-1"
    });
    expect(first.deliver).not.toHaveBeenCalled();
    expect(third.deliver).not.toHaveBeenCalled();
  });

  it("does not switch transports after an available channel fails", async () => {
    const failure: DeliveryResult = {
      status: "failed",
      retryable: true,
      error: { code: "BROWSER_VOICE_CONNECTION_CLOSED", message: "Closed" }
    };
    const first = channel(failure, true);
    const second = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback([first, second]);

    await expect(compound.deliver({ markdown: "Hello" })).resolves.toEqual(
      failure
    );
    expect(second.deliver).not.toHaveBeenCalled();
  });

  it("does not inspect later channels when an earlier one is available", async () => {
    const first = channel({ status: "delivered", reference: "voice-1" }, true);
    const second: Channel = {
      isAvailable() {
        throw new Error("Secondary availability failed");
      },
      deliver: vi.fn(
        async (): Promise<DeliveryResult> => ({
          status: "delivered",
          reference: "email-1"
        })
      )
    };
    const compound = fallback([first, second]);

    await expect(compound.isAvailable?.()).resolves.toBe(true);
  });

  it("attempts a channel that does not expose availability", async () => {
    const first = channel({
      status: "uncertain",
      error: { code: "DELIVERY_ERROR", message: "Unknown outcome" }
    });
    const second = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback([first, second]);

    await compound.deliver({ markdown: "Hello" });

    expect(first.deliver).toHaveBeenCalledOnce();
    expect(second.deliver).not.toHaveBeenCalled();
  });
});
