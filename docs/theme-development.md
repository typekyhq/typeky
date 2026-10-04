# Theme development

A theme turns stored content into pages. It is written in Liquid, and it is the
only thing that decides what a visitor sees — the platform assembles data and
hands it over, and nothing else reaches the page.

This guide is for people editing a theme in the admin panel, and for people
writing one.

- [What a theme is made of](#what-a-theme-is-made-of)
- [What you can edit](#what-you-can-edit)
- [How a page is rendered](#how-a-page-is-rendered)
- [The data a template gets](#the-data-a-template-gets)
- [Liquid reference](#liquid-reference)
- [Four rules that will bite you](#four-rules-that-will-bite-you)
- [Limits](#limits)
- [Checking your work](#checking-your-work)

## What a theme is made of

Three directories, and that is all of it:

```
layouts/     the page shell; a template renders into one of these
templates/   one per kind of page, chosen by the URL that was asked for
snippets/    reusable pieces, pulled in by name
```

The bundled theme ships fifteen files:

| Path | Rendered when |
| :---- | :---- |
| `layouts/base` | Not directly — every template renders into it |
| `templates/home` | The page flagged as the home page |
| `templates/page` | A page |
| `templates/post` | One post |
| `templates/posts` | The post list |
| `templates/product` | One product |
| `templates/products` | The product list |
| `templates/404` | Nothing matched the URL |
| `snippets/header` | The navigation, from `site.nav` |
| `snippets/footer` | The footer, from `site.settings` |
| `snippets/pagination` | Previous/next links on a list |
| `snippets/post-card` | One row of the post list |
| `snippets/product-card` | One row of the product list |
| `snippets/seo-meta` | `<title>`, description, canonical, Open Graph |
| `snippets/cookie-consent` | A notice, when the site configures one |

## What you can edit

**Any template the theme ships, and nothing else.** There is no "new file"
button, deliberately: a theme upgrade that found files it did not put there is
the conflict this avoids, and a template name is a whitelist the platform can
enforce without looking anything up.

An edit is stored as an **override**. The bundled file is still there underneath,
so:

- **Saving takes effect immediately.** The next page rendered anywhere sees it.
  There is no publish step and no cache to clear by hand.
- **Restoring puts the bundled version back** — the override is dropped rather
  than replaced with a copy of the original, so it also picks up future changes
  to the bundled theme.
- **Previewing renders your unsaved source** through the theme's own loader, so
  `{% render %}` and `{% layout %}` resolve exactly as they will once saved.

## How a page is rendered

```
request
  → the platform resolves the route and loads the content
  → it builds the render context (plain JSON, nothing callable)
  → Liquid renders the template, which pulls in its layout and its snippets
  → HTML comes back
```

Lookup is two levels and one rule: **an override if there is one, otherwise the
bundled file**. Editing a template never changes how names resolve.

One exception, and it is the site owner's choice rather than yours: a page can be
marked as **its own document**, in which case its own source is rendered instead of
`templates/page.liquid` — same engine, same context, no layout. Such a page is
deliberately not yours to theme.

## The data a template gets

One object, and these are all of its fields. Everything in it is plain JSON —
there are no functions to call and nothing to fetch.

### `site`

| Field | Type | Notes |
| :---- | :---- | :---- |
| `site.name` | string | |
| `site.tagline` | string? | |
| `site.logo_url` | string? | Already a URL; a media id would be useless here |
| `site.favicon_url` | string? | The browser tab icon, already a URL. Set it in the site settings |
| `site.language` | string | BCP 47, for the `lang` attribute |
| `site.date_format` | string | A strftime format for `\| date`. The site's own setting |
| `site.timezone` | string | An IANA zone for `\| date`, for example `Asia/Shanghai`. Always present; `UTC` until the operator chooses |
| `site.nav` | array | `{ label, href }`, already in the order the operator set |
| `site.settings.footer` | string? | |
| `site.settings.social_links` | array? | `{ label, href }` |
| `site.settings.cookie_notice` | string? | Present only when one is configured |
| `site.settings.custom` | object? | The operator's own keys, so `site.settings.custom.contact_email`. Absent when there are none |

### `page`

| Field | Type | Notes |
| :---- | :---- | :---- |
| `page.kind` | string | `home`, `page`, `post`, `posts`, `product`, `products`, `notFound` |
| `page.url` | string | Site-relative, for example `/posts/hello` |
| `page.canonical` | string? | Absolute when the site knows its own origin |
| `page.title` | string? | A heading for list pages; absent on detail pages |
| `page.pagination` | object? | `{ page, pages, previous_url?, next_url? }` |

### `content`

The page's main data, **already computed**: an array on a list page, one object
on a detail page. Sorting, counting, media resolution and block rendering have
all happened — a template displays, it does not calculate.

| Field | Present on | Notes |
| :---- | :---- | :---- |
| `content.title` | all | |
| `content.slug` | all | |
| `content.url` | all | |
| `content.blocks` | all | Raw Block JSON — render it, see below |
| `content.excerpt` | posts | |
| `content.terms` | posts, products | `{ name, slug, vocabulary }`; **absent** when there are none |
| `content.tags` | posts | |
| `content.price_label` | products | Text, printed as written |
| `content.gallery` | products | Media ids resolved to URLs |
| `content.specs` | products | `{ label, value }` |
| `content.cta_label` / `content.cta_url` | products | |
| `content.cover_url` | posts, products | |
| `content.published_at` | posts | ISO 8601 |

### `seo`

| Field | Type | Notes |
| :---- | :---- | :---- |
| `seo.title` | string | The override, then the content title, then the site default |
| `seo.document_title` | string | `seo.title` with the site's title template applied, for `<title>`. Identical to `seo.title` until one is set |
| `seo.description` | string? | The override, then the excerpt, then the site default |
| `seo.og_image` | string? | A URL, resolved from the media id — the page's own, then the site's default |
| `seo.json_ld` | any? | |

Two of these are deliberately different from each other. A browser tab and a search
result are better with the site's name in them; a social card already carries it in
`og:site_name`, and a `BlogPosting` headline should be the headline — so the title
template reaches `<title>` and nothing else.

The platform also writes `<meta name="robots" content="noindex, nofollow">` into
every page itself when the operator has asked for the site not to be indexed. It is
injected rather than left to a template, so a theme does not need to emit it — and
`injectRobotsMeta` leaves a page that already has one alone.

### `preview`

`true` only while previewing from the admin. A template that emits a canonical
URL may want to skip it there — the page it names does not exist yet.

## Liquid reference

A template may use **exactly** these tags:

```
assign  block  break  capture  case  comment  continue  cycle  decrement
for  if  include  increment  layout  liquid  raw  render  unless
```

and, besides Liquid's own filters, exactly these platform ones:

| Filter | Example | Result |
| :---- | :---- | :---- |
| `url` | `{{ '/about' \| url }}` | `/about`, or `https://example.com/about` when the site knows its origin. Absolute URLs and `#anchor` are left alone |
| `asset_url` | `{{ 'theme.css' \| asset_url }}` | `/theme/theme.css` |
| `money` | `{{ 1990 \| money }}` | `$19.90` — cents in, formatted with the site's currency |
| `t` | `{{ 'nav.blog' \| t }}` | A translation; a missing key renders as the key, so it shows up |
| `render_blocks` | `{{ content.blocks \| render_blocks }}` | The body as HTML |

Anything else fails loudly rather than rendering nothing. That is on purpose: a
filter that silently produces an empty string reads as a theme bug, and you would
go looking in the wrong place.

### Dates

Liquid's own `date` filter is available, and both the format and the zone are the
site's to choose: `site.date_format` and `site.timezone` are settings. The bundled
theme writes it this way —

```liquid
<time datetime="{{ content.published_at }}">{{ content.published_at | date: site.date_format, site.timezone }}</time>
```

— and the second argument is worth copying. The filter formats in the runtime's
own time zone when it is not given one: a Cloudflare Worker runs in UTC and your
laptop does not, so a date near midnight renders as one day locally and another
after a deploy. Passing `site.timezone` makes the two agree, and keeps the
`datetime` attribute's ISO value and the text beside it talking about the same day.
It is always present — `UTC` until the operator chooses otherwise — so there is no
case where passing it is wrong.

The operator's format string is checked before it is saved, against a fixed list
of directives (`%Y %m %d %B %b %A %a %H %I %M %S %p`, plus `%-m` and `%-d` for no
leading zero). A directive outside that list is refused rather than rendered —
which matters because Liquid renders an unknown one as `"nd"` rather than
failing, and a plausible-looking date is worse than a visible error. The zone is
checked the same way, against `Intl`: a zone that does not exist makes the filter
throw, which would be every page with a date on it rather than one wrong date.

## Packaging and uploading a theme

A theme is a **folder**, and uploading one posts its files as text. There is nothing
to archive and nothing to compile:

```
my-theme/
  layouts/base.liquid
  templates/*.liquid
  snippets/*.liquid
  assets/theme.css
  assets/theme.js
```

- The three template directories are what the renderer reads, and a file there is
  named **without** its extension: `templates/post.liquid` is asked for as
  `templates/post`.
- `assets/` is what the browser fetches; those files keep their extension, and
  `asset_url` versions them by their revision so an edit reaches a reader.
- At most **200 files** and **1,000,000 characters** of source, which is the ceiling
  the loader's overrides already live under.
- Every template is parsed before anything is stored. A theme that will not parse is
  refused at the door, naming the file and the line, rather than on a page later.
- A path stays inside the theme: `..`, an absolute path and a backslash are refused
  rather than normalised.
- A theme is **layered over the bundled one**: a file it does not ship renders with
  the bundled theme's, and so does an asset. That makes a partial theme a normal thing
  -- change the two files you care about and leave the rest -- and it is why the theme
  page lists the files the bundled theme ships alongside your own. *Restore* on one of
  those drops the override, exactly as it does for the bundled theme.

Upload it from **Theme → Choose a folder**, then choose it under **Settings → Theme**.
Editing a file of an uploaded theme works exactly as editing the bundled one, and
*Restore* puts back what the theme shipped -- for an uploaded theme that means
rewriting the file, not deleting it, because the file *is* the theme.

## Four rules that will bite you

These are the ones that are not obvious, in the order people hit them.

**1. `{% layout %}` is Jekyll-style, not Shopify-style.** The child template's
whole body becomes an anonymous block, and the layout prints it with
`{% block %}{% endblock %}`. A Shopify theme's `{{ content_for_layout }}` renders
**nothing at all** — the page comes out with an empty `<main>` and no error.

```liquid
{% comment %} layouts/base → the layout {% endcomment %}
<main>{% block %}{% endblock %}</main>
```

**2. `{% render %}` does not share scope.** A snippet sees only what you pass it,
so `{{ seo.title }}` inside `snippets/seo-meta` is empty unless the caller sends
it. This is what makes a snippet predictable, and it is the first thing that
breaks when you extract one.

```liquid
{% render 'snippets/seo-meta', seo: seo %}
{% render 'snippets/post-card', post: post %}
```

`{% include %}` does share scope, if you want that instead.

**3. Names are relative to the theme root.** `{% render 'header' %}` is resolved
against the directory of the file that wrote it, so from `layouts/base` it looks
for `layouts/header` and fails. Write the whole name:

```liquid
{% render 'snippets/header', site: site %}
{% layout 'layouts/base' %}
```

**4. Everything you print is escaped — including a body.** Output escaping is
global, and it is what stops a post title from injecting markup. That means
pre-rendered HTML cannot be printed with `{{ }}`: it comes out as `&lt;p&gt;`.
Use the filter whose output is not escaped again:

```liquid
{{ content.blocks | render_blocks }}   {% comment %} right {% endcomment %}
{{ content.blocks }}                   {% comment %} escaped, and wrong {% endcomment %}
```

A character reference an operator typed into a setting is resolved for you before
the template sees it: the footer renders `Copyright © 2026` whether it was typed as
`©` or as `&copy;`. That happens on the way into the context — the site's own text
(footer, tagline, navigation and social labels, custom values, the SEO defaults) is
read that way, while a body is markup because a block body *is* markup. A theme
still escapes what it prints, which is what keeps a setting from becoming markup.

## Limits

A theme is untrusted input, so it runs inside limits rather than being trusted to
behave:

| Limit | Default |
| :---- | :---- |
| Template source, per parse | 2,000,000 characters |
| Time, per render | 500 ms |
| Memory, per render | 8 MB |
| Output, per page | 5 MB |
| Templates that may be overridden | 200 |
| Total override source | 1,000,000 characters |
| Template source, per save | 64 KB |
| Uploaded file | 25 MB |

An override is validated before it is stored: a template that will not parse is
refused, with the line number. The site never sees a broken template — it sees
the one before it.

## Checking your work

**In the admin panel.** Open **Theme**, pick a template and press **Preview**. The
server renders your unsaved source with sample data through the same loader the
site uses, so what you see is what a page will produce, including the layout and
the snippets it pulls in. A parse error comes back with a line number and the
editor marks that line.

**From a terminal.** The sandbox suite is the list of things a theme must not be
able to do:

```bash
pnpm test:sandbox
```

Preview renders with fixed sample data rather than your own content, on purpose:
a preview answers "what does this template look like", and using whatever post
happened to be newest would let a theme look right by accident.
