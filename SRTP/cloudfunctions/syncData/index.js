/**
 * 云函数：syncData
 * 处理SyncManager的云端同步请求
 * 支持：write、delete、get、batchGet操作
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 集合名称映射
const COLLECTION_MAP = {
  'medicine_': 'medicines',
  'health_': 'health_profiles',
  'record_': 'medication_records',
  'profile_': 'user_profiles'
};

exports.main = async (event, context) => {
  const { action, key, data, keys, localTimestamp } = event;
  const { OPENID } = cloud.getWXContext();

  if (!OPENID) {
    return { success: false, error: 'NO_OPENID' };
  }

  try {
    switch (action) {
      case 'get':
        return await getData(key, OPENID, localTimestamp);
      case 'batchGet':
        return await batchGetData(keys, OPENID);
      case 'write':
        return await writeData(key, data, OPENID);
      case 'delete':
        return await deleteData(key, OPENID);
      case 'syncFromCloud':
        return await syncFromCloud(key, OPENID, localTimestamp);
      default:
        return { success: false, error: 'UNKNOWN_ACTION' };
    }
  } catch (err) {
    console.error('[syncData] 执行失败:', err);
    return { success: false, error: err.message };
  }
};

/**
 * 获取单个数据（用于冲突校验）
 */
async function getData(key, openid, localTimestamp) {
  const collectionName = getCollectionName(key);
  if (!collectionName) {
    return { success: false, error: 'UNKNOWN_KEY_TYPE' };
  }

  try {
    const { data } = await db.collection(collectionName)
      .where({
        _openid: openid,
        _key: key
      })
      .limit(1)
      .get();

    if (data.length > 0) {
      return {
        success: true,
        data: data[0],
        cloudTimestamp: data[0]._cloudTimestamp || 0
      };
    }

    return { success: true, data: null };
  } catch (e) {
    console.error('[syncData] getData失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 批量获取数据
 */
async function batchGetData(keys, openid) {
  const results = {};

  for (const key of keys) {
    const collectionName = getCollectionName(key);
    if (!collectionName) continue;

    try {
      const { data } = await db.collection(collectionName)
        .where({
          _openid: openid,
          _key: key
        })
        .limit(1)
        .get();

      if (data.length > 0) {
        results[key] = data[0];
      }
    } catch (e) {
      console.warn(`[syncData] 批量获取失败: ${key}`, e);
    }
  }

  return { success: true, data: results };
}

/**
 * 写入/更新数据（UPSERT）
 */
async function writeData(key, data, openid) {
  const collectionName = getCollectionName(key);
  if (!collectionName) {
    return { success: false, error: 'UNKNOWN_KEY_TYPE' };
  }

  try {
    // 查询是否已存在
    const { data: existing } = await db.collection(collectionName)
      .where({
        _openid: openid,
        _key: key
      })
      .limit(1)
      .get();

    const cloudData = {
      ...data,
      _openid: openid,
      _key: key,
      _cloudTimestamp: Date.now(),
      _syncVersion: (data._version || 0) + 1
    };

    if (existing.length > 0) {
      // 更新
      await db.collection(collectionName).doc(existing[0]._id).update({
        data: cloudData
      });
    } else {
      // 新增
      await db.collection(collectionName).add({
        data: cloudData
      });
    }

    return {
      success: true,
      cloudTimestamp: cloudData._cloudTimestamp
    };
  } catch (e) {
    console.error('[syncData] writeData失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 删除数据
 */
async function deleteData(key, openid) {
  const collectionName = getCollectionName(key);
  if (!collectionName) {
    return { success: false, error: 'UNKNOWN_KEY_TYPE' };
  }

  try {
    const { data } = await db.collection(collectionName)
      .where({
        _openid: openid,
        _key: key
      })
      .limit(1)
      .get();

    if (data.length > 0) {
      await db.collection(collectionName).doc(data[0]._id).remove();
    }

    return { success: true };
  } catch (e) {
    console.error('[syncData] deleteData失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 从云端同步列表数据（增量同步）
 */
async function syncFromCloud(keyPrefix, openid, localTimestamp) {
  const collectionName = getCollectionName(keyPrefix);
  if (!collectionName) {
    return { success: false, error: 'UNKNOWN_KEY_TYPE' };
  }

  try {
    // 查询云端更新的数据
    const { data } = await db.collection(collectionName)
      .where({
        _openid: openid,
        _key: db.RegExp({ regexp: '^' + keyPrefix }),
        _cloudTimestamp: _.gt(localTimestamp || 0)
      })
      .get();

    return {
      success: true,
      data: data,
      count: data.length
    };
  } catch (e) {
    console.error('[syncData] syncFromCloud失败:', e);
    return { success: false, error: e.message };
  }
}

/**
 * 根据key前缀判断集合名称
 */
function getCollectionName(key) {
  for (const prefix in COLLECTION_MAP) {
    if (key.startsWith(prefix)) {
      return COLLECTION_MAP[prefix];
    }
  }
  // 默认集合
  return 'sync_data';
}
