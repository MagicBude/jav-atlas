/** 离线合成测试：不读取/改写真实浏览器收藏，也不会触发源站采集。 */
import { describe, expect, it } from 'vitest'
import {
  emptyData,
  localValue,
  parseData,
  PersonalConflict,
  PersonalRepository,
  resolvePerson,
  USER_KEY,
  type Operation,
  type StorageLike
} from '../src/data/personal'
import {
  selectPeople,
  emptyPrivate,
  privateFilters,
  sanitizeQuery
} from '../src/features/people/query'
import { parseInput } from '../src/features/personal-data/PersonEditor'
import type { Person } from '../src/entities/person'
const person = (id: string, extra: Partial<Person> = {}): Person => ({
  source: 'minnano',
  id,
  name: `人物${id}`,
  aliases: [],
  gender: 'f',
  birthday: '',
  height: null,
  breast: null,
  waist: null,
  hip: null,
  cup: '',
  blood: '',
  place: '',
  agency: '',
  hobby: '',
  shoe: '',
  official: '',
  tags: [],
  avatar: null,
  status: 'directory',
  fetchedAt: null,
  genderEvidence: '',
  sourceUrl: `https://www.minnano-av.com/actress${id}.html`,
  detailRef: '',
  ...extra
})
const set = (value: Operation['value']): Operation => ({
  kind: 'set',
  value,
  base: null,
  updatedAt: 1
})
function sandbox() {
  const values = new Map<string, string>()
  const storage: StorageLike = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
  return { repository: new PersonalRepository(storage), storage, values }
}
describe('字段覆盖和收藏的保留边界', () => {
  it('修改来源视图不会更改源对象，零值和未知不混用', () => {
    const { repository } = sandbox(),
      source = person('1', { height: 160 })
    const data = repository.patch(source, { height: set(162) }, { height: undefined })
    expect(resolvePerson(source, data.records['minnano/1']).height).toBe(162)
    expect(source.height).toBe(160)
    expect(
      repository.patch(
        source,
        { height: { ...set(null), kind: 'clear' } },
        { height: data.records['minnano/1'].fields.height }
      ).records['minnano/1'].fields.height.kind
    ).toBe('clear')
  })
  it('取消收藏不删除备注，恢复来源不被旧备份静默复活', () => {
    const { repository } = sandbox(),
      p = person('1')
    repository.favorite(p, true)
    const backup = repository.patch(p, { height: set(170), note: set('保留的备注') }, {})
    repository.favorite(p, false)
    repository.patch(
      p,
      { height: { ...set(null), kind: 'clear' } },
      { height: backup.records['minnano/1'].fields.height }
    )
    const imported = repository.import(backup, {}, repository.raw())
    expect(imported.records['minnano/1'].favorite?.active).toBe(false)
    expect(imported.records['minnano/1'].fields.height.kind).toBe('clear')
    expect(localValue(imported.records['minnano/1'], 'note')).toBe('保留的备注')
  })
  it('两标签页改不同属性不互相覆盖；同字段冲突需要重新核对', () => {
    const { repository } = sandbox(),
      p = person('1')
    repository.favorite(p, true)
    repository.favorite(p, false)
    repository.patch(p, { height: set(165) }, { height: undefined })
    expect(repository.read().records['minnano/1'].favorite?.active).toBe(false)
    expect(() => repository.patch(p, { height: set(180) }, { height: undefined })).toThrow(
      PersonalConflict
    )
  })
  it('导入预览过期不执行，损坏版本与恶意链接不覆盖数据', () => {
    const { repository, values } = sandbox(),
      raw = repository.raw()
    repository.favorite(person('1'), true)
    expect(() => repository.import(emptyData(), {}, raw)).toThrow('重新导入')
    const original = values.get(USER_KEY)
    expect(() => parseData('{"schemaVersion":2,"records":{}}')).toThrow()
    const bad = repository.read()
    bad.records['minnano/1'].fields.official = set('javascript:alert(1)')
    expect(() => parseData(JSON.stringify(bad))).toThrow('http/https')
    expect(values.get(USER_KEY)).toBe(original)
  })
  it('存储写满会抛出失败，不能在调用方发布虚假成功', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw Error('QuotaExceededError')
      }
    }
    expect(() => new PersonalRepository(storage).favorite(person('1'), true)).toThrow(
      'QuotaExceededError'
    )
  })
  it('原生大小写ID及不同来源收藏保持独立', () => {
    const { repository } = sandbox()
    repository.favorite(person('AbC', { source: 'javdb' }), true)
    repository.favorite(person('abc', { source: 'javdb' }), false)
    const data = repository.favorite(person('AbC'), true)
    expect(Object.keys(data.records)).toHaveLength(3)
  })
  it('显式未知保持显示模型类型，非法导入字段拒绝保存', () => {
    const { repository } = sandbox(),
      p = person('1')
    const data = repository.patch(p, { name: set(null), aliases: set(null) }, {})
    expect(typeof resolvePerson(p, data.records['minnano/1']).name).toBe('string')
    expect(resolvePerson(p, data.records['minnano/1']).aliases).toEqual([])
    data.records['minnano/1'].fields.height = set('not-a-number')
    expect(() => parseData(JSON.stringify(data))).toThrow('尺寸')
  })
})
describe('搜索与筛选语义', () => {
  const rows = [
    person('1', {
      height: 160,
      cup: 'F',
      name: '第一人',
      aliases: ['旧名'],
      tags: [{ value: 'minnano:1', label: '标签一' }]
    }),
    person('2', { height: 170, cup: 'G', gender: '?' }),
    person('3')
  ]
  it('同维度取并集、跨维度取交集，未知需要显式包含', () => {
    const query = new URLSearchParams('cup=F&cup=G&heightMin=165')
    expect(selectPeople(rows, query, emptyPrivate(), emptyData()).map(p => p.id)).toEqual(['2'])
    query.delete('cup')
    query.set('heightUnknown', 'yes')
    expect(
      selectPeople(rows, query, emptyPrivate(), emptyData())
        .map(p => p.id)
        .sort()
    ).toEqual(['2', '3'])
  })
  it('别名可检索，精确ID优先，标签模式不串来源', () => {
    expect(
      selectPeople(rows, new URLSearchParams('q=旧名'), emptyPrivate(), emptyData())[0].id
    ).toBe('1')
    expect(
      selectPeople(rows, new URLSearchParams('tag=javdb:1'), emptyPrivate(), emptyData())
    ).toHaveLength(0)
  })
  it('收藏是本地条件，不需要放进公开查询串', () => {
    const { repository } = sandbox(),
      data = repository.favorite(rows[0], true),
      query = new URLSearchParams()
    expect(selectPeople(rows, query, { ...emptyPrivate(), favorite: 'yes' }, data)).toHaveLength(1)
    expect(query.toString()).toBe('')
  })
  it('非法地址参数和损坏个人筛选回退，不将私人字段写入分享条件', () => {
    const params = sanitizeQuery(
      'heightMin=bad&page=Infinity&personalTags=私人标签&source=bad&cup=F'
    )
    expect(params.toString()).toBe('cup=F')
    expect(privateFilters({ personalTags: 'bad', favorite: 'unknown' })).toEqual(emptyPrivate())
  })
})
describe('编辑输入验证', () => {
  it('非法日期、部分数字和危险链接不能保存', () => {
    expect(() => parseInput('birthday', '2024-02-31')).toThrow()
    expect(() => parseInput('height', '160abc')).toThrow()
    expect(() => parseInput('official', 'javascript:alert(1)')).toThrow()
    expect(parseInput('aliases', '别名,别名,另一个名字')).toEqual(['别名', '另一个名字'])
  })
})
