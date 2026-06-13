/**
 * 云函数：getFriendMedicationStatus
 * 家人监督闭环：在“已建立 accepted 好友关系”的授权前提下，
 * 返回指定好友的当日用药完成情况（汇总 + 各时段明细）。
 *
 * 授权模型：好友关系双向 accepted 即视为已授权查看用药状态。
 * 数据来源：
 *   - medicines           好友的药品清单（times 数组 = 当日各服药时刻）
 *   - medication_records  好友的打卡记录（_key = record_YYYY-MM-DD_<medicineId>_<time>）
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function todayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

exports.main = async (event, context) => {
  const { friendOpenid } = event;
  const { OPENID } = cloud.getWXContext();

  if (!OPENID) return { success: false, error: 'NO_OPENID' };
  if (!friendOpenid) return { success: false, error: 'MISSING_FRIEND_OPENID' };

  try {
    // 1. 授权校验：当前用户与目标必须是 accepted 好友
    const rel = await db.collection('friends').where({
      userId: OPENID,
      friendId: friendOpenid,
      status: 'accepted'
    }).limit(1).get();

    if (rel.data.length === 0) {
      return { success: false, error: 'NOT_AUTHORIZED', message: '未建立好友关系，无权查看' };
    }

    // 2. 拉取好友药品清单
    const medRes = await db.collection('medicines').where({ _openid: friendOpenid }).get();
    const medicines = medRes.data || [];

    // 3. 拉取好友今日打卡记录
    const date = todayStr();
    const recRes = await db.collection('medication_records').where({
      _openid: friendOpenid,
      date: date,
      completed: true
    }).get();

    // slotId -> markedTime 映射（slotId = 药品id_时刻）
    const completedMap = {};
    (recRes.data || []).forEach(r => {
      if (r.slotId) completedMap[r.slotId] = r.markedTime || '';
    });

    // 4. 展开为时段明细
    const slots = [];
    medicines.forEach(med => {
      const times = Array.isArray(med.times) ? med.times : [];
      times.forEach(time => {
        const slotId = `${med.id}_${time}`;
        const completed = Object.prototype.hasOwnProperty.call(completedMap, slotId);
        slots.push({
          time: time,
          name: med.name || '未命名药品',
          dosage: (med.dosageNumber || '') + (med.dosageUnit || ''),
          instruction: med.instruction || '',
          completed: completed,
          markedTime: completed ? completedMap[slotId] : ''
        });
      });
    });

    slots.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

    const todayTotal = slots.length;
    const todayCompleted = slots.filter(s => s.completed).length;

    return {
      success: true,
      data: {
        todayTotal,
        todayCompleted,
        medicines: slots
      }
    };
  } catch (err) {
    console.error('[getFriendMedicationStatus] 执行失败:', err);
    return { success: false, error: err.message };
  }
};
