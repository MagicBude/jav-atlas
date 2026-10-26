import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import audit from '../src/data/source-candidates.json'
import { dataSources, sourceRecordUrl } from '../src/entities/dataSources'
import { SourceCandidates } from '../src/pages/SourceCandidates'

it('首批候选不混入已接入来源，也不能生成对应详情链接', () => {
  expect(audit.candidates).toHaveLength(5)
  expect(new Set(audit.candidates.map(item => item.id)).size).toBe(5)
  expect(dataSources.map(item => item.id)).toEqual(['minnano', 'javdb'])
  for (const item of audit.candidates) {
    expect(sourceRecordUrl(item.id, 'work', '123')).toBeUndefined()
    expect(item.status.length).toBeGreaterThan(0)
    expect(item.blockers.length).toBeGreaterThan(0)
  }
})
it('候选页面展示核实依据与限制，不提供采集开关或主页跳转', () => {
  const html = renderToStaticMarkup(createElement(SourceCandidates))
  expect(html.match(/<details /g)).toHaveLength(5)
  expect(html).toContain('尚未接入')
  expect(html).toContain('待令牌验证')
  expect(html).toContain('访问核实受阻')
  expect(html).toContain('官方API文档')
  expect(html).not.toContain('打开网站')
  expect(html).not.toContain('type="checkbox"')
})
