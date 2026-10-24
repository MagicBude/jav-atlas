import { expect, it } from 'vitest'
import dictionary from '../src/data/javdb-tag-labels.json'
import {
  javdbTagLabel,
  javdbTagGroup,
  tagSelectionKey,
  parseTagSelection
} from '../src/entities/tagLabels'
import { workFacetOptions, matchesWorkFacets } from '../src/features/works/query'
const row = (name: string) => ({
  id: '1',
  kind: 'work' as const,
  title: '',
  sourceUrl: '',
  facets: { tag: [{ id: '109', name }] }
})
it('目录保留844个类型内类别，未知名称不被同号其他类别覆盖', () => {
  expect(Object.keys(dictionary.terms)).toHaveLength(844)
  for (const [key, term] of Object.entries(dictionary.terms)) {
    const id = key.split(':')[1]
    expect(javdbTagLabel(id, term.sourceNames[0], Number(key.split(':')[0]))).toBe(term.label)
  }
  expect(javdbTagLabel('109', '未知原名')).toBe('未知原名')
  expect(javdbTagLabel('future-tag', '原名称')).toBe('原名称')
})
it('109只有泳池可以归入地点，其他同号类别不串组', () => {
  expect(javdbTagGroup('109', '泳池')?.id).toBe('place')
  expect(javdbTagGroup('109', '戀乳癖')?.id).toBe('subject')
  expect(javdbTagGroup('110', '濫交')?.id).toBe('behavior')
  expect(javdbTagGroup('160', '流汗')?.id).toBe('subject')
  expect(javdbTagGroup('109', '未经核对的名称')).toBeUndefined()
})
it('同号不同原名的选项、筛选和计数身份分开，逗号名称可以往返', () => {
  const key = tagSelectionKey('109', '戀乳癖')
  const params = new URLSearchParams({ wf_tag: key })
  expect(workFacetOptions([row('戀乳癖'), row('泳池')], 'tag')).toHaveLength(2)
  expect(matchesWorkFacets(row('戀乳癖'), params)).toBe(true)
  expect(matchesWorkFacets(row('泳池'), params)).toBe(false)
  expect(parseTagSelection(tagSelectionKey('109', 'a,b~c'))).toEqual({ id: '109', name: 'a,b~c' })
  expect(matchesWorkFacets(row('戀乳癖'), new URLSearchParams('wf_tag=109'))).toBe(true)
})

it('筛选面板不会把截图中的三个类别放进地点，且同号名称各自计数', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { TagFilters } = await import('../src/features/works/TagFilters')
  const { MemoryRouter } = await import('react-router-dom')
  const entries = [
    row('戀乳癖'),
    row('戀乳癖'),
    row('泳池'),
    { ...row('濫交'), facets: { tag: [{ id: '110', name: '濫交' }] } },
    { ...row('流汗'), facets: { tag: [{ id: '160', name: '流汗' }] } }
  ]
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(TagFilters, { entries, params: new URLSearchParams(), update: () => {} })
    )
  )
  const place = html.split('<section').find(section => section.includes('aria-label="地点"'))!
  expect(place).toContain('泳池')
  expect(place).not.toContain('戀乳癖')
  expect(place).not.toContain('濫交')
  expect(place).not.toContain('流汗')
  expect(html).toContain('恋乳癖</span><small>2</small>')
  expect(html).toContain('泳池</span><small>1</small>')
})

it('有类型后简繁差异不影响归组，同号其他类型不会被选中', () => {
  const censored = { ...row('恋乳癖'), javdbType: 0 }
  const western = { ...row('泳池'), javdbType: 2 }
  const key = tagSelectionKey('109', '恋乳癖', 0)
  expect(key).toBe('0:109')
  expect(parseTagSelection(key)).toEqual({ id: '109', name: undefined, type: 0 })
  expect(javdbTagGroup('109', '恋乳癖', 0)?.id).toBe('0:subject')
  expect(javdbTagGroup('109', '泳池', 2)?.id).toBe('2:place')
  expect(javdbTagLabel('109', '恋乳癖', 0)).toBe('恋乳癖')
  expect(matchesWorkFacets(censored, new URLSearchParams({ wf_tag: key }))).toBe(true)
  expect(matchesWorkFacets(western, new URLSearchParams({ wf_tag: key }))).toBe(false)
  expect(javdbTagGroup('40', '颜射', 0)?.id).toBe('0:behavior')
})

it('五类官方简体页面都已核实，重复数字ID保持类型隔离', () => {
  expect(Object.values(dictionary.localizations).map(row => row.terms)).toEqual([
    307, 151, 208, 55, 123
  ])
  expect(Object.keys(dictionary.groupLabels)).toHaveLength(25)
  expect(
    Object.values(dictionary.terms).filter(term => term.status === 'official-zh-CN')
  ).toHaveLength(844)
  expect(javdbTagLabel('109', '来源', 0)).toBe('恋乳癖')
  expect(javdbTagLabel('109', '来源', 2)).toBe('泳池')
})

it('实测同名条目仅在有码且名称一致时合并展示，来源数组完整保留', async () => {
  const { displayJavdbTags, javdbDisplayTagId } = await import('../src/entities/tagLabels')
  const tags = [
    { id: '40', name: '颜射' },
    { id: '46', name: '颜射' }
  ]
  const original = JSON.stringify(tags)
  expect(displayJavdbTags(tags, 0)).toEqual([{ id: '46', name: '颜射' }])
  expect(JSON.stringify(tags)).toBe(original)
  expect(javdbDisplayTagId('40', '其他名称', 0)).toBe('40')
  expect(javdbDisplayTagId('40', '按摩', 2)).toBe('40')
  expect(javdbDisplayTagId('40', '颜射')).toBe('40')
  expect(javdbTagGroup('40', '颜射', 0)?.id).toBe('0:behavior')
  const record = { ...row('颜射'), javdbType: 0, facets: { tag: tags } }
  const only40 = { ...record, facets: { tag: [tags[0]] } }
  expect(matchesWorkFacets(only40, new URLSearchParams('wf_tag=0:46'))).toBe(true)
  expect(matchesWorkFacets(record, new URLSearchParams('wf_tag=0:40'))).toBe(true)
})
it('同一作品的40与46只计数一次，统一出现在行为组', async () => {
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { TagFilters } = await import('../src/features/works/TagFilters')
  const record = {
    ...row('颜射'),
    javdbType: 0,
    facets: {
      tag: [
        { id: '40', name: '颜射' },
        { id: '46', name: '颜射' }
      ]
    }
  }
  const html = renderToStaticMarkup(
    createElement(TagFilters, {
      entries: [record],
      params: new URLSearchParams(),
      update: () => {}
    })
  )
  expect(html).toContain('aria-label="行为"')
  expect(html).not.toContain('来源目录未收录')
  expect(html.match(/<span>颜射<\/span><small>1<\/small>/g)).toHaveLength(1)
})
