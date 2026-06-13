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
