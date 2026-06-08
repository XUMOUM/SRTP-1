# SRTP医疗处方智能管理系统 - API接口手册

## 1. 云函数接口

### 1.1 syncData - 数据同步通用接口

**功能**：SyncManager后端服务，支持离线优先的数据同步

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | String | 是 | 操作类型：get/write/delete/batchGet/syncFromCloud |
| `key` | String | 条件 | 数据键名（action=get/write/delete时必填） |
| `data` | Object | 条件 | 数据内容（action=write时必填） |
| `keys` | Array | 条件 | 键名数组（action=batchGet时必填） |
| `localTimestamp` | Number | 否 | 本地时间戳，用于冲突判断 |

#### 响应格式

```javascript
{
  success: true,           // Boolean：是否成功
  data: Object,          // 返回数据（查询时）
  cloudTimestamp: Number, // 云端时间戳
  error: String          // 错误信息（失败时）
}
```

#### 调用示例

```javascript
// 写入数据
wx.cloud.callFunction({
  name: 'syncData',
  data: {
    action: 'write',
    key: 'medicine_123',
    data: { name: '阿司匹林', dosageNumber: '1', ... }
  }
});

// 获取数据
wx.cloud.callFunction({
  name: 'syncData',
  data: {
    action: 'get',
    key: 'health_profile'
  }
});
```

---

### 1.2 sendReminderMessage - 发送用药提醒

**功能**：三层降级策略发送提醒消息

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `openid` | String | 是 | 用户OpenID |
| `medicine` | Object | 是 | 药品信息 `{name, dosageNumber, dosageUnit}` |
| `time` | String | 是 | 提醒时间 "HH:MM" |
| `strategy` | String | 否 | 策略：auto(默认)/long_term_only/one_time_only |

#### 响应格式

```javascript
{
  success: true,
  strategy: 'long_term',     // 实际使用的策略
  results: {
    attempts: [...],         // 各层尝试结果
    final: Object            // 最终结果
  }
}
```

#### 调用示例

```javascript
wx.cloud.callFunction({
  name: 'sendReminderMessage',
  data: {
    openid: 'o123456789',
    medicine: { name: '阿司匹林', dosageNumber: '1', dosageUnit: '片' },
    time: '08:00',
    strategy: 'auto'
  }
});
```

---

### 1.3 checkAndSendReminders - 定时检查提醒

**功能**：定时触发器调用，批量检查并发送待提醒

**触发方式**：云开发定时触发器（每15分钟）

**配置位置**：`config.json`

```json
{
  "triggers": [{
    "name": "reminderCheck",
    "type": "timer",
    "config": "*/15 * * * * * *"
  }]
}
```

#### 响应格式

```javascript
{
  success: true,
  checkTime: '14:30',
  totalChecked: 100,
  totalMatched: 5,
  results: {
    total: 5,
    success: 4,
    failed: 0,
    foregroundFallback: 1
  }
}
```

---

### 1.4 checkMedicineContraindication - 禁忌分析

**功能**：基于CMeKG知识图谱分析用药禁忌

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `newMedicineName` | String | 是 | 待添加药品名称 |
| `currentMedicines` | Array | 否 | 当前已添加药品列表 |
| `userDiseases` | Array | 否 | 用户疾病史 |
| `userAllergies` | Array | 否 | 用户过敏史 |

#### 响应格式

```javascript
{
  code: 1,                    // 0: 未找到药品, 1: 正常, -1: 异常
  hasWarning: true,
  msg: '发现潜在用药风险！',
  warnings: [
    {
      type: 'disease',        // disease/allergy/interaction
      level: '高危',
      title: '个人病史禁忌预警',
      detail: '根据您的健康档案，该药物禁用于【糖尿病】患者...'
    }
  ]
}
```

#### 调用示例

```javascript
wx.cloud.callFunction({
  name: 'checkMedicineContraindication',
  data: {
    newMedicineName: '二甲双胍',
    currentMedicines: ['阿司匹林'],
    userDiseases: ['糖尿病'],
    userAllergies: ['青霉素']
  }
});
```

---

### 1.5 parseMedicineByAI - AI解析处方

**功能**：调用硅基流动LLM API解析OCR识别的处方文本

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ocrText` | String | 是 | OCR识别的文本内容 |
| `imageUrl` | String | 否 | 处方图片URL（预留） |

#### 响应格式

**成功响应**：
```javascript
{
  success: true,
  medicines: [
    {
      name: '阿司匹林肠溶片',
      dosageNumber: '100',
      dosageUnit: 'mg',
      instruction: '饭后服用',
      times: ['08:00'],
      frequency: '1',
      notes: ''
    }
  ],
  rawText: '原始OCR文本',
  count: 1
}
```

**校验警告响应**（有异常但可继续）：
```javascript
{
  success: true,
  medicines: [...],
  hasValidationWarning: true,
  validationWarnings: ['药品[1].dosageUnit: "斤" 是非法单位'],
  message: '处方已解析，但部分内容可能需要核对...'
}
```

**失败Fallback响应**：
```javascript
{
  success: false,
  error: '处方解析存在错误',
  errorType: 'VALIDATION_ERROR',
  fallback: true,              // 需要手动输入
  validationErrors: [...],
  rawText: '原始OCR文本'
}
```

#### 调用示例

```javascript
wx.cloud.callFunction({
  name: 'parseMedicineByAI',
  data: {
    ocrText: '阿司匹林 100mg 每日一次 饭后服用'
  }
});
```

---

### 1.6 updateSubscription - 更新订阅状态

**功能**：管理用户订阅授权状态

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | String | 是 | 操作：updateStatus/addOneTimeCount/getStatus |
| `status` | String | 条件 | 状态（action=updateStatus时） |
| `addCount` | Number | 条件 | 增加的一次性订阅次数 |

#### 响应格式

```javascript
// getStatus 返回
{
  success: true,
  data: {
    longTermValid: false,
    oneTimeCount: 3,
    lastStatus: 'accepted'
  }
}
```

---

## 2. 前端工具类接口

### 2.1 SyncManager (utils/syncManager.js)

#### write(key, data, options)

写入数据（本地优先，后台同步云端）

```javascript
const syncManager = require('../../utils/syncManager.js');

syncManager.write('medicine_123', {
  name: '阿司匹林',
  dosageNumber: '1'
}).then((res) => {
  console.log('写入成功', res);
});
```

#### read(key, options)

读取数据（本地优先，后台校验云端）

```javascript
syncManager.read('health_profile').then((data) => {
  console.log('健康档案', data);
});
```

#### forceSync()

强制同步所有待同步数据到云端

```javascript
syncManager.forceSync().then((res) => {
  if (res.success) {
    console.log('同步完成');
  }
});
```

---

### 2.2 subscriptionHelper (utils/subscriptionHelper.js)

#### requestSubscription(options)

请求用户订阅授权

```javascript
const subscriptionHelper = require('../../utils/subscriptionHelper.js');

subscriptionHelper.requestSubscription({
  scenario: 'after_checkin',  // 场景标识
  onSuccess: (res) => {
    console.log('订阅成功', res);
  },
  onFail: (err) => {
    console.log('订阅失败', err);
  }
});
```

#### requestSubscriptionAfterCheckin(medicineList, justCheckedMedicine)

打卡后智能索要下次授权

```javascript
const medicineList = wx.getStorageSync('medicineList');
subscriptionHelper.requestSubscriptionAfterCheckin(
  medicineList, 
  '阿司匹林'
);
```

#### getUserSubscriptionStatus()

获取用户订阅状态

```javascript
const status = subscriptionHelper.getUserSubscriptionStatus();
console.log(status);
// {
//   local: { status: 'accepted', updateTime: 1234567890 },
//   lastRequestTime: 1234567890,
//   requestCount: 5,
//   canRequest: true
// }
```

---

## 3. 微信小程序原生API使用

### 3.1 订阅消息API

#### wx.requestSubscribeMessage

```javascript
wx.requestSubscribeMessage({
  tmplIds: ['YOUR_TEMPLATE_ID'],
  success: (res) => {
    // res[templateId] = 'accept' | 'reject' | 'ban'
    if (res[templateId] === 'accept') {
      // 用户接受，同步到云端
      wx.cloud.callFunction({
        name: 'updateSubscription',
        data: {
          action: 'addOneTimeCount',
          addCount: 1
        }
      });
    }
  }
});
```

### 3.2 OCR识别API

```javascript
wx.serviceMarket.invokeService({
  service: 'wx79ac3de8be320b71',
  api: 'OcrAllInOne',
  data: {
    img_data: base64Image,
    data_type: 2,
    ocr_type: 8  // 印刷体识别
  },
  success: (res) => {
    const result = JSON.parse(res.data);
    const text = result.text_detections
      .map(item => item.detected_text)
      .join('\n');
  }
});
```

---

## 4. 数据库集合Schema

### 4.1 medicines - 用户药品清单

```javascript
{
  _openid: String,           // 用户OpenID
  _key: String,              // SyncManager键名（medicine_id）
  _cloudTimestamp: Number,   // 云端时间戳
  
  id: Number,                // 药品ID
  name: String,              // 药品名称
  dosageNumber: String,      // 剂量数字
  dosageUnit: String,        // 剂量单位
  instruction: String,         // 服用说明
  times: Array<String>,      // 服药时间 ["08:00", "20:00"]
  frequency: String,         // 每日次数
  frequencyDisplay: String,  // 显示文本
  notes: String,             // 备注
  createTime: Date,
  updateTime: Date
}
```

### 4.2 medication_records - 服药打卡记录

```javascript
{
  _openid: String,
  _key: String,
  _cloudTimestamp: Number,
  
  slotId: String,            // medicineId_time
  date: String,              // YYYY-MM-DD
  medicineId: Number,
  medicineName: String,
  scheduledTime: String,     // HH:MM
  markedTime: String,        // 实际打卡时间
  completed: Boolean,
  checkinTime: Date
}
```

### 4.3 reminder_logs - 提醒发送日志

```javascript
{
  _openid: String,
  medicineName: String,
  scheduledTime: String,
  sentTime: Date,
  type: String,              // long_term / one_time / foreground
  sent: Boolean,             // 是否成功发送
  error: String              // 失败原因（如有）
}
```

---

## 5. 错误码速查

| 错误码 | 来源 | 含义 | 处理建议 |
|--------|------|------|---------|
| `PARAM_ERROR` | parseMedicineByAI | 缺少必要参数 | 检查传入参数 |
| `VALIDATION_ERROR` | parseMedicineByAI | Schema校验失败 | 引导用户手动输入 |
| `AUTH_ERROR` | sendReminderMessage | API Key无效 | 检查硅基流动配置 |
| `RATE_LIMIT_ERROR` | parseMedicineByAI | 请求频率过高 | 延迟后重试 |
| `NO_ONE_TIME_AUTH` | sendReminderMessage | 无一次性订阅授权 | 弹出授权请求 |
| `NETWORK_ERROR` | SyncManager | 网络不可用 | 本地优先，稍后自动重试 |
| `MISSING_OPENID` | 所有云函数 | 无法获取用户身份 | 检查登录状态 |

---

文档版本：v1.0
更新日期：2026-06-08
