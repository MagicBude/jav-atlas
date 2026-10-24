/** 总表直接展示来源分组，目录数量不受本地作品覆盖影响。 */
import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import TagCatalogPage from '../src/pages/TagCatalogPage'
const render = (url: string) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [url] }, createElement(TagCatalogPage))
  )
it('五类目录分开显示，默认有码保留307项且没有欧美地点组', () => {
  const html = render('/tags')
  expect(html).toContain('844')
  expect(html).toContain('307 / 307')
  expect(html).toContain('主题')
  expect(html).toContain('展开主题')
  expect(html).not.toContain('接口原名')
  expect(html).not.toContain('戀乳癖')
  expect(render('/tags?type=0&q=恋乳癖')).toContain('恋乳癖')
  expect(render('/tags?type=0&q=恋乳癖')).toContain('wf_tag=0%3A109')
  expect(html).not.toContain('catalog-2:place')
  expect(html).toContain('下载完整 JSON')
})
it('切换欧美目录才显示地点，URL搜索可以定位来源类别', () => {
  const html = render('/tags?type=2&q=泳池')
  expect(html).toContain('catalog-2:place')
  expect(html).toContain('泳池')
  expect(html).not.toContain('戀乳癖')
  expect(render('/tags?type=0&q=不存在的类别')).toContain('没有匹配的类别')
})
