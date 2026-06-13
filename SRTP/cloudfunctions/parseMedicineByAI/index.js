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

// 硅基流动配置（密钥通过云函数环境变量注入，切勿硬编码提交）
// 在微信云开发控制台 -> 云函数 -> parseMedicineByAI -> 配置 -> 环境变量 中设置 SILICONFLOW_API_KEY
const API_KEY = process.env.SILICONFLOW_API_KEY || '';
const BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1/chat/completions';
const MODEL_NAME = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-7B-Instruct';

const { httpclient } = cloud;

// Schema 校验与后处理纯函数（已抽离，便于单元测试）
const { validateMedicine, postProcess } = require('./validator.js');

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

  // 密钥缺失检查（避免在未配置环境变量时发起无效请求）
  if (!API_KEY) {
    console.error('[parseMedicineByAI] 未配置 SILICONFLOW_API_KEY 环境变量');
    return {
      success: false,
      error: 'AI解析服务未配置，请联系管理员或使用手动输入',
      errorType: 'CONFIG_ERROR',
      fallback: true,
      rawText: ocrText
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
