# CMeKG v5.2 全量图谱集成指南（路线 A：离线 ETL）

本指南说明如何把 `resources/cmekg-v5.2-no-constraints.dump`
（Neo4j 图数据库 dump）转换为云数据库集合 `cme_kg_medicines` 的文档数据，
从而扩充禁忌分析覆盖率（目标 ≥90%），而**无需改动** `checkMedicineContraindication` 云函数主体逻辑。

```
dump (Neo4j) ──restore──> 本地 Neo4j ──cmekgEtl.js(Cypher)──> cmekg_seed_data.generated.json ──导入──> 云数据库 cme_kg_medicines
```

## 0. 关于 dump 文件

- 文件魔数为 `DZV1` + zstd，属 **Neo4j 5.x `neo4j-admin database dump`** 格式（`no-constraints` 表示未含约束）。
- 因此需要 **Neo4j 5.x + JDK 17+** 才能恢复（本机当前为 JDK 11，需另装 JDK 17）。
- 该 12.8MB 二进制不纳入 git（见根目录 `.gitignore` 的 `*.dump`）；仅提交 ETL 生成的 JSON。

## 1. 恢复 dump 到本地 Neo4j

以 Neo4j 5.x Community 为例（在已停止的数据库上 load）：

```bash
# 将 dump 放到某目录，例如 ./dumps/
neo4j stop
neo4j-admin database load cmekg --from-path=./dumps --overwrite-destination=true
# 在 neo4j.conf 中设置 initial.dbms.default_database=cmekg 或后续以 :use cmekg
neo4j start
```

> dump 文件名（去扩展名）即数据库名，这里假设加载为数据库 `cmekg`。

## 2. 探查图谱 schema

CMeKG v5.2（no-constraints dump）实测标签/关系为**英文**：

| 项目 | v5.2 实测值 |
|------|------------|
| 药品节点 | `Drug`（属性仅 `name`） |
| 禁忌关系 | `contraindications` → `Disease` / `Complication` / `Symptom` |
| 分类 | `subject` → `Subject` |
| 注意事项 | `precautions` → `Precautions`（可解析过敏/人群） |
| 药物相互作用 | **图谱中无 Drug-Drug 边** |

`cmekgEtl.js` 已按上述 schema 校准；抽取时仅导出含禁忌/过敏/人群信息的药品（约 5000+ 条），
并可将原 `cmekg_seed_data.json` 中的 `interactions` 合并进同名药品。

```bash
cd SRTP/scripts
npm install                      # 安装 neo4j-driver
set NEO4J_PASSWORD=你的密码        # Windows PowerShell: $env:NEO4J_PASSWORD="..."
set CMEKG_DATABASE=cmekg
node cmekgEtl.js --probe
```

输出会列出全部标签、关系类型、属性键，以及每个标签的样例节点。
据此核对并修改 `cmekgEtl.js` 顶部 `CONFIG`（药品标签、各关系类型、相互作用属性名等），
也可直接用环境变量覆盖（如 `CMEKG_DRUG_LABEL`、`CMEKG_REL_INTERACTION` 等）。

## 3. 抽取并生成文档 JSON

```bash
node cmekgEtl.js
# 生成 SRTP/scripts/cmekg_seed_data.generated.json
```

生成结构与现有 `SRTP/cmekg_seed_data.json` 一致：

```json
{
  "name": "...",
  "aliases": ["..."],
  "category": "...",
  "contraindications": { "diseases": ["..."], "allergies": ["..."], "populations": ["..."] },
  "interactions": [ { "target_drug": "...", "risk_level": "高|中|低", "mechanism": "...", "advice": "..." } ]
}
```

> `checkMedicineContraindication` 当前使用 `name`/`aliases`/`contraindications.diseases`/
> `contraindications.allergies`/`interactions[].{target_drug,risk_level,mechanism,advice}`，
> ETL 输出已对齐这些字段，云函数无需改动。

## 4. 导入云数据库

微信云开发控制台导入时，**每条记录必须是顶层独立文档**（顶层有 `name` 字段）。
以下格式会导致只导入 **1 条**错误记录，切勿使用：

- ❌ `cmekg_import_ready.json` — `{ "medicines": [...] }` 会被当成单条文档
- ❌ 裸 JSON 数组 `[...]`

### 4.1 生成可导入文件

在 `SRTP/scripts` 目录执行：

```bash
# 全量（自动按 name 去重，约 4593 条，原 ETL 有重复药名）
node prepareCmekgImport.js full

# 或分片导入（每文件 500 条）
node prepareCmekgImport.js full --chunks
```

生成文件：

| 文件 | 说明 |
|------|------|
| `cmekg_full_import.jsonl` | 全量单文件，已去重，每行一条 JSON |
| `cmekg_chunk_001.jsonl` … | 分片导入备用 |

> 扩展名 `.jsonl` 表示 JSON Lines（每行一条）。微信控制台导入时类型仍选 **JSON**；若文件选择器只显示 `.json`，复制文件改扩展名即可，内容不变。

### 4.2 控制台导入步骤

1. 云开发控制台 → **数据库** → `cme_kg_medicines`
2. **清空集合**（删除此前导入失败残留的记录，如已导入的 9 条）
3. 点击 **导入** → 文件类型选 **JSON** → 冲突模式 **Insert**
4. 选择 `cmekg_full_import.jsonl`（或分片文件；选择器只认 `.json` 时可改扩展名）

### 4.3 导入后验证

- 记录总数应为 **约 4593**（去重后，不是 5183 也不是 1）
- 随机点开一条，顶层应有 `name`、`contraindications` 等字段
- 搜索 `name` 含「阿莫西林」应能查到记录

为 `name` 建唯一索引、`aliases` 建普通索引（参考 `scripts/initDatabase.js`）。

### 4.4 演示/答辩快速导入（可选）

仅需验证禁忌功能时，可只导入 38 条种子数据：

```bash
node prepareCmekgImport.js seed
# → cmekg_seed_import.json
```

## 5. 复核与性能

- 数据量增大后，复核 `checkMedicineContraindication` 中对 `name`/`aliases` 的 `RegExp` 与
  `includes` 双向匹配是否产生误报；建议优先用别名归一化 + 精确匹配，必要时分页/限流。
- 确认 `name` 唯一索引生效，避免重复药品。
