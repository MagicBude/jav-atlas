const fs = require('fs')
const path = require('path')

/**
 * 头像使用源站 ID + 姓名，姓名只用于浏览，人物关联仍使用 JSON 中的原始 ID。
 * Windows 禁用字符以下划线替换，去掉末尾点/空格，限制姓名长度以避免路径过长。
 */
function avatarFilename(id, name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(id))) throw new Error('非法头像 ID：' + id)
  const safe =
    String(name || '未命名')
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 64) || '未命名'
  // 字母 ID 区分大小写，而 Windows 文件系统通常不区分；编码保留这种区别。
  // 纯数字 minnano ID 无需编码；JavDB ID 附带完整十六进制，避免同名演员再次碰撞。
  const key = /[a-zA-Z]/.test(String(id)) ? '--' + Buffer.from(String(id)).toString('hex') : ''
  return `${id}_${safe}${key}.jpg`
}

/** 同一 ID 改名时重用原图，避免每次姓名更新都重新下载。 */
function avatarPath(dir, id, name) {
  const target = path.join(dir, avatarFilename(id, name))
  if (fs.existsSync(target)) return target
  if (fs.existsSync(dir)) {
    const suffix = /[a-zA-Z]/.test(String(id))
      ? '--' + Buffer.from(String(id)).toString('hex') + '.jpg'
      : null
    const previous = fs
      .readdirSync(dir)
      .find(file =>
        suffix ? file.endsWith(suffix) : file.startsWith(id + '_') && file.endsWith('.jpg')
      )
    if (previous) fs.renameSync(path.join(dir, previous), target)
  }
  return target
}
module.exports = { avatarFilename, avatarPath }
