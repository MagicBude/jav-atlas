import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import WebsitesPage from '../src/pages/WebsitesPage'

it('相关网站保留站点入口和核实记录，采集说明通过数据页单独查看', () => {
  const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(WebsitesPage)))
  expect(html).toContain('<h1>相关网站</h1>')
  expect(html).toContain('更多相关网站')
  expect(html).not.toContain('原目录的清点结果')
  expect(html).not.toContain('本地用途分流')
  expect(html.match(/打开网站/g)).toHaveLength(2)
  expect(html).not.toContain('<h2>如何理解来源信息</h2>')
  expect(html).not.toContain('采集来源与字段说明')
})
