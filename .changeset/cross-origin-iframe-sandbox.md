---
"oxlint-plugin-react-doctor": patch
---

Fix `iframe-missing-sandbox` false positive for cross-origin iframes that combine `allow-scripts` and `allow-same-origin`

A cross-origin document cannot reach `window.parent` to strip its own `sandbox` attribute, so the banned pair is only a self-escape risk when the framed page shares the embedder's origin. The rule now suppresses the invalid-combination report when the iframe's `src` resolves to an absolute (cross-origin) URL, while still flagging same-origin, relative, and dynamic sources.
