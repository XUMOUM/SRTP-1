/**
 * 提醒时间窗口纯函数（无外部依赖，便于单元测试）
 */

/**
 * 生成时间窗口内的候选 "HH:MM" 列表（跨小时/跨天安全）
 */
function buildCandidateTimes(currentHour, currentMinute, windowMinutes) {
  const currentTotal = currentHour * 60 + currentMinute;
  const times = [];
  for (let offset = -windowMinutes; offset <= windowMinutes; offset++) {
    let total = (currentTotal + offset) % (24 * 60);
    if (total < 0) total += 24 * 60;
    const h = Math.floor(total / 60).toString().padStart(2, '0');
    const m = (total % 60).toString().padStart(2, '0');
    times.push(`${h}:${m}`);
  }
  return times;
}

/**
 * 检查目标时刻是否在当前时刻 ± windowMinutes 的环形窗口内（跨午夜安全）
 * @param {string} targetTime - "HH:MM"
 */
function isTimeWithinWindow(targetTime, currentHour, currentMinute, windowMinutes) {
  if (!targetTime || typeof targetTime !== 'string') return false;

  const parts = targetTime.split(':');
  if (parts.length !== 2) return false;

  const targetHour = parseInt(parts[0], 10);
  const targetMinute = parseInt(parts[1], 10);

  if (isNaN(targetHour) || isNaN(targetMinute)) return false;

  const targetTotal = targetHour * 60 + targetMinute;
  const currentTotal = currentHour * 60 + currentMinute;

  const rawDiff = Math.abs(targetTotal - currentTotal);
  const diff = Math.min(rawDiff, 24 * 60 - rawDiff);

  return diff <= windowMinutes;
}

module.exports = { buildCandidateTimes, isTimeWithinWindow };
