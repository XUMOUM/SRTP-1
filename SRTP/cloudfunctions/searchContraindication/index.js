// cloudfunctions/searchContraindication/index.js
const cloud = require('wx-server-sdk')
cloud.init()

// 模拟CMeKG知识图谱数据（实际应该连接CMeKG API或数据库）
const contraindicationDB = [
  { name: '糖尿病', description: '血糖代谢异常，避免含糖药物', keywords: ['糖尿', '血糖', '胰岛素'] },
  { name: '高血压', description: '血压偏高，避免升压药物', keywords: ['血压', '高压'] },
  { name: '肾衰竭', description: '肾功能不全，避免肾毒性药物', keywords: ['肾', '肌酐'] },
  { name: '肝功能不全', description: '肝脏代谢障碍，避免肝损药物', keywords: ['肝', '转氨酶'] },
  { name: '过敏', description: '对特定成分过敏', keywords: ['过敏', '皮疹'] },
  { name: '哮喘', description: '呼吸道痉挛，避免β受体阻滞剂', keywords: ['哮喘', '喘息'] },
  { name: '胃溃疡', description: '胃黏膜损伤，避免NSAIDs', keywords: ['胃', '溃疡'] },
  { name: '孕妇', description: '妊娠期，避免致畸药物', keywords: ['孕妇', '妊娠', '怀孕'] },
  { name: '哺乳期', description: '哺乳期，避免通过乳汁影响婴儿', keywords: ['哺乳', '母乳'] },
  { name: '青光眼', description: '眼压升高，避免抗胆碱药物', keywords: ['青光眼', '眼压'] }
]

exports.main = async (event, context) => {
  const { keyword } = event
  
  try {
    // 模糊匹配
    const results = contraindicationDB.filter(item => 
      item.name.includes(keyword) || 
      item.keywords.some(k => k.includes(keyword))
    )
    
    return {
      success: true,
      data: results
    }
  } catch (err) {
    return {
      success: false,
      error: err.message
    }
  }
}