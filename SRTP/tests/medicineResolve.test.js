/* 药品名解析单元测试 */
const { extractCoreName, buildLookupNames, pickBestMedicine } = require('../cloudfunctions/checkMedicineContraindication/medicineResolve.js');

test('extractCoreName：阿司匹林肠溶片 → 阿司匹林', () => {
  assert.strictEqual(extractCoreName('阿司匹林肠溶片'), '阿司匹林');
});

test('extractCoreName：无剂型后缀时保持原样', () => {
  assert.strictEqual(extractCoreName('阿司匹林'), '阿司匹林');
});

test('extractCoreName：头孢克肟胶囊 → 头孢克肟', () => {
  assert.strictEqual(extractCoreName('头孢克肟胶囊'), '头孢克肟');
});

test('buildLookupNames：包含原词与核心名', () => {
  assert.deepStrictEqual(buildLookupNames('阿司匹林肠溶片'), ['阿司匹林肠溶片', '阿司匹林']);
});

test('pickBestMedicine：用户长名包含图谱短名时选最长匹配', () => {
  const candidates = [
    { name: '复方忍冬藤阿司匹林片', contraindications: { diseases: [] } },
    { name: '阿司匹林', contraindications: { diseases: ['消化性溃疡'] } }
  ];
  const best = pickBestMedicine(candidates, '阿司匹林肠溶片');
  assert.strictEqual(best.name, '阿司匹林');
});
