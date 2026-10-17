---
"oxlint-plugin-react-doctor": patch
"eslint-plugin-react-doctor": patch
"react-doctor": patch
---

Avoid recommending structuredClone inside a directly installed implementation of the same global API, including a narrowly recognized Jest mock implementation. Ordinary application cloning and unsupported provider or binding shapes remain reportable.
