---
"oxlint-plugin-react-doctor": patch
---

Fix `unsafe-json-in-html` false positive for `JSON.stringify().replaceAll("<", "\\u003c")`

The `unsafe-json-in-html` rule now recognizes `.replaceAll("<", "\\u003c")` as a safe escape pattern, equivalent to the already-recognized `.replace(/</g, "\\u003c")` form. This resolves false positives when developers use the more explicit `.replaceAll` method to escape less-than characters in JSON-LD or other JSON embedded in HTML/script tags.
