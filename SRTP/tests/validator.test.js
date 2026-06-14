/* 处方 Schema 校验单元测试 */
const { validateMedicine, inferTimes, postProcess } = require('../cloudfunctions/parseMedicineByAI/validator.js');

test('合法药品通过校验', () => {
  const r = validateMedicine({
    name: '阿司匹林肠溶片',
    dosageNumber: '100',
    dosageUnit: 'mg',
    instruction: '晨起服用',
    frequency: '1',
    times: ['08:00']
  }, 0);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.errors.length, 0);
});

test('异常单位"斤"被拦截（核心安全用例）', () => {
  const r = validateMedicine({
    name: '阿司匹林',
    dosageNumber: '1',
    dosageUnit: '斤',
    frequency: '1'
  }, 0);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('非法单位')));
});

test('缺少必填项 name 报错', () => {
  const r = validateMedicine({
    dosageNumber: '1',
    dosageUnit: '片',
    frequency: '1'
  }, 0);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('name')));
});

test('剂量为非数字格式报错', () => {
  const r = validateMedicine({
    name: '布洛芬',
    dosageNumber: '一百',
    dosageUnit: 'mg',
    frequency: '2'
  }, 0);
  assert.strictEqual(r.valid, false);
});

test('非法时间格式报错', () => {
  const r = validateMedicine({
    name: '布洛芬',
    dosageNumber: '1',
    dosageUnit: '片',
    frequency: '1',
    times: ['25:99']
  }, 0);
  assert.strictEqual(r.valid, false);
});

test('inferTimes 按频次推断默认时间', () => {
  assert.deepStrictEqual(inferTimes('3'), ['08:00', '14:00', '20:00']);
  assert.deepStrictEqual(inferTimes('1'), ['08:00']);
  assert.deepStrictEqual(inferTimes('99'), ['08:00']);
});

test('postProcess 缺失 times 时自动补全', () => {
  const m = postProcess({ name: ' 头孢 克肟 ', dosageNumber: '0.1g', frequency: '2' });
  assert.deepStrictEqual(m.times, ['08:00', '20:00']);
  assert.strictEqual(m.name, '头孢 克肟');
  assert.strictEqual(m.dosageNumber, '0.1');
});

test('inferTimes 频次4推断四个时间点', () => {
  assert.deepStrictEqual(inferTimes('4'), ['08:00', '12:00', '18:00', '22:00']);
});

test('dosageUnit 合法白名单值"片"通过校验', () => {
  const r = validateMedicine({ name: '二甲双胍片', dosageNumber: '500', dosageUnit: '片', frequency: '3' }, 0);
  assert.strictEqual(r.valid, true);
});

test('dosageUnit 不在白名单也不在禁止列表时报"不在允许值列表中"', () => {
  const r = validateMedicine({ name: '阿司匹林', dosageNumber: '100', dosageUnit: '颗', frequency: '1' }, 0);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('不在允许值列表中')));
});

test('postProcess 已有 times 时不覆盖', () => {
  const m = postProcess({ name: '阿司匹林', dosageNumber: '100', frequency: '3', times: ['09:00'] });
  assert.deepStrictEqual(m.times, ['09:00']);
});

test('name 含特殊字符（如#）被 pattern 拦截', () => {
  const r = validateMedicine({ name: '阿司匹林#强效版', dosageNumber: '100', dosageUnit: 'mg', frequency: '1' }, 0);
  assert.strictEqual(r.valid, false);
});

// ── LLM 幻觉边界用例（医疗安全关键） ──

test('dosageNumber 合法小数"0.5"通过校验', () => {
  const r = validateMedicine({ name: '布洛芬', dosageNumber: '0.5', dosageUnit: 'g', frequency: '2' }, 0);
  assert.strictEqual(r.valid, true);
});

test('dosageNumber 仅一个点"."被拦截（幻觉场景）', () => {
  const r = validateMedicine({ name: '布洛芬', dosageNumber: '.', dosageUnit: 'mg', frequency: '1' }, 0);
  assert.strictEqual(r.valid, false);
});

test('dosageNumber 多个连续点"..."被拦截', () => {
  const r = validateMedicine({ name: '布洛芬', dosageNumber: '...', dosageUnit: 'mg', frequency: '1' }, 0);
  assert.strictEqual(r.valid, false);
});

test('dosageNumber 以点开头".5"被拦截', () => {
  const r = validateMedicine({ name: '阿莫西林', dosageNumber: '.5', dosageUnit: 'g', frequency: '3' }, 0);
  assert.strictEqual(r.valid, false);
});
