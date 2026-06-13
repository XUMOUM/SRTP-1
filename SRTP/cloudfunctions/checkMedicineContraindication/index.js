// 云函数入口文件
const cloud = require('wx-server-sdk')

// 初始化 cloud，设定为动态获取当前环境
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 禁忌匹配纯函数（已抽离，便于单元测试）
const { analyzeContraindications } = require('./analyzer.js')

// 云函数入口函数
exports.main = async (event, context) => {
  // 接收前端传来的三个关键参数
  const { newMedicineName, currentMedicines = [], userDiseases = [], userAllergies = [] } = event

  try {
    // 1. 图谱检索：在 CMeKG 集合中寻找准备添加的“新药”
    const medRes = await db.collection('cme_kg_medicines').where(_.or([
      { name: db.RegExp({ regexp: newMedicineName, options: 'i' }) }, 
      { aliases: newMedicineName } 
    ])).get()

    // 如果图谱里没这个药，直接放行
    if (medRes.data.length === 0) {
      return { 
        code: 0, 
        hasWarning: false, 
        msg: '图谱库中暂无该药品数据，请遵医嘱服用', 
        warnings: [] 
      }
    }

    const kgData = medRes.data[0]

    // 2. 风险研判（病史禁忌 / 过敏史 / 同服相互作用）
    const warnings = analyzeContraindications(kgData, {
      currentMedicines,
      userDiseases,
      userAllergies
    })

    // 3. 汇总并返回研判结果
    if (warnings.length > 0) {
      return { 
        code: 1, 
        hasWarning: true, 
        msg: '发现潜在用药风险！',
        warnings: warnings 
      }
    } else {
      return { 
        code: 1, 
        hasWarning: false, 
        msg: '未发现明显用药禁忌，安全性评估通过', 
        warnings: [] 
      }
    }

  } catch (err) {
    console.error('禁忌分析云函数运行异常:', err)
    return { code: -1, hasWarning: false, msg: '禁忌分析服务异常', warnings: [], error: err.message }
  }
}