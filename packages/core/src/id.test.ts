import { describe, expect, it } from 'vitest'
import { isUuidV7, uuidv7 } from './id'

describe('uuidv7', () => {
  it('produces a version 7 uuid', () => {
    expect(isUuidV7(uuidv7())).toBe(true)
  })

  it('encodes the timestamp, so a later millisecond sorts later as a string', () => {
    const earlier = uuidv7(1_700_000_000_000)
    const later = uuidv7(1_700_000_001_000)

    expect(earlier < later).toBe(true)
  })

  it('stays ordered and unique inside a single millisecond', () => {
    const ids = Array.from({ length: 200 }, () => uuidv7(1_700_000_000_000))

    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects a uuid carrying a different version', () => {
    expect(isUuidV7('01930000-0000-4000-8000-000000000001')).toBe(false)
  })

  it('rejects a uuid with the wrong layout', () => {
    expect(isUuidV7('not-a-uuid')).toBe(false)
    expect(isUuidV7('01930000-0000-7000-0000-000000000001')).toBe(false)
  })
})
