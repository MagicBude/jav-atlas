/** 来源适配器是纯函数，可用极小合成记录独立验证，不依赖真实站点。 */
import { expect, it } from 'vitest'
import { collectSources, projectPerson } from '../scripts/adapters.mjs'
it('启用榜单池只展示上榜人物，保留成员原记录且不修改存档', () => {
  const roster = [
    { mnid: '1', name: '上榜', extra: '完整字段' },
    { mnid: '2', name: '存档' }
  ]
  const snapshot = structuredClone(roster)
  const files: Record<string, unknown> = {
    'minnano/actresses.json': roster,
    'minnano/ranked-pool.json': { schemaVersion: 1, members: { '1': { id: '1' } } }
  }
  const rows = collectSources((file: string, fallback: unknown) => files[file] || fallback)
  expect(rows.minnano).toHaveLength(1)
  expect(rows.minnano[0].records.directory).toEqual(roster[0])
  expect(roster).toEqual(snapshot)
})
it('未知性别不覆盖已有明确依据，两份原记录与未知新增字段保留', () => {
  const actor = { id: 'AbC', name: '姓名', gender: '?', sourceOnly: { keep: '完整原文' } }
  const uc = { id: 'AbC', name: '姓名', gender: 'f', genderSource: 'known', uc_codes: ['CODE'] }
  const files: Record<string, unknown> = {
    'javdb/actors.json': { list: [actor] },
    'javdb/uncensored-actors.json': { list: [uc] }
  }
  const rows = collectSources((file: string, fallback: unknown) => files[file] || fallback)
  expect(rows.javdb).toHaveLength(1)
  expect(rows.javdb[0].main.gender).toBe('f')
  expect(rows.javdb[0].records.actors).toEqual(actor)
  expect(rows.javdb[0].records.uncensored).toEqual(uc)
})
it('数值解析保留零，别名去重不改源对象，标签所属来源不串用', () => {
  const input = {
    name: '姓名',
    height: '160',
    waist: '0',
    hip: 'unknown',
    alias: ['别名', '别名'],
    cup: 'ｆ'
  }
  const snapshot = structuredClone(input),
    row = projectPerson('minnano', input)
  expect(row.height).toBe(160)
  expect(row.waist).toBe(0)
  expect(row.hip).toBe(null)
  expect(row.aliases).toEqual(['别名'])
  expect(row.cup).toBe('F')
  expect(input).toEqual(snapshot)
})
