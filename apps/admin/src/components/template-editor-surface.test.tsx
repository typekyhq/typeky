// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TemplateEditorSurface } from './template-editor-surface'

/**
 * The editor against the thing that was rebuilding it.
 *
 * Every screen passes its own live state as `initialSource`, so that prop changes on
 * every keystroke. While the mount effect watched it, each letter destroyed the
 * editor and built another one -- which put the caret back at the top of the
 * document, so the next letter landed in the wrong place and typing was impossible.
 *
 * A component test cannot see a caret, but it can see the rebuild, which is the
 * cause. The editor itself is replaced with something that records being built.
 */

const built = vi.hoisted(() => [] as string[])

vi.mock('@/lib/template-editor', () => ({
  TemplateEditor: class {
    constructor(_parent: HTMLElement, options: { initialSource: string }) {
      built.push(options.initialSource)
    }
    markError(): void {}
    destroy(): void {}
  },
}))

async function settle(): Promise<void> {
  // The import inside the effect is a promise; two turns is what it takes to run.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the template editor surface', () => {
  it('builds the editor once, not once per keystroke', async () => {
    built.length = 0
    const onChange = (): void => undefined

    const { rerender } = render(
      <TemplateEditorSurface initialSource="first" onChange={onChange} />,
    )
    await waitFor(() => {
      expect(built).toHaveLength(1)
    })

    // What typing looks like from the outside: the caller's state grew, so the prop
    // grew with it.
    rerender(<TemplateEditorSurface initialSource="first and more" onChange={onChange} />)
    await settle()

    expect(built).toHaveLength(1)
  })

  it('builds another one when the caller keys it, which is how a document changes', async () => {
    built.length = 0
    const onChange = (): void => undefined

    const { rerender } = render(
      <TemplateEditorSurface key="one" initialSource="first" onChange={onChange} />,
    )
    await waitFor(() => {
      expect(built).toHaveLength(1)
    })

    rerender(<TemplateEditorSurface key="two" initialSource="second" onChange={onChange} />)
    await waitFor(() => {
      expect(built).toHaveLength(2)
    })

    expect(built[1]).toBe('second')
  })
})
