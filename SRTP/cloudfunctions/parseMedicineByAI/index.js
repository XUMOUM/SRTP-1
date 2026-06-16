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
const https = require('https');
const { URL } = require('url');
cloud.init();

// 硅基流动配置（密钥通过云函数环境变量注入，切勿硬编码提交）
// 在微信云开发控制台 -> 云函数 -> parseMedicineByAI -> 配置 -> 环境变量 中设置 SILICONFLOW_API_KEY
const API_KEY = process.env.SILICONFLOW_API_KEY || '';
const BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1/chat/completions';
const MODEL_NAME = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-7B-Instruct';

// Schema 校验与后处理纯函数（已抽离，便于单元测试）
const { validateMedicine, postProcess } = require('./validator.js');

/**
 * 从模型输出中稳健提取并解析 JSON：
 * 1. 去除 markdown 代码围栏（```json ... ```）
 * 2. 直接 JSON.parse
 * 3. 失败则按括号配对截取第一个完整 {...} 再 parse（容忍前后多余文字）
 * 解析不出返回 null（交由上层判断是否截断）。
 */
function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;

  let s = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(s);
  } catch (e) { /* 继续尝试括号配对 */ }

  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null; // 未找到配对的右括号（通常意味着输出被截断）
}

/**
 * 发起 POST JSON 请求（基于 Node 内置 https，无需第三方依赖）
 *
 * ⚠️ 不使用 socket 空闲超时（options.timeout）：非流式 LLM 在生成期间不会发送任何字节，
 * 若用空闲超时会误判为 timeout。此处仅用「总截止时间」控制整次请求时长。
 */
function postJSON(urlStr, headers, bodyObj, deadlineMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(new Error('INVALID_URL: ' + urlStr));
      return;
    }

    const payload = JSON.stringify(bodyObj);
    const options = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      port: u.port || 443,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json'
      }
    };

    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      fn(arg);
    };

    const deadlineTimer = setTimeout(() => {
      req.destroy(new Error('deadline_exceeded'));
    }, deadlineMs || 58000);

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        const status = res.statusCode;
        let data;
        try { data = JSON.parse(raw); } catch (e) { data = raw; }
        if (status >= 200 && status < 300) {
          finish(resolve, { status, data });
        } else {
          const err = new Error('HTTP_ERROR_' + status);
          err.response = { status, data };
          finish(reject, err);
        }
      });
    });

    req.on('error', (e) => finish(reject, e));
    req.write(payload);
    req.end();
  });
}

/**
 * 紧凑系统提示（避免与 user 重复，减少 token 浪费）
 */
const SYSTEM_PROMPT = `你是药品信息提取助手。只返回一个合法 JSON 对象，不要 markdown、不要解释、不要用空格填充。
格式：{"medicines":[{"name":"药品名","dosageNumber":"0.25","dosageUnit":"g","instruction":"无特殊要求","times":["08:00"],"frequency":"1","notes":""}]}
规则：
- name：主要药品名称（如"阿莫西林胶囊"）
- dosageNumber+dosageUnit：从规格提取（0.25g→"0.25"+"g"）
- dosageUnit 只能是：片、粒、mg、g、ml、包、支、瓶、盒、丸、袋、滴、喷、枚、贴
- 包装文字无用法时：instruction="无特殊要求"，frequency="1"，times=["08:00"]`;

/** 主提示：单示例，面向处方/包装混合场景 */
function buildPrompt(ocrText) {
  return `示例输入："阿莫西林胶囊 0.25g 每板10粒"
示例输出：{"medicines":[{"name":"阿莫西林胶囊","dosageNumber":"0.25","dosageUnit":"g","instruction":"无特殊要求","times":["08:00"],"frequency":"1","notes":""}]}

请解析以下文字（JSON 紧凑单行输出）：
${ocrText}`;
}

/** 解析失败时的极简重试提示 */
function buildRetryPrompt(ocrText) {
  return `从下面文字提取一种药品，只返回 JSON：
{"medicines":[{"name":"药品名","dosageNumber":"数字","dosageUnit":"g或mg或粒等","instruction":"无特殊要求","times":["08:00"],"frequency":"1","notes":""}]}

文字：
${ocrText.slice(0, 800)}`;
}

/**
 * 从 AI 返回对象中提取 medicines 数组（兼容 medicin/medicine 等拼写）
 */
function extractMedicinesFromParsed(parsedData) {
  if (!parsedData || typeof parsedData !== 'object') return null;

  if (Array.isArray(parsedData)) {
    const list = parsedData.map(normalizeMedicineItem).filter(Boolean);
    return list.length ? list : null;
  }

  const arrayKeys = ['medicines', 'medicin', 'medicine', 'data', 'items', 'drugs'];
  for (const key of arrayKeys) {
    if (Array.isArray(parsedData[key]) && parsedData[key].length > 0) {
      const list = parsedData[key].map(normalizeMedicineItem).filter(Boolean);
      if (list.length) return list;
    }
  }

  if (parsedData.name) {
    const one = normalizeMedicineItem(parsedData);
    return one ? [one] : null;
  }
  return null;
}

/** 字段名模糊归一化（兼容 dosicUnit、dos粒Unit 等） */
function normalizeFieldName(key) {
  const k = String(key).toLowerCase();
  if (k.includes('name')) return 'name';
  if (k.includes('unit')) return 'dosageUnit';
  if (k.includes('number') || (k.includes('dosage') && !k.includes('unit')) || k.includes('dosic')) return 'dosageNumber';
  if (k.includes('instruction') || k.includes('用法')) return 'instruction';
  if (k.includes('frequency') || k.includes('freq')) return 'frequency';
  if (k.includes('times') || k.includes('time')) return 'times';
  if (k.includes('notes') || k.includes('note')) return 'notes';
  return key;
}

/** 归一化单个药品对象 */
function normalizeMedicineItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const item = {};
  for (const [k, v] of Object.entries(raw)) {
    const field = normalizeFieldName(k);
    if (['name', 'dosageNumber', 'dosageUnit', 'instruction', 'frequency', 'notes'].includes(field)) {
      if (typeof v === 'string') item[field] = v.trim();
      else if (v != null && field !== 'name') item[field] = String(v);
      else if (field === 'name' && v) item[field] = String(v).trim();
    } else if (field === 'times') {
      if (Array.isArray(v)) item.times = v.map(String);
      else if (typeof v === 'string') item.times = [v];
    }
  }

  if (!item.name) return null;

  if (item.dosageNumber) {
    const m = String(item.dosageNumber).match(/(\d+\.?\d*)/);
    item.dosageNumber = m ? m[1] : '';
  }
  if (item.dosageUnit) {
    const um = String(item.dosageUnit).match(/(mg|g|ml|片|粒|包|支|瓶|盒|丸|袋|滴|喷|枚|贴)/i);
    item.dosageUnit = um ? (um[1] === 'MG' ? 'mg' : um[1].toLowerCase() === 'mg' ? 'mg' : um[1]) : item.dosageUnit;
  }
  if (item.times) {
    item.times = item.times.filter(t => /^([01]\d|2[0-3]):([0-5]\d)$/.test(t));
  }
  if (!item.frequency || !/^\d+$/.test(item.frequency)) item.frequency = '1';
  if (!item.instruction) item.instruction = '无特殊要求';
  if (!item.notes) item.notes = '';

  return item;
}

/** 过滤明显非药品名（如品牌「抗之霸」） */
function isLikelyDrugName(name) {
  return /(?:胶囊|片|颗粒|口服液|注射液|分散片|缓释片|肠溶片|软胶囊|滴丸|混悬|糖浆|栓|膏)/.test(name);
}

function filterDrugCandidates(medicines) {
  if (!medicines || !medicines.length) return medicines;
  const drugs = medicines.filter(m => isLikelyDrugName(m.name));
  return drugs.length ? drugs : medicines.slice(0, 1);
}

/** 校验并后处理药品列表；无有效项时返回 null */
function processMedicineList(medicines, ocrText) {
  if (!medicines || !medicines.length) return null;

  const validatedMedicines = [];
  const validationErrors = [];

  for (let i = 0; i < medicines.length; i++) {
    const validation = validateMedicine(medicines[i], i);
    if (validation.valid) {
      validatedMedicines.push(postProcess(validation.data));
    } else {
      validationErrors.push(...validation.errors);
      if (validation.data.name && validation.data.name.length > 0) {
        validatedMedicines.push({
          ...postProcess(validation.data),
          _hasValidationError: true,
          _validationErrors: validation.errors
        });
      }
    }
  }

  if (validatedMedicines.length === 0) return null;

  const fullyValid = validatedMedicines.filter(m => !m._hasValidationError);
  if (fullyValid.length === 0) return null;

  return {
    medicines: fullyValid,
    validationErrors,
    hasValidationWarning: validationErrors.length > 0
  };
}

/** 判断是否为药品包装文字（非处方笺） */
function isPackagingText(ocrText) {
  return /(?:每板|每盒|制药|有限公司|Capsules|胶囊)/i.test(ocrText)
    && !/(每日|tid|bid|口服|一次|疗程|用法用量)/i.test(ocrText);
}

/** AI 解析 → 归一化 → 校验；失败或 AI 质量差则规则兜底 */
function resolveMedicines(ocrText, parsedData) {
  let list = extractMedicinesFromParsed(parsedData);
  if (list) list = filterDrugCandidates(list);

  const aiResult = processMedicineList(list, ocrText);
  const fallbackData = extractPackageFallback(ocrText);
  const fallbackResult = fallbackData ? processMedicineList(fallbackData.medicines, ocrText) : null;

  // 药盒/包装文字：规则提取比 7B 模型更可靠
  if (isPackagingText(ocrText) && fallbackResult) {
    return { ...fallbackResult, source: 'fallback' };
  }
  // AI 完全有效 → 直接用
  if (aiResult && !aiResult.hasValidationWarning) {
    return { ...aiResult, source: 'ai' };
  }
  // AI 有错误或无效，但规则兜底成功 → 优先兜底（药盒场景更准）
  if (fallbackResult) {
    return { ...fallbackResult, source: 'fallback' };
  }
  // 仅 AI 部分可用
  if (aiResult) {
    return { ...aiResult, source: 'ai' };
  }
  return null;
}

function extractPackageFallback(ocrText) {
  const lines = ocrText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const nameLine = lines.find(l =>
    /[\u4e00-\u9fa5]{2,}(?:胶囊|片|颗粒|口服液|注射液|分散片|缓释片|肠溶片|软胶囊|滴丸)/.test(l)
  );
  // 优先匹配规格剂量（0.25g、100mg），避免误匹配「每板10粒」
  let specMatch = ocrText.match(/(\d+\.?\d*)\s*(mg|g|ml|μg|ug)\b/i);
  if (!specMatch) {
    specMatch = ocrText.match(/(?:规格|含量)[:：]?\s*(\d+\.?\d*)\s*(片|粒)/);
  }
  if (!nameLine) return null;

  const unit = specMatch
    ? (specMatch[2].toLowerCase() === 'μg' || specMatch[2].toLowerCase() === 'ug' ? 'mg' : specMatch[2])
    : '粒';

  return {
    medicines: [{
      name: nameLine.replace(/\s+/g, ''),
      dosageNumber: specMatch ? specMatch[1] : '1',
      dosageUnit: unit,
      instruction: '无特殊要求',
      times: ['08:00'],
      frequency: '1',
      notes: '规则提取，请核对用法用量'
    }]
  };
}

/** 调用硅基流动并返回 { aiContent, finishReason, elapsed } */
async function callSiliconFlow(userPrompt, maxTokens) {
  const requestBody = {
    model: MODEL_NAME,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' }
  };

  const startedAt = Date.now();
  const res = await postJSON(BASE_URL, {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }, requestBody, 58000);

  if (!res.data || !res.data.choices || !res.data.choices[0]) {
    throw new Error('AI返回结构异常: ' + JSON.stringify(res.data).slice(0, 300));
  }

  const choice = res.data.choices[0];
  const aiContent = (choice.message && choice.message.content) ? choice.message.content : '';
  return {
    status: res.status,
    aiContent,
    finishReason: choice.finish_reason || '',
    elapsed: Date.now() - startedAt
  };
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
    // 药盒/包装 OCR：规则提取更快更准，跳过 LLM
    if (isPackagingText(ocrText)) {
      const packagingResult = extractPackageFallback(ocrText);
      const resolved = packagingResult ? processMedicineList(packagingResult.medicines, ocrText) : null;
      if (resolved) {
        console.log('[parseMedicineByAI] 包装文字，规则提取成功:', JSON.stringify(resolved.medicines));
        return {
          success: true,
          medicines: resolved.medicines,
          rawText: ocrText,
          count: resolved.medicines.length,
          message: '已从包装文字提取，请核对用法用量'
        };
      }
    }

    console.log('[parseMedicineByAI] 调用硅基流动 API，模型:', MODEL_NAME, ' host:', new URL(BASE_URL).hostname);

    // 第一次：标准 prompt；失败则极简重试
    let aiResult = await callSiliconFlow(buildPrompt(ocrText), 512);
    console.log(`[parseMedicineByAI] 第1次请求完成，耗时${aiResult.elapsed}ms，finish_reason:`, aiResult.finishReason, 'content长度:', aiResult.aiContent.length);
    console.log('[parseMedicineByAI] AI原始返回:', aiResult.aiContent.slice(0, 300));

    let parsedData = extractJSON(aiResult.aiContent);
    let medicinesResolved = parsedData ? resolveMedicines(ocrText, parsedData) : null;

    if (!medicinesResolved) {
      console.warn('[parseMedicineByAI] 第1次结果无效，发起极简重试');
      aiResult = await callSiliconFlow(buildRetryPrompt(ocrText), 512);
      console.log(`[parseMedicineByAI] 第2次请求完成，耗时${aiResult.elapsed}ms，finish_reason:`, aiResult.finishReason);
      console.log('[parseMedicineByAI] 重试返回:', aiResult.aiContent.slice(0, 300));
      parsedData = extractJSON(aiResult.aiContent);
      medicinesResolved = parsedData ? resolveMedicines(ocrText, parsedData) : null;
    }

    const finishReason = aiResult.finishReason;
    const aiContent = aiResult.aiContent;

    if (!medicinesResolved) {
      const fallbackOnly = extractPackageFallback(ocrText);
      if (fallbackOnly) {
        medicinesResolved = processMedicineList(fallbackOnly.medicines, ocrText);
        if (medicinesResolved) medicinesResolved.source = 'fallback';
      }
    }

    if (!medicinesResolved) {
      const malformed = /\s{20,}/.test(aiContent) || !/(medicines|medicin)/.test(aiContent);
      return {
        success: false,
        error: malformed ? 'AI返回格式异常，请重试或手动输入' : '处方解析失败，请手动输入',
        errorType: malformed ? 'MALFORMED' : (finishReason === 'length' ? 'TRUNCATED' : 'PARSE_ERROR'),
        detail: 'finish_reason=' + finishReason + ', contentHead=' + aiContent.slice(0, 120),
        fallback: true,
        rawText: ocrText
      };
    }

    if (medicinesResolved.source === 'fallback') {
      console.log('[parseMedicineByAI] 使用规则兜底提取成功');
    }

    const validatedMedicines = medicinesResolved.medicines;
    const validationErrors = medicinesResolved.validationErrors || [];
    console.log(`[parseMedicineByAI] 解析到 ${validatedMedicines.length} 个药品 (来源: ${medicinesResolved.source})`);

    if (medicinesResolved.hasValidationWarning) {
      console.warn('[parseMedicineByAI] 校验警告:', validationErrors);
      return {
        success: true,
        medicines: validatedMedicines,
        rawText: ocrText,
        hasValidationWarning: true,
        validationWarnings: validationErrors,
        message: medicinesResolved.source === 'fallback'
          ? '已从包装文字规则提取，请核对用法用量'
          : '处方已解析，但部分内容可能需要核对，请检查药品信息'
      };
    }

    return {
      success: true,
      medicines: validatedMedicines,
      rawText: ocrText,
      count: validatedMedicines.length
    };

  } catch (err) {
    console.error('[parseMedicineByAI] AI解析失败:', err);

    // 异常时仍尝试规则兜底
    try {
      const fallbackData = extractPackageFallback(ocrText);
      if (fallbackData) {
        const recovered = processMedicineList(fallbackData.medicines, ocrText);
        if (recovered) {
          console.log('[parseMedicineByAI] 异常后规则兜底成功');
          return {
            success: true,
            medicines: recovered.medicines,
            rawText: ocrText,
            hasValidationWarning: true,
            message: '已从包装文字规则提取，请核对用法用量'
          };
        }
      }
    } catch (e) { /* ignore */ }
    
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
    } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout') || err.message.includes('deadline_exceeded')) {
      errorType = 'TIMEOUT_ERROR';
      errorMessage = 'AI解析超时，请重试或手动输入';
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
