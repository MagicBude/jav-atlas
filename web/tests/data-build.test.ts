/**
 * 真实快照集成检查：运行只读生成器，并核对源文件哈希、完整详情和索引身份。
 * 这些检查验证的是数据契约，不触发真实网络采集，也不会修改个人收藏。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { collectSources } from '../scripts/adapters.mjs'
import { selectPeople, emptyPrivate } from '../src/features/people/query'
import { emptyData } from '../src/data/personal'
import type { Manifest, Person } from '../src/entities/person'
const relay = path.resolve('../relay'),
  generated = path.resolve('public/generated')
const read = (relative: string, fallback: unknown = null) => {
  const file = path.join(relay, relative)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
}
function hashes(dir: string): Record<string, string> {
  return Object.fromEntries(
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name)
      return entry.isDirectory()
        ? Object.entries(hashes(file))
        : [[file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]]
    })
  )
}
let before: Record<string, string>, manifest: Manifest
beforeAll(() => {
  before = hashes(relay)
  execFileSync(process.execPath, ['scripts/build-data.mjs'], { encoding: 'utf8' })
  manifest = JSON.parse(fs.readFileSync(path.join(generated, 'manifest.json'), 'utf8'))
}, 30000)
describe('来源与生成资源', () => {
  it('独立作品索引去重且覆盖全部已发现正式作品，保留待补详情关系', () => {
    const index = JSON.parse(fs.readFileSync(path.join(generated, manifest.works!.index!), 'utf8'))
    const expected = new Set(Object.keys(manifest.works!.records))
    const relations = new Map<string, Set<string>>()
    for (const [actorId, file] of Object.entries(manifest.works!.people)) {
      const person = JSON.parse(fs.readFileSync(path.join(generated, file), 'utf8'))
      for (const row of person.entries.filter((entry: { kind: string }) => entry.kind === 'work')) {
        expected.add(row.id)
        const actors = relations.get(row.id) || new Set<string>()
        actors.add(actorId)
        relations.set(row.id, actors)
      }
    }
    expect(new Set(index.entries.map((row: { id: string }) => row.id)).size).toBe(
      index.entries.length
    )
    expect(index.entries.map((row: { id: string }) => row.id).sort()).toEqual([...expected].sort())
    for (const row of index.entries) {
      expect(row.kind).toBe('work')
      expect(row).not.toHaveProperty('reviews')
      expect(row).not.toHaveProperty('observations')
      for (const actor of relations.get(row.id) || []) expect(row.actorIds).toContain(actor)
    }
  })
  it('JavDB补充按minnano映射独立加载，评论数量与去重ID一致', () => {
    const source = read('javdb/work-enrichment/mappings.json').mappings
    expect(Object.keys(manifest.works?.enrichments || {})).toEqual(Object.keys(source))
    for (const [localId, file] of Object.entries(manifest.works!.enrichments!)) {
      const value = JSON.parse(fs.readFileSync(path.join(generated, file), 'utf8'))
      expect(value.id).toBe(source[localId].javdbId)
      expect(value.mapping.minnanoId).toBe(localId)
      expect(value.metadata).toEqual(
        read(`javdb/work-enrichment/records/${value.id}.json`).metadata
      )
      expect(new Set(value.reviews.map((row: { id: string }) => row.id)).size).toBe(
        value.reviews.length
      )
      expect(value.reviewScope.saved).toBe(value.reviews.length)
    }
  })
  it('作品详情完整投影，人物作品的正式引用存在且番号可检索', () => {
    const sourceFiles = fs
      .readdirSync(path.join(relay, 'minnano/works/records'))
      .filter(file => /^\d+\.json$/.test(file))
    expect(Object.keys(manifest.works?.records || {})).toHaveLength(sourceFiles.length)
    for (const [id, file] of Object.entries(manifest.works!.records)) {
      const value = JSON.parse(fs.readFileSync(path.join(generated, file), 'utf8'))
      expect(value).toEqual(read(`minnano/works/records/${id}.json`))
    }
    for (const file of Object.values(manifest.works!.people)) {
      const value = JSON.parse(fs.readFileSync(path.join(generated, file), 'utf8'))
      for (const row of value.entries.filter((entry: { kind: string }) => entry.kind === 'work')) {
        // 后续试采可能先保存关系、再按预算补详情；有详情时番号必须来自原记录。
        const detailFile = manifest.works!.records[row.id]
        if (detailFile) {
          const detail = JSON.parse(fs.readFileSync(path.join(generated, detailFile), 'utf8'))
          expect(row.code).toEqual(detail.code || null)
        }
      }
    }
  })
  it('生成前后全部 relay 文件的字节哈希一致', () => expect(hashes(relay)).toEqual(before))
  it('原始下载快照与来源逐字节一致，不丢集合元数据', () => {
    for (const [source, file] of Object.entries(manifest.rawFiles))
      expect(
        fs
          .readFileSync(path.join(generated, file))
          .equals(fs.readFileSync(path.join(relay, source)))
      ).toBe(true)
  })
  it('两个来源的原生ID唯一，每条完整原记录都能从索引追溯', () => {
    const sources = collectSources(read)
    for (const [source, meta] of Object.entries(manifest.sources)) {
      const index: Person[] = JSON.parse(fs.readFileSync(path.join(generated, meta.index), 'utf8'))
      expect(new Set(index.map(row => row.id)).size).toBe(index.length)
      expect(index.length).toBe(meta.count)
      const originals = new Map(
        sources[source].map((row: { main: { mnid?: string; id?: string }; records: unknown }) => [
          String(source === 'minnano' ? row.main.mnid : row.main.id),
          row.records
        ])
      )
      const blocks = new Map<string, { id: string; records: unknown }[]>()
      for (const row of index) {
        if (!blocks.has(row.detailRef))
          blocks.set(
            row.detailRef,
            JSON.parse(fs.readFileSync(path.join(generated, row.detailRef), 'utf8'))
          )
        expect(blocks.get(row.detailRef)!.find(detail => detail.id === row.id)?.records).toEqual(
          originals.get(row.id)
        )
        if (row.avatar)
          expect(fs.statSync(path.join(generated, row.avatar)).size).toBeGreaterThan(2048)
      }
    }
  })
  it('默认来源索引gzip低于1MB，并记录真实索引查询耗时', () => {
    const bytes = fs.readFileSync(path.join(generated, manifest.sources.minnano.index))
    expect(gzipSync(bytes).length).toBeLessThan(1024 * 1024)
    const rows = JSON.parse(bytes.toString()) as Person[],
      times: number[] = []
    for (const query of [
      'q=100025',
      'q=三上',
      'heightMin=160&cup=F',
      'q=不存在的很长名字',
      'gender=f&avatar=yes'
    ]) {
      const start = performance.now()
      selectPeople(rows, new URLSearchParams(query), emptyPrivate(), emptyData())
      times.push(Math.round(performance.now() - start))
    }
    console.log('真实名册查询耗时（Node毫秒，非浏览器验收）：', times)
    fs.mkdirSync(path.resolve('../.cache'), { recursive: true })
    fs.writeFileSync(
      path.resolve('../.cache/web-query-metrics.json'),
      JSON.stringify(
        { environment: 'Node (not browser)', gzipBytes: gzipSync(bytes).length, queryMs: times },
        null,
        2
      )
    )
  })
})

it('内容类型从来源投影到全库与人物作品索引，保留有码零值', () => {
  const index = JSON.parse(fs.readFileSync(path.join(generated, manifest.works!.index!), 'utf8'))
  const mappings = read('javdb/work-enrichment/mappings.json').mappings
  const assertType = (row: { id: string; javdbType?: number }) => {
    const mapping = mappings[row.id]
    if (!mapping) return
    const type = read(`javdb/work-enrichment/records/${mapping.javdbId}.json`).metadata.type
    if (Number.isInteger(type) && type >= 0 && type <= 4) expect(row.javdbType).toBe(type)
  }
  index.entries.forEach(assertType)
  for (const file of Object.values(manifest.works!.people)) {
    const person = JSON.parse(fs.readFileSync(path.join(generated, file), 'utf8'))
    person.entries.forEach(assertType)
  }
})

it('人物作品进度来自当前断点，部分扫描不能显示为完整', () => {
  const progress = read('minnano/works/progress.json') as {
    people: Record<string, { finished?: boolean; stable?: boolean; completedAt?: number }>
  }
  for (const [id, file] of Object.entries(manifest.works!.people)) {
    const value = JSON.parse(fs.readFileSync(path.join(generated, file), 'utf8'))
    const scan = progress.people[id]
    if (scan?.finished && scan.stable && scan.completedAt) {
      expect(value.coverage.status).toBe('complete')
      expect(value.coverage.completedAt).toBe(scan.completedAt)
    } else {
      expect(value.coverage.status).not.toBe('complete')
      expect(value.coverage.completedAt).toBeNull()
    }
  }
})
