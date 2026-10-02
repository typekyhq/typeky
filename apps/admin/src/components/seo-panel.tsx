import type { SeoMetadata } from '@typeky/api'
import { MediaField } from '@/components/media-picker'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/lib/i18n'

/**
 * The SEO overrides, shared by the three content types.
 *
 * Closed by default. Most pieces of content never need any of these, and a form
 * that shows four empty boxes to everybody invites filling them in with
 * something worse than the defaults. `<details>` rather than a state-driven
 * disclosure: it is keyboard- and screen-reader-correct without any code, and
 * there is no state to get wrong.
 *
 * Every field is an override, so the hints say what is being overridden rather
 * than repeating what the field is called.
 */

export interface SeoPanelProps {
  value: SeoMetadata
  onChange: (next: SeoMetadata) => void
  /** Issues keyed by dotted path, as the form collects them. */
  issues?: Record<string, string>
  /** Keeps the input ids unique when more than one of these is on a page. */
  idPrefix: string
  /** What this content type falls back to, in one line. */
  fallback: string
}

export function SeoPanel({ value, onChange, issues = {}, idPrefix, fallback }: SeoPanelProps) {
  const t = useT()
  const field = (name: keyof SeoMetadata) => `${idPrefix}-${name}-error`

  function set<K extends keyof SeoMetadata>(key: K, next: string): void {
    const trimmed = next === '' ? undefined : next
    const updated: SeoMetadata = { ...value }

    if (trimmed === undefined) delete updated[key]
    else updated[key] = trimmed as SeoMetadata[K]

    onChange(updated)
  }

  return (
    <Card>
      <details>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <CardHeader>
            <CardTitle>
              {t('seo.summary')}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {countSet(value) === 0 ? t('seo.usingDefaults') : t('seo.overridden', { count: countSet(value) })}
              </span>
            </CardTitle>
            <CardDescription>{fallback}</CardDescription>
          </CardHeader>
        </summary>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-title`}>{t('seo.title')}</Label>
            <Input
              id={`${idPrefix}-title`}
              value={value.title ?? ''}
              aria-invalid={issues['seo.title'] !== undefined}
              aria-describedby={issues['seo.title'] !== undefined ? field('title') : undefined}
              onChange={(event) => set('title', event.target.value)}
            />
            <FieldNote id={field('title')} error={issues['seo.title']} hint={t('seo.title.hint')} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-canonical`}>{t('seo.canonical')}</Label>
            <Input
              id={`${idPrefix}-canonical`}
              value={value.canonical ?? ''}
              placeholder={t('seo.placeholder.url')}
              aria-invalid={issues['seo.canonical'] !== undefined}
              aria-describedby={issues['seo.canonical'] !== undefined ? field('canonical') : undefined}
              onChange={(event) => set('canonical', event.target.value)}
            />
            <FieldNote
              id={field('canonical')}
              error={issues['seo.canonical']}
              hint={t('seo.canonical.hint')}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${idPrefix}-description`}>{t('seo.description')}</Label>
            <Textarea
              id={`${idPrefix}-description`}
              value={value.description ?? ''}
              aria-invalid={issues['seo.description'] !== undefined}
              aria-describedby={issues['seo.description'] !== undefined ? field('description') : undefined}
              onChange={(event) => set('description', event.target.value)}
            />
            <FieldNote
              id={field('description')}
              error={issues['seo.description']}
              hint={t('seo.description.hint')}
            />
          </div>

          <div className="sm:col-span-2">
            <MediaField
              id={`${idPrefix}-ogImageMediaId`}
              label={t('seo.socialImage')}
              value={value.ogImageMediaId ?? ''}
              error={issues['seo.ogImageMediaId']}
              hint={t('seo.socialImage.hint')}
              onChange={(next) => set('ogImageMediaId', next)}
            />
          </div>
        </CardContent>
      </details>
    </Card>
  )
}

function FieldNote({ id, error, hint }: { id: string; error?: string; hint: string }) {
  if (error !== undefined) {
    return (
      <p id={id} className="text-sm text-destructive">
        {error}
      </p>
    )
  }

  return <p className="text-xs text-muted-foreground">{hint}</p>
}

function countSet(value: SeoMetadata): number {
  return Object.values(value).filter((entry) => entry !== undefined && entry !== '').length
}
