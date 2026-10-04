import {
  TAXONOMY_CONTENT_TYPES,
  type TaxonomyContentType,
  type TaxonomyResponse,
  type Term,
  type TermWrite,
  type Vocabulary,
  type VocabularyWrite,
} from '@typeky/api'
import { ChevronRightIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useApiClient } from '@/lib/client-context'
import { useT } from '@/lib/i18n'
import { describeApiError } from '@/lib/session'
import { slugify } from '@/lib/slug'

/**
 * The taxonomy: vocabularies on the left, the open one on the right.
 *
 * One screen because it is one idea. A vocabulary is a container, its terms are
 * what it contains, and the setting that matters about it is which content types
 * may draw from it -- three facts about the same row, which three screens would
 * make into three places to look.
 *
 * The tree is a flat list of rows with an indent per level, not a nested
 * structure. That is what the API answers with, and it is also what makes every
 * operation here one row: a nested tree is a structure you have to map over and
 * rebuild to change one leaf.
 *
 * What is deliberately missing: creating a term from inside a post. The editor
 * picks from these terms and links here -- a picker that could also add would be
 * a second place where a term's slug gets decided.
 */

type LoadState = 'loading' | 'ready' | 'error'

interface VocabularyForm {
  name: string
  description: string
  contentTypes: TaxonomyContentType[]
}

interface TermDraft {
  /** Null while creating. */
  id: string | null
  vocabularyId: string
  name: string
  slug: string
  description: string
  /** Empty string means a root term. */
  parentId: string
  /** True once the slug is typed by hand; until then it follows the name. */
  slugTouched: boolean
}

const BLANK_VOCABULARY: VocabularyForm = { name: '', description: '', contentTypes: [] }

function formOf(vocabulary: Vocabulary): VocabularyForm {
  return {
    name: vocabulary.name,
    description: vocabulary.description ?? '',
    contentTypes: vocabulary.contentTypes,
  }
}

export function TaxonomyPage(): ReactNode {
  const client = useApiClient()
  const t = useT()

  const [state, setState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [data, setData] = useState<TaxonomyResponse>({ vocabularies: [], terms: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<TermDraft | null>(null)

  const load = useCallback(async (): Promise<TaxonomyResponse | null> => {
    try {
      const response = await client.readTaxonomy()
      setData(response)
      setState('ready')
      // Falling back to the first vocabulary is what keeps the screen from going
      // blank after the open one is deleted.
      setSelectedId((current) =>
        response.vocabularies.some((vocabulary) => vocabulary.id === current)
          ? current
          : (response.vocabularies[0]?.id ?? null),
      )
      return response
    } catch (thrown) {
      setLoadError(describeApiError(thrown, t))
      setState('error')
      return null
    }
  }, [client, t])

  useEffect(() => {
    void load()
  }, [load])

  const selected = data.vocabularies.find((vocabulary) => vocabulary.id === selectedId) ?? null
  const terms = useMemo(
    () => data.terms.filter((term) => term.vocabularyId === selectedId),
    [data.terms, selectedId],
  )
  // Every vocabulary's name, for the slug error that has to say where the other
  // term lives -- the collision can be in a vocabulary this screen is not showing.
  const vocabularyNames = useMemo(
    () => Object.fromEntries(data.vocabularies.map((vocabulary) => [vocabulary.id, vocabulary.name])),
    [data.vocabularies],
  )

  // The delete confirmation names the vocabulary, and the term's names how much
  // content it would detach: a count is the difference between "are you sure" and
  // a decision.
  const removeVocabulary = useCallback(
    async (vocabulary: Vocabulary) => {
      if (!window.confirm(t('taxonomy.deleteVocabularyConfirm', { name: vocabulary.name }))) return

      try {
        await client.deleteVocabulary(vocabulary.id)
        toast.success(t('taxonomy.vocabularyDeleted'))
        setDraft(null)
        await load()
      } catch (thrown) {
        toast.error(describeApiError(thrown, t))
      }
    },
    [client, load, t],
  )

  const removeTerm = useCallback(
    async (term: Term) => {
      if (!window.confirm(t('taxonomy.deleteTermConfirm', { name: term.name }))) {
        return
      }

      try {
        await client.deleteTerm(term.id)
        toast.success(t('taxonomy.termDeleted'))
        setDraft((current) => (current?.id === term.id ? null : current))
        await load()
      } catch (thrown) {
        toast.error(describeApiError(thrown, t))
      }
    },
    [client, load, t],
  )

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t('taxonomy.title')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('taxonomy.subtitle')}</p>
      </div>

      {state === 'error' && (
        <ErrorState title={t('taxonomy.loadFailed')} description={loadError} onRetry={() => void load()} />
      )}
      {state === 'loading' && <LoadingState label={t('taxonomy.loading')} />}

      {state === 'ready' && (
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <nav
            aria-label={t('taxonomy.vocabularyList')}
            className="rounded-lg border p-2 md:w-72 md:shrink-0"
            data-testid="vocabulary-list"
          >
            {data.vocabularies.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">{t('taxonomy.noVocabularies')}</p>
            ) : (
              <ul className="space-y-1">
                {data.vocabularies.map((vocabulary) => {
                  const open = !creating && vocabulary.id === selectedId
                  const count = data.terms.filter((term) => term.vocabularyId === vocabulary.id).length

                  return (
                    <li key={vocabulary.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setCreating(false)
                          setSelectedId(vocabulary.id)
                          setDraft(null)
                        }}
                        aria-current={open ? 'true' : undefined}
                        className={
                          open
                            ? 'flex w-full items-center justify-between gap-2 rounded-lg bg-muted px-2 py-1.5 text-left text-sm'
                            : 'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/50'
                        }
                      >
                        <span className="min-w-0 truncate">{vocabulary.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t('taxonomy.termCount', { count })}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="mt-2 border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setCreating(true)
                  setDraft(null)
                }}
              >
                <PlusIcon aria-hidden="true" />
                {t('taxonomy.newVocabulary')}
              </Button>
            </div>
          </nav>

          <div className="min-w-0 flex-1 space-y-6">
            {creating ? (
              <VocabularyEditor
                key="new"
                initial={BLANK_VOCABULARY}
                saveLabel={t('taxonomy.create')}
                onSave={async (form) => {
                  const vocabulary = await client.createVocabulary(writeOf(form))
                  toast.success(t('taxonomy.vocabularySaved'))
                  setCreating(false)
                  setSelectedId(vocabulary.id)
                  await load()
                }}
                onError={(thrown) => toast.error(describeApiError(thrown, t))}
              />
            ) : selected === null ? (
              <EmptyState
                title={t('taxonomy.pickVocabulary')}
                description={t('taxonomy.pickVocabulary.hint')}
              />
            ) : (
              <>
                <VocabularyEditor
                  key={selected.id}
                  initial={formOf(selected)}
                  saveLabel={t('taxonomy.save')}
                  onDelete={() => void removeVocabulary(selected)}
                  onSave={async (form) => {
                    await client.saveVocabulary(selected.id, writeOf(form))
                    toast.success(t('taxonomy.vocabularySaved'))
                    await load()
                  }}
                  onError={(thrown) => toast.error(describeApiError(thrown, t))}
                />

                <TermsPanel
                  vocabulary={selected}
                  terms={terms}
                  allTerms={data.terms}
                  vocabularyNames={vocabularyNames}
                  draft={draft}
                  onDraft={setDraft}
                  onDelete={(term) => void removeTerm(term)}
                  onChanged={load}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function writeOf(form: VocabularyForm): VocabularyWrite {
  return {
    name: form.name.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    contentTypes: form.contentTypes,
  }
}

/**
 * The open vocabulary's own fields.
 *
 * Owns its state and is mounted with a `key` of the vocabulary's id, so switching
 * vocabulary replaces the form rather than syncing it -- which is the thing that
 * silently keeps a half-typed name from the previous row.
 */
function VocabularyEditor({
  initial,
  saveLabel,
  onSave,
  onDelete,
  onError,
}: {
  initial: VocabularyForm
  saveLabel: string
  onSave: (form: VocabularyForm) => Promise<void>
  onDelete?: () => void
  onError: (thrown: unknown) => void
}): ReactNode {
  const t = useT()
  const [form, setForm] = useState<VocabularyForm>(initial)
  const [saving, setSaving] = useState(false)

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await onSave(form)
    } catch (thrown) {
      onError(thrown)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      data-testid="vocabulary-editor"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <Field
        id="vocabulary-name"
        label={t('taxonomy.vocabularyName')}
        value={form.name}
        onChange={(value) => setForm((current) => ({ ...current, name: value }))}
      />

      <div className="space-y-2">
        <Label htmlFor="vocabulary-description">{t('taxonomy.vocabularyDescription')}</Label>
        <Textarea
          id="vocabulary-description"
          rows={2}
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />
        <p className="text-xs text-muted-foreground">{t('taxonomy.vocabularyDescription.hint')}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('taxonomy.appliesTo')}</legend>
        <div className="flex flex-wrap gap-4">
          {TAXONOMY_CONTENT_TYPES.map((contentType) => (
            <Label key={contentType} className="font-normal">
              <input
                type="checkbox"
                className="size-4"
                checked={form.contentTypes.includes(contentType)}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    contentTypes: event.target.checked
                      ? [...current.contentTypes, contentType]
                      : current.contentTypes.filter((value) => value !== contentType),
                  }))
                }
              />
              {t(`taxonomy.appliesTo.${contentType}`)}
            </Label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('taxonomy.appliesTo.hint')}</p>
      </fieldset>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving || form.name.trim() === ''}>
          {saveLabel}
        </Button>
        {onDelete !== undefined && (
          <Button type="button" variant="destructive" onClick={onDelete}>
            <Trash2Icon aria-hidden="true" />
            {t('taxonomy.deleteVocabulary')}
          </Button>
        )}
      </div>
    </form>
  )
}

/**
 * The terms of the open vocabulary.
 *
 * One row per term, indented by its depth, with the three things one row can do.
 * The form for adding or editing is a single one below the list rather than a
 * form per row: an editor inside a list makes every row taller than the row above
 * it and turns a scannable list into a form.
 */
function TermsPanel({
  vocabulary,
  terms,
  allTerms,
  vocabularyNames,
  draft,
  onDraft,
  onDelete,
  onChanged,
}: {
  vocabulary: Vocabulary
  terms: Term[]
  /** Every term on the site, for the slug-uniqueness check. */
  allTerms: Term[]
  vocabularyNames: Record<string, string>
  draft: TermDraft | null
  onDraft: (draft: TermDraft | null) => void
  onDelete: (term: Term) => void
  onChanged: () => Promise<unknown>
}): ReactNode {
  const t = useT()
  const client = useApiClient()

  function startCreate(parentId: string): void {
    onDraft({
      id: null,
      vocabularyId: vocabulary.id,
      name: '',
      slug: '',
      description: '',
      parentId,
      slugTouched: false,
    })
  }

  function startEdit(term: Term): void {
    onDraft({
      id: term.id,
      vocabularyId: term.vocabularyId,
      name: term.name,
      slug: term.slug,
      description: term.description ?? '',
      parentId: term.parentId ?? '',
      slugTouched: true,
    })
  }

  const choices = draft === null ? [] : parentChoices(terms, draft)

  return (
    <section className="space-y-3" data-testid="term-list">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('taxonomy.terms')}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{t('taxonomy.terms.hint')}</p>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={() => startCreate('')}>
        <PlusIcon aria-hidden="true" />
        {t('taxonomy.addTerm')}
      </Button>

      {terms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('taxonomy.noTerms')}</p>
      ) : (
        <ul className="rounded-lg border" data-testid="term-tree">
          {terms.map((term) => (
            <li
              key={term.id}
              className="flex items-center justify-between gap-2 border-b px-2 py-1.5 last:border-b-0"
              style={{ paddingInlineStart: `${0.5 + term.depth * 1.25}rem` }}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-sm">{term.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{term.slug}</span>
                {term.usage > 0 && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('taxonomy.usedBy', { count: term.usage })}
                  </span>
                )}
              </span>

              <span className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('taxonomy.addChildLabel', { name: term.name })}
                  onClick={() => startCreate(term.id)}
                >
                  <ChevronRightIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('taxonomy.editTermLabel', { name: term.name })}
                  onClick={() => startEdit(term)}
                >
                  <PencilIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('taxonomy.deleteTermLabel', { name: term.name })}
                  onClick={() => onDelete(term)}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {draft !== null && (
        <TermForm
          key={draft.id ?? `new:${draft.parentId}`}
          draft={draft}
          choices={choices}
          allTerms={allTerms}
          vocabularyNames={vocabularyNames}
          onCancel={() => onDraft(null)}
          onSave={async (saved) => {
            const body: TermWrite = {
              vocabularyId: draft.vocabularyId,
              parentId: saved.parentId === '' ? null : saved.parentId,
              name: saved.name.trim(),
              slug: saved.slug.trim(),
              description: saved.description.trim() === '' ? null : saved.description.trim(),
            }

            if (saved.id === null) await client.createTerm(body)
            else await client.saveTerm(saved.id, body)

            toast.success(t('taxonomy.termSaved'))
            onDraft(null)
            await onChanged()
          }}
        />
      )}
    </section>
  )
}

/**
 * The form for one term.
 *
 * Owns its state and takes a `key`, like the vocabulary editor: opening another
 * term replaces it, so there is no moment where the previous term's name is still
 * in a field the operator is about to save.
 */
function TermForm({
  draft,
  choices,
  allTerms,
  vocabularyNames,
  onSave,
  onCancel,
}: {
  draft: TermDraft
  choices: Term[]
  allTerms: Term[]
  vocabularyNames: Record<string, string>
  onSave: (draft: TermDraft) => Promise<void>
  onCancel: () => void
}): ReactNode {
  const t = useT()
  const [form, setForm] = useState<TermDraft>(draft)
  const [saving, setSaving] = useState(false)

  const title = form.id === null ? t('taxonomy.addTerm') : t('taxonomy.editTerm')

  // A term's slug is its archive address (`/category/{slug}`), so it has to be
  // unique across the whole site -- not only inside this vocabulary. Checked here
  // as well as on the server, so the refusal lands on the field instead of in a
  // toast after a round trip. The other term may live in a vocabulary this screen
  // is not showing, which is why the message names it.
  const slug = form.slug.trim()
  const clash =
    slug === '' ? null : (allTerms.find((term) => term.slug === slug && term.id !== form.id) ?? null)
  const slugError =
    clash === null
      ? undefined
      : t('taxonomy.termSlug.taken', {
          name: clash.name,
          vocabulary: vocabularyNames[clash.vocabularyId] ?? '',
        })

  return (
    <form
      className="space-y-4 rounded-lg border p-4"
      data-testid="term-editor"
      onSubmit={(event) => {
        event.preventDefault()
        setSaving(true)
        void onSave(form).finally(() => setSaving(false))
      }}
    >
      <p className="text-sm font-medium">{title}</p>

      <Field
        id="term-name"
        label={t('taxonomy.termName')}
        value={form.name}
        onChange={(value) =>
          setForm((current) => ({
            ...current,
            name: value,
            // Only for a new term, and only until the slug is typed by hand: an
            // existing term's slug is its address, and rewriting it silently
            // would break whatever already points at it.
            ...(current.slugTouched || current.id !== null ? {} : { slug: slugify(value) }),
          }))
        }
      />
      <Field
        id="term-slug"
        label={t('taxonomy.termSlug')}
        value={form.slug}
        hint={t('taxonomy.termSlug.hint')}
        error={slugError}
        onChange={(value) => setForm((current) => ({ ...current, slug: value, slugTouched: true }))}
      />

      <div className="space-y-2">
        <Label htmlFor="term-parent">{t('taxonomy.termParent')}</Label>
        <Select
          id="term-parent"
          value={form.parentId}
          onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value }))}
        >
          <option value="">{t('taxonomy.termParent.none')}</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {`${'\u00a0\u00a0'.repeat(choice.depth)}${choice.name}`}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t('taxonomy.termParent.hint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="term-description">{t('taxonomy.termDescription')}</Label>
        <Textarea
          id="term-description"
          rows={2}
          value={form.description}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving || form.name.trim() === '' || form.slug.trim() === '' || slugError !== undefined}>
          {form.id === null ? t('taxonomy.create') : t('taxonomy.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('taxonomy.cancel')}
        </Button>
      </div>
    </form>
  )
}

/**
 * The terms that may be this one's parent.
 *
 * Excludes the term itself and its descendants. The server refuses a cycle
 * anyway, but offering one is offering a mistake: the tree is depth first, so a
 * descendant is any following row deeper than this one, and the first row at the
 * same depth or shallower ends the branch.
 */
function parentChoices(terms: Term[], draft: TermDraft): Term[] {
  if (draft.id === null) return terms

  const index = terms.findIndex((term) => term.id === draft.id)
  if (index === -1) return terms

  const own = terms[index]?.depth ?? 0
  const excluded = new Set<string>([draft.id])
  for (let cursor = index + 1; cursor < terms.length; cursor += 1) {
    const row = terms[cursor]
    if (row === undefined || row.depth <= own) break
    excluded.add(row.id)
  }

  return terms.filter((term) => !excluded.has(term.id))
}
