/**
 * 药品名解析：从「阿司匹林肠溶片」等商品名回退到图谱中的「阿司匹林」
 */

// 剂型/规格后缀（长串优先剥离）
const DOSAGE_FORM_SUFFIXES = [
  '肠溶片', '缓释片', '控释片', '咀嚼片', '分散片', '泡腾片', '双层片',
  '肠溶胶囊', '缓释胶囊', '软胶囊', '硬胶囊', '维c肠溶胶囊',
  '注射液', '注射剂', '注射用', '口服液', '滴眼液', '软膏', '乳膏', '贴剂', '喷雾剂',
  '颗粒', '片剂', '胶囊', '片', '丸', '散', '液'
].sort((a, b) => b.length - a.length);

/**
 * 剥离常见剂型后缀，得到核心药名
 * @example extractCoreName('阿司匹林肠溶片') => '阿司匹林'
 */
function extractCoreName(name) {
  let core = String(name || '').trim();
  if (!core) return '';
  for (const suf of DOSAGE_FORM_SUFFIXES) {
    if (core.endsWith(suf) && core.length > suf.length) {
      core = core.slice(0, -suf.length).trim();
      break;
    }
  }
  return core;
}

/**
 * 生成用于图谱检索的名称候选（原词 + 剥离剂型后的核心名，去重）
 */
function buildLookupNames(queryName) {
  const q = String(queryName || '').trim();
  if (!q) return [];
  const core = extractCoreName(q);
  const names = [q];
  if (core && core !== q) names.push(core);
  return [...new Set(names)];
}

/**
 * 多条命中时优先：精确 name → aliases → 名称最短
 */
function pickBestMedicine(candidates, queryName) {
  if (!candidates || !candidates.length) return null;
  const q = String(queryName).trim();
  const exact = candidates.find(m => m.name === q);
  if (exact) return exact;
  const aliasHit = candidates.find(m => Array.isArray(m.aliases) && m.aliases.includes(q));
  if (aliasHit) return aliasHit;
  const contains = candidates.filter(m => m.name && m.name.includes(q));
  if (contains.length) {
    return contains.sort((a, b) => a.name.length - b.name.length)[0];
  }
  // 用户输入更长：「阿司匹林肠溶片」包含图谱名「阿司匹林」
  const containedByQuery = candidates.filter(m => m.name && q.includes(m.name));
  if (containedByQuery.length) {
    return containedByQuery.sort((a, b) => b.name.length - a.name.length)[0];
  }
  return candidates[0];
}

module.exports = { extractCoreName, buildLookupNames, pickBestMedicine, DOSAGE_FORM_SUFFIXES };
