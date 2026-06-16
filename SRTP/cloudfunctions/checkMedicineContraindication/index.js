// 云函数入口文件
const cloud = require('wx-server-sdk')

// 初始化 cloud，设定为动态获取当前环境
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 禁忌匹配纯函数（已抽离，便于单元测试）
const { analyzeContraindications } = require('./analyzer.js')
const { buildLookupNames, pickBestMedicine } = require('./medicineResolve.js')

async function lookupMedicine(db, queryName) {
  const namesToTry = buildLookupNames(queryName)

  for (const q of namesToTry) {
    const exactRes = await db.collection('cme_kg_medicines').where({ name: q }).limit(1).get()
    if (exactRes.data.length > 0) {
      return exactRes.data[0]
    }

    const aliasRes = await db.collection('cme_kg_medicines').where({ aliases: q }).limit(1).get()
    if (aliasRes.data.length > 0) {
      return aliasRes.data[0]
    }

    const fuzzyRes = await db.collection('cme_kg_medicines').where({
      name: db.RegExp({ regexp: q, options: 'i' })
    }).limit(20).get()

    const best = pickBestMedicine(fuzzyRes.data, queryName)
    if (best) return best
  }

  return null
}

// 云函数入口函数
exports.main = async (event, context) => {
  // 接收前端传来的三个关键参数
  const { newMedicineName, currentMedicines = [], userDiseases = [], userAllergies = [] } = event

  try {
    // 1. 图谱检索：原药名 → 剥离剂型后的核心名（如 阿司匹林肠溶片 → 阿司匹林）
    const kgData = await lookupMedicine(db, newMedicineName)

    // 如果图谱里没这个药，直接放行
    if (!kgData) {
      return { 
        code: 0, 
        hasWarning: false, 
        msg: '图谱库中暂无该药品数据，请遵医嘱服用', 
        warnings: [] 
      }
    }

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