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

export interface PanelPreference {
  language: string
  dateFormat: string
  /** How this panel writes a timestamp. */
  format: (value: string | null | undefined) => string
  /** Called after the settings screen saves, so the shell stops using the old one. */
  refresh: () => void
}

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

/**
 * A timestamp in the operator's own zone, in a format given here.
 *
 * Separate from the context so the settings screen can preview a format that has
 * not been saved yet -- and through the same zone, or the preview would be of a
 * different date than the one it is about to produce.
 */
export function formatLocal(value: string | null | undefined, format: string): string {
  return formatDate(value, format, { timeZone: LOCAL_ZONE })
}

const PanelPreferenceContext = createContext<PanelPreference>({
  language: DEFAULT_LANGUAGE,
  dateFormat: DEFAULT_ADMIN_DATE_FORMAT,
  format: (value) => formatLocal(value, DEFAULT_ADMIN_DATE_FORMAT),
  refresh: () => undefined,
})

export function PanelPreferenceProvider({ children }: { children: ReactNode }) {
  const client = useApiClient()
  const [settings, setSettings] = useState<AdminSettings>({})
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    client.getSite().then(
      (site) => {
        if (!cancelled) setSettings(site.settings.admin ?? {})
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

  return (
    <PanelPreferenceContext.Provider
      value={{
        language,
        dateFormat,
        format: (value) => formatLocal(value, dateFormat),
        refresh,
      }}
    >
      {children}
    </PanelPreferenceContext.Provider>
  )
}

export function usePanelPreference(): PanelPreference {
  return useContext(PanelPreferenceContext)
}

/** For a test that needs the hook to work without a provider. */
export function panelPreferenceFor(settings: AdminSettings): PanelPreference {
  const dateFormat = settings.dateFormat ?? DEFAULT_ADMIN_DATE_FORMAT

  return {
    language: settings.language ?? DEFAULT_LANGUAGE,
    dateFormat,
    format: (value) => formatLocal(value, dateFormat),
    refresh: () => undefined,
  }
}
