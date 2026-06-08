# SRTP医疗处方智能管理系统 - 测试用例文档

## 测试目标

| 指标 | 目标值 | 测试方法 |
|------|--------|---------|
| OCR准确率 | ≥80% | 对比AI解析结果与人工标注 |
| 提醒准时率 | ≥85% | 统计reminder_logs成功发送比例 |
| 禁忌分析准确率 | ≥90% | 专家审核CMeKG匹配结果 |
| 云端同步成功率 | ≥95% | 统计SyncManager同步结果 |

---

## 1. OCR识别测试用例

### 1.1 正常处方测试

| 用例ID | 输入 | 预期输出 | 通过标准 |
|--------|------|---------|---------|
| OCR-001 | 阿司匹林 100mg 每日一次 饭后服用 | 名称:阿司匹林,剂量:100mg,频次:1 | 所有字段正确 |
| OCR-002 | 头孢克肟 0.1g tid 饭后 疗程7天 | 名称:头孢克肟,剂量:0.1g,频次:3,备注:疗程7天 | 所有字段正确 |
| OCR-003 | 二甲双胍片 0.5g 每日三次 餐前服 | 名称:二甲双胍片,剂量:0.5g,频次:3,说明:饭前服用 | 所有字段正确 |
| OCR-004 | 降压药（氨氯地平）5mg qd 晨起 | 名称:降压药,剂量:5mg,频次:1,说明:晨起服用 | 所有字段正确 |

### 1.2 异常处理测试

| 用例ID | 输入 | 预期行为 | 通过标准 |
|--------|------|---------|---------|
| OCR-ERR-001 | 含有"斤"的处方（OCR错误） | 触发Schema校验失败，返回fallback=true | 拒绝非法单位，提示手动输入 |
| OCR-ERR-002 | 乱码/无法识别文字 | 返回解析失败，提供手动输入入口 | 优雅降级 |
| OCR-ERR-003 | 超长文本（>5000字符） | 返回TEXT_TOO_LONG错误 | 正确处理边界 |
| OCR-ERR-004 | 网络超时 | 返回TIMEOUT_ERROR | 超时处理正确 |

### 1.3 准确率测试数据集

**测试样本**：50张真实处方图片

**评估维度**：
1. 药品名称识别准确率
2. 剂量数字识别准确率
3. 剂量单位识别准确率
4. 服用频率识别准确率
5. 综合准确率（全部正确视为1次成功）

**计算公式**：
```
准确率 = 正确识别字段数 / 总字段数 × 100%
```

**执行步骤**：
```bash
1. 准备50张处方图片（覆盖常见药品）
2. 人工标注每张图片的正确字段值
3. 调用parseMedicineByAI接口
4. 对比AI输出与人工标注
5. 计算各维度准确率
```

---

## 2. 提醒功能测试用例

### 2.1 定时触发测试

| 用例ID | 场景 | 预期行为 | 通过标准 |
|--------|------|---------|---------|
| REM-001 | 用户设置8:00服药 | 8:00收到提醒 | 时间窗口±5分钟内 |
| REM-002 | 多药品同时间点 | 收到多条提醒 | 每条药品独立提醒 |
| REM-003 | 跨天提醒 | 次日同一时间收到 | 跨天正确处理 |
| REM-004 | 修改用药时间 | 按新时间提醒 | 修改后生效 |

### 2.2 订阅降级测试

| 用例ID | 用户状态 | 预期行为 | 通过标准 |
|--------|---------|---------|---------|
| SUB-001 | 有长期订阅权限 | 发送长期订阅消息 | 收到微信服务通知 |
| SUB-002 | 无长期，有一次性授权 | 发送一次性订阅消息 | 收到微信服务通知 |
| SUB-003 | 无任何授权 | 写入foregroundReminders | 前端震动+弹窗提醒 |
| SUB-004 | 授权后打卡 | 索要下次用药授权 | 弹出订阅请求弹窗 |

### 2.3 准时率统计方法

**数据源**：`reminder_logs`集合

**计算公式**：
```
准时率 = 成功发送数 / 应发送总数 × 100%

应发送总数 = 用户设置的用药时间点总数
成功发送数 = type为long_term/one_time且sent=true的记录数
```

**测试周期**：连续7天

**执行步骤**：
```javascript
// 1. 查询所有设置提醒的药品
const medicines = await db.collection('medicines').get();

// 2. 计算应发送总数
let expectedTotal = 0;
medicines.forEach(med => {
  expectedTotal += (med.times?.length || 0);
});

// 3. 查询实际发送成功数
const logs = await db.collection('reminder_logs')
  .where({
    type: _.in(['long_term', 'one_time']),
    sent: true,
    sentTime: _.gte(new Date('2026-06-01'))
  })
  .get();

// 4. 计算准时率
const successRate = logs.length / expectedTotal * 100;
```

---

## 3. 禁忌分析测试用例

### 3.1 疾病禁忌测试

| 用例ID | 用户疾病史 | 待添加药品 | 预期预警 | 通过标准 |
|--------|-----------|-----------|---------|---------|
| CON-001 | 糖尿病 | 含糖药物（如某些中成药） | 高危警告 | 触发禁忌提醒 |
| CON-002 | 胃溃疡 | 阿司匹林 | 高危警告 | 触发禁忌提醒 |
| CON-003 | 无特殊 | 维生素C | 无警告 | 通过安全检测 |
| CON-004 | 高血压 | 含麻黄碱药物（如连花清瘟） | 中风险提醒 | 触发相互作用提醒 |

### 3.2 过敏禁忌测试

| 用例ID | 用户过敏史 | 待添加药品 | 预期预警 | 通过标准 |
|--------|-----------|-----------|---------|---------|
| ALG-001 | 青霉素过敏 | 阿莫西林 | 高危警告 | 触发过敏风险预警 |
| ALG-002 | 头孢过敏 | 头孢克肟 | 高危警告 | 触发过敏风险预警 |
| ALG-003 | 无过敏史 | 阿司匹林 | 无警告 | 通过安全检测 |

### 3.3 药物相互作用测试

| 用例ID | 当前用药 | 待添加药品 | 预期预警 | 通过标准 |
|--------|---------|-----------|---------|---------|
| INT-001 | 华法林 | 阿司匹林 | 高危警告（出血风险） | 触发相互作用提醒 |
| INT-002 | 二甲双胍 | 造影剂 | 高危警告 | 触发禁忌提醒 |
| INT-003 | 布洛芬 | 对乙酰氨基酚 | 中风险提醒 | 同类药物叠加提醒 |

### 3.4 准确率评估

**测试样本**：CMeKG中全部50种药品 × 20种常见疾病/过敏组合 = 1000次测试

**评估标准**：
- 召回率：真实禁忌中有多少被系统识别
- 精确率：系统预警中有多少是真正的禁忌

**计算公式**：
```
准确率 = (召回率 + 精确率) / 2 × 100%
召回率 = TP / (TP + FN)
精确率 = TP / (TP + FP)

TP: 真正例（正确预警）
FP: 假正例（误报）
FN: 假负例（漏报）
```

---

## 4. 数据同步测试用例

### 4.1 离线优先测试

| 用例ID | 场景 | 操作 | 预期行为 | 通过标准 |
|--------|------|------|---------|---------|
| SYNC-001 | 网络正常 | 添加药品 | 本地写入+云端同步 | 两端数据一致 |
| SYNC-002 | 无网络 | 添加药品 | 仅本地写入，加入同步队列 | 联网后自动同步 |
| SYNC-003 | 弱网络 | 多次操作 | 本地批量更新，后台重试 | 最终一致 |
| SYNC-004 | 多端登录 | A端添加，B端查看 | B端最终能看到A端数据 | 数据同步正确 |

### 4.2 冲突解决测试

| 用例ID | 场景 | 本地时间戳 | 云端时间戳 | 预期结果 | 通过标准 |
|--------|------|-----------|-----------|---------|---------|
| CONFLICT-001 | 离线修改 | 100 | 50 | 以本地为准，同步到云端 | 本地数据保留 |
| CONFLICT-002 | 云端更新 | 50 | 100 | 以云端为准，覆盖本地 | 拉取云端数据 |
| CONFLICT-003 | 同时修改 | 100 | 100 | 以时间戳为准（Last-Write-Wins） | 有明确结果 |

### 4.3 同步成功率统计

**计算公式**：
```
成功率 = 成功同步数 / 总尝试数 × 100%
```

**监控指标**：
- `sync_data`集合中`_syncStatus=pending`的记录数
- 重试次数超过3次的记录（异常）

---

## 5. 性能测试用例

### 5.1 响应时间测试

| 用例ID | 操作 | 目标响应时间 | 最大可接受时间 |
|--------|------|-------------|---------------|
| PERF-001 | 打开用药页面 | <500ms | 1s |
| PERF-002 | 加载药品列表 | <300ms | 800ms |
| PERF-003 | OCR识别+AI解析 | <5s | 10s |
| PERF-004 | 禁忌分析查询 | <1s | 3s |
| PERF-005 | 云端数据同步 | <2s | 5s |

### 5.2 并发测试

| 用例ID | 场景 | 并发数 | 预期行为 |
|--------|------|-------|---------|
| CONC-001 | 定时触发器执行 | 100用户 | 全部收到提醒 |
| CONC-002 | 多用户同时打卡 | 50用户 | 数据不丢失 |
| CONC-003 | 批量OCR识别 | 10请求 | 队列处理，不超时 |

---

## 6. 测试执行脚本

### 6.1 OCR准确率测试脚本

```javascript
// test/ocr-accuracy-test.js
const testCases = require('./ocr-test-cases.json');

async function runOCRAccuracyTest() {
  let totalFields = 0;
  let correctFields = 0;
  
  for (const testCase of testCases) {
    const result = await wx.cloud.callFunction({
      name: 'parseMedicineByAI',
      data: { ocrText: testCase.input }
    });
    
    if (result.result.success) {
      const medicine = result.result.medicines[0];
      totalFields += 5; // name, dosageNumber, dosageUnit, frequency, times
      
      if (medicine.name === testCase.expected.name) correctFields++;
      if (medicine.dosageNumber === testCase.expected.dosageNumber) correctFields++;
      if (medicine.dosageUnit === testCase.expected.dosageUnit) correctFields++;
      if (medicine.frequency === testCase.expected.frequency) correctFields++;
      if (JSON.stringify(medicine.times) === JSON.stringify(testCase.expected.times)) correctFields++;
    }
  }
  
  const accuracy = (correctFields / totalFields * 100).toFixed(2);
  console.log(`OCR准确率: ${accuracy}%`);
  return accuracy >= 80;
}
```

### 6.2 提醒准时率统计脚本

```javascript
// test/reminder-rate-test.js
async function calculateReminderRate(startDate, endDate) {
  const db = wx.cloud.database();
  
  // 应发送总数（按设置的时间点计算）
  const { data: medicines } = await db.collection('medicines').get();
  let expectedTotal = 0;
  medicines.forEach(med => {
    expectedTotal += (med.times?.length || 0) * 7; // 假设测试7天
  });
  
  // 实际发送成功数
  const { data: logs } = await db.collection('reminder_logs')
    .where({
      sentTime: _.gte(new Date(startDate)).and(_.lte(new Date(endDate))),
      sent: true,
      type: _.in(['long_term', 'one_time'])
    })
    .get();
  
  const rate = (logs.length / expectedTotal * 100).toFixed(2);
  console.log(`提醒准时率: ${rate}%`);
  return rate >= 85;
}
```

---

## 7. 测试报告模板

### 7.1 OCR准确率报告

```markdown
# OCR准确率测试报告

测试日期：2026-06-08
测试样本：50张处方图片

## 总体结果

| 指标 | 目标 | 实际 | 是否达标 |
|------|------|------|---------|
| 综合准确率 | ≥80% | XX% | 是/否 |
| 药品名称识别率 | - | XX% | - |
| 剂量识别率 | - | XX% | - |
| 频次识别率 | - | XX% | - |

## 失败案例分析

| 用例ID | 输入 | 预期 | 实际 | 原因分析 |
|--------|------|------|------|---------|
| ... | ... | ... | ... | ... |

## 改进建议

...
```

### 7.2 提醒准时率报告

```markdown
# 提醒准时率测试报告

测试周期：2026-06-01 至 2026-06-07
测试用户：XX人

## 总体结果

| 指标 | 目标 | 实际 | 是否达标 |
|------|------|------|---------|
| 提醒准时率 | ≥85% | XX% | 是/否 |
| 长期订阅成功率 | - | XX% | - |
| 一次性订阅成功率 | - | XX% | - |
| 前台兜底比例 | - | XX% | - |

## 失败原因分布

| 失败原因 | 次数 | 占比 |
|---------|------|------|
| 用户拒绝订阅 | XX | XX% |
| 网络超时 | XX | XX% |
| 其他 | XX | XX% |
```

---

文档版本：v1.0
更新日期：2026-06-08
