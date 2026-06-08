/**
 * 云函数：updateSubscription
 * 更新用户的订阅授权状态
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, status, updateTime, addCount = 0 } = event;
  const { OPENID } = cloud.getWXContext();
  
  if (!OPENID) {
    return { success: false, error: 'NO_OPENID' };
  }

  try {
    switch (action) {
      case 'updateStatus':
        return await updateStatus(OPENID, status, updateTime);
      case 'addOneTimeCount':
        return await addOneTimeCount(OPENID, addCount);
      case 'getStatus':
        return await getStatus(OPENID);
      default:
        return { success: false, error: 'UNKNOWN_ACTION' };
    }
  } catch (err) {
    console.error('[updateSubscription] 执行失败:', err);
    return { success: false, error: err.message };
  }
};

/**
 * 更新用户订阅状态
 */
async function updateStatus(openid, status, updateTime) {
  try {
    const collection = db.collection('userSubscriptions');
    
    // 查询是否存在
    const { data } = await collection.where({ _openid: openid }).limit(1).get();
    
    const docData = {
      lastStatus: status,
      updateTime: updateTime || Date.now()
    };
    
    if (data.length > 0) {
      // 更新
      await collection.doc(data[0]._id).update({ data: docData });
    } else {
      // 新增
      await collection.add({
        data: {
          _openid: openid,
          longTermValid: false,
          oneTimeCount: 0,
          ...docData
        }
      });
    }
    
    return { success: true };
  } catch (e) {
    console.error('[updateSubscription] updateStatus失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 增加一次性订阅授权次数
 * 当用户点击"接受"订阅时调用
 */
async function addOneTimeCount(openid, count) {
  try {
    const collection = db.collection('userSubscriptions');
    
    const { data } = await collection.where({ _openid: openid }).limit(1).get();
    
    if (data.length > 0) {
      await collection.doc(data[0]._id).update({
        data: {
          oneTimeCount: _.inc(count),
          lastSubscriptionTime: Date.now()
        }
      });
    } else {
      await collection.add({
        data: {
          _openid: openid,
          longTermValid: false,
          oneTimeCount: count,
          lastSubscriptionTime: Date.now(),
          lastStatus: 'accepted'
        }
      });
    }
    
    return { success: true };
  } catch (e) {
    console.error('[updateSubscription] addOneTimeCount失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 获取用户订阅状态
 */
async function getStatus(openid) {
  try {
    const { data } = await db.collection('userSubscriptions')
      .where({ _openid: openid })
      .limit(1)
      .get();
    
    if (data.length > 0) {
      return {
        success: true,
        data: {
          longTermValid: data[0].longTermValid || false,
          oneTimeCount: data[0].oneTimeCount || 0,
          lastStatus: data[0].lastStatus,
          updateTime: data[0].updateTime
        }
      };
    }
    
    return {
      success: true,
      data: {
        longTermValid: false,
        oneTimeCount: 0,
        lastStatus: null
      }
    };
  } catch (e) {
    console.error('[updateSubscription] getStatus失败:', e);
    return { success: false, error: e.message };
  }
}
