# Architecture
- Keep brewing formulas and unit conversions in a pure calculation module, separate from calculator definitions and the React view, so numerical behavior can be tested independently.
- Define calculator fields, defaults, validation limits and output labels in a typed registry so every calculator shares the same accessible form and result rendering.
- Run numerical calculator tests with `bun test src/lib/brewing.test.ts`; these tests do not depend on the browser.- Keep recipe, water, inventory, batch and report math in `src/lib/recipe-calc.ts` (pure, tested in `recipe-calc.test.ts`); the ingredient catalog and BJCP styles live in `src/lib/catalog.ts`.
- Persist recipes, batches and inventory through the hooks in `src/lib/store.ts` (browser storage with a change event) so every page stays in sync.
- Batches store a snapshot of their recipe so later recipe edits do not alter brewed history.
- Render recipe mug metrics as SVG text supplied by the recipe view, using the existing calculated stats; this keeps the artwork and displayed numbers aligned without duplicating calculation logic.
- Embed mug font data in its scoped font stylesheet, retaining CDN asset pointers as provenance, so typography also works in the offline single-file export.
- Generate the double-click standalone app with `bun run build:standalone` (vite-plugin-singlefile inlines all JS/CSS into `dist/index.html`); it uses HashRouter when `window.location.protocol === "file:"`, so `BrowserRouter` stays for the hosted app.
- Route every Gemini text request through `GeminiService.run` in `src/lib/gemini.ts`, which uses the shared `geminiLimiter` (per-minute cap, minimum gap, capped attempts per message); never add automatic retries or calls outside it, to stay under Google AI Studio RPM limits. Tests: `bun test src/lib/gemini-limits.test.ts`.
