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
 * @returns {void}
 * @throws {Error} 序列化、写入或重命名失败；不会降级为直接覆盖旧文件。
 */
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = file + '.tmp'
  fs.writeFileSync(temp, JSON.stringify(value))
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

module.exports = { relayDir, readJson, writeJson, envInt }
