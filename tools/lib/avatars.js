/** 头像文件命名、冲突处理和性别目录的统一入口。 */
const fs = require('fs')
const path = require('path')
const { readJson, writeJson } = require('./runtime')
// 当前进程尚未完成下载的预留路径；跨进程仅已有图片占用文件名。
const reservations = new Set()

/** 默认使用 ID_姓名.jpg；非法文件字符替换为下划线，不改变人物 ID。 */
function avatarFilename(id, name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('非法头像 ID：' + id)
  const safe =
    String(name || '未命名')
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 64) || '未命名'
  return `${id}_${safe}.jpg`
}

/** gender 只接受明确的 f/m；其余归入 unknown，不根据姓名或图片猜测。 */
function genderFolder(gender) {
  return gender === 'f' ? 'female' : gender === 'm' ? 'male' : 'unknown'
}

/** 索引中的路径必须位于当前来源的三个性别目录内。 */
function resolveFile(dir, file) {
  if (!/^(female|male|unknown)\/[^/\\]+\.jpg$/.test(file))
    throw new Error('非法头像索引路径：' + file)
  return path.join(dir, file)
}

/**
 * 按原始 ID 维护 index.json，支持姓名更新与性别确认后移动原图。
 * 默认名与其他人物的目标路径忽略大小写后相同时，才追加 --ID十六进制。
 * 在网络 await 之前同步预留索引，避免同批并发下载互相覆盖；图片下载仍由调用者负责。
 * 索引可包含待补图的人物，使用端应检查图片是否实际存在。
 */
function avatarPath(dir, id, name, gender = '?') {
  id = String(id)
  const filename = avatarFilename(id, name)
  fs.mkdirSync(dir, { recursive: true })
  const indexFile = path.join(dir, 'index.json')
  const index = readJson(indexFile, { files: {} })
  if (!index.files || typeof index.files !== 'object')
    throw new Error('头像索引结构错误：' + indexFile)
  const previous = index.files[id]
  const effectiveGender = ['f', 'm'].includes(gender) ? gender : previous?.gender || '?'
  const folder = genderFolder(effectiveGender)
  const previousPath = previous ? resolveFile(dir, previous.file) : null
  const occupied = file => {
    const relative = `${folder}/${file}`
    const key = relative.toLowerCase()
    if (
      Object.entries(index.files).some(
        ([other, row]) =>
          other !== id &&
          row.file.toLowerCase() === key &&
          (fs.existsSync(resolveFile(dir, row.file)) ||
            reservations.has(resolveFile(dir, row.file)))
      )
    )
      return true
    const entries = fs.existsSync(path.join(dir, folder))
      ? fs.readdirSync(path.join(dir, folder))
      : []
    return entries.some(
      entry =>
        entry.toLowerCase() === file.toLowerCase() &&
        (!previousPath ||
          path.join(dir, folder, entry).toLowerCase() !== previousPath.toLowerCase())
    )
  }
  const selected = occupied(filename)
    ? filename.slice(0, -4) + '--' + Buffer.from(id).toString('hex') + '.jpg'
    : filename
  if (occupied(selected)) throw new Error('头像文件冲突，拒绝覆盖：' + selected)
  const file = `${folder}/${selected}`
  const target = resolveFile(dir, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (previousPath && previousPath !== target && fs.existsSync(previousPath)) {
    // 中转名也覆盖 Windows 的仅大小写改名场景；网络下载不参与文件迁移。
    const temp = previousPath + '.renaming'
    if (fs.existsSync(temp)) throw new Error('存在未完成的头像改名：' + temp)
    fs.renameSync(previousPath, temp)
    fs.renameSync(temp, target)
  }
  index.files[id] = { name: name || '未命名', gender: effectiveGender, file }
  index.files = Object.fromEntries(
    Object.entries(index.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
  try {
    if (JSON.stringify(previous) !== JSON.stringify(index.files[id])) writeJson(indexFile, index)
  } catch (error) {
    // 索引写入失败时把原图退回，保证已有索引仍能定位；不删除唯一图片副本。
    if (
      previousPath &&
      previousPath !== target &&
      fs.existsSync(target) &&
      !fs.existsSync(previousPath)
    ) {
      try {
        fs.renameSync(target, previousPath)
      } catch (rollbackError) {
        throw new Error('索引与回滚均失败，原图仍在：' + target, { cause: rollbackError })
      }
    }
    throw error
  }
  reservations.add(target)
  return target
}
module.exports = { avatarFilename, avatarPath, genderFolder }
