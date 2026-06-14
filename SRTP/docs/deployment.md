# SRTP医疗处方智能管理系统 - 部署运维手册

## 1. 前置准备

### 1.1 开发环境

- 微信开发者工具（最新稳定版）
- Node.js 16.x+
- 微信云开发账号（已开通云开发）
- 硅基流动API Key（https://siliconflow.cn）

### 1.2 申请配置清单

| 项目 | 申请地址 | 用途 | 必填 |
|------|---------|------|------|
| 微信小程序AppID | mp.weixin.qq.com | 小程序标识 | 是 |
| 微信订阅消息模板 | 微信公众平台->功能->订阅消息 | 用药提醒通知 | 是 |
| 硅基流动API Key | siliconflow.cn | AI处方解析 | 是 |
| 微信OCR服务 | 服务市场 | 处方识别 | 否（免费） |

---

## 2. 部署步骤

### 2.1 数据库初始化

#### 步骤1：创建集合

在微信开发者工具中：
1. 点击"云开发"按钮进入控制台
2. 切换到"数据库"标签
3. 点击"添加集合"，依次创建以下集合：

```
medicines
cme_kg_medicines
health_profiles
medication_records
reminder_logs
foregroundReminders
userSubscriptions
userRelations
sync_data
users
```

#### 步骤2：设置索引

在各集合的"索引管理"中添加：

**medicines集合**：
- `_openid` - 普通索引
- `times` - 普通索引

**cme_kg_medicines集合**：
- `name` - 唯一索引

**reminder_logs集合**：
- `_openid` + `sentTime` - 组合索引

#### 步骤3：导入CMeKG数据

```bash
# 方式1：使用控制台导入
1. 打开 cme_kg_medicines 集合
2. 点击"导入"
3. 选择 cmekg_seed_data.json 文件
4. 按字段名自动映射

# 方式2：使用脚本
node scripts/initDatabase.js
```

### 2.2 云函数部署

#### 步骤1：安装依赖

```bash
# 进入每个云函数目录，执行npm install
cd cloudfunctions/syncData && npm install
cd cloudfunctions/sendReminderMessage && npm install
cd cloudfunctions/checkAndSendReminders && npm install
cd cloudfunctions/checkMedicineContraindication && npm install
cd cloudfunctions/parseMedicineByAI && npm install
cd cloudfunctions/updateSubscription && npm install
cd cloudfunctions/getPhoneNumber && npm install
```

#### 步骤2：部署云函数

在微信开发者工具中：
1. 右键点击 `cloudfunctions/syncData` 文件夹
2. 选择"创建并部署：云端安装依赖"
3. 对所有云函数重复上述操作

部署顺序建议：
```
1. syncData（基础同步服务）
2. updateSubscription（订阅管理）
3. getPhoneNumber（手机号获取）
4. checkMedicineContraindication（禁忌分析）
5. parseMedicineByAI（OCR解析）
6. sendReminderMessage（消息发送）
7. checkAndSendReminders（定时触发，最后部署）
```

#### 步骤3：配置定时触发器

`checkAndSendReminders` 云函数的 `config.json` 已包含触发器配置：

```json
{
  "triggers": [{
    "name": "reminderCheck",
    "type": "timer",
    "config": "*/15 * * * * * *"
  }]
}
```

部署后会自动生效，无需额外配置。

### 2.3 前端配置

#### 步骤1：配置API Key

修改 `cloudfunctions/parseMedicineByAI/index.js`：

```javascript
const API_KEY = 'YOUR_SILICONFLOW_API_KEY';
```

#### 步骤2：配置订阅消息模板ID

修改 `cloudfunctions/sendReminderMessage/index.js`：

```javascript
const TEMPLATES = {
  LONG_TERM: 'YOUR_LONG_TERM_TEMPLATE_ID',  // 如有权限
  ONE_TIME: 'YOUR_ONE_TIME_TEMPLATE_ID'      // 一次性订阅模板
};
```

修改 `utils/subscriptionHelper.js`：

```javascript
const SUBSCRIPTION_CONFIG = {
  TEMPLATES: {
    REMINDER: 'YOUR_ONE_TIME_TEMPLATE_ID'
  }
};
```

#### 步骤3：上传并预览

1. 微信开发者工具中点击"上传"
2. 填写版本号和描述
3. 在小程序后台提交审核（或选择体验版）

---

## 3. 配置检查清单

### 3.1 数据库检查

```sql
-- 在微信云开发控制台执行查询验证

-- 检查CMeKG数据
db.collection('cme_kg_medicines').count()
-- 预期：返回约50条记录

-- 检查索引
db.collection('medicines').getIndexes()
-- 预期：包含 _openid, times 等索引
```

### 3.2 云函数检查

```javascript
// 在微信开发者工具控制台测试

// 测试syncData
wx.cloud.callFunction({
  name: 'syncData',
  data: {
    action: 'write',
    key: 'test_key',
    data: { test: 'hello' }
  }
}).then(res => console.log('syncData OK', res))
  .catch(err => console.error('syncData FAIL', err));

// 测试parseMedicineByAI
wx.cloud.callFunction({
  name: 'parseMedicineByAI',
  data: {
    ocrText: '阿司匹林 100mg 每日一次'
  }
}).then(res => console.log('parseMedicineByAI OK', res.result))
  .catch(err => console.error('parseMedicineByAI FAIL', err));

// 测试checkMedicineContraindication
wx.cloud.callFunction({
  name: 'checkMedicineContraindication',
  data: {
    newMedicineName: '阿司匹林',
    userDiseases: ['胃溃疡']
  }
}).then(res => console.log('checkMedicineContraindication OK', res.result))
  .catch(err => console.error('checkMedicineContraindication FAIL', err));
```

---

## 4. 运维监控

### 4.1 日常监控指标

| 指标 | 监控方式 | 正常范围 | 异常处理 |
|------|---------|---------|---------|
| 云函数调用次数 | 云开发控制台 | - | >10000次/天需关注额度 |
| 数据库读写次数 | 云开发控制台 | - | >50000次/天需优化 |
| 提醒发送成功率 | reminder_logs统计 | ≥85% | 检查订阅授权状态 |
| OCR解析成功率 | parseMedicineByAI日志 | ≥80% | 检查API Key和余额 |
| 云端同步成功率 | sync_data状态统计 | ≥95% | 检查网络和重试队列 |

### 4.2 日志查看

```bash
# 在微信开发者工具中
1. 打开"云开发"控制台
2. 进入"日志"标签
3. 筛选云函数名称查看详细日志

# 关键日志关键词搜索
- "[SyncManager]" - 数据同步相关
- "[sendReminderMessage]" - 提醒发送相关
- "[parseMedicineByAI]" - OCR解析相关
- "ERROR" - 错误日志
```

### 4.3 常见问题处理

#### 问题1：提醒消息发送失败

**症状**：用户反馈收不到提醒

**排查步骤**：
```bash
1. 检查 reminder_logs 集合
   - 是否有记录？
   - sent字段是否为false？
   - error字段是否有错误信息？

2. 检查用户订阅状态
   db.collection('userSubscriptions').where({ _openid: 'xxx' }).get()
   - oneTimeCount 是否为0？
   - 需要重新索要授权

3. 检查前台兜底是否生效
   db.collection('foregroundReminders').count()
   - 是否有pending状态的记录？
```

**解决方案**：
- 如果一次性订阅用完：引导用户重新打卡触发索要
- 如果全部失败：检查前台震动提醒是否正常

#### 问题2：OCR解析准确率下降

**症状**：解析结果经常出现"斤"等异常单位

**排查步骤**：
```bash
1. 检查硅基流动API调用日志
   - 是否有大量超时？
   - response_format是否生效？

2. 抽查parseMedicineByAI日志
   - fallback=true的比例？
   - validationErrors的具体内容？
```

**解决方案**：
- 检查API Key余额（硅基流动控制台）
- 确认temperature=0.1配置正确
- 如果问题持续，考虑更换模型（如使用更强的模型）

#### 问题3：数据同步失败

**症状**：A端添加的药品B端看不到

**排查步骤**：
```bash
1. 检查 sync_data 集合
   db.collection('sync_data').where({ _syncStatus: 'pending' }).count()
   - 是否有大量pending记录？

2. 检查medicines集合
   db.collection('medicines').where({ _openid: 'xxx' }).get()
   - 数据是否存在？
```

**解决方案**：
- 手动触发同步：`SyncManager.forceSync()`
- 检查网络状态
- 如果持续失败，检查云函数报错日志

---

## 5. 备份与恢复

### 5.1 数据库备份

**自动备份**：
- 微信云开发每天自动备份数据库
- 保留最近7天的备份

**手动导出**：
```bash
# 在微信云开发控制台
1. 进入数据库集合
2. 点击"导出"
3. 选择JSON格式
4. 下载备份文件
```

### 5.2 关键数据导出

```javascript
// 导出用户药品数据
const db = wx.cloud.database();
const medicines = await db.collection('medicines').get();
console.log(JSON.stringify(medicines.data, null, 2));

// 导出CMeKG数据
const kgData = await db.collection('cme_kg_medicines').get();
console.log(JSON.stringify(kgData.data, null, 2));
```

---

## 6. 扩展与升级

### 6.1 增加新药品到CMeKG

```javascript
// 在 cmekg_seed_data.json 中添加新药品
{
  "name": "新药品名称",
  "aliases": ["别名1", "别名2"],
  "category": "药品分类",
  "contraindications": {
    "diseases": ["禁忌疾病1"],
    "allergies": ["禁忌过敏1"]
  },
  "interactions": [
    { 
      "target_drug": "相互作用药品", 
      "risk_level": "高", 
      "mechanism": "作用机制",
      "advice": "处理建议"
    }
  ]
}

// 然后重新导入到 cme_kg_medicines 集合
```

### 6.2 升级LLM模型

修改 `cloudfunctions/parseMedicineByAI/index.js`：

```javascript
// 原配置
const MODEL_NAME = 'Qwen/Qwen2.5-7B-Instruct';

// 升级到更强模型（需确认硅基流动支持）
const MODEL_NAME = 'Qwen/Qwen2.5-72B-Instruct';
```

### 6.3 增加短信提醒（可选）

修改 `cloudfunctions/sendReminderMessage/index.js`，在fallback层增加短信：

```javascript
// 第三层扩展：增加短信兜底
async function fallbackToSMS(openid, medicine, time) {
  // 调用短信服务API
  // 如：阿里云短信、腾讯云短信
}
```

---

## 7. 安全加固

### 7.1 数据库安全规则

```javascript
// 在微信云开发控制台->数据库->安全规则
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
```

### 7.2 API Key保护

- 硅基流动API Key仅存储在云函数环境变量
- 前端不暴露任何API Key
- 定期轮换API Key（建议3个月一次）

### 7.3 敏感数据处理

- 处方图片仅用于OCR，不存储原图
- 仅存储OCR识别的文本和解析结果
- 健康档案数据加密存储（云开发自动加密）

---

## 8. 联系与支持

| 项目 | 资源 |
|------|------|
| 微信开发文档 | https://developers.weixin.qq.com/miniprogram/dev/framework/ |
| 云开发文档 | https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html |
| 硅基流动 | https://siliconflow.cn |
| 技术支持 | [团队内部联系方式] |

---

文档版本：v1.0
更新日期：2026-06-08
