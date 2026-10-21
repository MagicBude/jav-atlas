/**
 * @file 一次性将旧 ID.jpg 迁移为 ID_姓名.jpg（字母 ID 附区分大小写的编码）。
 * 用法：node tools/migrate-avatar-names.js --from-git
 * --from-git 从 HEAD blob 恢复原图，专用于 Windows 已发生大小写碰撞的旧版本。
 * 先完整读取并校验全部内容，再写新文件、删除旧路径；未知 ID/冲突/本地改图均中止。
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { dataPaths } = require('./lib/data-paths')
const { readJson } = require('./lib/runtime')
const { avatarFilename } = require('./lib/avatars')
const paths = dataPaths()
const fromGit = process.argv.includes('--from-git')
const groups = [
  [paths.minnanoAvatars, readJson(paths.minnanoActresses, []).map(r => [String(r.mnid), r.name])],
  [
    paths.javdbAvatars,
    [
      ...(readJson(paths.javdbActors, {}).list || []),
      ...(readJson(paths.javdbMaleSeeds, {}).list || [])
    ].map(r => [r.id, r.name])
  ],
  [
    paths.supplementAvatars,
    Object.entries(readJson(paths.avatarSupplements, {}).map || {}).map(([name, r]) => [
      r.id || 'mn_' + r.mnid,
      r.name || name
    ])
  ]
]
const tasks = []
const targets = new Set()
for (const [dir, entries] of groups) {
  const names = new Map(entries)
  const relative = path.relative(process.cwd(), dir).split(path.sep).join('/')
  const files = fromGit
    ? execFileSync('git', ['ls-tree', '-rz', '--name-only', 'HEAD', '--', relative], {
        encoding: 'utf8'
      })
        .split('\0')
        .filter(Boolean)
        .map(f => path.basename(f))
    : fs.existsSync(dir)
      ? fs.readdirSync(dir)
      : []
  for (const file of files) {
    if (!/^[A-Za-z0-9_-]+\.jpg$/.test(file)) continue
    const id = file.slice(0, -4)
    if (!names.has(id)) {
      if ([...names].some(([key, name]) => avatarFilename(key, name) === file)) continue
      throw new Error('找不到头像对应姓名：' + file)
    }
    const target = path.join(dir, avatarFilename(id, names.get(id)))
    const key = target.toLowerCase()
    if (targets.has(key) || fs.existsSync(target)) throw new Error('目标文件冲突：' + target)
    targets.add(key)
    const source = path.join(dir, file)
    const buffer = fromGit
      ? execFileSync('git', ['show', 'HEAD:' + relative + '/' + file], {
          maxBuffer: 20 * 1024 * 1024
        })
      : fs.readFileSync(source)
    tasks.push({ source, target, buffer })
  }
}
// Windows 本地旧文件可能只剩同大小写组中的某一张；仅允许它与该组 Git 内容之一相同。
for (const task of tasks) {
  if (!fs.existsSync(task.source)) throw new Error('本地旧图缺失：' + task.source)
  const local = fs.readFileSync(task.source)
  if (
    !tasks.some(
      other =>
        other.source.toLowerCase() === task.source.toLowerCase() && local.equals(other.buffer)
    )
  )
    throw new Error('本地图已修改，请先保存：' + task.source)
}
for (const { target, buffer } of tasks) fs.writeFileSync(target, buffer, { flag: 'wx' })
for (const source of new Set(tasks.map(task => task.source)))
  if (fs.existsSync(source)) fs.unlinkSync(source)
console.log('迁移完成：' + tasks.length + ' 张；图片内容保持不变。')
