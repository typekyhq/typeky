import { Node, mergeAttributes } from '@tiptap/core'

/**
 * The call-to-action block.
 *
 * Four plain-text attributes rather than editable rich content, because the
 * theme renders it as a banner: a paragraph of prose in the middle of a button
 * row is not something a template can lay out. Section 7.9 draws the same line
 * for section parameters -- parameters are data, not markup.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    cta: {
      setCta: (attributes?: Partial<CtaAttributes>) => ReturnType
    }
  }
}

export interface CtaAttributes {
  title: string
  body: string
  label: string
  href: string
}

export const Cta = Node.create({
  name: 'cta',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      title: { default: '' },
      body: { default: '' },
      label: { default: 'Learn more' },
      href: { default: '/' },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'aside[data-cta]',
        getAttrs: (element) => ({
          title: element.getAttribute('data-title') ?? '',
          body: element.getAttribute('data-body') ?? '',
          label: element.getAttribute('data-label') ?? '',
          href: element.getAttribute('data-href') ?? '',
        }),
      },
    ]
  },

  renderHTML({ node }) {
    return [
      'aside',
      mergeAttributes({
        'data-cta': 'true',
        'data-title': String(node.attrs.title ?? ''),
        'data-body': String(node.attrs.body ?? ''),
        'data-label': String(node.attrs.label ?? ''),
        'data-href': String(node.attrs.href ?? ''),
      }),
    ]
  },

  addCommands() {
    return {
      setCta:
        (attributes = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { ...attributes } }),
    }
  },
})
