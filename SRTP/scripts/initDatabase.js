/**
 * 数据库初始化脚本
 * 在微信云开发控制台中执行，创建必要的集合和索引
 * 
 * 使用方法：
 * 1. 打开微信开发者工具
 * 2. 进入"云开发"控制台
 * 3. 在"数据库"中创建以下集合
 * 4. 设置对应的索引
 */

// 集合配置
const COLLECTIONS = {
  // 用户药品清单
  medicines: {
    description: '用户药品清单（按openid隔离）',
    indexes: [
      { name: '_openid_idx', fields: ['_openid'], unique: false },
      { name: 'openid_name_idx', fields: ['_openid', 'name'], unique: false },
      { name: 'times_idx', fields: ['times'], unique: false }
    ]
  },
  
  // CMeKG知识图谱
  cme_kg_medicines: {
    description: 'CMeKG医学知识图谱数据',
    indexes: [
      { name: 'name_idx', fields: ['name'], unique: true },
      { name: 'aliases_idx', fields: ['aliases'], unique: false }
    ]
  },
  
  // 用户健康档案
  health_profiles: {
    description: '用户健康档案（疾病史、过敏史等）',
    indexes: [
      { name: 'openid_idx', fields: ['_openid'], unique: true }
    ]
  },
  
  // 服药打卡记录
  medication_records: {
    description: '服药打卡记录（按日期分片）',
    indexes: [
      { name: 'openid_date_idx', fields: ['_openid', 'date'], unique: false },
      { name: 'openid_medicine_idx', fields: ['_openid', 'medicineId'], unique: false },
      { name: 'date_idx', fields: ['date'], unique: false }
    ]
  },
  
  // 提醒发送日志
  reminder_logs: {
    description: '提醒发送日志（用于统计准时率）',
    indexes: [
      { name: 'openid_time_idx', fields: ['_openid', 'sentTime'], unique: false },
      { name: 'openid_medicine_time_idx', fields: ['_openid', 'medicineName', 'scheduledTime'], unique: false }
    ]
  },
  
  // 前台提醒队列（降级兜底）
  foregroundReminders: {
    description: '前台提醒队列（订阅失败时的兜底方案）',
    indexes: [
      { name: 'openid_status_idx', fields: ['_openid', 'status'], unique: false },
      { name: 'scheduled_time_idx', fields: ['scheduledTime'], unique: false }
    ]
  },
  
  // 用户订阅状态
  userSubscriptions: {
    description: '用户订阅授权状态管理',
    indexes: [
      { name: 'openid_idx', fields: ['_openid'], unique: true }
    ]
  },
  
  // 用户关系（家人监督）
  userRelations: {
    description: '用户关系链（家人监督功能）',
    indexes: [
      { name: 'requester_idx', fields: ['requesterOpenid'], unique: false },
      { name: 'target_idx', fields: ['targetOpenid'], unique: false },
      { name: 'status_idx', fields: ['status'], unique: false }
    ]
  },
  
  // 通用数据同步
  sync_data: {
    description: 'SyncManager通用数据同步',
    indexes: [
      { name: 'openid_key_idx', fields: ['_openid', '_key'], unique: true },
      { name: 'timestamp_idx', fields: ['_cloudTimestamp'], unique: false }
    ]
  }
};

/**
 * 生成云开发控制台操作指南
 */
function generateGuide() {
  let guide = `# 微信云开发数据库初始化指南

## 手动创建步骤

### 1. 打开云开发控制台
- 在微信开发者工具中点击"云开发"按钮
- 进入"数据库"标签页

### 2. 创建集合
按顺序创建以下集合：\n\n`;

  Object.keys(COLLECTIONS).forEach(name => {
    const config = COLLECTIONS[name];
    guide += `#### ${name}
- 描述: ${config.description}
- 索引:\n`;
    
    config.indexes.forEach(idx => {
      guide += `  - ${idx.name}: ${JSON.stringify(idx.fields)} ${idx.unique ? '(唯一)' : ''}\n`;
    });
    
    guide += `\n`;
  });

  guide += `
### 3. 安全规则配置
在数据库安全规则中添加：
\`\`\`json
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
\`\`\`

### 4. 导入CMeKG数据
1. 打开 cme_kg_medicines 集合
2. 点击"导入"
3. 选择 cmekg_seed_data.json 文件
4. 映射字段: name -> name, contraindications -> contraindications, etc.
`;

  return guide;
}

/**
 * 生成CMeKG数据导入格式
 */
function generateCMeKGImportFormat() {
  const fs = require('fs');
  const path = require('path');
  
  try {
    // 读取原始数据
    const rawData = fs.readFileSync(
      path.join(__dirname, '../cmekg_seed_data.json'), 
      'utf8'
    );
    const jsonData = JSON.parse(rawData);
    
    // 转换为云数据库格式
    const importData = jsonData.medicines.map(med => ({
      name: med.name,
      aliases: med.aliases || [],
      category: med.category || '',
      contraindications: med.contraindications || {},
      interactions: med.interactions || [],
      sideEffects: med.sideEffects || [],
      createTime: new Date(),
      updateTime: new Date()
    }));
    
    // 保存导入格式
    const outputPath = path.join(__dirname, '../cmekg_import_ready.json');
    fs.writeFileSync(outputPath, JSON.stringify(importData, null, 2));
    
    console.log(`CMeKG导入数据已生成: ${outputPath}`);
    console.log(`共 ${importData.length} 条药品记录`);
    
    return importData;
  } catch (e) {
    console.error('生成CMeKG导入格式失败:', e);
    return null;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  console.log(generateGuide());
  generateCMeKGImportFormat();
}

module.exports = {
  COLLECTIONS,
  generateGuide,
  generateCMeKGImportFormat
};
