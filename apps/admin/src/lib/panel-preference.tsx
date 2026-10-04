import type { AdminSettings } from '@typeky/api'
import { DEFAULT_ADMIN_DATE_FORMAT, DEFAULT_LANGUAGE, formatDate } from '@typeky/core'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useApiClient } from './client-context'

/**
 * The panel's own language and date format.
 *
 * They live in the site document -- one deployment, one operator, and a row that
 * already exists -- but they are read by the whole shell rather than by the
 * settings screen alone: a timestamp appears in the post list, the editors and
 * the theme list, and every one of those has to write it the way the operator
 * asked. So the document is fetched once here and handed down.
 *
 * The zone is the operator's own. A date in the panel answers "when did I do
 * that", which is a question about their clock; the site's dates answer "when was
 * this published", which is about the document, and the bundled theme renders
 * those in UTC. The two are deliberately different and both are deliberate.
 */

/**
 * The site's own brand, as the panel shows it.
 *
 * The panel belongs to the site owner, so it wears their logo rather than the
 * platform's name -- one deployment, one operator, and the same document that
 * already carries the site's name. Null until there is a site document, and until
 * it has a logo.
 */
export interface PanelBrand {
  name: string
  /** Already a URL this panel can serve; null when no logo is set. */
  logoUrl: string | null
}

export interface PanelPreference {
  language: string
  dateFormat: string
  /** How this panel writes a timestamp. */
  format: (value: string | null | undefined) => string
  /** Called after the settings screen saves, so the shell stops using the old one. */
  refresh: () => void
  brand: PanelBrand | null
}

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * A timestamp in the operator's own zone, in a format given here.
 *
 * Separate from the context so the settings screen can preview a format that has
 * not been saved yet -- and through the same zone, or the preview would be of a
 * different date than the one it is about to produce.
 */
/**
 * Whether a panel language is written right to left.
 *
 * A list rather than a property of the language file, because what it decides is the
 * document's direction and not its words: a translation that got the layout wrong is
 * a translation that is worse than the English it replaced.
 */
const RIGHT_TO_LEFT = new Set(['ar', 'fa', 'he', 'ur'])

function isRightToLeft(language: string): boolean {
  return RIGHT_TO_LEFT.has(language.split('-')[0]?.toLowerCase() ?? '')
}

export function formatLocal(value: string | null | undefined, format: string): string {
  return formatDate(value, format, { timeZone: LOCAL_ZONE })
}

const PanelPreferenceContext = createContext<PanelPreference>({
  language: DEFAULT_LANGUAGE,
  dateFormat: DEFAULT_ADMIN_DATE_FORMAT,
  format: (value) => formatLocal(value, DEFAULT_ADMIN_DATE_FORMAT),
  refresh: () => undefined,
  brand: null,
})

export function PanelPreferenceProvider({ children }: { children: ReactNode }) {
  const client = useApiClient()
  const [settings, setSettings] = useState<AdminSettings>({})
  const [brand, setBrand] = useState<PanelBrand | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    client.getSite().then(
      (site) => {
        if (cancelled) return

        setSettings(site.settings.admin ?? {})
        setBrand({
          name: site.name,
          // Built here rather than in the sidebar: how the panel serves media is
          // this module's business, and a screen that had to know it would be a
          // second place to change when it moves.
          logoUrl: site.logoMediaId === null ? null : client.mediaContentUrl(site.logoMediaId),
        })
      },
      () => {
        // Deliberately silent. A panel that cannot read its own preference still
        // works, in the default language and the default format, and a toast
        // about it on every screen would be worse than either.
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, attempt])

  const refresh = useCallback(() => {
    setAttempt((value) => value + 1)
  }, [])

  const dateFormat = settings.dateFormat ?? DEFAULT_ADMIN_DATE_FORMAT
  const language = settings.language ?? DEFAULT_LANGUAGE

  // The panel's own `lang`, which is what a screen reader reads the interface
  // aloud in. It is the panel's language and not the site's: they are two
  // different readers.
  //
  // `dir` is set beside it, and that is the half that is easy to forget: Arabic is
  // written right to left, and a panel that kept a left-to-right layout would put
  // the interface in the wrong place rather than merely in the wrong words. What
  // this does *not* do is mirror the components -- Tailwind's physical utilities
  // (`px-`, `ml-`, and the drawn chevron on a select) still point the way they were
  // written, so a full right-to-left pass is still owed.
  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = isRightToLeft(language) ? 'rtl' : 'ltr'
  }, [language])

  return (
    <PanelPreferenceContext.Provider
      value={{
        language,
        dateFormat,
        format: (value) => formatLocal(value, dateFormat),
        refresh,
        brand,
      }}
    >
      {children}
    </PanelPreferenceContext.Provider>
  )
}

export function usePanelPreference(): PanelPreference {
  return useContext(PanelPreferenceContext)
}

/**
 * For a test that needs the hook to work without a provider.
 *
 * `brand` is a parameter rather than a fixed null: the shell's brand is the site's
 * logo, and a test that could only ever see the fallback would not be able to ask
 * about the logo at all.
 */
export function panelPreferenceFor(
  settings: AdminSettings,
  brand: PanelBrand | null = null,
): PanelPreference {
  const dateFormat = settings.dateFormat ?? DEFAULT_ADMIN_DATE_FORMAT

  return {
    language: settings.language ?? DEFAULT_LANGUAGE,
    dateFormat,
    format: (value) => formatLocal(value, dateFormat),
    refresh: () => undefined,
    brand,
  }
}
