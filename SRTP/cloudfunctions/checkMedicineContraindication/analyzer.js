/**
 * 禁忌分析纯函数（无外部依赖，便于单元测试）
 * 给定 CMeKG 图谱中某药品节点数据与用户画像，产出风险预警列表。
 */

/**
 * @param {Object} kgData - cme_kg_medicines 中的药品文档
 * @param {Object} profile - { currentMedicines: string[], userDiseases: string[], userAllergies: string[] }
 * @returns {Array} warnings
 */
function analyzeContraindications(kgData, profile) {
  const {
    currentMedicines = [],
    userDiseases = [],
    userAllergies = []
  } = profile || {};

  const warnings = [];
  if (!kgData) return warnings;

  // 1. 个人病史禁忌
  if (kgData.contraindications && kgData.contraindications.diseases) {
    const diseaseConflicts = kgData.contraindications.diseases.filter(d =>
      userDiseases.some(ud => ud.includes(d) || d.includes(ud))
    );
    if (diseaseConflicts.length > 0) {
      warnings.push({
        type: 'disease',
        level: '高危',
        title: '个人病史禁忌预警',
        detail: `根据您的健康档案，该药物禁用于【${diseaseConflicts.join('、')}】患者，可能引发严重不良反应！`
      });
    }
  }

  // 2. 过敏史碰撞
  if (kgData.contraindications && kgData.contraindications.allergies && userAllergies.length > 0) {
    const allergyConflicts = kgData.contraindications.allergies.filter(a =>
      userAllergies.some(ua => ua.includes(a) || a.includes(ua))
    );
    if (allergyConflicts.length > 0) {
      warnings.push({
        type: 'allergy',
        level: '高危',
        title: '过敏风险预警',
        detail: `您对【${allergyConflicts.join('、')}】过敏，该药物可能含有相关成分，建议立即停药咨询医生！`
      });
    }
  }

  // 3. 同服药物相互作用
  if (kgData.interactions && kgData.interactions.length > 0 && currentMedicines.length > 0) {
    kgData.interactions.forEach(interaction => {
      const isConflict = currentMedicines.some(oldMed =>
        oldMed.includes(interaction.target_drug) || interaction.target_drug.includes(oldMed)
      );
      if (isConflict) {
        warnings.push({
          type: 'interaction',
          level: interaction.risk_level === '高' ? '高危' : '中风险',
          title: '同服冲突预警',
          detail: `与计划中的【${interaction.target_drug}】存在冲突：${interaction.mechanism}。建议：${interaction.advice}`
        });
      }
    });
  }

  return warnings;
}

module.exports = { analyzeContraindications };
