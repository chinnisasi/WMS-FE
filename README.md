# WMS-FE

WMS web dashboard — Next.js 16 App Router shell carrying the shared design-token layer (DESIGN.md), the sidebar IA skeleton, and the interaction primitives. Package manager is **bun** everywhere.

Also hosts the **mobile scan client** (Expo 57) under `mobile/` — it lives in this repo for now (Story 1.1 decision) and is structured for mechanical extraction to its own repo later. See `mobile/README.md`.

## Layout

```
src/app/            App Router: shell layout + 12 surface routes (Overview,
                    Inventory, Inbound, Outbound, Moves, Conflicts & Reviews,
                    Notifications, Replenishment, Channels, Compliance,
                    Reports / Audit, Settings)
src/components/     shell (sidebar, ⌘K palette), KPI tile, data-table primitive
src/lib/            brand tokens, cursor-pagination helper, navigation IA
src/lib/api/        GENERATED typed client from wms-be's OpenAPI doc — never
                    hand-edit; never hand-write API types (AD-8)
mobile/             Expo 57 scan client (own package.json; extraction-ready)
```

## Commands

```sh
bun install
bun run dev           # web on :3001 (api defaults to :3000)
bun run build         # next build
bun run start         # next start
bun run lint          # eslint
bun run test          # bun test (token/IA/cursor suites)
bun run typecheck     # tsc --noEmit
bun run api:generate  # regenerate src/lib/api from wms-be openapi/openapi.json
cd mobile && bunx expo start   # Expo Go / simulator
```

## Design-token layer

Authoritative source: DESIGN.md (`_bmad-output/planning-artifacts/ux-designs/ux-WMS-Meta-2026-09-08/`). Brand delta on shadcn defaults — primary `#1E4E8C`, accent green `#16794C`, warning amber `#B45309`, each with dark-mode foreground pairs (white on dark fills is forbidden). Radius scale 4/6/8px. `kpi` = 28px semibold tabular numerals. Tests in `src/lib/brand-tokens.test.ts` pin all of this — a second brand hue or drifted token fails CI.

Interaction contract: ⌘K palette (Esc closes, Enter commits, arrows select), Esc closes the topmost layer, permissions hide surfaces (no "blocked" screens). Banned: infinite scroll, hover-only touch affordances, modal stacks > 1 deep, celebratory animation, badge-count spam.

## API contract (AD-8)

- Consumes wms-be at `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3000/api/v1`).
- Typed client is generated from wms-be's OpenAPI document: change the backend → `bun run openapi:export` there → `bun run api:generate` here → commit the regenerated `src/lib/api/generated/`.
- There are no hand-written API types in this repo.

## Environment

Copy `.env.example` → `.env.local`: `NEXT_PUBLIC_API_BASE_URL`.
