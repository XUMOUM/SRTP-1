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

// ============ 可配置区（用 --probe 探查后按真实 schema 校准） ============
const CONFIG = {
  // 药品节点标签（CMeKG 中文标签，常见为 "药物" 或 "药品"）
  drugLabel: process.env.CMEKG_DRUG_LABEL || '药物',
  疾病Label: process.env.CMEKG_DISEASE_LABEL || '疾病',
  // 节点上药品名称所在属性
  nameProp: process.env.CMEKG_NAME_PROP || 'name',
  aliasProp: process.env.CMEKG_ALIAS_PROP || 'aliases',
  categoryProp: process.env.CMEKG_CATEGORY_PROP || 'category',

  // 关系类型（药品 -> 目标）。以下为占位/常见命名，请按 --probe 结果修改。
  rels: {
    // 药品 -> 禁忌疾病
    contraindicationDisease: process.env.CMEKG_REL_CONTRA || '禁忌症',
    // 药品 -> 过敏原 / 过敏禁忌
    allergy: process.env.CMEKG_REL_ALLERGY || '过敏',
    // 药品 -> 药品（相互作用）
    interaction: process.env.CMEKG_REL_INTERACTION || '药物相互作用',
    // 药品 -> 禁忌人群
    population: process.env.CMEKG_REL_POPULATION || '禁忌人群'
  },

  // 相互作用关系上的属性名
  interactionProps: {
    riskLevel: process.env.CMEKG_IX_RISK || 'risk_level',
    mechanism: process.env.CMEKG_IX_MECHANISM || 'mechanism',
    advice: process.env.CMEKG_IX_ADVICE || 'advice'
  },

  // 抽取上限（0 表示不限制，调试时可设小值）
  limit: parseInt(process.env.CMEKG_LIMIT || '0', 10),

  outputFile: path.join(__dirname, 'cmekg_seed_data.generated.json')
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

function normalizeRisk(val) {
  if (!val) return '中';
  const s = String(val);
  if (/高|严重|major|high/i.test(s)) return '高';
  if (/低|轻|minor|low/i.test(s)) return '低';
  return '中';
}

async function runExtract(session) {
  const limitClause = CONFIG.limit > 0 ? `LIMIT ${CONFIG.limit}` : '';

  // 一次性按药品聚合其各类关系。OPTIONAL MATCH 保证无关系的药品也能导出。
  const cypher = `
    MATCH (d:\`${CONFIG.drugLabel}\`)
    OPTIONAL MATCH (d)-[:\`${CONFIG.rels.contraindicationDisease}\`]->(dis)
    OPTIONAL MATCH (d)-[:\`${CONFIG.rels.allergy}\`]->(al)
    OPTIONAL MATCH (d)-[:\`${CONFIG.rels.population}\`]->(pop)
    OPTIONAL MATCH (d)-[ix:\`${CONFIG.rels.interaction}\`]->(t:\`${CONFIG.drugLabel}\`)
    RETURN
      d.\`${CONFIG.nameProp}\`      AS name,
      d.\`${CONFIG.aliasProp}\`     AS aliases,
      d.\`${CONFIG.categoryProp}\`  AS category,
      collect(DISTINCT dis.\`${CONFIG.nameProp}\`) AS diseases,
      collect(DISTINCT al.\`${CONFIG.nameProp}\`)  AS allergies,
      collect(DISTINCT pop.\`${CONFIG.nameProp}\`) AS populations,
      collect(DISTINCT {
        target: t.\`${CONFIG.nameProp}\`,
        risk:   ix.\`${CONFIG.interactionProps.riskLevel}\`,
        mech:   ix.\`${CONFIG.interactionProps.mechanism}\`,
        advice: ix.\`${CONFIG.interactionProps.advice}\`
      }) AS interactions
    ${limitClause}
  `;

  const result = await session.run(cypher);
  const medicines = [];

  for (const rec of result.records) {
    const name = rec.get('name');
    if (!name) continue;

    const interactions = toArray(rec.get('interactions'))
      .filter(i => i && i.target)
      .map(i => ({
        target_drug: i.target,
        risk_level: normalizeRisk(i.risk),
        mechanism: i.mech || '存在相互作用，请遵医嘱',
        advice: i.advice || '如需合用请咨询医生或药师'
      }));

    medicines.push({
      name: name,
      aliases: toArray(rec.get('aliases')),
      category: rec.get('category') || '',
      contraindications: {
        diseases: toArray(rec.get('diseases')),
        allergies: toArray(rec.get('allergies')),
        populations: toArray(rec.get('populations'))
      },
      interactions: interactions
    });
  }

  const output = {
    _comment: 'CMeKG v5.2 全量图谱 ETL 生成（由 cmekgEtl.js 抽取）',
    _generatedAt: new Date().toISOString(),
    _count: medicines.length,
    medicines: medicines,
    import_instructions: '导入云数据库集合 cme_kg_medicines 前，请删除 _comment/_generatedAt/_count/import_instructions 字段，并为 name 建唯一索引、aliases 建普通索引'
  };

  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(output, null, 2), 'utf8');
  console.log(`已抽取 ${medicines.length} 种药品，输出到: ${CONFIG.outputFile}`);
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
