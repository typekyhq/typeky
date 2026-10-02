import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Image and video blocks.
 *
 * Both are atoms that hold a **media id, never a URL**: R2 keys and public URLs
 * change, and content written today should not break when they do (architecture
 * section 3.11). The URL is resolved when the page is rendered, by the site side.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      /** Inserts an image block, or replaces the selected atom. */
      setImage: (attributes?: Partial<ImageAttributes>) => ReturnType
    }
    video: {
      setVideo: (attributes?: Partial<VideoAttributes>) => ReturnType
    }
  }
}

export interface ImageAttributes {
  mediaId: string
  alt: string | null
}

export interface VideoAttributes {
  mediaId: string
  title: string | null
}

export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      mediaId: { default: '' },
      alt: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        // `:not([data-media-kind])` matters: a video is also a
        // `figure[data-media-id]`, and without it this rule would claim every
        // video before the video rule got a chance.
        tag: 'figure[data-media-id]:not([data-media-kind])',
        getAttrs: (element) => ({
          mediaId: element.getAttribute('data-media-id') ?? '',
          alt: element.getAttribute('data-alt'),
        }),
      },
    ]
  },

  renderHTML({ node }) {
    const attributes: Record<string, string> = { 'data-media-id': String(node.attrs.mediaId ?? '') }
    if (node.attrs.alt !== null && node.attrs.alt !== '') attributes['data-alt'] = String(node.attrs.alt)

    return ['figure', mergeAttributes(attributes)]
  },

  addCommands() {
    return {
      setImage:
        (attributes = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { mediaId: '', alt: null, ...attributes } }),
    }
  },
})

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      mediaId: { default: '' },
      title: { default: null },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-media-kind="video"]',
        getAttrs: (element) => ({
          mediaId: element.getAttribute('data-media-id') ?? '',
          title: element.getAttribute('data-title'),
        }),
      },
    ]
  },

  renderHTML({ node }) {
    const attributes: Record<string, string> = {
      'data-media-kind': 'video',
      'data-media-id': String(node.attrs.mediaId ?? ''),
    }
    if (node.attrs.title !== null && node.attrs.title !== '') attributes['data-title'] = String(node.attrs.title)

    return ['figure', mergeAttributes(attributes)]
  },

  addCommands() {
    return {
      setVideo:
        (attributes = {}) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { mediaId: '', title: null, ...attributes } }),
    }
  },
})
