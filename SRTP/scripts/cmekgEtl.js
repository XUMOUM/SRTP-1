/**
 * CMeKG 图谱 ETL 脚本（路线 A：离线抽取 -> 文档结构）
 *
 * 作用：连接已恢复 cmekg-v5.2 dump 的本地 Neo4j 实例，抽取“药品-禁忌疾病 / 过敏原 /
 *       药物相互作用 / 禁忌人群”子图，转换为云数据库集合 cme_kg_medicines 期望的
 *       文档结构（与 SRTP/cmekg_seed_data.json 完全一致），输出 cmekg_seed_data.generated.json。
 *
 * 前置条件：
 *   1. 已用 Neo4j 5.x 恢复 dump（见 scripts/cmekg-integration.md）。
 *   2. npm install （安装 neo4j-driver，见同目录 package.json）。
 *
 * 用法：
 *   # 1) 先探查图谱 schema（标签、关系类型、属性、样例），据此校准下方 CONFIG
 *   node cmekgEtl.js --probe
 *   # 2) 抽取并生成 JSON
 *   node cmekgEtl.js
 *
 * 环境变量：
 *   NEO4J_URI       默认 bolt://localhost:7687
 *   NEO4J_USER      默认 neo4j
 *   NEO4J_PASSWORD  必填
 *   CMEKG_DATABASE  默认 neo4j
 *
 * 注意：CMeKG 不同版本的标签/关系命名可能不同。请务必先用 --probe 探查真实 schema，
 *       再修改 CONFIG 中的 labels / relationships / props 后正式抽取。
 */

const fs = require('fs');
const path = require('path');

let neo4j;
try {
  neo4j = require('neo4j-driver');
} catch (e) {
  console.error('未找到 neo4j-driver，请先在 scripts 目录执行: npm install');
  process.exit(1);
}

// ============ 可配置区（CMeKG v5.2 no-constraints dump 实测 schema） ============
const CONFIG = {
  // v5.2 使用英文标签 Drug / Disease / Complication / Symptom
  drugLabel: process.env.CMEKG_DRUG_LABEL || 'Drug',
  nameProp: process.env.CMEKG_NAME_PROP || 'name',

  // v5.2 仅有 contraindications 关系指向 Disease/Complication/Symptom，无 Drug-Drug 相互作用边
  rels: {
    contraindications: process.env.CMEKG_REL_CONTRA || 'contraindications',
    subject: process.env.CMEKG_REL_SUBJECT || 'subject',
    precautions: process.env.CMEKG_REL_PRECAUTIONS || 'precautions'
  },

  // 抽取上限（0 表示不限制，调试时可设小值）
  limit: parseInt(process.env.CMEKG_LIMIT || '0', 10),

  outputFile: path.join(__dirname, 'cmekg_seed_data.generated.json'),
  importFile: path.join(__dirname, 'cmekg_import_ready.json'),
  importJsonlFile: path.join(__dirname, 'cmekg_import_ready.jsonl')
};

function getDriver() {
  const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  if (!password) {
    console.error('请设置环境变量 NEO4J_PASSWORD');
    process.exit(1);
  }
  return neo4j.driver(uri, neo4j.auth.basic(user, password));
}

async function runProbe(session) {
  console.log('===== Schema 探查 =====');
  const labels = await session.run('CALL db.labels() YIELD label RETURN label ORDER BY label');
  console.log('节点标签:', labels.records.map(r => r.get('label')).join(', '));

  const relTypes = await session.run('CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType');
  console.log('关系类型:', relTypes.records.map(r => r.get('relationshipType')).join(', '));

  const propKeys = await session.run('CALL db.propertyKeys() YIELD propertyKey RETURN propertyKey ORDER BY propertyKey');
  console.log('属性键:', propKeys.records.map(r => r.get('propertyKey')).join(', '));

  // 样例：每个标签取 1 个节点，便于核对属性名
  console.log('\n----- 各标签样例节点 -----');
  for (const r of labels.records) {
    const label = r.get('label');
    const sample = await session.run(
      `MATCH (n:\`${label}\`) RETURN n LIMIT 1`
    );
    if (sample.records.length > 0) {
      console.log(`[${label}]`, JSON.stringify(sample.records[0].get('n').properties));
    }
  }
  console.log('\n探查完成。请据此校准 cmekgEtl.js 顶部 CONFIG，再执行 node cmekgEtl.js 正式抽取。');
}

function toArray(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return [val].filter(Boolean);
}

function uniqueStrings(items) {
  return [...new Set(items.map(s => String(s).trim()).filter(Boolean))];
}

function extractAllergiesFromPrecautions(precautions) {
  const allergies = [];
  for (const text of toArray(precautions)) {
    const m = String(text).match(/对(.{1,30}?)过敏者禁用/);
    if (m && m[1]) allergies.push(m[1].trim());
    if (/青霉素/.test(text)) allergies.push('青霉素');
    if (/头孢/.test(text)) allergies.push('头孢类');
  }
  return allergies;
}

function extractPopulationsFromPrecautions(precautions) {
  const populations = [];
  for (const text of toArray(precautions)) {
    if (/孕妇/.test(text)) populations.push('孕妇');
    if (/哺乳期/.test(text)) populations.push('哺乳期妇女');
    if (/儿童/.test(text)) populations.push('儿童');
    if (/老年/.test(text)) populations.push('老年人');
  }
  return uniqueStrings(populations);
}

async function runExtract(session) {
  const limitClause = CONFIG.limit > 0 ? `LIMIT ${CONFIG.limit}` : '';

  const cypher = `
    MATCH (d:\`${CONFIG.drugLabel}\`)
    OPTIONAL MATCH (d)-[:\`${CONFIG.rels.contraindications}\`]->(dis:Disease)
    OPTIONAL MATCH (d)-[:\`${CONFIG.rels.contraindications}\`]->(comp:Complication)
    OPTIONAL MATCH (d)-[:\`${CONFIG.rels.contraindications}\`]->(sym:Symptom)
    OPTIONAL MATCH (d)-[:\`${CONFIG.rels.subject}\`]->(sub:Subject)
    OPTIONAL MATCH (d)-[:\`${CONFIG.rels.precautions}\`]->(pre:Precautions)
    WITH d, sub,
         collect(DISTINCT dis.\`${CONFIG.nameProp}\`) AS diseaseNames,
         collect(DISTINCT comp.\`${CONFIG.nameProp}\`) AS complicationNames,
         collect(DISTINCT sym.\`${CONFIG.nameProp}\`) AS symptomNames,
         collect(DISTINCT pre.\`${CONFIG.nameProp}\`) AS precautionTexts
    RETURN
      d.\`${CONFIG.nameProp}\` AS name,
      sub.\`${CONFIG.nameProp}\` AS category,
      diseaseNames,
      complicationNames,
      symptomNames,
      precautionTexts
    ${limitClause}
  `;

  const result = await session.run(cypher);
  const medicines = [];

  for (const rec of result.records) {
    const name = rec.get('name');
    if (!name) continue;

    const diseaseNames = toArray(rec.get('diseaseNames'));
    const complicationNames = toArray(rec.get('complicationNames'));
    const symptomNames = toArray(rec.get('symptomNames'));
    const precautionTexts = toArray(rec.get('precautionTexts'));

    const allergyFromComplications = complicationNames.filter(n => /过敏/.test(n));
    const diseaseComplications = complicationNames.filter(n => !/过敏/.test(n));

    const diseases = uniqueStrings([
      ...diseaseNames,
      ...diseaseComplications,
      ...symptomNames
    ]);
    const allergies = uniqueStrings([
      ...allergyFromComplications,
      ...extractAllergiesFromPrecautions(precautionTexts)
    ]);
    const populations = extractPopulationsFromPrecautions(precautionTexts);

    // 仅导出至少含禁忌/过敏/人群信息的药品，减少云库无效记录
    if (diseases.length === 0 && allergies.length === 0 && populations.length === 0) {
      continue;
    }

    medicines.push({
      name: name,
      aliases: [],
      category: rec.get('category') || '',
      contraindications: {
        diseases: diseases,
        allergies: allergies,
        populations: populations
      },
      interactions: []
    });
  }

  const output = {
    _comment: 'CMeKG v5.2 全量图谱 ETL 生成（由 cmekgEtl.js 抽取）',
    _generatedAt: new Date().toISOString(),
    _count: medicines.length,
    _source: 'cmekg-v5.2-no-constraints.dump',
    medicines: medicines,
    import_instructions: '云开发导入请使用 cmekg_import_ready.json（medicines 包装）或 cmekg_import_ready.jsonl（JSON Lines）'
  };

  // 微信云开发导入：不接受裸数组，需 medicines 包装对象或 JSON Lines
  const importPayload = { medicines: medicines };
  const jsonl = medicines.map(item => JSON.stringify(item)).join('\n');

  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2), 'utf8');
  fs.writeFileSync(CONFIG.importFile, JSON.stringify(importPayload, null, 2), 'utf8');
  fs.writeFileSync(CONFIG.importJsonlFile, jsonl, 'utf8');
  console.log(`已抽取 ${medicines.length} 种药品（含禁忌/过敏/人群信息）`);
  console.log(`完整输出: ${CONFIG.outputFile}`);
  console.log(`云库导入(JSON): ${CONFIG.importFile}`);
  console.log(`云库导入(JSONL): ${CONFIG.importJsonlFile}`);
}

async function main() {
  const isProbe = process.argv.includes('--probe');
  const driver = getDriver();
  const session = driver.session({ database: process.env.CMEKG_DATABASE || 'neo4j' });
  try {
    if (isProbe) {
      await runProbe(session);
    } else {
      await runExtract(session);
    }
  } catch (e) {
    console.error('执行失败:', e.message);
    process.exitCode = 1;
  } finally {
    await session.close();
    await driver.close();
  }
}

main();
