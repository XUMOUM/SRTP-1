/**
 * 订阅消息辅助工具
 * 实现一次性订阅的循环索要机制
 * 在关键用户行为点（打卡、添加药品等）触发订阅授权请求
 */

const SUBSCRIPTION_CONFIG = {
  // 模板ID（需在微信公众平台申请）
  TEMPLATES: {
    REMINDER: 'YOUR_ONE_TIME_TEMPLATE_ID', // 用药提醒模板
  },
  
  // 授权请求间隔（毫秒）- 避免频繁打扰
  REQUEST_COOLDOWN: 24 * 60 * 60 * 1000, // 24小时内不重复请求
  
  // 最大请求次数
  MAX_REQUESTS: 50
};

/**
 * 检查是否需要请求订阅授权
 */
function shouldRequestSubscription() {
  const lastRequestTime = wx.getStorageSync('lastSubscriptionRequest') || 0;
  const requestCount = wx.getStorageSync('subscriptionRequestCount') || 0;
  const now = Date.now();
  
  // 检查冷却期
  if (now - lastRequestTime < SUBSCRIPTION_CONFIG.REQUEST_COOLDOWN) {
    return { should: false, reason: 'cooldown' };
  }
  
  // 检查请求次数
  if (requestCount >= SUBSCRIPTION_CONFIG.MAX_REQUESTS) {
    return { should: false, reason: 'max_reached' };
  }
  
  return { should: true };
}

/**
 * 记录订阅请求
 */
function recordSubscriptionRequest() {
  const now = Date.now();
  const count = wx.getStorageSync('subscriptionRequestCount') || 0;
  
  wx.setStorageSync('lastSubscriptionRequest', now);
  wx.setStorageSync('subscriptionRequestCount', count + 1);
}

/**
 * 请求订阅授权（一次性订阅）
 * @param {Object} options - 配置选项
 * @param {string} options.scenario - 场景标识（如'after_checkin', 'after_add_medicine'）
 * @param {Function} options.onSuccess - 成功回调
 * @param {Function} options.onFail - 失败回调
 * @param {boolean} options.force - 是否强制请求（无视冷却期）
 */
function requestSubscription(options = {}) {
  const { scenario = 'default', onSuccess, onFail, force = false } = options;
  
  // 检查是否需要请求
  if (!force) {
    const check = shouldRequestSubscription();
    if (!check.should) {
      console.log(`[subscriptionHelper] 跳过订阅请求: ${check.reason}`);
      if (onFail) onFail({ reason: check.reason, skipped: true });
      return;
    }
  }
  
  // 获取场景提示语
  const messages = getScenarioMessages(scenario);
  
  // 先显示引导弹窗，说明订阅的用途
  wx.showModal({
    title: messages.title,
    content: messages.content,
    confirmText: '开启提醒',
    cancelText: '暂不需要',
    success: (res) => {
      if (res.confirm) {
        // 用户同意，调用微信API请求订阅
        wx.requestSubscribeMessage({
          tmplIds: [SUBSCRIPTION_CONFIG.TEMPLATES.REMINDER],
          success: (subRes) => {
            console.log('[subscriptionHelper] 订阅请求结果:', subRes);
            
            recordSubscriptionRequest();
            
            // 处理结果
            const acceptStatus = subRes[SUBSCRIPTION_CONFIG.TEMPLATES.REMINDER];
            
            if (acceptStatus === 'accept') {
              // 用户接受
              recordUserSubscription('accepted');
              wx.showToast({ title: '已开启提醒', icon: 'success' });
              if (onSuccess) onSuccess({ status: 'accepted' });
            } else if (acceptStatus === 'reject') {
              // 用户拒绝
              recordUserSubscription('rejected');
              wx.showToast({ title: '您可在"我的"页面重新开启', icon: 'none' });
              if (onFail) onFail({ status: 'rejected' });
            } else if (acceptStatus === 'ban') {
              // 用户被禁用订阅
              recordUserSubscription('banned');
              if (onFail) onFail({ status: 'banned' });
            }
          },
          fail: (err) => {
            console.error('[subscriptionHelper] 订阅请求失败:', err);
            if (onFail) onFail({ status: 'error', error: err });
          }
        });
      } else {
        // 用户在引导弹窗取消
        if (onFail) onFail({ status: 'cancelled_at_guide' });
      }
    }
  });
}

/**
 * 根据场景获取提示语
 */
function getScenarioMessages(scenario) {
  const messages = {
    default: {
      title: '开启用药提醒',
      content: '订阅后我们将在您设置的用药时间通过消息提醒您，不再错过服药时间。'
    },
    after_checkin: {
      title: '下次用药提醒',
      content: '检测到您还有未完成的用药计划，开启提醒后我们会在下次用药时间通知您。'
    },
    after_add_medicine: {
      title: '新药品提醒',
      content: '新药品已添加成功！开启提醒后我们会按时通知您服用新药。'
    },
    before_important: {
      title: '重要用药提醒',
      content: '您有重要药品需要按时服用，建议开启提醒以确保治疗效果。'
    }
  };
  
  return messages[scenario] || messages.default;
}

/**
 * 记录用户订阅状态到本地和云端
 */
function recordUserSubscription(status) {
  // 本地记录
  wx.setStorageSync('userSubscriptionStatus', {
    status: status,
    updateTime: Date.now()
  });
  
  // 云端记录（静默同步）
  syncSubscriptionToCloud(status);
}

/**
 * 同步订阅状态到云端
 */
function syncSubscriptionToCloud(status) {
  wx.cloud.callFunction({
    name: 'updateSubscription',
    data: {
      action: 'updateStatus',
      status: status,
      updateTime: Date.now()
    },
    success: (res) => {
      console.log('[subscriptionHelper] 订阅状态已同步到云端');
    },
    fail: (err) => {
      console.warn('[subscriptionHelper] 订阅状态同步失败:', err);
    }
  });
}

/**
 * 计算下次需要索要授权的时间点
 * @param {Array} medicineList - 用户的药品列表
 * @returns {string|null} - 下次索要的时间点描述
 */
function calculateNextSubscriptionRequest(medicineList) {
  if (!medicineList || medicineList.length === 0) return null;
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  // 收集所有用药时间点
  const allTimes = [];
  medicineList.forEach(med => {
    if (med.times && Array.isArray(med.times)) {
      med.times.forEach(time => {
        const [h, m] = time.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) {
          allTimes.push({ time, minutes: h * 60 + m, medicine: med.name });
        }
      });
    }
  });
  
  // 找出距离现在最近的下一个时间点
  let nextTime = null;
  let minDiff = Infinity;
  
  allTimes.forEach(t => {
    let diff = t.minutes - currentMinutes;
    if (diff < 0) diff += 24 * 60; // 跨天
    
    if (diff > 5 && diff < minDiff) { // 至少5分钟后
      minDiff = diff;
      nextTime = t;
    }
  });
  
  return nextTime;
}

/**
 * 智能索要：在打卡后请求下次用药的订阅授权
 * @param {Array} medicineList - 药品列表
 * @param {string} justCheckedMedicine - 刚刚打卡的药品名称
 */
function requestSubscriptionAfterCheckin(medicineList, justCheckedMedicine) {
  const nextTime = calculateNextSubscriptionRequest(medicineList);
  
  if (!nextTime) {
    console.log('[subscriptionHelper] 没有后续用药计划，跳过订阅请求');
    return;
  }
  
  // 如果下次用药是同一药品，不重复请求
  if (nextTime.medicine === justCheckedMedicine) {
    console.log('[subscriptionHelper] 下次是同一药品，跳过订阅请求');
    return;
  }
  
  // 格式化时间显示
  const hours = Math.floor(minDiff / 60);
  const minutes = minDiff % 60;
  const timeText = hours > 0 ? `${hours}小时${minutes}分钟后` : `${minutes}分钟后`;
  
  // 延迟请求（让用户先完成当前打卡的反馈）
  setTimeout(() => {
    requestSubscription({
      scenario: 'after_checkin',
      onSuccess: (res) => {
        console.log('[subscriptionHelper] 打卡后订阅成功');
      },
      onFail: (err) => {
        console.log('[subscriptionHelper] 打卡后订阅失败:', err);
      }
    });
  }, 1500);
}

/**
 * 获取用户订阅状态
 */
function getUserSubscriptionStatus() {
  const localStatus = wx.getStorageSync('userSubscriptionStatus');
  const lastRequest = wx.getStorageSync('lastSubscriptionRequest');
  const requestCount = wx.getStorageSync('subscriptionRequestCount');
  
  return {
    local: localStatus,
    lastRequestTime: lastRequest,
    requestCount: requestCount,
    canRequest: shouldRequestSubscription().should
  };
}

/**
 * 重置订阅请求计数（用于调试或用户手动重置）
 */
function resetSubscriptionRequestCount() {
  wx.removeStorageSync('subscriptionRequestCount');
  wx.removeStorageSync('lastSubscriptionRequest');
}

module.exports = {
  requestSubscription,
  requestSubscriptionAfterCheckin,
  getUserSubscriptionStatus,
  calculateNextSubscriptionRequest,
  resetSubscriptionRequestCount,
  CONFIG: SUBSCRIPTION_CONFIG
};
