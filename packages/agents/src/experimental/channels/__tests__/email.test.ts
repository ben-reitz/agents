import { describe, expect, it, vi } from "vitest";
import type { EmailSendBinding } from "../../../email";
import { email } from "..";

function channelThatRejects(error: unknown) {
  const send = vi.fn(async (_message: unknown): Promise<EmailSendResult> => {
    throw error;
  });

  return email({
    binding: { send: send as EmailSendBinding["send"] },
    from: "agent@example.com",
    to: "support@example.com",
    defaultTitle: "Agent escalation"
  });
}

describe("experimental email channel", () => {
  it("sends to the configured email address and maps Markdown through the renderer", async () => {
    const send = vi.fn(async (_message: unknown) => ({
      messageId: "email-1"
    }));
    const channel = email({
      binding: { send: send as EmailSendBinding["send"] },
      from: "agent@example.com",
      to: "support@example.com",
      defaultTitle: "Agent escalation",
      renderMarkdown: (markdown) => ({
        text: markdown.replaceAll("**", ""),
        html: `<strong>${markdown.slice(2, -2)}</strong>`
      })
    });

    await expect(channel.deliver({ markdown: "**Help**" })).resolves.toEqual({
      status: "delivered",
      reference: "email-1"
    });

    expect(send).toHaveBeenCalledWith({
      from: "agent@example.com",
      to: "support@example.com",
      subject: "Agent escalation",
      text: "Help",
      html: "<strong>Help</strong>",
      replyTo: undefined,
      cc: undefined,
      bcc: undefined,
      headers: undefined
    });
  });

  it("allows a message title to override the configured email title", async () => {
    const send = vi.fn(async (_message: unknown) => ({ messageId: "email-2" }));
    const channel = email({
      binding: { send: send as EmailSendBinding["send"] },
      from: "agent@example.com",
      to: "support@example.com",
      defaultTitle: "Default"
    });

    await channel.deliver({ title: "Incident", markdown: "Details" });

    expect(send.mock.calls[0]?.[0]).toMatchObject({
      subject: "Incident",
      text: "Details"
    });
  });

  it("marks rate limits as safe to retry", async () => {
    const error = Object.assign(new Error("Slow down"), {
      code: "E_RATE_LIMIT_EXCEEDED"
    });

    await expect(
      channelThatRejects(error).deliver({ markdown: "Help" })
    ).resolves.toEqual({
      status: "failed",
      retryable: true,
      error: { code: "E_RATE_LIMIT_EXCEEDED", message: "Slow down" }
    });
  });

  it("marks permanent Email Service errors as unsafe to retry", async () => {
    const error = Object.assign(new Error("Verify the sender"), {
      code: "E_SENDER_NOT_VERIFIED"
    });

    await expect(
      channelThatRejects(error).deliver({ markdown: "Help" })
    ).resolves.toEqual({
      status: "failed",
      retryable: false,
      error: {
        code: "E_SENDER_NOT_VERIFIED",
        message: "Verify the sender"
      }
    });
  });

  it("recognizes recipient validation errors without an error code", async () => {
    await expect(
      channelThatRejects(
        new Error(
          'Email must have at least one recipient in "to", "cc", or "bcc".'
        )
      ).deliver({ markdown: "Help" })
    ).resolves.toEqual({
      status: "failed",
      retryable: false,
      error: {
        code: "E_FIELD_MISSING",
        message:
          'Email must have at least one recipient in "to", "cc", or "bcc".'
      }
    });
  });

  it("treats unknown delivery errors as uncertain to avoid duplicates", async () => {
    await expect(
      channelThatRejects(new Error("Connection closed")).deliver({
        markdown: "Help"
      })
    ).resolves.toEqual({
      status: "uncertain",
      error: {
        code: "EMAIL_DELIVERY_ERROR",
        message: "Connection closed"
      }
    });
  });
});
