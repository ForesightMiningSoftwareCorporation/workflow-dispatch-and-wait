/**
 * Unit tests for src/wait.ts
 */

import { utils } from '../src/utils'
import { expect } from '@jest/globals'

describe('wait.ts', () => {
  it('throws an invalid number', async () => {
    const input = parseInt('foo', 10)
    expect(isNaN(input)).toBe(true)

    await expect(utils(input)).rejects.toThrow('milliseconds not a number')
  })

  it('waits with a valid number', async () => {
    const start = new Date()
    await utils(500)
    const end = new Date()

    const delta = Math.abs(end.getTime() - start.getTime())

    expect(delta).toBeGreaterThan(450)
  })
})
