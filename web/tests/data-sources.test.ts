import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sourceRecordUrl } from '../src/entities/dataSources'
import { SourceRecordLink } from '../src/shared/SourceRecordLink'
import SourcesPage from '../src/pages/SourcesPage'

it('人物与作品入口按来源原生ID生成，保持已有四类链接路径', () => {
  expect(sourceRecordUrl('minnano', 'person', '551014')).toBe(
    'https://www.minnano-av.com/actress551014.html'
  )
  expect(sourceRecordUrl('minnano', 'work', '424918')).toBe(
    'https://www.minnano-av.com/av424918.html'
  )
  expect(sourceRecordUrl('javdb', 'person', 'Ab_12')).toBe('https://javdb.com/actors/Ab_12')
  expect(sourceRecordUrl('javdb', 'work', 'NQkGWZ')).toBe('https://javdb.com/v/NQkGWZ')
})
it('未知来源、姓名番号和路径注入不会生成猜测链接，仍保留显示文字', () => {
  for (const id of ['', '../123', 'https://example.invalid', 'A&B', '姓名']) {
    expect(sourceRecordUrl('minnano', 'person', id)).toBeUndefined()
    expect(sourceRecordUrl('javdb', 'work', id)).toBeUndefined()
  }
  expect(sourceRecordUrl('unknown', 'person', '123')).toBeUndefined()
  expect(sourceRecordUrl('minnano', 'work', 'SNOS-461')).toBeUndefined()
  expect(sourceRecordUrl('javdb', 'work', 'SNOS-461')).toBeUndefined()
  const text = renderToStaticMarkup(
    createElement(SourceRecordLink, { source: 'unknown', entity: 'person', id: '123' }, '保留署名')
  )
  expect(text).toContain('保留署名')
  expect(text).not.toContain('href=')
})
it('来源链接统一新标签打开与隔离，来源说明只展示实际接入的两个来源', () => {
  const link = renderToStaticMarkup(
    createElement(SourceRecordLink, { source: 'javdb', entity: 'work', id: 'NQkGWZ' })
  )
  expect(link).toContain('target="_blank"')
  expect(link).toContain('noreferrer noopener')
  const page = renderToStaticMarkup(createElement(SourcesPage))
  expect(page.match(/<article /g)).toHaveLength(2)
  expect(page).toContain('人物资料为既有存档')
  expect(page).toContain('不代表每个人物或每部作品都已补齐')
  expect(page).toContain('不代表刚刚检查过外站连通性')
})
