# WMS mobile scan client (Expo 57)

Expo app for floor operators. **It lives inside `wms-fe` for now** (human decision, Story 1.1) and will be extracted to its own repo later. This folder is structured so the move is mechanical:

- Self-contained package: its own `package.json` (bun workspace `mobile`), `tsconfig.json`, `app.json`, entry (`index.ts`), and source (`App.tsx`, `src/`).
- No imports from the parent Next.js app — nothing in `../src` is referenced.
- The web app does not import from `mobile/` either. Extraction = move this folder, drop the `workspaces` entry in the root `package.json`, register the new repo.

## Run

```sh
bun install   # from the wms-fe root (workspace)
cd mobile
bunx expo start   # Expo Go / simulator
```

Point it at the local api with `EXPO_PUBLIC_API_BASE_URL` (defaults to `http://localhost:3000/api/v1`).