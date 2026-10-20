/**
 * @file 生成用于姓名反查的女性原始名字集合，不做身份去重或性别验证。
 * 读取：脚本同级 actresses.json、relay/actors_full.json、relay/uncensored_actresses.json。
 * 写入：脚本同级 relay/female_names.json；在当前结构下路径位于 tools/，并非仓库根。
 * 流程：收集名册姓名/别名 → 收集 gender=f 的人物姓名 → Set 去重 → 写出 count 和 names。
 * 文件不存在或 JSON 解析失败均被忽略；因此读取失败可能得到不完整甚至空集合。
 * 函数 add 会限制原字符串长度再 trim；没有将大小写、假名或同义名字合并。
 * 运行：node tools/gen-female-names.js。不会自动创建输出目录；路径适配留待后续功能修改。
 *
 * 维护边界：本轮仅整理格式与注释，已知行为限制不在此处修复。
 */

const fs = require('fs'),
  path = require('path')
const RELAY = path.join(__dirname, 'relay')
const set = new Set()

/**
 * 收集原始姓名：先校验真值及长度小于 60，再 trim 后加入 Set。
 * @param {*} n 原始名字；当前实现允许 trim 后的空串先进入 Set。
 * @returns {void} 最终输出前还会过滤空串。
 */
const add = n => {
  if (n && String(n).length < 60) set.add(String(n).trim())
}
// 阶段 1：读入外部名册；读取失败会静默继续，不表示资料已经完整。
let roster = []
try {
  roster = JSON.parse(fs.readFileSync(path.join(__dirname, 'actresses.json'), 'utf8')) || []
} catch (_) {}
for (const a of roster) {
  if (!a) continue
  add(a.name)
  ;[a.name_ja, a.name_zh, a.name_en].forEach(add)
  if (Array.isArray(a.alias)) a.alias.forEach(add)
}

/**
 * 从脚本指定 relay 目录读取人物 list，仅合并 gender=f 的姓名及别名。
 * 缺失文件、结构访问或解析错误均被忽略，可能使最终姓名集合不完整。
 * @param {string} f 相对于 RELAY 的 JSON 文件名。
 * @returns {void} 通过外层 Set 累积结果。
 */
const addFromFile = f => {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(RELAY, f), 'utf8')) || {}
    for (const a of d.list || []) {
      if (!a || a.gender !== 'f') continue
      add(a.name)
      add(a.name_zht)
      add(a.other_name)
      String(a.other_name || '')
        .split(/[,，、]/)
        .forEach(add)
    }
  } catch (_) {}
}
// 阶段 2：收集两个演员产物中已标为女性的姓名，不重新判断性别。
addFromFile('actors_full.json')
addFromFile('uncensored_actresses.json')
// 阶段 3：过滤最终空串后直接写目标，目录必须由调用方事先准备。
const names = [...set].filter(Boolean)
fs.writeFileSync(
  path.join(RELAY, 'female_names.json'),
  JSON.stringify({
    fetchedAt: Date.now(),
    source: 'minnano-roster+javdb-verified',
    count: names.length,
    names
  })
)
console.log(
  'relay/female_names.json：' +
    names.length +
    ' 个女优名字，' +
    (fs.statSync(path.join(RELAY, 'female_names.json')).size / 1048576).toFixed(2) +
    ' MB'
)
