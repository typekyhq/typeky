import type { TaxonomyContentType, TaxonomyResponse } from '@typeky/api'
import { useEffect, useState, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { useApiClient } from '@/lib/client-context'
import { useT } from '@/lib/i18n'
import { describeApiError } from '@/lib/session'

/**
 * The terms a piece of content is filed under.
 *
 * A checkbox per term rather than a multiple-select. A taxonomy is a tree, and a
 * native multiple-select cannot show the indentation that says so; it also asks a
 * person to hold Ctrl to pick a second thing, which is the interaction people get
 * wrong.
 *
 * The vocabularies offered are the ones that say they apply to this content type,
 * which is the whole reason that binding exists: a vocabulary for products must
 * not appear on a post.
 */
export function TermPicker({
  contentType,
  selected,
  onChange,
}: {
  contentType: TaxonomyContentType
  selected: string[]
  onChange: (termIds: string[]) => void
}): ReactNode {
  const client = useApiClient()
  const t = useT()

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse>({ vocabularies: [], terms: [] })
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let cancelled = false

    client
      .readTaxonomy()
      .then((response) => {
        if (cancelled) return
        setTaxonomy(response)
        setState('ready')
      })
      .catch((thrown: unknown) => {
        if (cancelled) return
        setProblem(describeApiError(thrown, t))
        setState('error')
      })

    return () => {
      cancelled = true
    }
  }, [client, t])

  const vocabularies = taxonomy.vocabularies.filter((vocabulary) =>
    vocabulary.contentTypes.includes(contentType),
  )

  function toggle(termId: string, checked: boolean): void {
    onChange(checked ? [...selected, termId] : selected.filter((id) => id !== termId))
  }

  return (
    <fieldset className="space-y-2" data-testid="term-picker">
      <legend className="text-sm font-medium">{t('taxonomy.pick')}</legend>

      {state === 'loading' && <p className="text-xs text-muted-foreground">{t('taxonomy.loading')}</p>}
      {state === 'error' && <p className="text-sm text-destructive">{problem}</p>}

      {state === 'ready' && vocabularies.length === 0 && (
        <>
          <p className="text-sm text-muted-foreground">{t('taxonomy.pick.none')}</p>
          <p className="text-xs text-muted-foreground">{t('taxonomy.pick.none.hint')}</p>
        </>
      )}

      {state === 'ready' &&
        vocabularies.map((vocabulary) => (
          <div key={vocabulary.id} className="space-y-1 rounded-lg border p-2">
            <p className="text-xs font-medium text-muted-foreground">{vocabulary.name}</p>

            {taxonomy.terms.filter((term) => term.vocabularyId === vocabulary.id).length === 0 && (
              <p className="text-xs text-muted-foreground">{t('taxonomy.noTerms')}</p>
            )}

            {taxonomy.terms
              .filter((term) => term.vocabularyId === vocabulary.id)
              .map((term) => (
                <Label
                  key={term.id}
                  className="font-normal"
                  style={{ paddingInlineStart: `${term.depth * 1.25}rem` }}
                >
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={selected.includes(term.id)}
                    onChange={(event) => toggle(term.id, event.target.checked)}
                  />
                  {term.name}
                </Label>
              ))}
          </div>
        ))}
    </fieldset>
  )
}
