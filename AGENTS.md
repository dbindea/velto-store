# AGENTS.md

Velto Store — Angular + Firebase business management SPA (clients, vehicles, contracts, calendar, expenses, inspections, payments, reservations, reports).

## Setup commands

- Install deps: `npm install`
- Start dev:    `npm start` (ng serve)
- Build:        `npm run build` / `npm run build:prod`
- Test:         `npm test` (ng test)
- Lint:         `npm run lint` (if configured)
- Deploy:       `npm run deploy:hosting` (ng build && firebase deploy --only hosting)

## Project layout

- `src/app/core/`      — Auth, Firebase, guards, interceptors, i18n, services, theme
- `src/app/features/`  — Feature modules: calendar, clients, contracts, dashboard, expenses, inspections, payments, reports, reservations, settings, vehicles
- `src/app/shared/`    — Reusable components, directives, models, pipes, utils
- `src/environments/`  — Environment configs (Firebase, app settings)
- `dist/`              — Build output (Firebase Hosting deployment target)

## Code style

- Angular standalone components (v20, no NgModules)
- SCSS for styles; Prettier configured with single quotes, 100-char width
- Strict TypeScript (`strict: true` in tsconfig)
- Component style: `skipTests: true` via Angular schematics
- Run Prettier before committing

## Testing instructions

- Unit tests: `ng test` (Karma + Jasmine)
- All tests must pass before opening a PR

## PR & commit conventions

- Branch from `main`; never push to it directly
- Commit message: conventional commits (`feat:` / `fix:` / `docs:` / `refactor:`)
- CI: lint + test must pass on every PR

## Security

- Never commit secrets — `.env` is in `.gitignore`
- Firebase config uses environment variables / runtime injection
- Auth state managed via Angular Fire + Firebase Auth guards