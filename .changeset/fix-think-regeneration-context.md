---
"agents": patch
"@cloudflare/think": patch
---

Generate Think response alternatives from the selected regeneration branch point instead of continuing the previous answer.

Preserve the branch selection through compaction and chat recovery so interrupted regenerated responses remain siblings of the previous answer.

Preserve continuation semantics when replaying a Think response after reconnect so follow-up text remains attached to the existing assistant message.
