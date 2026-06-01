// 云函数入口文件
const cloud = require('wx-server-sdk')

// 初始化 cloud，设定为动态获取当前环境
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
    let warnings = []

    // 2. 第一层碰撞：个人病史禁忌
    if (kgData.contraindications && kgData.contraindications.diseases) {
      const diseaseConflicts = kgData.contraindications.diseases.filter(d => 
        userDiseases.some(ud => ud.includes(d) || d.includes(ud))
      )
      
      if (diseaseConflicts.length > 0) {
        warnings.push({
          type: 'disease',
          level: '高危',
          title: '个人病史禁忌预警',
          detail: `根据您的健康档案，该药物禁用于【${diseaseConflicts.join('、')}】患者，可能引发严重不良反应！`
        })
      }
    }

    // 2.1 过敏史碰撞
    if (kgData.contraindications && kgData.contraindications.allergies && userAllergies.length > 0) {
      const allergyConflicts = kgData.contraindications.allergies.filter(a =>
        userAllergies.some(ua => ua.includes(a) || a.includes(ua))
      )
      
      if (allergyConflicts.length > 0) {
        warnings.push({
          type: 'allergy',
          level: '高危',
          title: '过敏风险预警',
          detail: `您对【${allergyConflicts.join('、')}】过敏，该药物可能含有相关成分，建议立即停药咨询医生！`
        })
      }
    }

    // 3. 第二层碰撞：同服药物相互作用
    if (kgData.interactions && kgData.interactions.length > 0 && currentMedicines.length > 0) {
      kgData.interactions.forEach(interaction => {
        // 检查当前用药列表中，是否包含冲突目标药
        const isConflict = currentMedicines.some(oldMed => 
          oldMed.includes(interaction.target_drug) || interaction.target_drug.includes(oldMed)
        )
        
        if (isConflict) {
          warnings.push({
            type: 'interaction',
            level: interaction.risk_level === '高' ? '高危' : '中风险',
            title: '同服冲突预警',
            detail: `与计划中的【${interaction.target_drug}】存在冲突：${interaction.mechanism}。建议：${interaction.advice}`
          })
        }
      })
    }

    // 4. 汇总并返回研判结果
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
    return { code: -1, msg: '禁忌分析服务异常', error: err }
  }
}