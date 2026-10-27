import { describe, expect, it } from 'vitest'
import { rankChangeLabel } from '../src/entities/ranking'
describe('榜单变化文案', () => {
  it('明确区分进入前250、上升、下降和持平', () => {
    expect(rankChangeLabel({ kind: 'entered', delta: null })).toBe('进入前250')
    expect(rankChangeLabel({ kind: 'up', delta: 12 })).toBe('↑ 12')
    expect(rankChangeLabel({ kind: 'down', delta: -8 })).toBe('↓ 8')
    expect(rankChangeLabel({ kind: 'same', delta: 0 })).toBe('持平')
  })
})
