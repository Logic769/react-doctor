---
"react-doctor": patch
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
---

Skip .open-next build output in security scan

The security scan now skips `.open-next/` directories (OpenNext build output) the same way it skips `.next/` and `.vercel/`, preventing false positive security findings from bundled library code.
