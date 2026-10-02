import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/states'
import { useT } from '@/lib/i18n'
import type { NavigationItem } from '@/lib/navigation'

/**
 * Every section renders through here until it is built.
 *
 * Saying what the section will do is more useful than an empty div, and it keeps
 * the shell honest: the navigation leads somewhere, even if that somewhere is
 * "not yet".
 */
export function SectionPage({ section }: { section: NavigationItem }) {
  const t = useT()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t(section.labelKey)}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t(section.descriptionKey)}</p>
      </div>

      <Alert>
        <AlertTitle>{t('section.notBuilt.title')}</AlertTitle>
        <AlertDescription>{t('section.notBuilt.description')}</AlertDescription>
      </Alert>

      <EmptyState title={t('section.empty.title')} description={t('section.empty.description')} />
    </div>
  )
}
