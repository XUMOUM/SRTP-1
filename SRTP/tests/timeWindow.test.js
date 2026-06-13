/* 提醒时间窗口单元测试 */
const { buildCandidateTimes, isTimeWithinWindow } = require('../cloudfunctions/checkAndSendReminders/timeWindow.js');

test('候选时刻数量为 2*window+1', () => {
  const list = buildCandidateTimes(8, 0, 7);
  assert.strictEqual(list.length, 15);
  assert.ok(list.includes('08:00'));
  assert.ok(list.includes('07:53'));
  assert.ok(list.includes('08:07'));
});

test('候选时刻跨小时正确（08:05 ± 7 含 07:58 与 08:12）', () => {
  const list = buildCandidateTimes(8, 5, 7);
  assert.ok(list.includes('07:58'));
  assert.ok(list.includes('08:12'));
});

test('候选时刻跨午夜正确（23:58 ± 7 含 00:05）', () => {
  const list = buildCandidateTimes(23, 58, 7);
  assert.ok(list.includes('00:05'));
  assert.ok(list.includes('23:51'));
});

test('窗口内时刻判定为 true', () => {
  assert.strictEqual(isTimeWithinWindow('08:05', 8, 0, 7), true);
  assert.strictEqual(isTimeWithinWindow('08:00', 8, 7, 7), true);
});

test('窗口外时刻判定为 false', () => {
  assert.strictEqual(isTimeWithinWindow('08:10', 8, 0, 7), false);
});

test('跨午夜环形窗口判定正确', () => {
  // 23:58 与 00:03 相差 5 分钟（跨午夜）
  assert.strictEqual(isTimeWithinWindow('00:03', 23, 58, 7), true);
  // 23:58 与 00:10 相差 12 分钟
  assert.strictEqual(isTimeWithinWindow('00:10', 23, 58, 7), false);
});

test('非法输入安全返回 false', () => {
  assert.strictEqual(isTimeWithinWindow('', 8, 0, 7), false);
  assert.strictEqual(isTimeWithinWindow('8-00', 8, 0, 7), false);
  assert.strictEqual(isTimeWithinWindow(null, 8, 0, 7), false);
});
