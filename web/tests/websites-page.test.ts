import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import WebsitesPage from '../src/pages/WebsitesPage'

it('网站目录保留站点入口和核实记录，采集说明通过数据页单独查看', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(WebsitesPage)))
  expect(html).toContain('<h1>网站目录</h1>')
  expect(html).toContain('网站核实记录')
  expect(html).toContain('收录网站不代表已接入采集')
  expect(html).toContain('href="/data"')
  expect(html.match(/打开网站/g)).toHaveLength(2)
  expect(html).not.toContain('<h2>如何理解来源信息</h2>')
  expect(html).not.toContain('采集来源与字段说明')
})
