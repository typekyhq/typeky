import { LIQUID_NATIVE_FILTERS, LIQUID_PLATFORM_FILTERS, LIQUID_TAGS } from '@typeky/theme-kit'
import { BASELINE_NAMES } from '@typeky/theme-default'
import { contextPaths } from '../render/sample'

/**
 * What a theme author needs to read, and what an AI needs to be told.
 *
 * Both documents are **generated**, and the lists in them come from the things that
 * actually decide them: the tags and filters from the sandbox's own whitelists, the
 * data shape from the sample context the previews render with. A hand-written list of
 * what a template may use stops being true the first time the context gains a field,
 * and the way it goes wrong is by telling an author about something that renders
 * nothing -- which is exactly the failure an AI cannot notice.
 *
 * The prose around the lists is written here, because a rule is not derivable. It is
 * deliberately short: the long form is `docs/theme-development.md` in the repository.
 */

const TEMPLATE_NAMES = BASELINE_NAMES.filter((name) => name.startsWith('templates/'))
const SNIPPET_NAMES = BASELINE_NAMES.filter((name) => name.startsWith('snippets/'))

/** The fields a template can read, for the two richest templates, derived from the sample. */
function pathsFor(template: string): string {
  return contextPaths(template)
    .map((path) => `- \`${path}\``)
    .join('\n')
}

const ESCAPING = `\`{{ ... }}\` is **escaped**. That is what stops a content title from injecting markup, and
it means pre-rendered HTML cannot be printed with \`{{\`. The body of a post is HTML
already, so it has a filter whose output is not escaped again:

    {{ content.blocks | render_blocks }}

Two more things an author hits early:

- \`{% layout 'layouts/base' %}\` is Jekyll-style, not Shopify-style. The child template's
  whole body becomes an anonymous block, and the layout prints it with
  \`{% block %}{% endblock %}\`. \`{{ content_for_layout }}\` renders nothing at all.
- \`{% render 'snippets/header', site: site %}\` does **not** share scope: a snippet sees
  only what the caller passes it. \`{% include %}\` shares scope, if that is what you want.
- A render name is relative to the file that writes it, so from a template write the
  whole name: \`{% render 'snippets/post-card', post: post %}\`.`

/**
 * The syntax reference, as a downloadable document.
 *
 * Written as Markdown because it is meant to be read by a person *and* pasted at a
 * model: an author who is going to ask an AI for a template should hand it the same
 * constraints the platform enforces.
 */
export function templateSyntaxDocument(): string {
  return `# Typeky theme syntax

A Typeky theme is a set of **Liquid** files the platform renders on every request.
This is the part that is the platform's own: the objects you are given, the filters
that exist, and the rules that are not obvious. The Liquid language itself is at
<https://liquidjs.com/>.

## The files

| Path | What it is |
| :---- | :---- |
| \`layouts/base\` | The document: \`<html>\`, \`<head>\`, the header, the footer, \`{% block %}\` |
| \`${TEMPLATE_NAMES.join('\`, \`')}\` | One per page kind. The platform asks for these by name |
| \`${SNIPPET_NAMES.join('\`, \`')}\` | Fragments, rendered with \`{% render %}\`. Yours to change or add to |
| \`assets/theme.css\`, \`assets/theme.js\` | Fetched by the browser, linked with \`asset_url\` |

A template's name has **no extension** when it is named: the file is
\`templates/post.liquid\` and the platform asks for \`templates/post\`.

## The objects

A template is given exactly four top-level objects. Nothing else is in scope: no
functions, no database, no fetching.

### \`site\`

| Field | Type | Notes |
| :---- | :---- | :---- |
| \`site.name\`, \`site.tagline\` | string, string? | |
| \`site.logo_url\`, \`site.favicon_url\` | string? | Already URLs |
| \`site.language\` | string | BCP 47, for \`<html lang>\` |
| \`site.date_format\` | string | A strftime format for \`| date\`, e.g. \`%B %-d, %Y\` |
| \`site.timezone\` | string | An IANA zone, e.g. \`Asia/Shanghai\` |
| \`site.nav\` | array | \`{ label, href }\`, already in the operator's order |
| \`site.settings.footer\`, \`.social_links\`, \`.custom\` | | Operator-written copy. Character references are already resolved |
| \`site.attribution\` | object? | Absent on a white-labelled site |

### \`page\`

\`kind\` (\`home\`, \`page\`, \`post\`, \`posts\`, \`product\`, \`products\`, \`notFound\`), \`url\`,
\`canonical?\`, \`title?\` (list pages only), \`pagination?\`.

### \`content\`

The page's main data. An object on a detail page, an **array** on a list page.

For a post (\`templates/post\`):
${pathsFor('templates/post')}

### \`seo\`

\`title\`, \`document_title\` (the title with the site's template applied, for
\`<title>\`), \`description?\`, \`og_image?\`, \`json_ld?\`.

## Filters

The platform's own, which do the work a template cannot do itself:

| Filter | Example | Result |
| :---- | :---- | :---- |
| \`url\` | \`{{ '/about' \\\\| url }}\` | \`/about\`, or absolute when the site knows its origin |
| \`asset_url\` | \`{{ 'theme.css' \\\\| asset_url }}\` | The theme file's URL, with a version |
| \`money\` | \`{{ 1990 \\\\| money }}\` | \`$19.90\` -- cents in |
| \`t\` | \`{{ 'nav.blog' \\\\| t }}\` | A translation; a missing key renders as the key |
| \`render_blocks\` | \`{{ content.blocks \\\\| render_blocks }}\` | The body as HTML, not escaped again |
| \`json_ld\` | \`{{ seo.json_ld \\\\| json_ld }}\` | JSON for \`<script type="application/ld+json">\` |

Everything else is Liquid's own. The full list this deployment accepts:

${LIQUID_NATIVE_FILTERS.map((name) => `\`${name}\``).join(', ')}

## Tags

${LIQUID_TAGS.map((name) => `\`${name}\``).join(', ')}

\`echo\`, \`tablerow\` and \`paginate\` are deliberately not available. A tag or filter
outside these lists **fails the render**, loudly, rather than rendering nothing --
so a typo shows up as an error rather than as a blank space on a page.

## Dates

    <time datetime="{{ content.published_at }}">{{ content.published_at | date: site.date_format, site.timezone }}</time>

Pass the zone. Without it the filter uses the runtime's own, which is UTC on the
server and something else on your laptop, and a date near midnight then changes
depending on where it is rendered.

## Escaping and blocks

${ESCAPING}

## What is checked when you save

- The template must **parse**. A syntax error is refused with its line number.
- Only the file names above may be edited. A new name is refused: a theme upgrade
  that finds files it did not put there is the conflict the platform avoids.
- The output of a render is capped (5 MB), and so are time, memory and template size.
`
}

/**
 * The prompt to hand a model.
 *
 * It is written as an instruction to the model rather than as documentation, and it
 * carries the same derived lists: a model told to "use Liquid" will reach for filters
 * this sandbox does not have, and a template that fails to render is a worse answer
 * than one that is plainer.
 */
export function aiPromptDocument(): string {
  return `# Prompt: write a Typeky theme template

You are writing **one Liquid template file** for Typeky, a small self-hosted site
platform. Typeky renders themes with a sandboxed Liquid engine: only the tags and
filters listed below exist, and anything else **fails the render**. Do not invent a
filter, a field or a tag.

## What to produce

- Exactly one file, named as I ask (for example \`templates/post\`).
- Raw template source. Not HTML-escaped, not wrapped in a code fence unless I ask.
- The name has no extension: the platform asks for \`templates/post\`, not
  \`templates/post.liquid\`.

If I have not said which file, ask me before writing.

## Rules that decide whether it works

1. **Output is escaped.** \`{{ content.title }}\` is safe and correct. Pre-rendered
   HTML is only printed through \`render_blocks\`: \`{{ content.blocks | render_blocks }}\`.
2. **\`{% layout 'layouts/base' %}\`** is Jekyll-style: my template's body becomes a
   block, and the layout prints it with \`{% block %}{% endblock %}\`. Never
   \`{{ content_for_layout }}\`.
3. **\`{% render 'snippets/x', a: a %}\`** shares no scope. Pass everything the snippet
   needs. Names are relative to the file that writes them, so write the whole name.
4. **There are exactly four objects**: \`site\`, \`page\`, \`content\`, \`seo\`. There is no
   database, no function, no network. Do not reference anything else.
5. **A list page's \`content\` is an array**; a detail page's is an object.
6. Dates: \`{{ content.published_at | date: site.date_format, site.timezone }}\` --
   always pass the zone.

## The data you may use

A post (\`templates/post\`):
${pathsFor('templates/post')}

A product (\`templates/product\`):
${pathsFor('templates/product')}

There are also \`site.name\`, \`site.tagline\`, \`site.logo_url\`, \`site.nav\`,
\`site.language\`, \`site.date_format\`, \`site.timezone\`, \`site.settings.*\` (the
operator's own copy), and \`seo.title\`, \`seo.document_title\`, \`seo.description\`,
\`seo.og_image\`.

## The tags and filters that exist

Tags: ${LIQUID_TAGS.map((name) => `\`${name}\``).join(', ')}

Platform filters: ${LIQUID_PLATFORM_FILTERS.map((name) => `\`${name}\``).join(', ')}

Liquid filters: ${LIQUID_NATIVE_FILTERS.map((name) => `\`${name}\``).join(', ')}

The platform filters are the ones that do work you cannot do yourself:
\`url\` (a site path made absolute), \`asset_url\` (a theme file's URL, versioned),
\`money\` (cents to a formatted price), \`t\` (a translation),
\`render_blocks\` (the body as HTML, not escaped again),
\`json_ld\` (JSON for a structured-data script).

## The files of a theme

\`layouts/base\` is the document. These are the templates the platform asks for by
name: \`${TEMPLATE_NAMES.join('\`, \`')}\`.

\`snippets/*\` are fragments you may change or add to; \`assets/theme.css\` and
\`assets/theme.js\` are the browser's files, linked with \`asset_url\`.

## What to do

1. If I have not described the design, ask me two or three short questions.
2. Then write the file, and say which file name it is.
3. Do not explain at length. The template is the answer.
`
}
