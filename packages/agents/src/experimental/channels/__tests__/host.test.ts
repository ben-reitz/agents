import { describe, expect, it, vi } from "vitest";
import {
  ChannelHost,
  type Channel,
  type ChannelIngress,
  type ChannelIngressEvent
} from "..";

function ingress(
  path: string,
  events: readonly ChannelIngressEvent[]
): ChannelIngress {
  return {
    path,
    receive: vi.fn(async () => ({
      events,
      response: new Response("accepted", { status: 200 })
    }))
  };
}

function approvalChannel(options?: {
  reference?: string;
  ingress?: ChannelIngress;
}): Channel {
  return {
    ...(options?.ingress && { ingress: options.ingress }),
    deliver: vi.fn(),
    requestApproval: vi.fn(async () => ({
      status: "delivered" as const,
      reference: options?.reference ?? "42"
    }))
  };
}

describe("experimental ChannelHost", () => {
  it("routes a typed approval request to the selected Channel", async () => {
    const channel = approvalChannel();
    const host = new ChannelHost({
      channels: { telegram: channel },
      onApprovalResponse: vi.fn()
    });
    host.setApprovalRequestsChannel("telegram");

    const request = {
      title: "Approval required",
      summary: "Deploy release?",
      input: { environment: "production" }
    };
    await expect(
      host.requestApproval({ interactionId: "actpause_123", request })
    ).resolves.toEqual({
      channelId: "telegram",
      result: { status: "delivered", reference: "42" }
    });
    expect(channel.requestApproval).toHaveBeenCalledWith({
      interactionId: "actpause_123",
      request
    });
  });

  it("can clear the selected approval Channel", async () => {
    const host = new ChannelHost({
      channels: { telegram: approvalChannel() },
      onApprovalResponse: vi.fn()
    });
    host.setApprovalRequestsChannel("telegram");
    host.setApprovalRequestsChannel();

    await expect(
      host.requestApproval({
        interactionId: "actpause_123",
        request: { summary: "Deploy?", input: {} }
      })
    ).resolves.toBeUndefined();
  });

  it("rejects an unknown selected Channel", () => {
    const host = new ChannelHost({
      channels: {},
      onApprovalResponse: vi.fn()
    });

    expect(() => host.setApprovalRequestsChannel("telegram")).toThrow(
      'Unknown channel "telegram"'
    );
  });

  it("throws clearly when the selected Channel cannot request approval", async () => {
    const host = new ChannelHost({
      channels: { email: { deliver: vi.fn() } },
      onApprovalResponse: vi.fn()
    });
    host.setApprovalRequestsChannel("email");

    await expect(
      host.requestApproval({
        interactionId: "actpause_123",
        request: { summary: "Deploy?", input: {} }
      })
    ).rejects.toThrow('Channel "email" does not support approval requests');
  });

  it("does not request approval through an unavailable Channel", async () => {
    const channel = approvalChannel();
    channel.isAvailable = () => false;
    const host = new ChannelHost({
      channels: { telegram: channel },
      onApprovalResponse: vi.fn()
    });
    host.setApprovalRequestsChannel("telegram");

    await expect(
      host.requestApproval({
        interactionId: "actpause_123",
        request: { summary: "Deploy?", input: {} }
      })
    ).resolves.toEqual({
      channelId: "telegram",
      result: {
        status: "failed",
        retryable: true,
        error: {
          code: "CHANNEL_UNAVAILABLE",
          message: 'Channel "telegram" is unavailable'
        }
      }
    });
    expect(channel.requestApproval).not.toHaveBeenCalled();
  });

  it("correlates a provider reply reference and dispatches the response", async () => {
    const onApprovalResponse = vi.fn(async () => undefined);
    const channel = approvalChannel({
      ingress: ingress("/webhooks/telegram", [
        {
          type: "approval-response",
          decision: "approve",
          reference: "43",
          replyToReference: "42"
        }
      ])
    });
    const host = new ChannelHost({
      channels: { telegram: channel },
      onApprovalResponse
    });
    host.setApprovalRequestsChannel("telegram");
    await host.requestApproval({
      interactionId: "actpause_123",
      request: { summary: "Deploy?", input: {} }
    });

    const response = await host.handleRequest(
      new Request("https://example.com/webhooks/telegram", { method: "POST" })
    );

    expect(await response?.text()).toBe("accepted");
    expect(onApprovalResponse).toHaveBeenCalledWith({
      channelId: "telegram",
      interactionId: "actpause_123",
      decision: "approve"
    });
  });

  it("uses a provider-recovered interaction after Host recreation", async () => {
    const onApprovalResponse = vi.fn(async () => undefined);
    const host = new ChannelHost({
      channels: {
        telegram: approvalChannel({
          ingress: ingress("/webhooks/telegram", [
            {
              type: "approval-response",
              decision: "reject",
              reference: "44",
              interactionId: "actpause_456",
              replyToReference: "42"
            }
          ])
        })
      },
      onApprovalResponse
    });

    await host.handleRequest(
      new Request("https://example.com/webhooks/telegram", { method: "POST" })
    );

    expect(onApprovalResponse).toHaveBeenCalledWith({
      channelId: "telegram",
      interactionId: "actpause_456",
      decision: "reject"
    });
  });

  it("ignores normalized messages and uncorrelated approval responses", async () => {
    const onApprovalResponse = vi.fn();
    const host = new ChannelHost({
      channels: {
        telegram: approvalChannel({
          ingress: ingress("/webhooks/telegram", [
            { type: "message", text: "YES", reference: "1" },
            {
              type: "approval-response",
              decision: "approve",
              reference: "2"
            }
          ])
        })
      },
      onApprovalResponse
    });

    await host.handleRequest(
      new Request("https://example.com/webhooks/telegram", { method: "POST" })
    );

    expect(onApprovalResponse).not.toHaveBeenCalled();
  });

  it("suppresses sequential ingress replays", async () => {
    const onApprovalResponse = vi.fn(async () => undefined);
    const host = new ChannelHost({
      channels: {
        telegram: approvalChannel({
          ingress: ingress("/webhooks/telegram", [
            {
              type: "approval-response",
              decision: "approve",
              reference: "43",
              interactionId: "actpause_123"
            }
          ])
        })
      },
      onApprovalResponse
    });
    const request = () =>
      new Request("https://example.com/webhooks/telegram", { method: "POST" });

    await host.handleRequest(request());
    await host.handleRequest(request());

    expect(onApprovalResponse).toHaveBeenCalledOnce();
  });

  it("suppresses a concurrent ingress replay", async () => {
    let releaseResponse: (() => void) | undefined;
    const pendingResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const onApprovalResponse = vi.fn(async () => pendingResponse);
    const host = new ChannelHost({
      channels: {
        telegram: approvalChannel({
          ingress: ingress("/webhooks/telegram", [
            {
              type: "approval-response",
              decision: "approve",
              reference: "43",
              interactionId: "actpause_123"
            }
          ])
        })
      },
      onApprovalResponse
    });
    const request = () =>
      new Request("https://example.com/webhooks/telegram", { method: "POST" });

    const first = host.handleRequest(request());
    await vi.waitFor(() => expect(onApprovalResponse).toHaveBeenCalledOnce());
    const second = host.handleRequest(request());
    releaseResponse?.();
    await Promise.all([first, second]);

    expect(onApprovalResponse).toHaveBeenCalledOnce();
  });

  it("allows ingress to retry after response handling fails", async () => {
    const onApprovalResponse = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);
    const host = new ChannelHost({
      channels: {
        telegram: approvalChannel({
          ingress: ingress("/webhooks/telegram", [
            {
              type: "approval-response",
              decision: "reject",
              reference: "43",
              interactionId: "actpause_123"
            }
          ])
        })
      },
      onApprovalResponse
    });
    const request = () =>
      new Request("https://example.com/webhooks/telegram", { method: "POST" });

    await expect(host.handleRequest(request())).resolves.toMatchObject({
      status: 500
    });
    await expect(host.handleRequest(request())).resolves.toMatchObject({
      status: 200
    });
    expect(onApprovalResponse).toHaveBeenCalledTimes(2);
  });

  it("chooses the longest matching ingress path", async () => {
    const short = ingress("/telegram", []);
    const specific = ingress("/webhooks/telegram", []);
    const host = new ChannelHost({
      channels: {
        short: approvalChannel({ ingress: short }),
        specific: approvalChannel({ ingress: specific })
      },
      onApprovalResponse: vi.fn()
    });

    await host.handleRequest(
      new Request("https://example.com/webhooks/telegram", { method: "POST" })
    );

    expect(specific.receive).toHaveBeenCalledOnce();
    expect(short.receive).not.toHaveBeenCalled();
  });

  it("rejects duplicate ingress paths", () => {
    expect(
      () =>
        new ChannelHost({
          channels: {
            first: approvalChannel({
              ingress: ingress("/webhooks/telegram", [])
            }),
            second: approvalChannel({
              ingress: ingress("/webhooks/telegram", [])
            })
          },
          onApprovalResponse: vi.fn()
        })
    ).toThrow('Duplicate Channel ingress path "/webhooks/telegram"');
  });

  it("returns undefined when no Channel ingress owns the request path", async () => {
    const host = new ChannelHost({
      channels: {
        telegram: approvalChannel({
          ingress: ingress("/webhooks/telegram", [])
        })
      },
      onApprovalResponse: vi.fn()
    });

    await expect(
      host.handleRequest(new Request("https://example.com/other"))
    ).resolves.toBeUndefined();
  });
});
