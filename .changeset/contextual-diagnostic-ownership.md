---
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
"react-doctor": patch
---

Let rules declare the code that owns a finding separately from its diagnostic location. With `--scope contextual`, `exhaustive-deps` now reports existing dependency findings when their hook call or resolved local callback changes. Ownership survives lint-cache replay and stays out of public JSON reports and score requests.

Add JSX element scope for `alt-text` and `click-events-have-key-events`, and function scope for `rules-of-hooks`. Existing scan defaults and other scopes are unchanged.
