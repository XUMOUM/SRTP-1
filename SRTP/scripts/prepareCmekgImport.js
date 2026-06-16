/**
 * 生成微信云数据库可识别的 CMeKG 导入文件
 *
 * 重要：输出为 JSON Lines（.jsonl），每行一条记录。
 * 勿用标准 JSON 编辑器校验；微信导入时选 JSON 类型，文件可用 .jsonl，
 * 若选择器只认 .json，复制后改扩展名即可（内容不变）。
 *
 * 用法（在 SRTP/scripts 目录）：
 *   node prepareCmekgImport.js seed          → cmekg_seed_import.jsonl
 *   node prepareCmekgImport.js full            → cmekg_full_import.jsonl
 *   node prepareCmekgImport.js full --chunks → cmekg_chunk_001.jsonl ...
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCES = {
  seed: path.join(ROOT, 'cmekg_seed_data.json'),
  full: path.join(__dirname, 'cmekg_import_ready.json')
};

function loadMedicines(sourceKey) {
  const file = SOURCES[sourceKey];
  if (!fs.existsSync(file)) {
    console.error('找不到源文件:', file);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.medicines || []);
  if (!list.length) {
    console.error('源文件中没有 medicines 数据');
    process.exit(1);
  }
  return list;
}

function uniqueStrings(items) {
  return [...new Set(items.map(s => String(s).trim()).filter(Boolean))];
}

function mergeArrays(a, b) {
  return uniqueStrings([...(a || []), ...(b || [])]);
}

/**
 * 按 name 去重并合并禁忌字段（云库 name 有唯一索引，重复 name 会导致 E11000）
 */
function dedupeByName(medicines) {
  const map = new Map();
  let dupCount = 0;

  for (const med of medicines) {
    const name = (med.name || '').trim();
    if (!name) continue;

    if (!map.has(name)) {
      map.set(name, {
        name,
        aliases: [...(med.aliases || [])],
        category: med.category || '',
        contraindications: {
          diseases: [...(med.contraindications?.diseases || [])],
          allergies: [...(med.contraindications?.allergies || [])],
          populations: [...(med.contraindications?.populations || [])]
        },
        interactions: [...(med.interactions || [])]
      });
      continue;
    }

    dupCount++;
    const existing = map.get(name);
    existing.aliases = mergeArrays(existing.aliases, med.aliases);
    if (!existing.category && med.category) existing.category = med.category;
    existing.contraindications.diseases = mergeArrays(
      existing.contraindications.diseases,
      med.contraindications?.diseases
    );
    existing.contraindications.allergies = mergeArrays(
      existing.contraindications.allergies,
      med.contraindications?.allergies
    );
    existing.contraindications.populations = mergeArrays(
      existing.contraindications.populations,
      med.contraindications?.populations
    );
    // interactions 按 target_drug 去重
    const ixMap = new Map();
    [...existing.interactions, ...(med.interactions || [])].forEach(ix => {
      if (ix && ix.target_drug) ixMap.set(ix.target_drug, ix);
    });
    existing.interactions = [...ixMap.values()];
  }

  const result = [...map.values()];
  console.log(`去重：${medicines.length} 条 → ${result.length} 条（合并 ${dupCount} 条重复）`);
  return result;
}

function toJsonLines(medicines) {
  return medicines.map(item => JSON.stringify(item)).join('\n');
}

function writeJsonLines(filePath, medicines) {
  const content = toJsonLines(medicines);
  fs.writeFileSync(filePath, content, 'utf8');
  const sizeMb = (Buffer.byteLength(content, 'utf8') / 1024 / 1024).toFixed(2);
  console.log(`已写入 ${medicines.length} 条 → ${filePath} (${sizeMb} MB)`);
}

function main() {
  const mode = process.argv[2] || 'seed';
  const useChunks = process.argv.includes('--chunks');

  if (!SOURCES[mode]) {
    console.error('用法: node prepareCmekgImport.js <seed|full> [--chunks]');
    process.exit(1);
  }

  let medicines = loadMedicines(mode);
  console.log(`读取 ${mode} 数据源，共 ${medicines.length} 条药品`);

  if (mode === 'full') {
    medicines = dedupeByName(medicines);
  }

  if (useChunks) {
    const CHUNK = 500;
    let part = 1;
    for (let i = 0; i < medicines.length; i += CHUNK) {
      const slice = medicines.slice(i, i + CHUNK);
      const name = `cmekg_chunk_${String(part).padStart(3, '0')}.jsonl`;
      writeJsonLines(path.join(__dirname, name), slice);
      part++;
    }
    console.log(`共生成 ${part - 1} 个分片文件，请按顺序逐个导入`);
  } else {
    const outName = mode === 'seed' ? 'cmekg_seed_import.jsonl' : 'cmekg_full_import.jsonl';
    writeJsonLines(path.join(__dirname, outName), medicines);
  }

  console.log('\n导入步骤：');
  console.log('1. 云开发控制台 → 数据库 → cme_kg_medicines');
  console.log('2. 清空集合内已有记录（含此前导入失败残留的几条）');
  console.log('3. 点击「导入」→ 文件类型选 JSON → 冲突模式选 Insert');
  console.log('4. 选择生成的 .jsonl 文件（每行一条；选择器只认 .json 时可改扩展名）');
  console.log('5. 导入后记录数应等于输出条数，每条顶层有 name 字段');
}

main();
