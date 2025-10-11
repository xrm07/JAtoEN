# Repository Guidelines

## Project Structure & Module Organization
Use `requirements.txt` as the authoritative spec until code lands. Workspace modules sit under `packages/`: `domain/` for core translation logic, `infra-lmstudio/` for LM Studio adapters, `infra-cache/` for IndexedDB caching, `background/` for the MV3 service worker, `ui-content/` for content overlays, `ui-popup/` for the popup UI, and `e2e/` for Puppeteer assets. Keep shared helpers in their package and expose them through the package entrypoint only when stable.

## Build, Test, and Development Commands
Install pnpm v8+, run `pnpm install`, then build with `pnpm build` (esbuild bundles background/content; Vite handles the popup). Use `pnpm dev --filter ui-popup` for live popup work and `pnpm dev --filter ui-content` when attaching to a Chromium profile. Validate changes with `pnpm test` for unit coverage and `pnpm test:e2e` against the stub LM Studio server.

## Coding Style & Naming Conventions
Write TypeScript (ES2022) with 2-space indentation, trailing commas on multiline literals, and single quotes. Use camelCase for functions/variables, PascalCase for classes and exported types, kebab-case for file names unless the file exports a React component (`PopupPanel.tsx`). Run `pnpm lint` (ESLint + TS rules) and `pnpm format` (Prettier) before committing, and scope DOM hooks with `data-xt-*` attributes to stay isolated from host pages.

## Testing Guidelines
Co-locate unit tests as `*.spec.ts` files that run on vitest; mock LM Studio through the shared separator utilities. Add integration checks in `packages/background` to prove message contracts against content-script stubs. Target ≥90% statement coverage for domain and cache code (`pnpm coverage`), and maintain Puppeteer flows under `packages/e2e/tests/` so `pnpm test:e2e` guards critical paths.

## Commit & Pull Request Guidelines
Adopt Conventional Commits (`feat:`, `fix:`, `refactor:`) with English subject lines under 72 characters; align scopes with package folders (`feat(background): queue retries`). Each PR should summarise the change, reference the matching requirement clause, and attach screenshots or recordings for UI updates. Link issues when relevant and state any LM Studio or permission impacts. Ask for review only after `pnpm lint`, `pnpm test`, and (if touched) `pnpm test:e2e` succeed.

## LM Studio & Local Configuration
Aim LM Studio at `http://localhost:1234/v1` with a placeholder key such as `lm-studio`. Document model defaults in `packages/infra-lmstudio/README.md` and mirror them in the options page. When features change cache or retry behaviour, adjust the requirements file and record any IndexedDB migration steps.
