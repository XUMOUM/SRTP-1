/**
 * 云函数：checkAndSendReminders
 * 定时触发器调用：每15分钟检查一次待发送的用药提醒
 * 触发时间窗口：当前时间 ± 7分钟
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 时间窗口配置（分钟）
const TIME_WINDOW = 7;

exports.main = async (event, context) => {
  console.log('[checkAndSendReminders] 开始检查提醒任务', new Date().toISOString());

  try {
    // 1. 获取当前时间
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

    console.log(`[checkAndSendReminders] 当前时间: ${currentTimeStr}`);

    // 2. 获取所有设置了用药提醒的用户
    const { data: medicines } = await db.collection('medicines')
      .where({
        times: db.RegExp({
          regexp: currentTimeStr.substring(0, 4), // 匹配前4位（小时+分钟前1位）
          options: 'i'
        })
      })
      .get();

    console.log(`[checkAndSendReminders] 查询到 ${medicines.length} 条待提醒记录`);

    // 3. 过滤精确匹配的提醒
    const remindersToSend = [];
    
    for (const medicine of medicines) {
      if (!medicine.times || !Array.isArray(medicine.times)) continue;
      
      for (const time of medicine.times) {
        // 精确匹配当前时间（± TIME_WINDOW 分钟窗口）
        if (isTimeWithinWindow(time, currentHour, currentMinute, TIME_WINDOW)) {
          remindersToSend.push({
            openid: medicine._openid,
            medicine: {
              name: medicine.name,
              dosageNumber: medicine.dosageNumber,
              dosageUnit: medicine.dosageUnit
            },
            time: time,
            medicineId: medicine._id
          });
        }
      }
    }

    console.log(`[checkAndSendReminders] 精确匹配到 ${remindersToSend.length} 条提醒`);

    // 4. 批量发送提醒（限流控制）
    const results = {
      total: remindersToSend.length,
      success: 0,
      failed: 0,
      foregroundFallback: 0,
      details: []
    };

    // 使用批处理，每批最多10个（避免超时）
    const batchSize = 10;
    for (let i = 0; i < remindersToSend.length; i += batchSize) {
      const batch = remindersToSend.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (reminder) => {
        try {
          // 检查今天是否已经发送过（避免重复）
          const today = new Date().toDateString();
          const alreadySent = await checkAlreadySent(reminder.openid, reminder.medicine.name, reminder.time, today);
          
          if (alreadySent) {
            console.log(`[checkAndSendReminders] 跳过已发送: ${reminder.openid} - ${reminder.medicine.name}`);
            return { skipped: true, reason: 'already_sent' };
          }

          // 调用发送云函数
          const sendResult = await cloud.callFunction({
            name: 'sendReminderMessage',
            data: {
              openid: reminder.openid,
              medicine: reminder.medicine,
              time: reminder.time
            }
          });

          const result = sendResult.result;
          
          if (result.success) {
            results.success++;
            if (result.strategy === 'foreground_fallback') {
              results.foregroundFallback++;
            }
          } else {
            results.failed++;
          }

          return {
            openid: reminder.openid,
            medicine: reminder.medicine.name,
            time: reminder.time,
            ...result
          };
        } catch (e) {
          console.error(`[checkAndSendReminders] 发送失败:`, e);
          results.failed++;
          return {
            openid: reminder.openid,
            medicine: reminder.medicine.name,
            error: e.message
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.details.push(...batchResults);

      // 批次间延迟，避免触发频率限制
      if (i + batchSize < remindersToSend.length) {
        await delay(1000);
      }
    }

    console.log(`[checkAndSendReminders] 完成: 成功=${results.success}, 失败=${results.failed}, 前台兜底=${results.foregroundFallback}`);

    return {
      success: true,
      checkTime: currentTimeStr,
      totalChecked: medicines.length,
      totalMatched: remindersToSend.length,
      results
    };

  } catch (err) {
    console.error('[checkAndSendReminders] 执行失败:', err);
    return {
      success: false,
      error: err.message,
      stack: err.stack
    };
  }
};

/**
 * 检查时间是否在窗口内
 * @param {string} targetTime - "HH:MM" 格式
 * @param {number} currentHour
 * @param {number} currentMinute
 * @param {number} windowMinutes
 */
function isTimeWithinWindow(targetTime, currentHour, currentMinute, windowMinutes) {
  if (!targetTime || typeof targetTime !== 'string') return false;
  
  const parts = targetTime.split(':');
  if (parts.length !== 2) return false;
  
  const targetHour = parseInt(parts[0], 10);
  const targetMinute = parseInt(parts[1], 10);
  
  if (isNaN(targetHour) || isNaN(targetMinute)) return false;
  
  // 转换为分钟数
  const targetTotal = targetHour * 60 + targetMinute;
  const currentTotal = currentHour * 60 + currentMinute;
  
  // 计算时间差（绝对值）
  const diff = Math.abs(targetTotal - currentTotal);
  
  return diff <= windowMinutes;
}

/**
 * 检查今天是否已经发送过
 */
async function checkAlreadySent(openid, medicineName, time, date) {
  try {
    const { data } = await db.collection('reminder_logs')
      .where({
        _openid: openid,
        medicineName: medicineName,
        scheduledTime: time,
        sentTime: _.gte(new Date(date))
      })
      .limit(1)
      .get();
    
    return data.length > 0;
  } catch (e) {
    console.warn('[checkAndSendReminders] 检查重复发送失败:', e);
    return false; // 默认允许发送（避免漏发）
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
