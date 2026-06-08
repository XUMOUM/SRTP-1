/**
 * 云函数：sendReminderMessage（用药提醒发送）
 * 实现三层降级策略：
 * 1. 长期订阅消息（如有权限）
 * 2. 一次性订阅消息（循环索要）
 * 3. 前台兜底（记录待提醒，由前台震动+弹窗处理）
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 模板ID配置（需在微信公众平台申请）
const TEMPLATES = {
  // 长期订阅模板（如有权限）
  LONG_TERM: 'YOUR_LONG_TERM_TEMPLATE_ID',
  // 一次性订阅模板
  ONE_TIME: 'YOUR_ONE_TIME_TEMPLATE_ID',
  // 备用模板（如果主模板审核中）
  BACKUP: 'YOUR_BACKUP_TEMPLATE_ID'
};

// 获取access_token（缓存2小时）
let accessToken = null;
let tokenExpireTime = 0;

async function getAccessToken() {
  const now = Date.now();
  if (accessToken && tokenExpireTime > now) {
    return accessToken;
  }
  
  try {
    const res = await cloud.openapi.auth.getAccessToken();
    accessToken = res.accessToken;
    tokenExpireTime = now + (res.expiresIn * 1000) - 300000;
    return accessToken;
  } catch (e) {
    console.error('[sendReminderMessage] 获取access_token失败:', e);
    throw e;
  }
}

/**
 * 检查用户的订阅权限状态
 */
async function checkSubscriptionStatus(openid) {
  try {
    const { data } = await db.collection('userSubscriptions')
      .where({ _openid: openid })
      .limit(1)
      .get();

    if (data.length > 0) {
      return {
        hasLongTerm: data[0].longTermValid || false,
        oneTimeCount: data[0].oneTimeCount || 0,
        lastSubscriptionTime: data[0].lastSubscriptionTime || 0
      };
    }

    return { hasLongTerm: false, oneTimeCount: 0, lastSubscriptionTime: 0 };
  } catch (e) {
    console.warn('[sendReminderMessage] 查询订阅状态失败:', e);
    return { hasLongTerm: false, oneTimeCount: 0, lastSubscriptionTime: 0 };
  }
}

/**
 * 第一层：发送长期订阅消息
 */
async function sendLongTermMessage(openid, medicine, time) {
  try {
    if (!TEMPLATES.LONG_TERM || TEMPLATES.LONG_TERM === 'YOUR_LONG_TERM_TEMPLATE_ID') {
      return { success: false, level: 1, error: 'LONG_TERM_TEMPLATE_NOT_CONFIGURED' };
    }

    const result = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: TEMPLATES.LONG_TERM,
      page: 'packageA/pages/reminder/reminder?auto=true&medicine=' + encodeURIComponent(medicine.name),
      data: formatTemplateData(medicine, time),
      miniprogramState: 'formal'
    });

    // 记录发送日志
    await logReminder(openid, medicine, time, 'long_term', true);

    return { success: true, level: 1, result };
  } catch (e) {
    console.error('[sendReminderMessage] 长期订阅消息失败:', e);
    
    // 如果是权限错误，标记长期订阅失效
    if (e.errCode === 43101) {
      await db.collection('userSubscriptions').where({ _openid: openid }).update({
        data: { longTermValid: false, updateTime: Date.now() }
      });
    }

    return { success: false, level: 1, error: e.errCode || e.message };
  }
}

/**
 * 第二层：发送一次性订阅消息
 * 注意：一次性订阅需要用户提前授权，这里检查是否有可用的授权
 */
async function sendOneTimeMessage(openid, medicine, time) {
  try {
    if (!TEMPLATES.ONE_TIME || TEMPLATES.ONE_TIME === 'YOUR_ONE_TIME_TEMPLATE_ID') {
      return { success: false, level: 2, error: 'ONE_TIME_TEMPLATE_NOT_CONFIGURED' };
    }

    // 检查用户是否有可用的一次性订阅授权
    const subStatus = await checkSubscriptionStatus(openid);
    
    // 如果没有可用的授权，返回失败（由上层处理索要逻辑）
    if (subStatus.oneTimeCount <= 0) {
      return { 
        success: false, 
        level: 2, 
        error: 'NO_ONE_TIME_AUTH',
        needRequestAuth: true
      };
    }

    const result = await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: TEMPLATES.ONE_TIME,
      page: 'packageA/pages/reminder/reminder?auto=true&medicine=' + encodeURIComponent(medicine.name),
      data: formatTemplateData(medicine, time),
      miniprogramState: 'formal'
    });

    // 扣减一次性授权次数
    await db.collection('userSubscriptions').where({ _openid: openid }).update({
      data: { 
        oneTimeCount: _.inc(-1),
        lastSendTime: Date.now()
      }
    });

    // 记录发送日志
    await logReminder(openid, medicine, time, 'one_time', true);

    return { success: true, level: 2, result };
  } catch (e) {
    console.error('[sendReminderMessage] 一次性订阅消息失败:', e);

    // 授权已使用或过期
    if (e.errCode === 43101) {
      await db.collection('userSubscriptions').where({ _openid: openid }).update({
        data: { oneTimeCount: 0, updateTime: Date.now() }
      });
    }

    return { success: false, level: 2, error: e.errCode || e.message };
  }
}

/**
 * 第三层：前台兜底（记录待提醒，由前台处理）
 */
async function fallbackToForeground(openid, medicine, time) {
  try {
    // 写入前台提醒队列
    await db.collection('foregroundReminders').add({
      data: {
        _openid: openid,
        medicine: medicine,
        scheduledTime: time,
        status: 'pending',
        createTime: Date.now(),
        _cloudTimestamp: Date.now()
      }
    });

    // 记录发送日志（标记为前台兜底）
    await logReminder(openid, medicine, time, 'foreground', false);

    return { 
      success: true, 
      level: 3, 
      fallback: true,
      message: '已记录前台提醒'
    };
  } catch (e) {
    console.error('[sendReminderMessage] 前台兜底失败:', e);
    return { success: false, level: 3, error: e.message };
  }
}

/**
 * 格式化模板数据
 */
function formatTemplateData(medicine, time) {
  return {
    "time1": { "value": time },
    "thing2": { "value": medicine.name || '未命名药品' },
    "thing3": { 
      "value": (medicine.dosageNumber || '1') + (medicine.dosageUnit || '片') 
    },
    "thing4": { "value": "已到达用药提醒时间，请及时服药" }
  };
}

/**
 * 记录提醒日志
 */
async function logReminder(openid, medicine, time, type, sent) {
  try {
    await db.collection('reminder_logs').add({
      data: {
        _openid: openid,
        medicineName: medicine.name,
        scheduledTime: time,
        sentTime: new Date(),
        type: type,
        sent: sent,
        _cloudTimestamp: Date.now()
      }
    });
  } catch (e) {
    console.warn('[sendReminderMessage] 记录日志失败:', e);
  }
}

/**
 * 主入口：三层降级策略
 */
exports.main = async (event, context) => {
  const { openid, medicine, time, strategy = 'auto' } = event;
  
  if (!openid || !medicine || !time) {
    return { 
      success: false, 
      error: 'MISSING_PARAMS',
      message: '缺少必要参数: openid, medicine, time'
    };
  }

  console.log(`[sendReminderMessage] 发送提醒给 ${openid}, 药品: ${medicine.name}, 时间: ${time}`);

  const results = {
    attempts: [],
    final: null
  };

  // 策略1：强制长期订阅
  if (strategy === 'long_term_only') {
    const result = await sendLongTermMessage(openid, medicine, time);
    results.attempts.push(result);
    results.final = result;
    return results;
  }

  // 策略2：强制一次性订阅
  if (strategy === 'one_time_only') {
    const result = await sendOneTimeMessage(openid, medicine, time);
    results.attempts.push(result);
    results.final = result;
    return results;
  }

  // 策略3：自动降级（默认）
  // 第1层：尝试长期订阅
  const level1Result = await sendLongTermMessage(openid, medicine, time);
  results.attempts.push(level1Result);
  
  if (level1Result.success) {
    results.final = level1Result;
    return { success: true, strategy: 'long_term', results };
  }

  // 第2层：尝试一次性订阅
  const level2Result = await sendOneTimeMessage(openid, medicine, time);
  results.attempts.push(level2Result);

  if (level2Result.success) {
    results.final = level2Result;
    return { success: true, strategy: 'one_time', results };
  }

  // 如果需要索要授权，返回提示
  if (level2Result.needRequestAuth) {
    return { 
      success: false, 
      strategy: 'need_auth',
      needRequestAuth: true,
      message: '需要用户授权订阅消息',
      results 
    };
  }

  // 第3层：前台兜底
  const level3Result = await fallbackToForeground(openid, medicine, time);
  results.attempts.push(level3Result);
  results.final = level3Result;

  return { 
    success: level3Result.success, 
    strategy: 'foreground_fallback',
    results 
  };
};
