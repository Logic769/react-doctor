---
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
---

Add the opt-in `--scope contextual` reporting mode. Selected rules report existing findings when their owning function, JSX element, or file changes. Other rules retain line filtering. Support deletion-only edits, staged scans, untracked files, and separate result-cache entries while preserving existing scope defaults and diagnostic locations.
