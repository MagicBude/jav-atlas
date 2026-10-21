/** JavDB 网页性别证据：只保存用于判断的标签，不把拦截页当作人物资料。 */
const { readJson, writeJson } = require('./runtime')

/**
 * 从人物页的全部 section-meta 标签提取判定依据，保留别名等原文方便核对。
 * 有明确男性标签判 m；有作品数量且无男性标签判 f；仅别名或拦截页返回 null。
 * @param {string} html 网页正文；本函数不请求网络、不保存完整网页。
 * @returns {{gender: string, sectionMeta: string[]}|null} 可确认的结果或无有效依据。
 */
function parseGenderEvidence(html) {
  const metas = [
    ...String(html).matchAll(
      /<[^>]+class=["'][^"']*\bsection-meta\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/gi
    )
  ]
    .map(match =>
      match[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim()
    )
    .filter(Boolean)
  if (!metas.length) return null
  const male = metas.some(text => /男優|男优/.test(text))
  if (
    !male &&
    !metas.some(text => /\d[\d,，\s]*\s*(?:部影片|部電影|部电影|videos?\b|movies?\b)/i.test(text))
  )
    return null
  return { gender: male ? 'm' : 'f', sectionMeta: metas }
}

/**
 * 按源站 ID 原子保存成功取得的网页依据；失败由调用方跳过，不覆盖旧结果。
 * @param {string} file 网页证据 JSON 的绝对路径。
 * @param {string} id 原始 JavDB 人物 ID。
 * @param {{gender: string, sectionMeta: string[]}} evidence 公共解析器已确认的标签。
 * @returns {object} 包含性别、标签、人物页 URL 与本次复核时间的记录。
 */
function saveGenderEvidence(file, id, evidence) {
  const data = readJson(file, { source: 'javdb-web-section-meta', records: {} })
  if (!data.records || typeof data.records !== 'object') throw new Error('性别证据文件结构错误')
  const record = {
    gender: evidence.gender,
    sectionMeta: evidence.sectionMeta,
    sourceUrl: `https://javdb.com/actors/${id}`,
    checkedAt: new Date().toISOString()
  }
  data.records[id] = record
  data.records = Object.fromEntries(
    Object.entries(data.records).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
  writeJson(file, data)
  return record
}
module.exports = { parseGenderEvidence, saveGenderEvidence }
