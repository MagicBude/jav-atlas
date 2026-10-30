import { expect, it } from 'vitest'
import fs from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import audit from '../src/data/source-candidates.json'
import { dataSources } from '../src/entities/dataSources'
import {
  websiteCategories,
  matchesWebsiteCategory,
  readWebsiteCategory
} from '../src/entities/websiteCategories'
import WebsitesPage from '../src/pages/WebsitesPage'
const inventory = JSON.parse(
  fs.readFileSync(new URL('../../docs/data/website-inventory-audit.json', import.meta.url), 'utf8')
)

it('188条目录全部有处置记录且总数可核对，排除记录不分发名称和网址', () => {
  expect(inventory.records).toHaveLength(188)
  expect(new Set(inventory.records.map((r: { inventoryId: string }) => r.inventoryId)).size).toBe(
    188
  )
  expect(inventory.summary).toEqual(audit.inventorySummary)
  const counts = inventory.records.reduce(
    (out: Record<string, number>, row: { decision: string }) => {
      out[row.decision] = (out[row.decision] || 0) + 1
      return out
    },
    {}
  )
  expect(counts).toEqual({ candidate: 14, registered: 1, deferred: 9, excluded: 164 })
  for (const row of inventory.records) {
    expect(row.reason.length).toBeGreaterThan(0)
    expect(row).not.toHaveProperty('url')
    expect(row).not.toHaveProperty('logo')
  }
})
it('候选原目录引用完整，网站和API只计一个服务', () => {
  const ids = audit.candidates.flatMap(item => item.inventoryIds)
  expect(ids).toHaveLength(14)
  expect(new Set(ids).size).toBe(14)
  expect(audit.candidates.find(item => item.id === 'tpdb')?.inventoryIds).toEqual(['b020', 'b140'])
  expect(
    new Set(
      inventory.records
        .filter((r: { decision: string }) => r.decision === 'candidate')
        .map((r: { inventoryId: string }) => r.inventoryId)
    )
  ).toEqual(new Set(ids))
})
it('分类按用途过滤且多用途归属不造成站点总数重复', () => {
  const all = [...dataSources, ...audit.candidates]
  expect(all).toHaveLength(15)
  for (const category of websiteCategories) {
    expect(
      all.filter(site => matchesWebsiteCategory(site.categories, category.id)).length
    ).toBeGreaterThan(0)
  }
  expect(
    all.filter(site => matchesWebsiteCategory(site.categories, 'api')).map(site => site.id)
  ).toEqual(['tpdb'])
  expect(readWebsiteCategory('invalid')).toBe('all')
  for (const item of all)
    for (const id of item.categories) expect(websiteCategories.some(c => c.id === id)).toBe(true)
})
it('接口服务直达只显示对应候选，保留分类查询和空的已接入说明', () => {
  const render = (url: string) =>
    renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: [url] }, createElement(WebsitesPage))
    )
  const html = render('/websites?category=api')
  expect(html).toContain('ThePornDB')
  expect(html).not.toContain('<strong>AVbase</strong>')
  expect(html).toContain('这个分类暂无资料查询站点')
  expect(html.match(/class="candidate-card"/g)).toHaveLength(1)
  expect(render('/websites?category=bad').match(/class="candidate-card"/g)).toHaveLength(13)
})
