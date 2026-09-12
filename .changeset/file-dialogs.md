---
'@gpuiv/native': minor
'@gpuiv/vue': minor
---

Add native file dialogs. `promptForPaths` opens the platform file-selection
panel and `promptForNewPath` the save panel; both answer asynchronously (the
dialog result arrives on the Node event loop, nothing blocks) and resolve with
`null` when the user cancels. `@gpuiv/vue` exports Promise wrappers with the
same names, and the test renderer answers from a canned queue
(`setNextPathPromptResponse` / `setNextNewPathResponse`) so app flows are
testable end-to-end. Part of the issue #49 P1 app-shell gap work.
