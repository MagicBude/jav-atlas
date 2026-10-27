/**
 * @file 将采集数据只读投影成网页资源：索引负责搜索，详情块保留完整原记录。
 * 从仓库根 relay 读取，只能写 web/public/generated；不联网、不修改采集文件。
 * 资源使用内容摘要寻址，避免新索引误读旧详情。每次清理派生目录后重建清单和资源。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { collectSources, projectPerson } from './adapters.mjs'
import coveragePolicy from '../../tools/lib/work-coverage.js'
import rankingHistory from '../../tools/lib/ranking-history.js'
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const relay = path.resolve(web, '../relay')
const out = path.join(web, 'public/generated')
// 只能清理本脚本的产物目录。先核对绝对路径及链接，防止路径改错后删到原始 relay。
if (
  path.relative(web, out) !== path.join('public', 'generated') ||
  (fs.existsSync(path.dirname(out)) && fs.lstatSync(path.dirname(out)).isSymbolicLink()) ||
  (fs.existsSync(out) && fs.lstatSync(out).isSymbolicLink())
)
  throw Error('生成目录不在预期位置，拒绝清理。')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
const read = (name, fallback = null) => {
  const file = path.join(relay, name)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
}
/** 写入可独立缓存的 JSON；不压缩单行，便于本地排查生成结果。 */
function emit(prefix, value) {
  const body = JSON.stringify(value, null, 2) + '\n'
  const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)
  const name = `${prefix}-${hash}.json`
  fs.writeFileSync(path.join(out, name), body)
  return name
}
const rawFiles = {}
for (const source of ['minnano', 'javdb', 'derived']) {
  for (const file of fs.readdirSync(path.join(relay, source)).filter(x => x.endsWith('.json'))) {
    // 下载快照按字节复制，连原文件排版都不改变；压缩投影仅发生在搜索索引。
    const bytes = fs.readFileSync(path.join(relay, source, file))
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const target = `raw-${source}-${file.slice(0, -5)}-${hash}.json`
    fs.writeFileSync(path.join(out, target), bytes)
    rawFiles[`${source}/${file}`] = target
  }
}
/** 索引预留路径不等于文件存在：校验目录与体积后才向浏览器公开图片。 */
function avatar(source, id) {
  for (const owner of source === 'javdb' ? ['javdb', 'derived'] : ['minnano']) {
    const index = avatarIndexes[owner]
    const file = index.files?.[id]?.file
    if (!file || !/^(female|male|unknown)\/[^/\\]+\.jpg$/.test(file)) continue
    const sourceFile = path.join(relay, owner, 'avatars', file)
    if (!fs.existsSync(sourceFile) || fs.statSync(sourceFile).size <= 2048) continue
    const name = `images/${owner}/${file}`
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true })
    fs.copyFileSync(sourceFile, path.join(out, name))
    return name
  }
  return null
}
const avatarIndexes = Object.fromEntries(
  ['minnano', 'javdb', 'derived'].map(source => [
    source,
    read(`${source}/avatars/index.json`, { files: {} })
  ])
)
const sources = collectSources(read)
// 关联区可以借旧名册显示姓名，但不会因此把相关人物递归加入采集队列或下载头像。
const minnanoNames = new Map(
  read('minnano/actresses.json', []).map(row => [String(row.mnid), row.name])
)
const manifest = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  sources: {},
  rawFiles,
  rankings: emit('rankings', {
    ...read('minnano/rankings.json', {}),
    comparison: rankingHistory.compareRankings(
      read('minnano/rankings.json', {}),
      rankingHistory.readHistory(path.join(relay, 'minnano/ranking-history'))
    )
  }),
  report: emit('report', read('minnano/backfill-report.json', {}))
}
for (const [source, rows] of Object.entries(sources)) {
  const index = [],
    details = []
  for (const { main: r, records } of rows) {
    const id = String(source === 'minnano' ? r.mnid : r.id)
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !r.name) throw Error(`非法身份：${source}/${id}`)
    const fields = projectPerson(source, r)
    const tags = (r.tags || []).map(t =>
      Array.isArray(t)
        ? { value: `${source}:${t[0]}`, label: String(t[1]) }
        : { value: `${source}:${t}`, label: String(t) }
    )
    const item = {
      source,
      id,
      ...fields,
      tags,
      avatar: avatar(source, id),
      status:
        source === 'javdb'
          ? 'api'
          : r.profileSchemaVersion === 2
            ? 'raw'
            : r.profileFetchedAt
              ? 'profile'
              : 'directory',
      fetchedAt: r.profileFetchedAt || null,
      genderEvidence: source === 'minnano' ? '来源女演员目录' : r.genderSource || 'unverified',
      sourceUrl: r.msrc || r.source_url || `https://javdb.com/actors/${id}`,
      detailRef: ''
    }
    index.push(item)
    details.push({
      id,
      records,
      related:
        r.relatedProfiles ||
        (r.rel || []).map(id => ({
          id,
          name: source === 'minnano' ? minnanoNames.get(String(id)) || String(id) : String(id)
        }))
    })
  }
  // 小块按数量与字节共同约束；单条再大也不能截断。detailRef 只是存储位置，不是人物新编号。
  const indexById = new Map(index.map(row => [row.id, row]))
  let bucket = [],
    bytes = 0
  function flush() {
    if (!bucket.length) return
    const file = emit(`details-${source}`, bucket)
    for (const detail of bucket) indexById.get(detail.id).detailRef = file
    bucket = []
    bytes = 0
  }
  for (const detail of details) {
    const formatted = JSON.stringify(detail, null, 2)
    // 中文一个字符可能占多个 UTF-8 字节；数组内每行还需再缩进两格，预算不能只看字符数。
    const size = Buffer.byteLength(formatted) + formatted.split('\n').length * 2 + 3
    if (bucket.length && (bucket.length >= 200 || bytes + size > 256 * 1024)) flush()
    bucket.push(detail)
    bytes += size
  }
  flush()
  // 未知字段的默认值由浏览器仓库补齐，减少两万多条记录反复传输相同空字符串。
  // 0 是有效值，必须保留；详情与原始快照完全不使用这个精简规则。
  const compactIndex = index.map(row =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([, value]) =>
          value !== '' && value !== null && !(Array.isArray(value) && value.length === 0)
      )
    )
  )
  manifest.sources[source] = {
    count: index.length,
    index: emit(`index-${source}`, compactIndex),
    avatars: index.filter(x => x.avatar).length
  }
}
// 作品资源独立寻址，只有进入人物作品区才请求；详情保留原记录，列表仅加入检索所需番号。
const worksRoot = path.join(relay, 'minnano/works')
manifest.works = { people: {}, records: {}, enrichments: {} }
const workIndex = new Map()
const members = read('minnano/ranked-pool.json', { members: {} }).members
/** 摘要字段显式列举，避免把原始观察、评论或完整详情装进列表索引。 */
const summary = entry => ({
  id: entry.id,
  kind: 'work',
  title: entry.title || '',
  code: entry.code || null,
  sourceUrl: entry.sourceUrl || `https://www.minnano-av.com/av${entry.id}.html`,
  releaseDate: entry.releaseDate || null,
  makerText: entry.makerText || '',
  rating: entry.rating || null,
  actorIds: []
})
const mappings = read('javdb/work-enrichment/mappings.json', { mappings: {} }).mappings
for (const [localId, mapping] of Object.entries(mappings)) {
  if (!/^\d+$/.test(localId) || !/^[a-zA-Z0-9_-]+$/.test(mapping.javdbId))
    throw Error('补充作品身份无效')
  const record = read(`javdb/work-enrichment/records/${mapping.javdbId}.json`)
  if (!record || record.id !== mapping.javdbId || mapping.minnanoId !== localId)
    throw Error('补充作品映射不一致')
  manifest.works.enrichments[localId] = emit(`work-javdb-${mapping.javdbId}`, {
    ...record,
    mapping
  })
}
if (fs.existsSync(path.join(worksRoot, 'records'))) {
  for (const file of fs
    .readdirSync(path.join(worksRoot, 'records'))
    .filter(f => /^\d+\.json$/.test(f))) {
    const id = file.slice(0, -5)
    const detail = read(`minnano/works/records/${file}`)
    manifest.works.records[id] = emit(`work-${id}`, detail)
    workIndex.set(id, {
      ...summary(detail),
      actorIds: (detail.cast || [])
        .map(actor => String(actor.id))
        .filter(id => Object.hasOwn(members, id))
    })
  }
}
if (fs.existsSync(path.join(worksRoot, 'people'))) {
  for (const file of fs
    .readdirSync(path.join(worksRoot, 'people'))
    .filter(f => /^\d+\.json$/.test(f))) {
    const person = read(`minnano/works/people/${file}`)
    const entries = person.entries.map(entry => {
      // 列表只投影评分摘要，不加载评论全文；未补充评分不冒充0分。
      const mapping = mappings[entry.id]
      const metadata = mapping
        ? read(`javdb/work-enrichment/records/${mapping.javdbId}.json`, {})?.metadata
        : null
      const score = metadata?.score == null || metadata.score === '' ? null : Number(metadata.score)
      return {
        ...entry,
        ...(Number.isInteger(metadata?.type) && metadata.type >= 0 && metadata.type <= 4
          ? { javdbType: metadata.type }
          : {}),
        facets: {
          ...Object.fromEntries(
            ['director', 'maker', 'series'].flatMap(kind =>
              metadata?.[kind + '_id'] && metadata?.[kind + '_name']
                ? [[kind, [{ id: String(metadata[kind + '_id']), name: metadata[kind + '_name'] }]]]
                : []
            )
          ),
          ...(metadata?.tags?.length
            ? { tag: metadata.tags.map(tag => ({ id: String(tag.id), name: tag.name })) }
            : {})
        },
        code: read(`minnano/works/records/${entry.id}.json`, {})?.code || null,
        rating:
          score != null && Number.isFinite(score)
            ? { score, count: metadata.reviews_count ?? null, source: 'javdb' }
            : null
      }
    })
    for (const entry of entries.filter(entry => entry.kind === 'work')) {
      if (!/^\d+$/.test(entry.id)) throw Error('作品索引包含非法来源ID')
      const old = workIndex.get(entry.id)
      // 多个人物指向同一作品时合并关系，不重复生成条目；详情规范值优先于列表摘要。
      workIndex.set(entry.id, {
        ...summary(entry),
        ...old,
        title: old?.title || entry.title,
        code: old?.code || entry.code,
        releaseDate: old?.releaseDate || entry.releaseDate,
        makerText: old?.makerText || entry.makerText,
        rating: entry.rating || old?.rating || null,
        actorIds: [...new Set([...(old?.actorIds || []), String(person.actorId)])].sort()
      })
    }
    manifest.works.people[file.slice(0, -5)] = emit(`works-person-${file.slice(0, -5)}`, {
      ...person,
      // 当前断点决定本轮是否完成，历史completedAt只保留为来源记录。
      coverage: (() => {
        const scan = read('minnano/works/progress.json', { people: {} }).people?.[person.actorId]
        return {
          status: coveragePolicy.listCoverage(scan),
          nextPage: scan?.nextPage ?? null,
          completedAt: scan?.finished && scan.stable ? scan.completedAt : null
        }
      })(),
      entries
    })
  }
}
const actorIds = [...new Set([...workIndex.values()].flatMap(entry => entry.actorIds))].sort()
// 跨作品浏览只保存来源ID及名称，不能用导演/片商同名作为身份合并依据。
for (const entry of workIndex.values()) {
  const mapping = mappings[entry.id]
  const metadata = mapping
    ? read(`javdb/work-enrichment/records/${mapping.javdbId}.json`, {})?.metadata
    : null
  if (Number.isInteger(metadata?.type) && metadata.type >= 0 && metadata.type <= 4)
    entry.javdbType = metadata.type
  entry.facets = {}
  for (const kind of ['director', 'maker', 'series'])
    if (metadata?.[kind + '_id'] && metadata?.[kind + '_name'])
      entry.facets[kind] = [{ id: String(metadata[kind + '_id']), name: metadata[kind + '_name'] }]
  if (metadata?.tags?.length)
    entry.facets.tag = metadata.tags.map(tag => ({ id: String(tag.id), name: tag.name }))
}
manifest.works.index = emit('works-index', {
  entries: [...workIndex.values()].sort((a, b) => a.id.localeCompare(b.id)),
  actors: actorIds.map(id => ({ id, name: members[id]?.name || id }))
})
manifest.version = crypto
  .createHash('sha256')
  .update(
    JSON.stringify(manifest.sources) + JSON.stringify(rawFiles) + JSON.stringify(manifest.works)
  )
  .digest('hex')
  .slice(0, 16)
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(
  '浏览资源生成完成（源数据只读）：',
  Object.fromEntries(Object.entries(manifest.sources).map(([name, value]) => [name, value.count]))
)
