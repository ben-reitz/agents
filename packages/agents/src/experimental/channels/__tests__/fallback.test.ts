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
  it("uses the primary channel when it is available", async () => {
    const primary = channel(
      { status: "delivered", reference: "voice-1" },
      true
    );
    const secondary = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback({ primary, secondary });

    await expect(compound.deliver({ markdown: "Hello" })).resolves.toEqual({
      status: "delivered",
      reference: "voice-1"
    });
    expect(secondary.deliver).not.toHaveBeenCalled();
  });

  it("uses the secondary when the primary is unavailable before delivery", async () => {
    const primary = channel(
      {
        status: "failed",
        retryable: true,
        error: { code: "BROWSER_VOICE_UNAVAILABLE", message: "Disconnected" }
      },
      false
    );
    const secondary = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback({ primary, secondary });
    const message = { title: "Update", markdown: "Hello" };

    await expect(compound.deliver(message)).resolves.toEqual({
      status: "delivered",
      reference: "email-1"
    });
    expect(primary.deliver).not.toHaveBeenCalled();
    expect(secondary.deliver).toHaveBeenCalledWith(message);
  });

  it("does not switch transports after an available primary fails", async () => {
    const failure: DeliveryResult = {
      status: "failed",
      retryable: true,
      error: { code: "BROWSER_VOICE_CONNECTION_CLOSED", message: "Closed" }
    };
    const primary = channel(failure, true);
    const secondary = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback({ primary, secondary });

    await expect(compound.deliver({ markdown: "Hello" })).resolves.toEqual(
      failure
    );
    expect(secondary.deliver).not.toHaveBeenCalled();
  });

  it("does not inspect the secondary when the primary is available", async () => {
    const primary = channel(
      { status: "delivered", reference: "voice-1" },
      true
    );
    const secondary: Channel = {
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
    const compound = fallback({ primary, secondary });

    await expect(compound.isAvailable?.()).resolves.toBe(true);
  });

  it("attempts a primary that does not expose availability", async () => {
    const primary = channel({
      status: "uncertain",
      error: { code: "DELIVERY_ERROR", message: "Unknown outcome" }
    });
    const secondary = channel({ status: "delivered", reference: "email-1" });
    const compound = fallback({ primary, secondary });

    await compound.deliver({ markdown: "Hello" });

    expect(primary.deliver).toHaveBeenCalledOnce();
    expect(secondary.deliver).not.toHaveBeenCalled();
  });
});
