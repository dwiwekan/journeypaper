# JourneyPaper

A personal reading journal for research papers. Each paper gets a card in a searchable catalog and a page with a block editor, laid out in five sections: Introduction, Related Work, Method, Experiment Results, Conclusion.

Today it is a static front-end with no backend. Your papers are saved in your browser (IndexedDB). [ARCHITECTURE.md](ARCHITECTURE.md) describes the code and the plan for the backend, accounts, and AI enrichment.

## Run it

```sh
make web            # serves web/ at http://localhost:8000
```

Open http://localhost:8000. The app uses ES modules, so it has to be served over HTTP. Opening `web/index.html` straight from disk (`file://`) will not work.

Use another port with `make web PORT=8080`.

### Moving data you saved earlier

The browser keeps saved data separately for each address. Papers you saved while opening the old single-file app from disk (`file://`) will not show up at `http://localhost:8000` on their own. The old app is kept in `legacy/` so you can get them out:

1. Open `legacy/index.html` straight from disk (double-click it, or `xdg-open legacy/index.html`).
   - Chrome and Edge share one storage area for all `file://` pages, so your papers appear here.
   - Firefox keeps a separate one per file. If the list is empty there, copy the four files in `legacy/` back to the project root for a moment and open `index.html` from the root, the way you did before.
2. Go to **Data** and press **Copy** (or **Download .json** to keep a backup file).
3. Open http://localhost:8000, go to **Data**, paste the JSON into the box, and press **Import**. Papers with the same id are updated, not duplicated.

Once your papers are in the new app, you can delete `legacy/` (and any files you copied back to the root).

## Check and test

You need Node 20 or newer. Python 3 is used only to serve the files.

```sh
make check          # syntax, imports, layering, stylesheet order, undeclared names
make test           # make check, then the unit tests in tests/web/
```

If `node` on your PATH is older, run `nvm use 20` first, or pass the binary:

```sh
make test NODE=~/.nvm/versions/node/v20.20.0/bin/node
```

Some checks need a real browser. With `make web` running, open http://localhost:8000/tests/smoke.html. Every line should say PASS. This page does not read or change your saved papers.

## Production database (Supabase)

Secrets live only in `.env.prod`, which git ignores. Never paste them into chat, an issue, or a commit.

1. Fill in `.env.prod`. `MIGRATE_DATABASE_URL` is Supabase → Connect → Session pooler (port 5432, user `postgres`), written as `postgresql+psycopg://…`. `DATABASE_URL` is the transaction pooler (port 6543) for user `journey_app.<project-ref>`.
2. `make migrate-prod` creates the `journey` schema, the tables, row level security, and the `journey_app` and `journey_backup` roles.
3. `make set-passwords-prod` gives both roles the passwords from `.env.prod`. It prints only `password set for …`.
4. In the Supabase dashboard: turn off "Allow new users to sign up", keep `journey` out of the Data API's exposed schemas, and add users by hand (Authentication → Users → Add user).
5. `make check-exposure` confirms, with only the public key, that no table is readable and sign-up is closed.
6. `make dev ENV=.env.prod`, then `curl localhost:8080/api/v1/health`, checks that the API can reach the database as `journey_app`.

## Layout

```
web/index.html      page and dialogs
web/css/            one stylesheet per area; responsive.css loads last
web/js/main.js      start-up wiring
web/js/data/        storage (store.js is the only IndexedDB code), paper shape, sample data
web/js/services/    search, AI stub
web/js/editor/      block editor, block rules, sanitizer, image compression
web/js/ui/          one module per screen or widget
scripts/            check-web.mjs
tests/web/          node --test suites
```

No frameworks, no build step, no npm packages.
