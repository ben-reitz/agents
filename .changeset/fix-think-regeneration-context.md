---
"agents": patch
"@cloudflare/think": patch
---

Generate Think response alternatives from the selected regeneration branch point instead of continuing the previous answer.

Preserve the branch selection through compaction and chat recovery so interrupted regenerated responses remain siblings of the previous answer. Keep provider transcript repair from replacing the client-visible active branch with selected model history.
