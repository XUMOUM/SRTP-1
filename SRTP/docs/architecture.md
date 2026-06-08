# SRTP医疗处方智能管理系统 - 架构设计文档

## 1. 系统架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      微信小程序前端层                        │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ 用药提醒 │  │ 药品管理 │  │ 家人监督 │  │ 个人中心 │       │
│  │ index   │  │ manage  │  │ supervise│  │ profile │       │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │
│       │            │            │            │              │
│  ┌────┴────────────┴────────────┴────────────┘             │
│  │              SyncManager (离线优先)                      │
│  │         本地存储(wx.getStorageSync) + 云端同步            │
│  └─────────────────────┬────────────────────────────────────│
└──────────────────────┼──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                      微信云开发层                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ 云数据库 │  │ 云函数  │  │ 定时触发 │  │ 云存储  │       │
│  │ CloudDB │  │Functions│  │Triggers │  │Storage │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ 硅基流动 │   │ CMeKG    │   │ 微信服务 │
  │ AI API   │   │知识图谱  │   │ OCR      │
  └──────────┘   └──────────┘   └──────────┘
```

## 2. 核心架构原则

### 2.1 离线优先（Offline-First）

**设计目标**：确保医院地下室、电梯等弱网环境下的可用性

**实现方式**：
- 所有UI操作优先响应本地存储
- 云端同步在后台静默进行
- 冲突解决采用Last-Write-Wins策略

**关键组件**：`SyncManager` (utils/syncManager.js)

```javascript
// 写入流程
write(key, data) {
  1. 立即写入本地(wx.setStorageSync)  → UI即时响应
  2. 加入同步队列                     → 后台处理
  3. 触发云端同步                      → 异步执行
}

// 读取流程
read(key) {
  1. 返回本地数据                      → 即时响应
  2. 后台校验云端版本                  → 如有更新则刷新
}
```

### 2.2 消息降级策略（订阅消息三层降级）

**问题背景**：微信小程序长期订阅消息审核严格，普通主体难以申请

**解决方案**：

```
第一层：长期订阅消息（如有权限）
    ↓ 无权限
第二层：一次性订阅消息 + 循环索要机制
    用户在每次打卡时，自动索要"下次用药"的授权
    ↓ 用户拒绝/无授权
第三层：前台兜底（震动 + 应用内强提醒）
    定时触发器将待提醒写入foregroundReminders集合
    前端每分钟检查，触发wx.vibrateLong() + 弹窗
```

**实现文件**：
- `cloudfunctions/sendReminderMessage/index.js` - 消息发送
- `utils/subscriptionHelper.js` - 循环索要逻辑
- `cloudfunctions/checkAndSendReminders/index.js` - 定时检查

### 2.3 LLM解析质量控制

**问题背景**：OCR后的文本直接传给LLM，可能出现幻觉（如"片"识别成"斤"）

**解决方案三层防护**：

1. **强制JSON输出**：`response_format: { type: 'json_object' }`
2. **Few-Shot提示**：提供2个标准解析示例
3. **Schema校验**：白名单验证，异常时Fallback手动输入

```javascript
// Schema校验规则（关键字段）
dosageUnit: {
  enum: ['片', '粒', 'mg', 'g', 'ml', '包', '支'],  // 白名单
  forbidden: ['斤', '公斤', '千克']                  // 明确禁止
}
```

## 3. 数据模型

### 3.1 集合设计

| 集合名称 | 用途 | 关键索引 | 数据量预估 |
|---------|------|---------|-----------|
| `medicines` | 用户药品清单 | `_openid`, `times` | 人均3-5条 |
| `cme_kg_medicines` | CMeKG知识图谱 | `name`(唯一), `aliases` | ~50条（种子数据） |
| `health_profiles` | 用户健康档案 | `_openid`(唯一) | 人均1条 |
| `medication_records` | 服药打卡记录 | `_openid+date`, `medicineId` | 人均30条/月 |
| `reminder_logs` | 提醒发送日志 | `_openid+sentTime` | 人均90条/月 |
| `foregroundReminders` | 前台提醒队列 | `_openid+status`, `scheduledTime` | 临时数据 |
| `userSubscriptions` | 订阅授权状态 | `_openid`(唯一) | 人均1条 |
| `userRelations` | 家人关系链 | `requesterOpenid`, `targetOpenid` | 人均2-3条 |
| `sync_data` | SyncManager通用同步 | `_openid+_key`(唯一) | 动态 |

### 3.2 关键数据流

**用药打卡流程**：
```
用户点击"已服药"
    ↓
写入本地 completed_YYYYMMDD 键
    ↓
UI立即更新（绿色标记）
    ↓
后台：syncManager.write('record_YYYYMMDD_slotId', recordData)
    ↓
云端：写入 medication_records 集合
```

**添加药品流程**：
```
用户提交药品信息
    ↓
调用 checkMedicineContraindication 云函数（CMeKG禁忌分析）
    ↓
如有警告，弹窗提示
    ↓
用户确认后
    ↓
写入本地 medicineList
    ↓
后台：syncManager.write('medicine_id', medicineData)
    ↓
云端：写入 medicines 集合
```

## 4. 云函数清单

| 云函数名称 | 功能 | 触发方式 | 关键依赖 |
|-----------|------|---------|---------|
| `syncData` | 数据同步通用接口 | HTTP | 云数据库 |
| `sendReminderMessage` | 发送提醒消息（三层降级） | 被调用 | 订阅消息API |
| `checkAndSendReminders` | 定时检查并发送提醒 | 定时触发器(15min) | sendReminderMessage |
| `checkMedicineContraindication` | CMeKG禁忌分析 | 被调用 | cme_kg_medicines集合 |
| `parseMedicineByAI` | AI解析处方OCR文本 | 被调用 | 硅基流动API |
| `updateSubscription` | 更新用户订阅状态 | 被调用 | userSubscriptions集合 |
| `getPhoneNumber` | 获取用户手机号 | 被调用 | 微信手机号解密 |

## 5. 前端工具类

| 文件路径 | 功能 | 关键方法 |
|---------|------|---------|
| `utils/syncManager.js` | 离线优先数据同步 | `write()`, `read()`, `forceSync()` |
| `utils/subscriptionHelper.js` | 订阅授权管理 | `requestSubscription()`, `requestSubscriptionAfterCheckin()` |

## 6. 性能与安全考量

### 6.1 性能优化

- **分页加载**：药品列表、历史记录分页返回
- **批量操作**：syncFromCloud批量获取云端更新
- **防抖处理**：搜索输入防抖300ms
- **缓存策略**：CMeKG数据本地缓存24小时

### 6.2 安全设计

- **数据隔离**：所有数据库查询强制附加`_openid`过滤
- **输入校验**：Schema校验拦截异常数据
- **隐私保护**：处方图片OCR后脱敏，仅传输文本给LLM
- **权限控制**：数据库安全规则`doc._openid == auth.openid`

## 7. 扩展性设计

### 7.1 新增药品适配

添加新药品到CMeKG只需：
1. 在`cmekg_seed_data.json`中添加数据
2. 执行导入脚本
3. 自动生效（无需修改代码）

### 7.2 新增提醒渠道

如需增加短信提醒：
1. 在`sendReminderMessage`中增加`smsProvider`调用
2. 在降级策略中增加短信层

## 8. 监控与运维

### 8.1 日志记录

- `reminder_logs`：记录所有提醒发送尝试
- 云函数控制台日志：记录错误和关键操作
- 前端console：开发调试

### 8.2 关键指标

| 指标 | 计算方式 | 目标 |
|------|---------|------|
| OCR准确率 | 正确解析字段数/总字段数 | ≥80% |
| 提醒准时率 | 按时发送数/应发送总数 | ≥85% |
| 云端同步成功率 | 成功同步数/总尝试数 | ≥95% |
| 禁忌分析准确率 | 正确预警数/总预警数 | ≥90% |

---

文档版本：v1.0
更新日期：2026-06-08
