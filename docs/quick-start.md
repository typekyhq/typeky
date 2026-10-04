# Deploying Typeky

Typeky runs on your own Cloudflare account: one Worker, one D1 database, one R2
bucket, one KV namespace. On Cloudflare's free plan the running cost is nothing —
[the arithmetic](../README.md#how-0-works) is in the README.

This is the whole deployment. It takes about ten minutes, and every command below
is meant to be copied as it is.

If you only want to look at it first, [the local setup](README.md#running-it-locally)
needs no account at all.

## What you need

- A Cloudflare account.
- Node.js 20 or newer, and pnpm.
- Optional but recommended: a domain on the **same** Cloudflare account, for
  [step 7](#7-put-it-on-your-own-domain).

## 1. The code

```bash
git clone https://github.com/typekyhq/typeky.git
cd typeky
pnpm install
```

## 2. Create the three resources

From the repository root. `pnpm --filter` is only how the commands find the
Wrangler that is already installed here.

```bash
pnpm --filter @typeky/site exec wrangler d1 create typeky
pnpm --filter @typeky/site exec wrangler r2 bucket create typeky-media
pnpm --filter @typeky/site exec wrangler kv namespace create CACHE
```

The first and third print an id. Copy each one into `apps/site/wrangler.jsonc`,
which ships with placeholders so that a local run never needs them:

| Where | What to replace |
| :---- | :---- |
| `d1_databases[0].database_id` | the id `d1 create` printed |
| `kv_namespaces[0].id` | the id `kv namespace create` printed |
| `r2_buckets[0].bucket_name` | nothing — it already says `typeky-media`. If you named the bucket something else, either create `typeky-media` or change this line |

While you are in that file, change `APP_ENV` from `"development"` to
`"production"`. It is only reported by `/healthz`, and a deployment that reports
itself as a development environment is reporting the wrong thing.

The resource names are yours to choose. Keep them in step with this file, which is
the only place the names appear.

## 3. Create the tables

```bash
pnpm db:migrate:remote
```

That applies `apps/site/migrations/` to the database you just created. It is the
remote half of `pnpm db:migrate`, which does the same thing to the local one.

## 4. Deploy

```bash
pnpm deploy
```

That builds the admin panel into `public/admin`, writes the asset cache policy,
and uploads the Worker. `pnpm deploy:dry-run` does everything except the upload,
which is the quickest way to find out whether your `wrangler.jsonc` is accepted.

The first deployment prints the address it landed on,
`https://typeky.<your-subdomain>.workers.dev`.

Do this **before** setting any secret, not after. `wrangler secret put` offers to
*create* the Worker when there is not one, and in a non-interactive context — a CI
job — it answers yes, leaving an empty Worker that holds a secret and no code.
With the order above the question cannot come up.

## 5. Set the admin password

```bash
pnpm admin:password
```

It asks for a password and prints one line — the hash, and nothing else. Put it in
as a secret, so it is encrypted at rest and never appears in a config file:

```bash
printf '%s' 'scrypt$16384$8$1$...' | pnpm --filter @typeky/site exec wrangler secret put ADMIN_PASSWORD_HASH
```

The username is `admin`. To use another one, change `ADMIN_USERNAME` in
`apps/site/wrangler.jsonc` — it is not a secret.

Between step 4 and here the site serves normally and the admin panel refuses every
login with `admin_password_not_configured`. It fails closed rather than falling
back to a default password, so that gap is not a hole.

If you have bought a white-label licence, add it too:

```bash
printf '%s' '<the licence>' | pnpm --filter @typeky/site exec wrangler secret put LICENSE_KEY
```

## 6. The first five minutes

A fresh deployment has no site row, so its pages answer **503** with a page that
says so. That is not a fault: nothing has told it what the site is called.

1. Open `https://<your-worker>.workers.dev/admin/`.
2. Sign in with `admin` and the password from step 5.
3. Open **Settings**, type a name, press **Save changes**.
4. Open **Settings → Reserved paths** and accept the suggested **panel address**.
   `/admin` is the first thing a scanner tries, so the field offers a random one.
   Save, then use the address it names — the old one forwards a browser that is
   already signed in, which is the way back if you forget what you typed.

The 503 is gone at that point, but `/` still answers **404**: it is the home page,
and no page has been marked as one. A site can have any number of pages; exactly
one of them is the front page, and which one is a decision rather than a default.

4. Open **Pages**, create one, and save it. Publish it while you are there.
5. Back in the list, open its menu and choose **Set as home**.

`/` renders from then on. Everything else — posts, products, images, templates —
is in the admin panel, and [the theme guide](theme-development.md) covers the
last of those.

## 7. Put it on your own domain

Add this to `apps/site/wrangler.jsonc`, next to `vars`:

```jsonc
"routes": [{ "pattern": "example.com", "custom_domain": true }],
```

Then deploy again:

```bash
pnpm deploy
```

Cloudflare creates the DNS record and the certificate for you; the domain has to
be a zone on the same account. Delete the `routes` line and deploy again to move
back to the workers.dev address.

Two things worth knowing about the domain:

- The admin panel and the site are the same Worker, so the panel is on your
  domain -- under whatever address the settings give it, `/admin` until you move
  it. There is nothing separate to deploy or protect.
- A white-label licence is bound to a domain. Sign it for the domain you will
  serve on — `example.com` and `www.example.com` count as the same name, and
  anything else counts as a different site.

## 8. Updating

```bash
git pull
pnpm install
pnpm db:migrate:remote   # only when there are new migrations
pnpm deploy
```

Migrations are applied before the code that reads them, so the deployed version
never meets columns that are not there yet. The admin panel's scripts are served
from hashed filenames, so a browser picks up the new build on its next page load.

## What a deploy token needs

Wrangler's own login (`wrangler login`) has everything by default. If you would
rather use an API token — for CI, or because you do not want an OAuth session on
a build machine — this is the complete list:

| Scope | Why |
| :---- | :---- |
| Account · Workers Scripts · Edit | upload the Worker |
| Account · D1 · Edit | create and migrate the database |
| Account · Workers KV Storage · Edit | create the namespace |
| Account · Workers R2 Storage · Edit | create the bucket |
| Account · Account Settings · Read | list the accounts this token can see |
| Zone · Workers Routes · Edit | **only** if you use a custom domain |

**The running Worker needs none of this.** At runtime it reaches its database,
bucket and namespace through bindings, which Cloudflare scopes to this Worker by
the config file. Nothing is granted by the fact that it is deployed.

## When something is wrong

| What you see | What it is |
| :---- | :---- |
| Pages answer **503** with "has not been set up yet" | the site has no name yet: [step 6](#6-the-first-five-minutes), first half |
| `/` answers **404** while other pages work | no page is marked as the home page: [step 6](#6-the-first-five-minutes), second half |
| `curl https://<your-worker>.workers.dev/healthz` says `"database":"unbound"` | the D1 binding is missing or its id was not pasted in |
| `"status":"degraded"` from the same address | the binding exists and the query failed; the migration in step 3 has not been applied |
| Every page loads, but unstyled | `/theme/theme.css` answered something other than 200 |
| A Worker named `typeky` exists that you never deployed | `secret put` ran before the first deploy and answered yes to creating one. `pnpm --filter @typeky/site exec wrangler delete typeky`, then follow step 4 first |
| The admin panel will not sign you in | `ADMIN_PASSWORD_HASH` is missing or has a line break in it; `secret put` takes the whole hash on one line |
| **Settings → Licence** says the key was refused | it names both the domain the request arrived on and the domain the licence is for. The site is not blocked; it serves with the attribution until the two agree |

## Notes

- `pnpm seed` — the demo content — runs against the **local** database only. A
  deployment starts empty on purpose: demo pages on a real site are a bug, not a
  feature.
- Prerendered static output (`public/static`) is not built yet; every page is
  rendered on request and cached at the edge.
- The `CACHE` KV namespace holds admin sessions. The page cache is the Cache API
  and needs no namespace of its own.
