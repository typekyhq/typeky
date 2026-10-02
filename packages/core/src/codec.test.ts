import { describe, expect, it } from 'vitest'
import {
  decodeBoolean,
  decodeJson,
  decodeNullableJson,
  decodeTimestamp,
  encodeBoolean,
  encodeJson,
  encodeTimestamp,
  nowIso,
} from './codec'

describe('codec', () => {
  it('round-trips a JSON column', () => {
    const value = {
      blocks: [{ id: 'blk_1', type: 'paragraph' }],
      tags: ['getting-started'],
      nested: { published: true },
    }

    expect(decodeJson<typeof value>(encodeJson(value))).toEqual(value)
  })

  it('maps null through for nullable JSON columns', () => {
    expect(decodeNullableJson(null)).toBeNull()
    expect(decodeNullableJson('null')).toBeNull()
    expect(decodeNullableJson<number[]>('[]')).toEqual([])
  })

  it('stores booleans as 0 and 1, because neither D1 nor SQLite binds a boolean', () => {
    expect(encodeBoolean(true)).toBe(1)
    expect(encodeBoolean(false)).toBe(0)
    expect(decodeBoolean(1)).toBe(true)
    expect(decodeBoolean(0)).toBe(false)
    expect(decodeBoolean(null)).toBeNull()
  })

  it('treats any non-zero integer as true rather than only literal 1', () => {
    expect(decodeBoolean(7)).toBe(true)
  })

  it('stores timestamps as ISO 8601 UTC text, which sorts chronologically', () => {
    const earlier = encodeTimestamp(new Date('2026-01-01T00:00:00.000Z'))
    const later = encodeTimestamp(new Date('2026-01-02T00:00:00.000Z'))

    expect(earlier < later).toBe(true)
    expect(decodeTimestamp(earlier)?.toISOString()).toBe(earlier)
    expect(decodeTimestamp(null)).toBeNull()
  })

  it('produces the stored format from nowIso', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})
