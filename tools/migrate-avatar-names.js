/**
 * @file 将旧头像迁移到性别目录，并按当前 JSON 重新整理姓名和性别。
 * 用法：node tools/migrate-avatar-names.js。支持旧 ID.jpg、带编码的旧文件和已索引文件。
 * 不访问网络、不修改人物资料；未知 ID 中止，避免把图片错误归给其他人。
 */
const fs = require('fs')
const path = require('path')
const { dataPaths } = require('./lib/data-paths')
const { readJson } = require('./lib/runtime')
const { avatarPath } = require('./lib/avatars')
const paths = dataPaths()
const actors = new Map()
// 先保留普通演员资料；无码资料仅补充已确认的性别，固定男演员种子同理。
for (const row of readJson(paths.javdbActors, {}).list || []) actors.set(String(row.id), row)
for (const row of [
  ...(readJson(paths.javdbUncensoredActors, {}).list || []),
  ...(readJson(paths.javdbMaleSeeds, {}).list || [])
]) {
  const previous = actors.get(String(row.id))
  if (!previous) actors.set(String(row.id), row)
  else if (!['f', 'm'].includes(previous.gender) && ['f', 'm'].includes(row.gender))
    actors.set(String(row.id), { ...previous, gender: row.gender })
}
const groups = [
  [
    paths.minnanoAvatars,
    readJson(paths.minnanoActresses, []).map(row => ({
      id: String(row.mnid),
      name: row.name,
      gender: 'f'
    }))
  ],
  [paths.javdbAvatars, [...actors.values()]],
  [
    paths.supplementAvatars,
    Object.entries(readJson(paths.avatarSupplements, {}).map || {}).map(([name, row]) => ({
      id: row.id || 'mn_' + row.mnid,
      name: row.name || name,
      gender: 'f'
    }))
  ]
]
let moved = 0
for (const [dir, rows] of groups) {
  if (!fs.existsSync(dir)) continue
  const records = new Map(rows.map(row => [String(row.id), row]))
  const index = readJson(path.join(dir, 'index.json'), { files: {} })
  const tasks = []
  // 仅根级图片属于历史布局；先检查所有归属，再开始移动。
  const ids = [...records.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
  for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.jpg'))) {
    const id = ids.find(id => file === id + '.jpg' || file.startsWith(id + '_'))
    if (!id) throw new Error('找不到头像对应人物：' + file)
    tasks.push({ row: records.get(id), source: path.join(dir, file) })
  }
  for (const [id, entry] of Object.entries(index.files)) {
    if (!records.has(id)) continue
    if (fs.existsSync(path.join(dir, entry.file)))
      tasks.push({ row: records.get(id), source: path.join(dir, entry.file) })
  }
  for (const { row, source } of tasks) {
    const target = avatarPath(dir, row.id, row.name, row.gender)
    if (source === target || !fs.existsSync(source)) continue
    if (fs.existsSync(target)) {
      if (!fs.readFileSync(source).equals(fs.readFileSync(target)))
        throw new Error('同一人物存在不同图片，拒绝覆盖：' + source)
      fs.unlinkSync(source)
    } else fs.renameSync(source, target)
    moved++
  }
}
console.log('头像整理完成：迁移旧文件 ' + moved + ' 张；姓名和性别目录已同步。')
