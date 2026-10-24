/** 收起时不能藏住已选条件；展开应保留完整来源顺序，而不是重排数据。 */
import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CategoryRow } from '../src/shared/CategoryRow'
import { visibleCategoryOptions } from '../src/shared/categoryRows'
const options = Array.from({ length: 20 }, (_, index) => ({
  key: String(index),
  label: `类别${index}`,
  selected: index === 19
}))
it('收起保留前12项及已选项，展开显示全部且来源顺序不变', () => {
  const collapsed = visibleCategoryOptions(options, false)
  expect(collapsed).toHaveLength(13)
  expect(collapsed.at(-1)?.key).toBe('19')
  expect(collapsed.some(option => option.key === '18')).toBe(false)
  expect(visibleCategoryOptions(options, true).map(option => option.key)).toEqual(
    options.map(option => option.key)
  )
  expect(visibleCategoryOptions(options.slice(0, 5), false)).toHaveLength(5)
})
it('展开按钮具备可访问状态；搜索展开不截断，全部按钮只委托调用方清组', () => {
  const collapsed = renderToStaticMarkup(
    createElement(CategoryRow, { label: '主题', options, onToggle: () => {}, onClear: () => {} })
  )
  expect(collapsed).toContain('更多 +7')
  expect(collapsed).toContain('aria-expanded="false"')
  expect(collapsed).toContain('清除主题类别条件')
  expect(collapsed).toContain('类别19')
  expect(collapsed).not.toContain('类别18')
  const expanded = renderToStaticMarkup(
    createElement(CategoryRow, { label: '主题', options, forceExpanded: true })
  )
  expect(expanded).toContain('类别18')
  expect(expanded).not.toContain('更多 +')
})
