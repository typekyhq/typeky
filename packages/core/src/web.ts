/**
 * The few web-standard globals this package uses, narrowed in one place.
 *
 * `lib: ["ES2022"]` is the compile target because core runs in three places at
 * once -- a Worker, a browser and Node -- and no single lib set is available in
 * all three. Everything below is: `crypto`, `atob`/`btoa` and the text codecs are
 * in the web standard that all three implement. Only the *types* are missing.
 *
 * Narrowing them here rather than declaring them per module means the modules
 * read as ordinary code. The cast is the price of a package that cannot pick one
 * runtime's lib set, and it is paid once.
 */

interface SubtleCryptoLike {
  importKey(
    format: 'raw',
    key: Uint8Array,
    algorithm: { name: string },
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>
  verify(
    algorithm: { name: string },
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>
}

interface TextEncoderLike {
  encode(input?: string): Uint8Array
}

interface TextDecoderLike {
  decode(input?: ArrayBufferView): string
}

interface WebGlobals {
  crypto: {
    getRandomValues<T extends ArrayBufferView>(array: T): T
    subtle: SubtleCryptoLike
  }
  atob(value: string): string
  btoa(value: string): string
  TextEncoder: new () => TextEncoderLike
  TextDecoder: new () => TextDecoderLike
}

const web = globalThis as unknown as WebGlobals

export const crypto = web.crypto
export const atob = web.atob
export const btoa = web.btoa

// Built once: constructing a codec per call is pure overhead, and neither holds
// any state between uses.
export const encoder = new web.TextEncoder()
export const decoder = new web.TextDecoder()
