# Modulo: Classroom

A browser sandbox about getting away with harmless classroom mischief (three.js + TypeScript, desktop and iPad). All characters are fictional.

- Run: `npm ci && npm run dev`, open http://localhost:5173/
- Docs: [`docs/classroom/`](docs/classroom/) — `PLAN.md` (status, next steps), `SETUP.md`, `DECISIONS.md`, `RESEARCH.md`, `ENVIRONMENT.md`
- Checks: `npm run typecheck && npm run lint && npm test`, e2e `npx playwright test --trace off`, balance `npx tsx scripts/classroom-balance.ts 500`
