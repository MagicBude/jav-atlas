const fs = require('fs')
const path = require('path')

/**
 * 解析统一产物目录，不依赖调用脚本位于 tools 还是子目录。
 * 显式覆盖为相对路径时，以进程工作目录为基准。
 * @returns {string} 产物目录的绝对路径；本函数不创建目录。
 */
function relayDir() {
  return path.resolve(process.env.RELAY_DIR || path.join(__dirname, '..', '..', 'relay'))
}

/**
 * 读取 JSON，只把 ENOENT 视为冷启动，其他读取/解析错误保留原因并抛出。
 * @param {string} file 文件路径。
 * @param {*} fallback 文件不存在时返回的默认值。
 * @returns {*} 解析结果，结构校验由业务调用方完成。
 * @throws {Error} 文件损坏、读取权限不足或其他非 ENOENT 异常。
 */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error('无法读取 JSON：' + file, { cause: error })
  }
}

/**
 * 创建父目录，完成同目录临时写入后再替换目标，降低中断破坏旧 JSON 的风险。
 * 不保证多个文件的整体事务，也不允许并发进程向同一路径写入。
 * @param {string} file 目标 JSON 路径。
 * @param {*} value 要序列化的数据。
 * @param {function} [replacer] 可选字段过滤器，遵循 JSON.stringify 规则。
 * @returns {void}
 * @throws {Error} 序列化、写入或重命名失败；不会降级为直接覆盖旧文件。
 */
function writeJson(file, value, replacer) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = file + '.tmp'
  fs.writeFileSync(temp, serializeJson(value, replacer))
  fs.renameSync(temp, file)
}

/**
 * 读取整数配置，拒绝 NaN、负数、小数、指数记法及越界值。
 * @param {string} name 环境变量名。
 * @param {number} fallback 未设置或空字符串时的默认值，由调用方保证有效。
 * @param {number} [min=1] 包含在内的下限。
 * @param {number} [max=100000] 包含在内的上限。
 * @returns {number} 验证后的配置值。
 * @throws {Error} 显式配置不是范围内的十进制安全整数。
 */
function envInt(name, fallback, min = 1, max = 100000) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(name + ' 必须为 ' + min + '～' + max + ' 的整数')
  }
  return value
}

/**
 * 序列化为两空格缩进的 UTF-8 JSON 文本，保留字段与数组顺序，并以换行结尾。
 * 集合排序由各采集器按业务规则完成，这里不擅自重排榜单或关系样本。
 * @param {*} value JSON 数据。
 * @param {function} [replacer] 可选字段过滤器。
 * @returns {string} 可直接写入的文本。
 */
function serializeJson(value, replacer) {
  const text = JSON.stringify(value, replacer, 2)
  if (text === undefined) throw new Error('顶层数据无法序列化为 JSON')
  return text + '\n'
}

/** 用 Unicode 字符串顺序比较来源 ID，给相同业务排序值提供稳定的最后排序键。 */
function compareIds(a, b) {
  const left = String(a.id),
    right = String(b.id)
  return left < right ? -1 : left > right ? 1 : 0
}

module.exports = { relayDir, readJson, writeJson, envInt, serializeJson, compareIds }
