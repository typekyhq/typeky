import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/states'
import type { NavigationItem } from '@/lib/navigation'

/**
 * Every section renders through here until it is built.
 *
 * Saying what the section will do is more useful than an empty div, and it keeps
 * the shell honest: the navigation leads somewhere, even if that somewhere is
 * "not yet".
 */
export function SectionPage({ section }: { section: NavigationItem }) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{section.label}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{section.description}</p>
      </div>

      <Alert>
        <AlertTitle>Not built yet</AlertTitle>
        <AlertDescription>
          This screen exists so the shell, the routing and the session handling can be exercised.
          The real one arrives with the content work.
        </AlertDescription>
      </Alert>

      <EmptyState
        title="Nothing here yet"
        description="Once this section is built, its list will appear in this space."
      />
    </div>
  )
}
