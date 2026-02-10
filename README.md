# Ledger API

A minimal Express backend scaffolded with TypeScript, split into `app.ts` (Express app) and `server.ts` (process lifecycle), with fast dev reloads via `tsc-watch` and production build via `tsc`.

## Requirements
- Node.js 18+ (LTS recommended)
- npm 9+

Optional:
- PM2 or a container runtime for production

## Project structure
```
.
├── src/
│   ├── app.ts        # Express app (routes, middleware)
│   └── server.ts     # Startup script and graceful shutdown
├── dist/             # Compiled JS (generated)
├── tsconfig.json     # TypeScript configuration
├── package.json      # Scripts and dependencies
└── .gitignore        # Ignores build, env, caches, etc.
```

## Scripts
- `npm run dev` — Watch TypeScript files, rebuild on change, and start `dist/server.js` automatically.
- `npm run build` — Compile TypeScript to `dist/`.
- `npm start` — Run the compiled server from `dist/server.js`.
- `npm run typecheck` — Type-check without emitting JS.

## Quick start (development)
```bash
# install dependencies
npm install

# start in watch mode (rebuilds & restarts on change)
npm run dev
```
Then open http://localhost:3000.

## Production build and run
```bash
# compile TS to JS
npm run build

# run compiled output
npm start
```

### With PM2 (recommended for bare-metal/VPS)
Create `ecosystem.config.js` (example):
```js
module.exports = {
  apps: [
    {
      name: 'ledger-api',
      script: 'dist/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
```
Then:
```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
```

### Containerized (Docker) example
```Dockerfile
# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && cp -r node_modules /prod_node_modules

FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /prod_node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
```
Build and run:
```bash
docker build -t ledger-api .
docker run --rm -p 3000:3000 ledger-api
```

## Configuration and environment
- The app reads standard environment variables from the process, e.g. `PORT`.
- Example values:
  - `PORT=3000`
  - `NODE_ENV=production`
- Environment files like `.env` are ignored by Git (see `.gitignore`). Use your platform to inject env vars:
  - Locally: export in shell, or use a runner (pm2, docker) that loads env.
  - CI/CD: configure secrets/variables in your pipeline.

If you want the app to auto-load a `.env` file in development, add `dotenv` and load it at the very top of `src/server.ts`:
```ts
// import 'dotenv/config';
```

## Graceful shutdown
`src/server.ts` handles `SIGINT` and `SIGTERM`, waits for open connections to close, and forces exit after a timeout. This is important for safe deploys and container stops.

## Recommended hardening (next steps)
- Security middleware: `helmet`, CORS, and rate-limiting (e.g. `express-rate-limit`).
- Input validation: `zod` or `joi` for request schemas.
- Logging: structured logs with `pino` or `winston`.
- Health endpoints: add `GET /healthz` (liveness) and `GET /readyz` (readiness) returning 200 when OK.
- Observability: request IDs, metrics (Prometheus), and tracing (OpenTelemetry) as needed.
- Linting/formatting: ESLint + Prettier with TS rules, run in CI.
- Testing: Jest + `supertest` for HTTP tests.
- CI/CD: GitHub Actions workflow to run typecheck, lint, test, and build on PRs.

## Example: add a health route
In `src/app.ts`:
```ts
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

## Troubleshooting
- Port already in use: change `PORT` or stop the other process.
- Changes not reflected in dev: ensure `npm run dev` is using `tsc-watch` and that your files are under `src/`.
- ESM/CommonJS conflicts: this template uses Node16 modules with compiled output. If you prefer native ESM, we can migrate scripts accordingly.
