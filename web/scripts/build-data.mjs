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
const manifest = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  sources: {},
  rawFiles,
  rankings: emit('rankings', read('minnano/rankings.json', {})),
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
      related: r.relatedProfiles || (r.rel || []).map(id => ({ id, name: id }))
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
manifest.version = crypto
  .createHash('sha256')
  .update(JSON.stringify(manifest.sources) + JSON.stringify(rawFiles))
  .digest('hex')
  .slice(0, 16)
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(
  '浏览资源生成完成（源数据只读）：',
  Object.fromEntries(Object.entries(manifest.sources).map(([name, value]) => [name, value.count]))
)
