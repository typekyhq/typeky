# Typeky documentation

Typeky is a lightweight site builder for personal blogs, business websites and
niche sites, deployed to your own Cloudflare account. What it is and why it
exists is in the [root README](../README.md).

This directory is the documentation for **using** it. Documentation for working
on it is in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Contents

| Document | What it covers |
| :---- | :---- |
| [Deploying Typeky](quick-start.md) | Putting it on your own Cloudflare account: the resources to create, the secrets, the deploy, your own domain, and the least-privilege token |
| [Theme development](theme-development.md) | Editing templates in the admin panel, and writing a theme: the Liquid surface, the data a template gets, and the four rules that are not obvious |
| [CHANGELOG](../CHANGELOG.md) | What each milestone delivered |
| [SECURITY](../SECURITY.md) | Reporting a vulnerability |
| [CONTRIBUTING](../CONTRIBUTING.md) | Repository layout, the checks, and the commit rules |

## Running it locally

You need Node.js 20 or newer and pnpm. Nothing else — the database, the object
store and the cache all run locally inside Wrangler.

```bash
pnpm install
pnpm db:migrate        # create the local database
pnpm seed              # a demo site: one page, one post, one product, two media rows
pnpm admin:password    # set the admin password (asks for it, stores a hash)
pnpm dev               # site on :8787, admin on :5173
```

Then open <http://localhost:5173/admin/> and sign in with `admin` and the
password you set.

`pnpm seed` is optional, and safe to run again: it upserts by slug. Without it you
start with an empty site, which is also a perfectly good way to start.

### The admin password

`pnpm admin:password` asks for a password and prints the hash to store it as —
one line, and the only thing it outputs:

```
scrypt$16384$8$1$...
```

Put it in `apps/site/.dev.vars` alongside the username:

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=scrypt$16384$8$1$...
```

That file is gitignored and never committed. Without it, the login endpoint
refuses every attempt and says why, rather than falling back to a default
password. Restart `pnpm dev` after changing it.

## Day-to-day commands

| Command | What it does |
| :---- | :---- |
| `pnpm dev` | The site Worker and the admin SPA, with the admin proxying its API to the Worker |
| `pnpm check` | Everything CI runs: types, tests, schema and theme drift, build, and the asset boundary checks |
| `pnpm test` | The test suite |
| `pnpm test:sandbox` | Just the theme sandbox suite — the things a theme must not be able to do |
| `pnpm build` | Build the admin SPA and the site assets |
| `pnpm db:migrate` | Apply migrations to the local database |
| `pnpm db:reset` | Throw the local database away and rebuild it from the migrations |
| `pnpm seed` | Load the demo site |
| `pnpm theme:generate` | Regenerate the bundled theme module after editing a `.liquid` file |
| `pnpm check:theme-drift` | Fail if that module and the `.liquid` files disagree |

Two of these exist because something is generated from files that people edit:
`pnpm db:generate` writes the schema and the migration from the data model, and
`pnpm theme:generate` compiles the bundled theme's `.liquid` files into a module
a Worker can import. Edit the source, run the generator, commit both. CI fails if
you forget the second half.

Migrations are appended, never rewritten. `0001_init.sql` was written once and is
frozen; every later change to the model produces a new numbered file. Apply what is
new with `pnpm db:migrate`. `pnpm db:generate` refuses to write a migration it
cannot express — a change that needs a table rebuild is reported instead, because
dropping and recreating a table loses its rows.

The reason the first rule matters is worth knowing, because its failure mode is
quiet: `wrangler` records which migrations a database has run **by file name**.
Rewriting a migration therefore means an existing database is never told about the
change, so the schema it has and the schema the code expects drift apart. The
symptom is a request that answers 500 with nothing on the screen to say why. That
happened once, to the three tables behind the Categories screen.

## Editing a theme

See [Theme development](theme-development.md). In short: open **Theme** in the
admin panel, pick a template, edit it, press **Preview**, then **Save**. It takes
effect on the next page rendered, and **Restore default** puts the bundled
version back.
