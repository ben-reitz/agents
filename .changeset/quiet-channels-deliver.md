---
"agents": minor
"@cloudflare/think": minor
"@cloudflare/voice": minor
---

Add an experimental transport-neutral Channels module with canonical Markdown messages, structured approval requests, explicit delivery outcomes, AI SDK tool adaptation, Email Service and Telegram Bot API delivery, ordered fallback, and an Agent-owned Channel Host that routes approval requests and correlates normalized webhook responses. Add an output-only browser voice channel to `@cloudflare/voice` that synthesizes messages with any TTS provider and delivers encoded audio through the Voice client protocol. Let Think initialize a Channel Host from declarative configuration, mount Channel ingress internally, dynamically switch the approval route, and resolve out-of-band responses through the existing durable Actions HITL ledger.
