import { describe, expect, it, vi } from "vitest";
import {
  createChannelTool,
  type Channel,
  type ChannelMessage,
  type DeliveryResult
} from "..";

function executable(tool: ReturnType<typeof createChannelTool>) {
  return tool.execute as unknown as (
    message: ChannelMessage
  ) => Promise<DeliveryResult>;
}

describe("experimental channels", () => {
  it("adapts a configured channel to a caller-described AI SDK tool", async () => {
    const deliver = vi.fn(
      async (): Promise<DeliveryResult> => ({
        status: "delivered",
        reference: "message-1"
      })
    );
    const channel: Channel = { deliver };

    const channelTool = createChannelTool(channel, {
      description: "Escalate to a human",
      needsApproval: true,
      metadata: { purpose: "escalation" },
      inputExamples: [{ input: { markdown: "Please **help**" } }]
    });

    expect(channelTool.description).toBe("Escalate to a human");
    expect(channelTool.needsApproval).toBe(true);
    expect(channelTool.metadata).toEqual({ purpose: "escalation" });

    await expect(
      executable(channelTool)({ title: "Urgent", markdown: "Please **help**" })
    ).resolves.toEqual({ status: "delivered", reference: "message-1" });
    expect(deliver).toHaveBeenCalledWith({
      title: "Urgent",
      markdown: "Please **help**"
    });
  });
});
