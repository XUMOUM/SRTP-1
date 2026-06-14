/* 禁忌分析单元测试 */
const { analyzeContraindications } = require('../cloudfunctions/checkMedicineContraindication/analyzer.js');

const aspirin = {
  name: '阿司匹林',
  contraindications: {
    diseases: ['胃溃疡', '消化道出血'],
    allergies: ['阿司匹林', '水杨酸类']
  },
  interactions: [
    { target_drug: '华法林', risk_level: '高', mechanism: '增强抗凝', advice: '监测INR' },
    { target_drug: '布洛芬', risk_level: '中', mechanism: '增加出血风险', advice: '避免同用' }
  ]
};

test('命中病史禁忌产生高危预警', () => {
  const w = analyzeContraindications(aspirin, { userDiseases: ['胃溃疡'] });
  assert.ok(w.some(x => x.type === 'disease' && x.level === '高危'));
});

test('命中过敏史产生高危预警', () => {
  const w = analyzeContraindications(aspirin, { userAllergies: ['阿司匹林'] });
  assert.ok(w.some(x => x.type === 'allergy'));
});

test('高风险相互作用标记为高危', () => {
  const w = analyzeContraindications(aspirin, { currentMedicines: ['华法林'] });
  const ix = w.find(x => x.type === 'interaction');
  assert.ok(ix);
  assert.strictEqual(ix.level, '高危');
});

test('中风险相互作用标记为中风险', () => {
  const w = analyzeContraindications(aspirin, { currentMedicines: ['布洛芬'] });
  const ix = w.find(x => x.type === 'interaction');
  assert.strictEqual(ix.level, '中风险');
});

test('无任何冲突时返回空预警', () => {
  const w = analyzeContraindications(aspirin, {
    userDiseases: ['感冒'],
    userAllergies: ['花粉'],
    currentMedicines: ['维生素C']
  });
  assert.strictEqual(w.length, 0);
});

test('子串模糊匹配（严重胃溃疡 命中 胃溃疡）', () => {
  const w = analyzeContraindications(aspirin, { userDiseases: ['严重胃溃疡'] });
  assert.ok(w.some(x => x.type === 'disease'));
});

test('空 kgData 安全返回空数组', () => {
  assert.deepStrictEqual(analyzeContraindications(null, { userDiseases: ['胃溃疡'] }), []);
});

test('病史与过敏史同时命中，产生两条预警', () => {
  const w = analyzeContraindications(aspirin, { userDiseases: ['胃溃疡'], userAllergies: ['阿司匹林'] });
  assert.ok(w.some(x => x.type === 'disease'));
  assert.ok(w.some(x => x.type === 'allergy'));
  assert.strictEqual(w.length, 2);
});

test('多个相互作用同时命中均产生预警', () => {
  const w = analyzeContraindications(aspirin, { currentMedicines: ['华法林', '布洛芬'] });
  const interactions = w.filter(x => x.type === 'interaction');
  assert.strictEqual(interactions.length, 2);
});

test('profile 为 null 时安全返回空数组', () => {
  assert.deepStrictEqual(analyzeContraindications(aspirin, null), []);
});

test('kgData 无 contraindications 字段时不抛出异常', () => {
  const noContraData = { name: '维生素C', interactions: [] };
  const w = analyzeContraindications(noContraData, { userDiseases: ['胃溃疡'] });
  assert.deepStrictEqual(w, []);
});
