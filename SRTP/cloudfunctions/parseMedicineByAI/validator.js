/**
 * 处方解析 Schema 校验纯函数（无外部依赖，便于单元测试）
 * 关键作用：拦截 OCR/LLM 幻觉（如剂量单位"片"被识别成"斤"）
 */

// Schema校验规则
const MEDICINE_SCHEMA = {
  name: {
    type: 'string',
    required: true,
    minLength: 1,
    maxLength: 100,
    pattern: /^[\u4e00-\u9fa5a-zA-Z0-9\(\)（）\-\s]+$/  // 中文字符、英文、数字、括号
  },
  dosageNumber: {
    type: 'string',
    required: true,
    pattern: /^[0-9]+(\.[0-9]+)?$/  // 必须以数字开头：整数或小数，拦截"."/"..."等幻觉值
  },
  dosageUnit: {
    type: 'string',
    required: true,
    enum: ['片', '粒', 'mg', 'g', 'ml', '包', '支', '瓶', '盒', '丸', '袋', '滴', '喷', '枚', '贴'],  // 白名单，拒绝"斤"
    forbidden: ['斤', '公斤', '千克', '两', '钱']  // 明确禁止的单位
  },
  instruction: {
    type: 'string',
    maxLength: 50,
    enum: ['饭前服用', '饭后服用', '随餐服用', '空腹服用', '睡前服用', '晨起服用', '必要时服用', '无特殊要求', '']
  },
  frequency: {
    type: 'string',
    required: true,
    pattern: /^[0-9]+$/  // 纯数字
  },
  times: {
    type: 'array',
    items: {
      pattern: /^([01]\d|2[0-3]):([0-5]\d)$/  // HH:MM 24小时格式
    }
  },
  notes: {
    type: 'string',
    maxLength: 200
  }
};

/**
 * Schema校验
 * @returns {Object} { valid: boolean, data: Object, errors: Array }
 */
function validateMedicine(medicine, index) {
  const errors = [];
  const validated = {};

  for (const [field, rules] of Object.entries(MEDICINE_SCHEMA)) {
    const value = medicine[field];

    // 必填检查
    if (rules.required && (!value || value === '')) {
      errors.push(`药品[${index + 1}].${field}: 必填项缺失`);
      continue;
    }

    // 跳过空值的其他校验
    if (!value && !rules.required) {
      validated[field] = value;
      continue;
    }

    // 类型检查
    if (rules.type === 'string' && typeof value !== 'string') {
      errors.push(`药品[${index + 1}].${field}: 类型错误，期望string，实际${typeof value}`);
      continue;
    }

    // 枚举检查（白名单）⭐ 拦截"斤"等异常单位
    if (rules.enum && !rules.enum.includes(value)) {
      if (rules.forbidden && rules.forbidden.includes(value)) {
        errors.push(`药品[${index + 1}].${field}: "${value}" 是非法单位（可能是识别错误）`);
      } else {
        errors.push(`药品[${index + 1}].${field}: "${value}" 不在允许值列表中，允许: ${rules.enum.join(', ')}`);
      }
      continue;
    }

    // 正则检查
    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push(`药品[${index + 1}].${field}: "${value}" 格式不符合要求`);
      continue;
    }

    // 数组项校验
    if (rules.type === 'array' && Array.isArray(value)) {
      if (rules.items) {
        for (let i = 0; i < value.length; i++) {
          if (rules.items.pattern && !rules.items.pattern.test(value[i])) {
            errors.push(`药品[${index + 1}].${field}[${i}]: "${value[i]}" 格式错误`);
          }
        }
      }
    }

    validated[field] = value;
  }

  return {
    valid: errors.length === 0,
    data: validated,
    errors: errors
  };
}

/**
 * 智能时间推断：AI 未提供 times 时根据 frequency 推断默认时间
 */
function inferTimes(frequency) {
  const freq = parseInt(frequency, 10) || 1;
  const defaultTimes = {
    1: ['08:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '14:00', '20:00'],
    4: ['08:00', '12:00', '18:00', '22:00']
  };
  return defaultTimes[freq] || ['08:00'];
}

/**
 * 后处理：补全缺失字段
 */
function postProcess(medicine) {
  if (!medicine.times || medicine.times.length === 0) {
    medicine.times = inferTimes(medicine.frequency);
  }
  if (medicine.name) {
    medicine.name = medicine.name.replace(/\s+/g, ' ').trim();
  }
  if (medicine.dosageNumber) {
    medicine.dosageNumber = medicine.dosageNumber.replace(/[^0-9.]/g, '');
  }
  return medicine;
}

module.exports = { MEDICINE_SCHEMA, validateMedicine, inferTimes, postProcess };
