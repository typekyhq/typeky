import type { ReactNode } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * The three states every screen needs and none of them should reinvent.
 *
 * Each announces itself to assistive technology: a loading region is `status`
 * with `aria-busy`, and a failure is `alert`, so a screen reader says something
 * when the state changes rather than leaving the page silent.
 */

export function LoadingState({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description !== undefined && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string
  description?: string
  onRetry?: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      {description !== undefined && <AlertDescription>{description}</AlertDescription>}
      {onRetry !== undefined && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}
