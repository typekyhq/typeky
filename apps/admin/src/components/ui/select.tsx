"use client"

import * as React from "react"
import { cn } from "cn"
import { ChevronDownIcon } from "lucide-react"

/**
 * A dropdown, styled to sit beside `Input`.
 *
 * A native `<select>` rather than a popup built from a primitive, and that is a
 * decision rather than a shortcut. The options here are plain text, and the
 * control the browser provides is already right about the things that are hard:
 * the keyboard, the picker a phone opens, and what a screen reader announces. A
 * listbox built by hand has to earn all of that back.
 *
 * What was wrong was that it did not look like the field next to it. That is a
 * `className`, and it is why this exists: the same height, the same border, the
 * same radius and the same focus ring as `Input`, from the same tokens.
 *
 * `appearance-none` and a drawn chevron, because leaving the arrow to the
 * platform means macOS and Windows draw two different controls and neither one
 * matches the input beside it.
 */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent px-2.5 py-1 pe-8 text-base transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50",
          "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
          "md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 end-2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { Select }
