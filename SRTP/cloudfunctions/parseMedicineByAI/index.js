// 云函数 parseMedicineByAI (使用官方 httpclient)
const cloud = require('wx-server-sdk')
cloud.init()

// 硅基流动配置（请替换为你的真实信息）
const API_KEY = 'sk-aqilbtdyydahygfxdfazurtqvhsurktmcohhzjcjrldrstmg'
const BASE_URL = 'https://api.siliconflow.cn/v1/chat/completions'
const MODEL_NAME = 'Qwen/Qwen2.5-7B-Instruct'

// 直接从 cloud 解构出 httpclient
const { httpclient } = cloud

exports.main = async (event, context) => {
  const { ocrText } = event
  
  console.log('收到OCR文本:', ocrText)
  
  if (!ocrText) {
    return {
      success: false,
      error: '缺少OCR文本',
      errorType: 'PARAM_ERROR'
    }
  }
  
  try {
    const prompt = `
你是一个专业的医疗处方解析助手。请将以下OCR识别的处方文本，解析为结构化的药品信息，返回严格的JSON格式。

要求：
1. 识别药品名称（name）
2. 识别每次用量数字（dosageNumber）
3. 识别用量单位（dosageUnit），如：片、粒、ml、mg、g等
4. 识别服用方式（instruction），如：饭前服用、饭后服用、随餐服用等
5. 识别用药时间点（times），如：08:00、12:00、20:00（如果有多个时间点，全部列出）
6. 识别每日次数（frequency），如：1、2、3（只写数字）

处方文本：
${ocrText}

请直接返回JSON格式，不要有任何解释文字。示例格式：
{
  "medicines": [
    {
      "name": "阿司匹林肠溶片",
      "dosageNumber": "1",
      "dosageUnit": "片",
      "instruction": "饭后服用",
      "times": ["08:00", "20:00"],
      "frequency": "2",
      "notes": ""
    }
  ]
}
`

    console.log('调用硅基流动 API，模型:', MODEL_NAME)
    
    // 使用 httpclient.request 替换 axios.post
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
          { role: 'system', content: '你是一个专业的医疗处方解析助手，只能返回JSON格式数据，不能包含其他文字。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 2000
      },
      dataType: 'json',
      timeout: 30000 
    })

    console.log('API响应状态:', res.status)
    
    const aiContent = res.data.choices[0].message.content
    console.log('AI原始返回:', aiContent)
    
    const jsonMatch = aiContent.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回格式错误')
    }
    
    const parsedData = JSON.parse(jsonMatch[0])
    
    return {
      success: true,
      medicines: parsedData.medicines || [],
      rawText: ocrText
    }
    
  } catch (err) {
    console.error('AI解析失败，完整错误:', err)
    
    // 错误类型判断（保持不变）
    let errorType = 'UNKNOWN_ERROR'
    let errorMessage = 'AI服务暂不可用'
    
    if (err.response) {
      const status = err.response.status
      if (status === 401) {
        errorType = 'AUTH_ERROR'
        errorMessage = 'API Key无效，请检查配置'
      } else if (status === 403) {
        errorType = 'FORBIDDEN_ERROR'
        errorMessage = '账户余额不足或需要实名认证'
      } else if (status === 404) {
        errorType = 'MODEL_NOT_FOUND'
        errorMessage = '模型不存在，请检查模型名称'
      } else if (status === 429) {
        errorType = 'RATE_LIMIT_ERROR'
        errorMessage = '请求频率过高，请稍后重试'
      } else if (status >= 500) {
        errorType = 'SERVER_ERROR'
        errorMessage = '硅基流动服务暂时不可用'
      }
    } else if (err.code === 'ETIMEDOUT' || err.message.includes('timeout')) {
      errorType = 'TIMEOUT_ERROR'
      errorMessage = '连接超时，请稍后重试'
    } else if (err.message && err.message.includes('Network')) {
      errorType = 'NETWORK_ERROR'
      errorMessage = '网络连接失败，请检查网络'
    }
    
    return {
      success: false,
      error: errorMessage,
      errorType: errorType,
      detail: err.message
    }
  }
}