/**
 * 云函数：parseMedicineByAI
 * 使用LLM解析OCR识别的处方文本
 * 关键优化：
 * 1. 强制JSON输出（response_format: json_object）
 * 2. Few-Shot提示（2个示例）
 * 3. Schema校验（拦截异常单位如"斤"）
 * 4. 异常时Fallback到手动输入模式
 */

const cloud = require('wx-server-sdk');
cloud.init();

// 硅基流动配置
const API_KEY = 'sk-aqilbtdyydahygfxdfazurtqvhsurktmcohhzjcjrldrstmg';
const BASE_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const MODEL_NAME = 'Qwen/Qwen2.5-7B-Instruct';

const { httpclient } = cloud;

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
    pattern: /^[0-9.]+$/  // 纯数字或小数
  },
  dosageUnit: {
    type: 'string',
    required: true,
    enum: ['片', '粒', 'mg', 'g', 'ml', '包', '支', '瓶', '盒', '粒', '丸', '袋', '滴', '喷', '枚', '贴', '粒'],  // ⭐ 白名单，拒绝"斤"
    forbidden: ['斤', '公斤', '千克', '斤', '两', '钱']  // 明确禁止的单位
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
 * 构建Few-Shot提示词（2个示例）
 */
function buildPrompt(ocrText) {
  return `你是一个专业的医疗处方解析助手。请严格按以下JSON格式返回，不要包含任何其他文字。

【示例1 - 标准处方】
输入: "阿司匹林肠溶片 100mg 口服 每日一次 早8点"
输出:
{
  "medicines": [
    {
      "name": "阿司匹林肠溶片",
      "dosageNumber": "100",
      "dosageUnit": "mg",
      "instruction": "晨起服用",
      "times": ["08:00"],
      "frequency": "1",
      "notes": ""
    }
  ]
}

【示例2 - 复杂处方】
输入: "头孢克肟胶囊 0.1g tid 饭后服用 疗程7天"
输出:
{
  "medicines": [
    {
      "name": "头孢克肟胶囊",
      "dosageNumber": "0.1",
      "dosageUnit": "g",
      "instruction": "饭后服用",
      "times": ["08:00", "14:00", "20:00"],
      "frequency": "3",
      "notes": "疗程7天"
    }
  ]
}

【待解析处方】
${ocrText}

请直接返回JSON格式，不要有任何解释文字。`;
}

/**
 * Schema校验
 * @returns {Object} { valid: boolean, data: Object, errors: Array }
 */
function validateMedicine(medicine, index) {
  const errors = [];
  const validated = {};

  // 遍历schema规则
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

    // 枚举检查（白名单）⭐ 关键：拦截"斤"等异常单位
    if (rules.enum && !rules.enum.includes(value)) {
      // 检查是否在禁用列表
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
 * 智能时间推断
 * 如果AI没有提供times，根据frequency推断默认时间
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
  // 如果时间缺失，自动推断
  if (!medicine.times || medicine.times.length === 0) {
    medicine.times = inferTimes(medicine.frequency);
  }

  // 标准化药品名称（去除多余空格）
  if (medicine.name) {
    medicine.name = medicine.name.replace(/\s+/g, ' ').trim();
  }

  // 标准化用量（去除单位中可能的重复）
  if (medicine.dosageNumber) {
    medicine.dosageNumber = medicine.dosageNumber.replace(/[^0-9.]/g, '');
  }

  return medicine;
}

exports.main = async (event, context) => {
  const { ocrText, imageUrl } = event;
  
  console.log('[parseMedicineByAI] 收到OCR文本:', ocrText);
  
  if (!ocrText) {
    return {
      success: false,
      error: '缺少OCR文本',
      errorType: 'PARAM_ERROR',
      fallback: true  // 需要用户手动输入
    };
  }

  // 文本长度检查
  if (ocrText.length > 5000) {
    return {
      success: false,
      error: 'OCR文本过长，请重新拍摄或使用手动输入',
      errorType: 'TEXT_TOO_LONG',
      fallback: true
    };
  }

  try {
    const prompt = buildPrompt(ocrText);

    console.log('[parseMedicineByAI] 调用硅基流动 API，模型:', MODEL_NAME);
    
    // ⭐ 关键：使用response_format强制JSON输出
    const res = await httpclient.request({
      method: 'POST',
      url: BASE_URL,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: MODEL_NAME,
        messages: [
          { 
            role: 'system', 
            content: '你是一个专业的医疗处方解析助手，只能返回JSON格式数据，不能包含任何解释性文字。' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,  // 低温度，减少幻觉
        max_tokens: 2000,
        response_format: { type: 'json_object' }  // ⭐ 强制JSON输出
      },
      dataType: 'json',
      timeout: 30000 
    });

    console.log('[parseMedicineByAI] API响应状态:', res.status);
    
    const aiContent = res.data.choices[0].message.content;
    console.log('[parseMedicineByAI] AI原始返回:', aiContent);
    
    // 解析JSON（因为有了response_format，这里应该直接可解析）
    let parsedData;
    try {
      parsedData = JSON.parse(aiContent);
    } catch (e) {
      console.error('[parseMedicineByAI] JSON解析失败，尝试提取:', e);
      
      // 备用：正则提取（兼容模式）
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI返回格式错误');
      }
      parsedData = JSON.parse(jsonMatch[0]);
    }

    // 确保medicines是数组
    const medicines = parsedData.medicines || parsedData;
    if (!Array.isArray(medicines)) {
      throw new Error('AI返回数据结构错误: medicines不是数组');
    }

    console.log(`[parseMedicineByAI] 解析到 ${medicines.length} 个药品`);

    // ⭐ Schema校验
    const validatedMedicines = [];
    const validationErrors = [];

    for (let i = 0; i < medicines.length; i++) {
      const med = medicines[i];
      const validation = validateMedicine(med, i);

      if (validation.valid) {
        // 后处理补全
        const processed = postProcess(validation.data);
        validatedMedicines.push(processed);
      } else {
        validationErrors.push(...validation.errors);
        // 部分有效？尝试保留
        if (validation.data.name && validation.data.name.length > 0) {
          validatedMedicines.push({
            ...postProcess(validation.data),
            _hasValidationError: true,
            _validationErrors: validation.errors
          });
        }
      }
    }

    // 如果有严重校验错误，返回警告
    if (validationErrors.length > 0) {
      console.warn('[parseMedicineByAI] 校验警告:', validationErrors);
      
      // 如果完全没有有效药品，触发fallback
      if (validatedMedicines.length === 0) {
        return {
          success: false,
          error: `处方解析存在错误：${validationErrors.join('; ')}`,
          errorType: 'VALIDATION_ERROR',
          validationErrors: validationErrors,
          fallback: true,  // 需要用户手动输入
          rawText: ocrText
        };
      }
      
      // 部分成功，返回警告但允许继续
      return {
        success: true,
        medicines: validatedMedicines,
        rawText: ocrText,
        hasValidationWarning: true,
        validationWarnings: validationErrors,
        message: '处方已解析，但部分内容可能需要核对，请检查药品信息'
      };
    }

    // 完全成功
    return {
      success: true,
      medicines: validatedMedicines,
      rawText: ocrText,
      count: validatedMedicines.length
    };
    
  } catch (err) {
    console.error('[parseMedicineByAI] AI解析失败:', err);
    
    // 错误类型判断
    let errorType = 'UNKNOWN_ERROR';
    let errorMessage = 'AI服务暂不可用，请使用手动输入';
    
    if (err.response) {
      const status = err.response.status;
      if (status === 401) {
        errorType = 'AUTH_ERROR';
        errorMessage = 'API Key无效';
      } else if (status === 429) {
        errorType = 'RATE_LIMIT_ERROR';
        errorMessage = '请求频率过高，请稍后重试';
      } else if (status >= 500) {
        errorType = 'SERVER_ERROR';
        errorMessage = 'AI服务暂时不可用';
      }
    } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
      errorType = 'TIMEOUT_ERROR';
      errorMessage = '连接超时';
    } else if (err.message.includes('VALIDATION')) {
      errorType = 'VALIDATION_ERROR';
    }
    
    // ⭐ 关键：所有错误都fallback到手动输入模式
    return {
      success: false,
      error: errorMessage,
      errorType: errorType,
      detail: err.message,
      fallback: true,  // 触发手动输入
      rawText: ocrText
    };
  }
};
