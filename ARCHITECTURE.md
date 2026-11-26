# JourneyPaper: Architecture and Roadmap

> Status: the front-end in `web/` is built and split into modules (sections 2, 5, 6). The backend (sections 7 to 12) is planned, not built.
> Audience: the project owner (Nara) and any coding agent working in this repo.
> Language: English. Keep it that way so humans and agents read the same text.

---

## 0. How to read this document

- **Humans**: read sections 1 to 4 for the big picture, section 13 for the order of work.
- **Coding agents**: read everything, then follow section 14 (rules) and section 13 (roadmap) one phase at a time. Do not jump ahead of the current phase.
- Words like MUST, SHOULD, MAY are used in the RFC 2119 sense.
- Anything marked `TODO(decision)` is an open choice. Do not guess it. Ask the owner or follow the default written next to it.

---

## 1. What this product is

JourneyPaper is a personal paper-reading journal. A user keeps a catalog of research papers. Each paper has a cover image, metadata, a short TL;DR, and a Notion-like document divided into five standard sections: **Introduction, Related Work, Method, Experiment Results, Conclusion**. The document supports text, headings, lists, quotes, callouts, code, LaTeX equations, images with captions, and dividers.

The user can search by keyword, title, tag, author, or a fragment of text they remember from their own notes.

Later, the system will fetch the paper, format it into the five sections, and write a short AI summary.

### Goals

1. Works well for one person today.
2. Supports a small group (target: **5 users**) without a rewrite.
3. Every user's data is private by default.
4. Simple enough to run and debug alone. Few moving parts.
5. Clear enough that an AI coding agent can extend it without breaking the structure.

### Non-goals (for now)

- Public sign-up, billing, or teams and organizations.
- Real-time collaborative editing.
- Mobile native apps.
- Microservices, Kubernetes, message brokers, or a separate search cluster.
- Sharing papers between users (planned as a later phase, see section 13).

---

## 2. Current state (what exists today)

A static front-end with no backend, in `web/`. Plain HTML, CSS, and native ES modules: no framework, no bundler, no npm packages. Serve it with `make web` and open `http://localhost:8000` (modules do not load from `file://`).

| Path | Role |
|---|---|
| `web/index.html` | Page structure, dialogs, stylesheet links, one `<script type="module" src="js/main.js">` |
| `web/css/*.css` | `tokens` (theme variables), `base`, `layout`, `catalog`, `dialogs`, `paper`, `editor`, `responsive` (loads last, holds the `@media` rules) |
| `web/js/main.js` | Start-up: calls every `init*()`, then `Store.init`, loads papers, renders, routes |
| `web/js/config.js`, `util.js` | Constants (storage names, limits) and small helpers (`$`, `esc`, `norm`, `Prefs`) |
| `web/js/data/` | `store.js` (IndexedDB, the only storage code), `paper.js` (record shape, cleanup, derived values), `seed.js` (sample papers) |
| `web/js/services/` | `search.js` (query parsing, typo-tolerant scoring, sort, highlight), `ai.js` (enrichment stub) |
| `web/js/editor/` | `editor.js` (`createEditor`, the block editor), `blocks.js` (block types and validation), `sanitize.js` (HTML and URL cleaning), `image.js` (compression) |
| `web/js/ui/` | One module per screen or widget: `catalog`, `paper-page`, `paper-form`, `data-dialog`, `dialog`, `toast`, `theme`, `cover`, `icons`, `shortcuts`, `state` |

Key facts an agent must know:

- Storage is behind the `Store` object in `web/js/data/store.js`. It uses IndexedDB (db `jurnal-paper`, an older name kept on purpose because renaming it would hide saved data; object store `papers`, reserved record `__meta__`). It migrates an older `localStorage` key `jp:papers:v1`. **This `Store` is the seam where the backend plugs in.**
- IndexedDB is per origin. Data saved while the page was opened from `file://` does not appear at `http://localhost:8000`. Move it with Data -> Copy on the old page (the pre-split app is kept in `legacy/` for this), then paste into Data and press Import on the new one. Delete `legacy/` once the data is moved.
- `AI.enrich(paper)` in `web/js/services/ai.js` is a stub that returns `null`. It is the planned seam for AI enrichment. It may return `{authors, year, venue, tags, summary, content}`.
- Theme tokens live on `:root`, with `[data-theme="dark"]` and a `prefers-color-scheme` fallback. Theme is saved in `localStorage` key `jp:theme`, grid or list view in `jp:view`.
- Routing is hash based. `#paper-<id>` opens a paper page, anything else shows the catalog.
- Search is client side: weighted fields, diacritic-insensitive, small typo tolerance (Levenshtein), phrases in quotes, `#tag` filters, AND semantics.
- Autosave is debounced at 800 ms (`AUTOSAVE_MS`). It also flushes on back, on visibility change, and on page hide.
- Images are compressed in the browser (content images max 1400 px, JPEG quality 0.86; covers max 900 px) and currently stored as **data URLs inside the paper record**. This is the main thing that must change.
- Equations render with KaTeX 0.16.9 from a CDN using MathML output, with raw LaTeX as fallback.

### Current paper record

```json
{
  "id": "string",
  "title": "string",
  "image": "data URL or URL or null",
  "link": "string",
  "authors": "string",
  "year": "2017",
  "venue": "string",
  "tags": ["string"],
  "status": "want | reading | done",
  "rating": 0,
  "summary": "short TL;DR shown on the card",
  "content": [ /* blocks, see section 7 */ ],
  "sample": false,
  "createdAt": 0,
  "updatedAt": 0
}
```

### Current store interface (must stay stable)

`init`, `list`, `create`, `update`, `remove`, `restore`, `removeWhere`, `merge`, `clear`.

The front-end calls only these. The backend phase replaces their implementation, not their callers.

---

## 3. Target architecture in one picture

```
 Browser (static front-end, same UI)
    |
    |  HTTPS, JSON, Authorization: Bearer <JWT>
    v
 +-----------------------------+        +---------------------------+
 |  API service (FastAPI)      |        |  Object storage (S3 API)  |
 |  routes -> services -> repos|------->|  images, covers, PDFs     |
 +--------------+--------------+        +---------------------------+
                |
                v
 +-----------------------------+        +---------------------------+
 |  Postgres                   |<-------|  Worker (same codebase)   |
 |  users, papers, assets,     |        |  GitHub Actions job:      |
 |  jobs, ai_usage             |        |  drains `jobs`, exits     |
 +-----------------------------+        +-------------+-------------+
                                                      |
                                                      v
                                    LLM provider (Claude Code CLI or API)
 Auth provider (Supabase Auth or similar) issues JWTs. The API only verifies them.
```

Style: **modular monolith**. One repository, one codebase, run in two modes: `api` (a container on Cloud Run that scales to zero) and `worker` (a GitHub Actions job that runs, drains the queue, and exits). One database. No other infrastructure, and nothing runs while nobody is using the app.

Why not microservices: with 5 users the cost is operations and debugging pain, with no benefit. The layering in section 6 keeps the code separable if it ever needs splitting.

---

## 4. Technology decisions

| Area | Decision | Reason | Alternatives considered |
|---|---|---|---|
| Backend language | Python 3.12 | Owner knows it, best ecosystem for PDF parsing and AI work | Node/TypeScript |
| Web framework | FastAPI | Typed, OpenAPI for free, easy for agents to read | Django, Flask |
| Validation | Pydantic v2 | Same models drive API schema and AI output validation | dataclasses |
| DB | PostgreSQL 16 | JSONB for documents, full text search, row level security | SQLite (too limited for multi-user and RLS) |
| ORM / queries | SQLAlchemy 2.x (typed) + Alembic migrations | Standard, migrations are mandatory | raw SQL, SQLModel |
| Job queue | A `jobs` table in Postgres, `FOR UPDATE SKIP LOCKED` | No Redis needed at this scale | Redis + RQ/Arq, Celery |
| Object storage | Cloudflare R2 (S3 API; MinIO locally) | Keeps images out of the DB; 10 GB free and no egress fees | Supabase Storage (1 GB free), local disk |
| Auth | Managed provider (default: Supabase Auth) issuing JWTs | Do not hand-roll password handling | Clerk, Auth.js, own sessions |
| Front-end | Static HTML/CSS + native ES modules, no build step | The UI already works; modules give one job per file without tooling | Classic scripts (hidden load order), Vite + framework later |
| LLM | Provider interface (`LLM_PROVIDER`). Default `claude_code`: the Claude Code CLI (`claude -p`) in GitHub Actions, signed in with the owner's subscription (`CLAUDE_CODE_OAUTH_TOKEN`). Used for the owner's papers only; other users need the `anthropic` API-key provider or get no enrichment | Free for a personal study project; nothing in the API holds an LLM key | Anthropic API key (paid per token), other providers behind the same interface |
| Search | Postgres full text (`tsvector`) + `pg_trgm` | Replaces client-side search once data is server side | Meilisearch, Elasticsearch (overkill) |
| Hosting | Cloudflare Pages (`web/`), Google Cloud Run (API, scales to zero), Supabase Free (Postgres + Auth), Cloudflare R2 (files), GitHub Actions (AI worker, backups, keep-alive) | All free tiers; no server runs while nobody uses the app | Fly.io or Railway (no lasting free tier), single VPS with docker compose (Hetzner), see section 12 |

Hosting was decided on 2026-11-23 (decision log #8).

---

## 5. Repository layout

`web/`, `scripts/`, `tests/web/` and `Makefile` exist today. `server/`, `.github/workflows/` and the rest are the target.

```
JourneyPaper/
  ARCHITECTURE.md              <- this file
  README.md                    <- how to run and test
  AGENTS.md                    <- short pointer to this file plus commands (create in phase 1)
  Makefile                     <- make web | check | test
  scripts/check-web.mjs        <- static checks for web/ (no dependencies)
  tests/web/                   <- node --test unit tests for DOM-free modules, plus a boot test
  web/                         <- static front-end, deployed as-is to Cloudflare Pages
    index.html
    css/                       <- tokens, base, layout, catalog, dialogs, paper, editor, responsive
    js/
      main.js                  <- start-up wiring only
      config.js                <- constants; API base URL and auth config join here in phase 4
      util.js
      data/                    <- store.js (IndexedDB), paper.js, seed.js; api-store.js in phase 4
      services/                <- search.js, ai.js
      editor/                  <- editor.js, blocks.js, sanitize.js, image.js
      ui/                      <- one module per screen or widget
    tests/smoke.html           <- in-browser smoke checks (open at /tests/smoke.html)
  server/
    pyproject.toml
    alembic.ini
    migrations/                <- Alembic versions
    app/
      main.py                  <- FastAPI app factory
      config.py                <- settings from env (pydantic-settings)
      deps.py                  <- dependency injection: db session, current user
      api/                     <- LAYER 1: routes only
        papers.py
        assets.py
        search.py
        me.py
        health.py
      services/                <- LAYER 2: business logic
        papers.py
        assets.py
        enrichment.py
        quota.py
      repos/                   <- LAYER 3: the only code that touches the DB
        papers.py
        assets.py
        jobs.py
        usage.py
      models/                  <- SQLAlchemy tables
      schemas/                 <- Pydantic request/response models, block schema
      blocks/                  <- block validation, sanitizer, markdown <-> blocks
      ai/
        provider.py            <- interface; claude_code (CLI) and anthropic (API key) implementations
        pipeline.py            <- fetch, parse, summarize, validate
        prompts/               <- prompt templates as files
      storage/                 <- S3 client wrapper, presigned URLs
      worker/
        runner.py              <- drains queued jobs, then exits (run by GitHub Actions)
    tests/
      unit/
      integration/
  .github/workflows/
    enrich.yml                 <- AI worker: cron every 30 min + manual dispatch
    maintenance.yml            <- daily keep-alive ping, nightly pg_dump to R2, orphan asset cleanup
    deploy.yml                 <- build and deploy the API image to Cloud Run
  docker-compose.yml           <- local Postgres + MinIO
  .env.example
```

---

## 6. Layering rules (the most important section for agents)

Three layers. Dependencies point **downward only**.

1. **`api/` (routes)**: parse the request, call one service function, shape the response. No business rules, no SQL.
2. **`services/`**: business logic, permission checks, quota checks, orchestration. Receives `user_id` explicitly. Never imports FastAPI types.
3. **`repos/`**: the only place that builds queries. **Every query on a user-owned table MUST filter by `user_id`.** A repo function without a `user_id` parameter for such a table is a bug.

Other rules:

- `ai/` and `storage/` are adapters behind small interfaces so they can be faked in tests.
- Pydantic models in `schemas/` are the contract. Never return ORM objects from routes.
- No business logic in the front-end beyond display and editing.
- Configuration comes from environment variables only. No secrets in the repo.

### Front-end layering (`web/js/`)

The same idea applies in the browser. Imports point downward only:

`ui/` -> `services/` -> `data/` -> `editor/blocks.js`, `editor/sanitize.js` -> `util.js`, `config.js`

- `data/store.js` is the only file that touches IndexedDB. In phase 4 `data/api-store.js` exports the same `Store` interface over HTTP, and `main.js` picks one. Nothing else changes.
- `services/` and `data/` never touch the DOM, except `sanitize.js`, which uses a detached `<template>`. They are unit-tested in Node.
- `ui/` modules export `init*()` functions and do nothing when imported. `main.js` calls them in order. This keeps import cycles between ui modules safe.
- `make check` enforces these rules (layering, the single IndexedDB file, no import-time work in `ui/`, imports resolve, no undeclared names, stylesheet order).

---

## 7. Data model

### 7.1 Tables

```sql
-- Users are created lazily on first valid login. id equals the auth provider's subject (uuid).
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  display_name  text,
  role          text NOT NULL DEFAULT 'member',   -- 'admin' | 'member'
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (            -- invite-only sign-up
  email         text PRIMARY KEY,
  invited_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz
);

CREATE TABLE papers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  link          text,
  authors       text,
  year          int,                               -- client keeps a string; the API converts, '' becomes NULL
  venue         text,
  tags          text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'want' CHECK (status IN ('want','reading','done')),
  rating        smallint NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  summary       text NOT NULL DEFAULT '',          -- short TL;DR
  cover_asset_id uuid,                             -- FK to assets, set after assets exists
  content       jsonb NOT NULL DEFAULT '[]',       -- array of blocks (7.2)
  body_text     text NOT NULL DEFAULT '',          -- derived plain text of content, for search
  sections_filled smallint NOT NULL DEFAULT 0,     -- bitmask of the 5 sections (7.3), derived on write; lets cards skip content
  ai_status     text NOT NULL DEFAULT 'none'
                CHECK (ai_status IN ('none','queued','running','done','failed')),
  ai_error      text,
  is_sample     boolean NOT NULL DEFAULT false,
  revision      int NOT NULL DEFAULT 1,            -- optimistic concurrency
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,                       -- soft delete (supports undo)
  search_tsv    tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(tags,' '),'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(authors,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(venue,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(summary,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(body_text,'')), 'C')
  ) STORED
);
CREATE INDEX papers_user_idx   ON papers (user_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX papers_tsv_idx    ON papers USING gin (search_tsv);
CREATE INDEX papers_title_trgm ON papers USING gin (title gin_trgm_ops);
CREATE INDEX papers_tags_idx   ON papers USING gin (tags);

CREATE TABLE assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id      uuid REFERENCES papers(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('cover','image','pdf')),
  object_key    text NOT NULL UNIQUE,              -- e.g. u/<user_id>/<asset_id>.jpg
  mime          text NOT NULL,
  bytes         int NOT NULL,
  width         int,
  height        int,
  thumb_key     text,                              -- ~400 px WebP for cards (covers only)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id      uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  type          text NOT NULL,                     -- 'enrich_paper'
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed')),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_pick_idx ON jobs (run_after) WHERE status = 'queued';

CREATE TABLE ai_usage (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id      uuid REFERENCES papers(id) ON DELETE SET NULL,
  model         text NOT NULL,
  input_tokens  int NOT NULL,
  output_tokens int NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_user_month ON ai_usage (user_id, created_at);
```

Notes:

- The `search_tsv` column uses the `simple` configuration on purpose. The owner writes in mixed Indonesian and English, so no single language stemmer fits. Typo tolerance comes from `pg_trgm` on title and tags.
- `body_text` is **derived** from `content` on every write by the service layer. Clients never send it.
- The five standard section headings are excluded from `body_text` so searching "method" does not match every paper. This mirrors current client behavior.
- Hard delete happens only through a purge job after 30 days, or the explicit "delete account" flow.

### 7.2 Block model (document content)

`content` is an ordered array. Each block:

```json
{ "id": "b_k3j2h1", "type": "p", "text": "inline <b>html</b>" }
```

| `type` | Fields | Notes |
|---|---|---|
| `p`, `h2`, `h3`, `ul`, `ol`, `quote`, `callout` | `text` | `text` is sanitized inline HTML. Allowed tags: `b`, `i`, `code`, `a`, `br`. Nothing else, no attributes except `href` on `a`. |
| `code` | `text` | Plain text, no HTML. |
| `equation` | `tex` | LaTeX source. Rendered on the client with KaTeX. |
| `image` | `asset_id`, `caption`, `w` | `w` is `s`, `m`, or `l` (default `l`). `caption` max 300 characters. **`asset_id` replaces the current `src` data URL.** |
| `divider` | none | |

Rules:

- Sanitization MUST run on the server too, using the same allow-list as `cleanInline` in `web/js/editor/sanitize.js`. Never trust the client. `b`/`strong` become `b`, `i`/`em` become `i`; an `a` keeps only an http(s) `href` and always gets `target="_blank" rel="noopener noreferrer"`; an `a` with any other `href` is unwrapped to its text.
- Block `id` is a string of `[A-Za-z0-9_-]`, max 40 characters. A duplicate id is replaced, not rejected.
- `ul` and `ol` items are one block per item, as in the current editor.
- The client turns an unknown block type into `p` so old data still loads. The API rejects unknown types with 422.
- Max sizes, the same on client and server: 600 blocks per paper, 20,000 characters per `code` block, 4,000 per `equation`, 20,000 per text block (server only for now), 2 MB total JSON per paper.

### 7.3 Section convention

The five standard sections are `h2` blocks with these exact titles: `Introduction`, `Related Work`, `Method`, `Experiment Results`, `Conclusion`. A section is "filled" when it has non-empty content after its heading and before the next `h2`. The card progress bars and the AI pipeline both rely on this. Users may rename or delete them, so code MUST NOT assume they exist.

---

## 8. API contract (v1)

Base path `/api/v1`. JSON only. All routes except `/health` require `Authorization: Bearer <JWT>`. Errors use a single shape:

```json
{ "error": { "code": "not_found", "message": "Paper not found" } }
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check, no auth |
| GET | `/me` | Current user, quota usage this month |
| GET | `/papers` | List. Query: `status`, `tag`, `sort`, `limit`, `cursor`. Returns cards: no `content`, no `body_text`; includes `sections_filled` and the cover thumbnail |
| POST | `/papers` | Create. Body: title plus optional fields. `enrich: true` queues AI |
| GET | `/papers/{id}` | Full paper with `content` and `revision` |
| PATCH | `/papers/{id}` | Partial update. Requires header `If-Match: <revision>`. 409 on mismatch |
| DELETE | `/papers/{id}` | Soft delete |
| POST | `/papers/{id}/restore` | Undo soft delete |
| POST | `/papers/{id}/enrich` | Queue AI enrichment (checks quota). Returns the job |
| GET | `/papers/{id}/enrich` | Poll AI status (`ai_status`, `ai_error`) |
| GET | `/search?q=...` | Server side search, returns cards with a snippet and match source |
| POST | `/assets` | Request an upload. Body: `kind`, `mime`, `bytes`, `paper_id`. Returns `asset_id` and a presigned PUT URL |
| POST | `/assets/{id}/complete` | Confirm the upload finished. Server verifies size and type |
| GET | `/assets/{id}` | Returns a short-lived signed GET URL (or 302 to it) |
| GET | `/export` | Full JSON export of the user's data (replaces the Data dialog's copy) |
| POST | `/import` | Import a previous export or a local IndexedDB export |

### Mapping from the current `Store` interface

| `Store` method | Backend call |
|---|---|
| `init` | `GET /me`, then `GET /papers` |
| `list` | `GET /papers` |
| `create` | `POST /papers` |
| `update` | `PATCH /papers/{id}` with `If-Match` |
| `remove` | `DELETE /papers/{id}` |
| `restore` | `POST /papers/{id}/restore` |
| `merge` | `POST /import` |
| `removeWhere`, `clear` | Removed. Replaced by a server side "delete sample data" action and the account delete flow |

### Concurrency

Autosave sends the revision it last saw. If the server revision is newer (another tab or device), respond `409` with the current paper. The front-end shows a small "updated elsewhere, reload?" prompt. No silent overwrites.

### Pagination

Cursor based on `(updated_at, id)`. Default limit 50. Catalog cards never include `content`.

---

## 9. Authentication and multi-tenancy

### Authentication

- Default provider: **Supabase Auth** (email magic link or email plus password, optionally Google).
- The browser signs in with the provider's JS client and receives a JWT.
- The API verifies the JWT signature against the provider's JWKS, checks `exp` and `aud`, and reads `sub` as `user_id`.
- On first valid request, the API creates the `users` row **only if the email exists in `invites`** (or the user is the first admin). Otherwise respond `403 not_invited`.
- Sign-up is **invite-only**. Admins add emails to `invites`.
- The API never sees or stores passwords.
- `TODO(decision)`: if the provider changes to self-hosted sessions, only `deps.py` (current user) changes. Keep all auth logic in that file.
- Tokens from anonymous sign-ins (`is_anonymous`) are refused. If the JWKS cannot be fetched the API answers `503 auth_unavailable`, not 401, so clients keep their session and retry.
- **A deleted and re-created Supabase user** gets a new `sub` with the old email. `journey.users.email` is unique, so the API answers `409 account_conflict` instead of making a second row. To move the papers, the admin runs one transaction as the owner role: change the old row's email (for example append `.old`), insert the new id with the email, `UPDATE journey.papers SET user_id = '<new>' WHERE user_id = '<old>'`, then delete the old user row.

### Multi-tenancy (data isolation)

Defense in depth, two layers:

1. **Application layer (primary)**: every repo function takes `user_id` and filters on it. Cross-user reads return 404, not 403, to avoid leaking existence.
2. **Database layer (backstop)**: enable Row Level Security on `papers`, `assets`, `jobs`, `ai_usage`. Policy `own_rows`, for `journey_app` only: `user_id = NULLIF(current_setting('app.user_id', true), '')::uuid` (a pooled session that once set it reads `''`, which means no user). Visitors' reads run as `journey_public`, whose `public_read` policy shows only public, live, non-sample rows. The API sets it per transaction with `SET LOCAL app.user_id = '<uuid>'`. The app connects with a non-owner role, and tables use `FORCE ROW LEVEL SECURITY` so owners cannot bypass it by accident. The worker sets the same variable from the job's `user_id`.

Required test: a user A token requesting user B's paper id gets 404 for every route that takes an id.

### Authorization

Only two roles. `admin` can manage invites and see usage. `member` can only access own data. No other permissions until sharing exists.

---

## 10. Assets (images, covers, PDFs)

Flow for an editor image:

1. Browser compresses the image (`compressImage` in `web/js/editor/image.js`). From phase 3 it outputs WebP (quality 0.82, max 1400 px; covers max 900 px), falling back to JPEG where the browser cannot encode WebP. For a cover it also makes a ~400 px WebP thumbnail, uploaded as a second object, so the catalog never downloads full covers.
2. `POST /assets` with `kind`, `mime`, `bytes`. The server checks the type allow-list (`image/jpeg`, `image/png`, `image/webp`), the size limit (default 4 MB), and the user's storage cap.
3. Server returns `asset_id` and a presigned PUT URL (valid 5 minutes).
4. Browser uploads directly to object storage.
5. Browser calls `POST /assets/{id}/complete`. Server `HEAD`s the object and verifies size and type.
6. The image block stores `asset_id`. It never stores a URL, because URLs expire.
7. On read, the client resolves `asset_id` through `GET /assets/{id}` (signed GET URL, 1 hour) and caches it in memory.

Object key format: `u/<user_id>/<asset_id>.<ext>`. Buckets are private.

Orphan cleanup: the daily `maintenance.yml` workflow deletes assets that are not referenced by any paper's `content` or `cover_asset_id` and are older than 24 hours. It also deletes objects for papers soft-deleted more than 30 days ago.

PDFs are **not stored** by default. The worker downloads, extracts text, and discards the file. The paper's `link` is the record of where it came from. This keeps R2 use to images only.

Per-user storage cap: 500 MB (decided). `services/assets.py` sums `assets.bytes` before issuing an upload URL.

Why it fits the free tiers: with WebP and thumbnails a paper with 5 figures is about 1 MB, so 10 GB of R2 holds roughly 10,000 papers. R2 has no egress fees, so reads cost nothing.

---

## 11. AI enrichment pipeline

Replaces the `AI.enrich` stub. Runs in the worker, never inside a web request.

### Trigger

- On `POST /papers` with `enrich: true`, or `POST /papers/{id}/enrich`.
- The service checks quota, sets `ai_status = 'queued'`, inserts a `jobs` row.

### Job loop

The worker runs in GitHub Actions (`enrich.yml`), not as an always-on process. The workflow runs every 30 minutes and on manual dispatch. The API can also trigger it right away with a `repository_dispatch` call when a job is queued (optional; needs a fine-grained GitHub token in the API's env). Each run takes jobs one by one until none is left, then exits. Typical latency is a few minutes; the cost is zero.

```sql
-- worker picks one job
UPDATE jobs SET status='running', locked_at=now(), attempts=attempts+1, updated_at=now()
WHERE id = (
  SELECT id FROM jobs
  WHERE status='queued' AND run_after <= now()
  ORDER BY run_after
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

- On success: `status='done'`.
- On failure: if `attempts < max_attempts`, set `status='queued'` and `run_after = now() + backoff` (1 min, 5 min, 30 min). Otherwise `failed`, and write `papers.ai_status='failed'` plus a short `ai_error`.
- Stuck jobs: a job `running` with `locked_at` older than 10 minutes is reset to `queued`. Each run does this before it starts taking jobs, and the workflow has a 20 minute timeout.
- Jobs MUST be idempotent. Running one twice must not duplicate content.

### Pipeline steps (`ai/pipeline.py`)

1. **Resolve source**: from `link` or title. Support arXiv URLs and IDs first. Direct PDF URLs second. DOI later. If nothing resolves, finish with `failed: source_not_found`.
2. **Fetch PDF** with a size limit (30 MB) and a timeout. Keep it only in memory or a temp file for this job (see section 10).
3. **Extract text** with PyMuPDF. Keep page boundaries. GROBID is an optional later upgrade for better section and reference parsing.
4. **Prompt the model** with the extracted text (chunked if long) and ask for strict JSON matching the schema below.
5. **Validate** with Pydantic. On validation failure, retry once with the error message appended. Then fail.
6. **Convert** section markdown to blocks using `blocks/` (headings, lists, equations as `$$...$$` becoming `equation` blocks).
7. **Write** the result using the rules below.
8. **Record usage** in `ai_usage`.

### Model output schema

```json
{
  "authors": "string",
  "year": 2017,
  "venue": "string",
  "tags": ["string"],
  "summary": "2 to 3 sentence TL;DR",
  "sections": {
    "introduction": "markdown",
    "related_work": "markdown",
    "method": "markdown",
    "experiment_results": "markdown",
    "conclusion": "markdown"
  }
}
```

### Write rules (protect the user's own writing)

- AI MUST NOT overwrite user-written content. It fills only sections that are empty.
- If a section already has content, the AI result for that section is dropped (decided).
- Metadata fields (`authors`, `year`, `venue`, `summary`) are filled only if currently empty.
- Every AI-written block gets `"ai": true` so the UI can show a small marker and the user can accept or clear it. The sanitizer allows this extra boolean on any block type.
- Writing bumps `revision`. If the user edited the paper while the job ran, the write is merged per section, not as a whole-document replace.

### Prompt handling

- Prompts live as files in `ai/prompts/`, versioned in git.
- Paper text is untrusted input. The prompt MUST state that text inside the paper is data, not instructions.
- The model name comes from the `LLM_MODEL` env var. Never hard-code it.

### Providers (`ai/provider.py`)

One interface: `complete(prompt: str, schema: dict) -> dict`. Two implementations, picked by `LLM_PROVIDER`:

- `claude_code` (default): runs `claude -p --output-format json --model "$LLM_MODEL"` inside the GitHub Actions job, signed in with `CLAUDE_CODE_OAUTH_TOKEN` (made once with `claude setup-token`, stored only as a GitHub repository secret). This uses the owner's Claude subscription limits instead of paid API tokens. It is for the owner's own papers in a personal study project; jobs for other users are skipped with `failed: provider_not_allowed` unless their `user_id` is in `AI_ALLOWED_USERS`.
- `anthropic`: the Anthropic API with `LLM_API_KEY`, paid per token. Use it if the app is opened to other people.

Tests use a fake provider. No test calls a real model.
- Output is parsed as JSON only. Never evaluate or render model output as HTML. It passes through the same sanitizer as user input.

### Quota

- Default: 30 enrichments per user per calendar month, plus a token ceiling per job.
- `services/quota.py` is the only place that decides. It reads `ai_usage`.
- `GET /me` returns `{used, limit, resets_at}`. The UI shows it near the enrich button.
- The numbers are decided. Admin may override per user later.

---

## 12. Deployment and operations

### Local development

`docker-compose.yml` runs Postgres 16 and MinIO. The API runs with `uvicorn --reload`. The front-end is served with `make web` (port 8000). `make check` and `make test` cover the front-end today (Node 20+). A `.env.example` lists every variable.

### Environment variables (minimum)

```
DATABASE_URL=
AUTH_JWKS_URL=
AUTH_AUDIENCE=
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
LLM_PROVIDER=claude_code        # or anthropic
LLM_MODEL=
LLM_API_KEY=                    # anthropic provider only
AI_ALLOWED_USERS=               # user ids the claude_code provider may run for (the owner)
ALLOWED_ORIGINS=
AI_MONTHLY_LIMIT=30
MAX_UPLOAD_BYTES=4194304
STORAGE_CAP_BYTES=524288000
```

GitHub repository secrets (never in `.env`): `CLAUDE_CODE_OAUTH_TOKEN`, `DATABASE_URL`, `S3_*` for the backup and cleanup jobs, and the Cloud Run deploy credentials (use Workload Identity Federation, not a key file).

### Production (decided)

| Piece | Where | Free-tier limit to watch |
|---|---|---|
| Front-end | Cloudflare Pages, deployed from `web/` on push to `main` | Unlimited static requests |
| API | Google Cloud Run, min instances 0, max 2, 512 MB | 2M requests/month; first request after idle has a 1 to 3 s cold start |
| Postgres + Auth | Supabase Free | 500 MB database; **project pauses after 7 days with no activity** |
| Files and backups | Cloudflare R2 | 10 GB storage, no egress fees |
| AI worker, backups, cleanup | GitHub Actions | Generous minutes on a student Pro account; scheduled jobs can start late by a few minutes |

Operations that keep it free and safe:

- **Keep-alive**: `maintenance.yml` calls `GET /api/v1/health`, which runs `SELECT 1`, once a day so Supabase does not pause.
- **Backups**: Supabase Free has no point-in-time backups you can download. `maintenance.yml` runs `pg_dump` nightly, gzips it, and uploads it to R2 (`backups/`, keep 14). Test a restore into a local Postgres once before inviting other users.
- **Database size**: content is JSON blocks without images, so 500 MB holds many thousands of papers. `body_text` and `search_tsv` roughly double each paper's size; that is accepted.
- **Connections**: the API uses Supabase's pooled connection string (port 6543, transaction mode), because Cloud Run instances come and go.

Fallback if a free tier disappears: one small VPS with docker compose running Postgres, API, worker, and Caddy for HTTPS, with R2 kept for files (about 5 to 8 USD per month). The code does not change, only the env vars.

### Non-negotiables in production

- CORS restricted to the real front-end origin.
- HTTPS only. Rate limiting on the API (per user and per IP). Stricter on `/enrich` and `/assets`.
- Structured JSON logs with a request id. No tokens, no paper content in logs.
- Error tracking (Sentry or equivalent), free tier is enough.
- Daily database backup, retention 14 days. A restore must have been tested at least once.
- Migrations run by Alembic on deploy. Never edit the schema by hand.

---

## 13. Roadmap (do one phase at a time)

Each phase ends with a working, testable state. Do not start phase N+1 until phase N's acceptance criteria pass.

### Phase 0: freeze the spec
- This document reviewed and the `TODO(decision)` items answered.
- **Done** (2026-11-23): hosting, quota numbers, the AI-vs-user-content rule, and the IndexedDB question are decided (section 15).

### Phase 0.5: front-end modules (done)
- The front-end moved into `web/` and was split into ES modules by layer (sections 2, 5, 6), with no behavior change. `make check` and `make test` guard it.

### Phase 1: backend skeleton, no auth
- Create `server/` with config, DB session, Alembic, health route. (`web/` already exists.)
- Implement tables `users`, `papers` and the CRUD routes with a fake fixed user.
- Block schema validation and server-side sanitizer.
- Repos and services layered as in section 6.
- **Done when**: CRUD works through `curl` and tests, migrations apply on an empty DB, block sanitizer has unit tests that include XSS strings.

### Phase 2: auth and isolation
- JWT verification in `deps.py`. Invite-only user creation. `GET /me`.
- RLS policies and the `SET LOCAL app.user_id` mechanism.
- **Done when**: the cross-user test (user A cannot read, update, or delete user B's paper) passes for every id-based route, and requests without a token get 401.

### Phase 3: assets
- Presigned upload flow, `assets` table, signed read URLs, orphan cleanup job.
- Change the image block from `src` to `asset_id`. Write a one-off converter for existing data URLs.
- **Done when**: an image uploaded from the browser appears in a paper after reload, and the paper JSON contains no data URLs.

### Phase 4: front-end moves to the API
- Add login UI. Add `web/js/data/api-store.js` exporting a `Store` with the same interface. `main.js` imports it instead of `store.js`. Keep `store.js` only for reading old local data during import, then remove it (decided).
- Autosave with `If-Match` and the 409 prompt.
- Import tool: export from the old IndexedDB, upload through `POST /import`.
- Move search to `GET /search` (keep the highlight and snippet logic on the client).
- **Done when**: the app works end to end against the API, old local data can be imported, and two tabs editing the same paper show the conflict prompt instead of losing data.

### Phase 5: AI worker
- `jobs` table loop, pipeline steps, quota, usage logging, status polling in the UI.
- **Done when**: adding a paper with an arXiv link fills the five sections and the TL;DR, user-written sections are never overwritten (tested), a failed job shows a readable error, and quota blocks the 31st request.

### Phase 6: deploy
- Cloudflare Pages, Cloud Run, the three workflows in `.github/workflows/`, rate limits, CORS.
- **Done when**: 5 invited users can sign in on the real domain, a backup restore has been tested, and a deploy from `main` runs migrations automatically.

### Phase 7: later (not scheduled)
- Sharing papers or collections between users (`shares` table or `is_public` flag).
- Reading mode. Keyboard-first editing improvements. Block-level undo.
- Better PDF parsing (GROBID), figure extraction into image blocks.
- Self-hosted KaTeX (remove CDN dependency).
- Front-end migration to a framework if the static code becomes hard to maintain.

---

## 14. Rules for coding agents

### Before you start
1. Read this file fully. Read the front-end modules you are about to touch (section 2 says which file owns what).
2. Identify the current phase from section 13. Work only inside it.
3. If a requirement is marked `TODO(decision)`, use the stated default and leave a `# TODO(decision)` comment. Do not invent a new design.

### While coding
- Follow the layering in section 6. A route that contains SQL is wrong.
- Every query on a user-owned table filters by `user_id`. No exceptions, even in scripts.
- All schema changes go through an Alembic migration. Never alter tables manually.
- Do not add dependencies without a reason. Prefer the standard library and what is already in `pyproject.toml`.
- Never hard-code secrets, model names, URLs, or limits. Use settings from env.
- Never store or return passwords, tokens, or presigned URLs in the database or logs.
- Sanitize on the server. Never trust the client's HTML or block types.
- Keep the front-end `Store` interface stable. Change the implementation, not the callers.
- In `web/js/`, follow the front-end layering in section 6. New code goes in the module that owns that job; a new screen gets a new `ui/` module with an `init*()` called from `main.js`. No npm packages, no build step.
- Do not rewrite `web/js/editor/editor.js` or `web/css/editor.css` wholesale. Make targeted edits. The editor has subtle behavior (IME input, mobile Enter and Backspace through `beforeinput`, slash menu, floating toolbar).
- UI strings are in English (changed from Indonesian at the owner's request). Code, comments, commit messages, and docs are in English too. Search still ignores common Indonesian stop words, because notes may be written in either language.
- Do not delete or overwrite user data in migrations. Migrations that transform data MUST be reversible or backed by a verified backup step.

### Testing
- Front-end: `make test` (Node 20+) runs `make check` and the `node --test` suite in `tests/web/`. Open `/tests/smoke.html` in a browser for the checks that need a real DOM.
- Unit tests for services and the block sanitizer.
- Integration tests against a real Postgres (the docker-compose one), not mocks, for repos and RLS.
- The AI provider and object storage are faked in tests. No test may call a real LLM.
- Required regression tests: cross-user access (404), `If-Match` conflict (409), AI never overwrites user content, quota enforcement, sanitizer strips scripts and unknown attributes.

### Definition of done for any task
- Tests pass and new behavior is covered.
- Migrations apply cleanly on an empty database and on a copy of existing data.
- `.env.example` and this document are updated if config or behavior changed.
- No leftover debug code, no secrets, no unused files.
- The change is described in a short commit message: what and why.

### Commands (keep them in `AGENTS.md`)

Exist today:

```
make web        # serve web/ at http://localhost:8000
make check      # static checks for web/ (Node 20+)
make test       # make check, then node --test tests/web/
```

To add in phase 1 (`make test` then also runs pytest):

```
make dev        # start Postgres + MinIO, run API with reload
make worker     # run the job worker
make migrate    # alembic upgrade head
make lint       # ruff + mypy
```

---

## 15. Decision log

| # | Decision | Status |
|---|---|---|
| 1 | Modular monolith, not microservices | Decided |
| 2 | FastAPI + Postgres + SQLAlchemy + Alembic | Decided |
| 3 | Jobs queue in Postgres, no Redis | Decided |
| 4 | Managed auth issuing JWTs, invite-only sign-up | Decided |
| 5 | Images in object storage, blocks reference `asset_id` | Decided |
| 6 | Application-level `user_id` filtering plus RLS as backstop | Decided |
| 7 | Keep static front-end for now, as native ES modules with no build step | Decided |
| 8 | Hosting: Cloudflare Pages, Cloud Run, Supabase Free, R2, GitHub Actions (section 12) | Decided 2026-11-23 |
| 9 | AI result when a section already has user content: drop it | Decided 2026-11-23 |
| 10 | Monthly AI limit 30 per user, storage cap 500 MB per user | Decided 2026-11-23 |
| 11 | Remove IndexedDB after phase 4 (kept only to import old local data) | Decided 2026-11-23 |
| 12 | LLM via Claude Code CLI in GitHub Actions on the owner's subscription; API-key provider for anyone else | Decided 2026-11-23 |
| 13 | Worker is a scheduled GitHub Actions job, not an always-on process | Decided 2026-11-23 |
| 14 | No PDFs stored; images as WebP with cover thumbnails | Decided 2026-11-23 |

---

## 16. Glossary

- **Block**: one unit of document content (paragraph, heading, image, and so on).
- **Section**: one of the five standard `h2` headings and the blocks under it.
- **Card**: the compact paper summary shown in the catalog (no `content`).
- **Enrichment**: the AI step that fills metadata, TL;DR, and the five sections.
- **Seam**: a stable interface where one implementation can be swapped for another (`Store`, `AI.enrich`).
- **RLS**: PostgreSQL Row Level Security, a database-enforced per-row access rule.
- **Presigned URL**: a temporary URL that lets the browser upload to or download from object storage directly.
