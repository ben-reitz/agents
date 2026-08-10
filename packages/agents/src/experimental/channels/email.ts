import type { EmailSendBinding } from "../../email";
import type { Channel, DeliveryFailure, DeliveryResult } from "./channel";

/** A text/HTML projection of canonical Markdown for an email. */
export type RenderedEmailMarkdown = {
  text?: string;
  html?: string;
};

/** Configuration for a destination-bound email channel. */
export type EmailChannelOptions = {
  binding: EmailSendBinding;
  from: EmailReplyMessageBuilder["from"];
  to: NonNullable<EmailMessageBuilder["to"]>;
  /** Subject used when a message does not provide a title. */
  defaultTitle: string;
  replyTo?: EmailReplyMessageBuilder["replyTo"];
  cc?: EmailMessageBuilder["cc"];
  bcc?: EmailMessageBuilder["bcc"];
  headers?: EmailReplyMessageBuilder["headers"];
  /**
   * Override the email representation of Markdown. By default the Markdown
   * source is sent as a readable text/plain body without adding dependencies.
   */
  renderMarkdown?: (markdown: string) => RenderedEmailMarkdown;
};

const PERMANENT_EMAIL_ERRORS = new Set([
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_TOO_MANY_ATTACHMENTS",
  "E_SENDER_NOT_VERIFIED",
  "E_RECIPIENT_NOT_ALLOWED",
  "E_RECIPIENT_SUPPRESSED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
  "E_CONTENT_TOO_LARGE",
  "E_DELIVERY_FAILED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_HEADER_NOT_ALLOWED",
  "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID",
  "E_HEADER_VALUE_TOO_LONG",
  "E_HEADER_NAME_INVALID",
  "E_HEADERS_TOO_LARGE",
  "E_HEADERS_TOO_MANY"
]);

const RETRYABLE_EMAIL_ERRORS = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR"
]);

const EMAIL_ERROR_MESSAGES = new Map<string, string>([
  [
    'Email must have at least one recipient in "to", "cc", or "bcc".',
    "E_FIELD_MISSING"
  ]
]);

function emailFailure(error: unknown): DeliveryFailure {
  if (error !== null && typeof error === "object") {
    const value = error as { code?: unknown; message?: unknown };
    return {
      code:
        typeof value.code === "string" ? value.code : "EMAIL_DELIVERY_ERROR",
      message:
        typeof value.message === "string"
          ? value.message
          : "Email delivery failed"
    };
  }

  return {
    code: "EMAIL_DELIVERY_ERROR",
    message: typeof error === "string" ? error : "Email delivery failed"
  };
}

/** Classify an Email Service binding error as a model-visible result. */
function classifyEmailDeliveryError(error: unknown): DeliveryResult {
  const failure = emailFailure(error);
  const inferredCode = EMAIL_ERROR_MESSAGES.get(failure.message);
  if (inferredCode) {
    return {
      status: "failed",
      retryable: false,
      error: { ...failure, code: inferredCode }
    };
  }

  if (RETRYABLE_EMAIL_ERRORS.has(failure.code)) {
    return { status: "failed", retryable: true, error: failure };
  }

  if (PERMANENT_EMAIL_ERRORS.has(failure.code)) {
    return { status: "failed", retryable: false, error: failure };
  }

  return { status: "uncertain", error: failure };
}

/** Create a configured outbound email route. */
export function email(options: EmailChannelOptions): Channel {
  if (!options.binding) {
    throw new Error("binding is required to create an email channel");
  }

  const renderMarkdown: (markdown: string) => RenderedEmailMarkdown =
    options.renderMarkdown ?? ((markdown: string) => ({ text: markdown }));

  return {
    async deliver(message) {
      const rendered = renderMarkdown(message.markdown);
      if (rendered.text === undefined && rendered.html === undefined) {
        throw new Error("renderMarkdown must return text or html content");
      }

      try {
        const result = await options.binding.send({
          from: options.from,
          to: options.to,
          subject: message.title ?? options.defaultTitle,
          text: rendered.text,
          html: rendered.html,
          replyTo: options.replyTo,
          cc: options.cc,
          bcc: options.bcc,
          headers: options.headers
        });

        return { status: "delivered", reference: result.messageId };
      } catch (error) {
        return classifyEmailDeliveryError(error);
      }
    }
  };
}
