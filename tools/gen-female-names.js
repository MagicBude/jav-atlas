/**
 * @file 生成用于姓名反查的女性原始名字集合，不做身份去重或性别验证。
 * 读取：RELAY_DIR 下 minnano/actresses.json、javdb/actors.json、javdb/uncensored-actors.json 与已有名字集合。
 * 写入：RELAY_DIR/derived/female-name-index.json，默认仓库根 relay/；已有名字只增不减。
 * 流程：收集名册姓名/别名 → 收集 gender=f 的人物姓名 → Set 去重 → 写出 count 和 names。
 * 文件不存在允许冷启动；损坏 JSON 不视为空集合，必须修复后重试。
 * 函数 add 会限制原字符串长度再 trim；没有将大小写、假名或同义名字合并。
 * 运行：node tools/gen-female-names.js；写入时自动创建目录，无姓名时保留旧集合，不生成空产物。
 *
 * 名字集合用于让采集环境在没有完整名册时仍可做反查，保存归一化前的原始名字。
 * 来源包括名册姓名与别名、javdb/actors.json 中 gender=f 的记录，以及无码名单中 gender=f 的记录。
 * 完整名册体积样本约 16 MB；缺失全部姓名输入时需保留未知，不能因生成了 JSON 就认为依据完整。
 */
const fs = require('fs')
const { readJson, writeJson } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const paths = dataPaths()
const previous = readJson(paths.femaleNameIndex, { names: [] })
if (!Array.isArray(previous.names))
  throw new Error('derived/female-name-index.json 缺少 names 数组')
const set = new Set(previous.names)

/**
 * 收集原始姓名：先校验真值及长度小于 60，再 trim 后加入 Set。
 *
 * @param {*} n 原始名字；当前实现允许 trim 后的空串先进入 Set。
 * @returns {void} 最终输出前还会过滤空串。
 */
const add = n => {
  if (n && String(n).length < 60) set.add(String(n).trim())
}
// 阶段 1：读取当前名册，文件缺失允许冷启动，读取或结构错误则中止。
const roster = readJson(paths.minnanoActresses, [])
if (!Array.isArray(roster)) throw new Error('minnano/actresses.json 必须是数组')
for (const a of roster) {
  if (!a) continue
  add(a.name)
  ;[a.name_ja, a.name_zh, a.name_en].forEach(add)
  if (Array.isArray(a.alias)) a.alias.forEach(add)
}

/**
 * 从脚本指定 relay 目录读取人物 list，仅合并 gender=f 的姓名及别名。
 * 文件缺失允许跳过，JSON 或 list 结构错误会中止，避免输出不完整的新集合。
 *
 * @param {string} f 由 dataPaths 返回的绝对 JSON 路径。
 * @returns {void} 通过外层 Set 累积结果。
 */
const addFromFile = f => {
  const data = readJson(f, { list: [] })
  if (!Array.isArray(data.list)) throw new Error(f + ' 缺少 list 数组')
  for (const a of data.list) {
    if (!a || a.gender !== 'f' || String(a.genderSource || '').startsWith('unverified')) continue
    add(a.name)
    add(a.name_zht)
    String(a.other_name || '')
      .split(/[,，、]/)
      .forEach(add)
  }
}
// 阶段 2：收集两个演员产物中已标为女性的姓名，不重新判断性别。
addFromFile(paths.javdbActors)
addFromFile(paths.javdbUncensoredActors)
// 阶段 3：过滤空串，保留已有姓名；只有非空结果才以临时文件替换，自动准备目录。
const names = [...set].filter(Boolean).sort()
if (!names.length) {
  console.log('没有已确认的女性姓名，本轮不写空集合')
  process.exit(0)
}
writeJson(paths.femaleNameIndex, {
  fetchedAt: Date.now(),
  source: 'minnano-roster+javdb-verified',
  count: names.length,
  names
})
console.log(
  'relay/derived/female-name-index.json：' +
    names.length +
    ' 个女优名字，' +
    (fs.statSync(paths.femaleNameIndex).size / 1048576).toFixed(2) +
    ' MB'
)
