/**
 * @file 数据目录的唯一约定，集中管理来源资料、图片缓存和跨来源派生文件。
 * 修改布局时只调整此处；采集器不自行拼接其他来源的相对目录。
 */
const path = require('path')
const { relayDir } = require('./runtime')

/**
 * 返回一套绝对路径。RELAY_DIR 只覆盖总根目录，内部始终按来源分组。
 * @param {string} [root] 显式指定数据根，默认读取 relayDir()。
 * @returns {object} 各数据文件和缓存目录路径；不创建文件或目录。
 */
function dataPaths(root = relayDir()) {
  const base = path.resolve(root)
  return {
    minnanoRankings: path.join(base, 'minnano', 'rankings.json'),
    minnanoActresses: path.join(base, 'minnano', 'actresses.json'),
    minnanoAvatars: path.join(base, 'minnano', 'avatars'),
    javdbActors: path.join(base, 'javdb', 'actors.json'),
    javdbUncensoredActors: path.join(base, 'javdb', 'uncensored-actors.json'),
    javdbMaleSeeds: path.join(base, 'javdb', 'male-seed-actors.json'),
    javdbAvatars: path.join(base, 'javdb', 'avatars'),
    javdbLineCache: path.join(base, 'javdb', '.line-ok'),
    femaleNameIndex: path.join(base, 'derived', 'female-name-index.json'),
    avatarSupplements: path.join(base, 'derived', 'avatar-supplements.json'),
    supplementAvatars: path.join(base, 'derived', 'avatars')
  }
}

module.exports = { dataPaths }
