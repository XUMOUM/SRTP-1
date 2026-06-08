/**
 * SyncManager - 离线优先数据同步管理器
 * 实现"本地优先，云端同步"策略，支持弱网环境
 * 冲突解决策略：Last-Write-Wins（时间戳优先）
 */

class SyncManager {
  constructor() {
    this.syncQueue = [];
    this.isSyncing = false;
    this.retryDelay = 5000; // 重试延迟5秒
    this.maxRetries = 3;
  }

  /**
   * 写入数据（本地优先策略）
   * 1. 立即写入本地缓存，UI即时响应
   * 2. 加入同步队列，后台静默同步
   */
  async write(key, data, options = {}) {
    const timestamp = Date.now();
    const version = options.version || 1;
    
    // 1. 构建完整数据对象
    const localData = {
      ...data,
      _localTimestamp: timestamp,
      _version: version,
      _syncStatus: 'pending' // pending | synced | failed
    };

    // 2. 立即写入本地（UI响应）
    try {
      wx.setStorageSync(key, localData);
      console.log(`[SyncManager] 本地写入成功: ${key}`);
    } catch (e) {
      console.error(`[SyncManager] 本地写入失败: ${key}`, e);
      throw new Error('LOCAL_WRITE_FAILED');
    }

    // 3. 加入同步队列（后台静默）
    this.addToQueue({
      type: 'write',
      key: key,
      data: localData,
      timestamp: timestamp,
      retries: 0
    });

    // 4. 触发后台同步
    this.triggerBackgroundSync();

    return { success: true, local: true };
  }

  /**
   * 读取数据（本地优先+云端校验）
   * 优先返回本地数据，网络可用时校验云端版本
   */
  async read(key, options = {}) {
    // 1. 优先读取本地
    let localData = null;
    try {
      localData = wx.getStorageSync(key);
    } catch (e) {
      console.warn(`[SyncManager] 本地读取失败: ${key}`);
    }

    // 2. 网络可用时，后台校验云端版本
    if (this.isNetworkAvailable() && !options.skipCloudCheck) {
      this.checkCloudVersion(key, localData);
    }

    return localData;
  }

  /**
   * 批量读取（带云端同步检查）
   */
  async readBatch(keys) {
    const results = {};
    const cloudCheckList = [];

    // 1. 批量读取本地
    keys.forEach(key => {
      try {
        results[key] = wx.getStorageSync(key);
        cloudCheckList.push(key);
      } catch (e) {
        results[key] = null;
      }
    });

    // 2. 后台批量校验云端
    if (this.isNetworkAvailable()) {
      this.checkCloudVersions(cloudCheckList);
    }

    return results;
  }

  /**
   * 删除数据（本地+云端）
   */
  async delete(key) {
    // 1. 删除本地
    try {
      wx.removeStorageSync(key);
    } catch (e) {
      console.error(`[SyncManager] 本地删除失败: ${key}`, e);
    }

    // 2. 加入同步队列（云端删除）
    this.addToQueue({
      type: 'delete',
      key: key,
      timestamp: Date.now(),
      retries: 0
    });

    this.triggerBackgroundSync();
    return { success: true };
  }

  /**
   * 获取列表数据（带分页和增量同步）
   * 适用于药品列表、服药记录等
   */
  async getList(keyPrefix, options = {}) {
    const { forceRefresh = false, page = 1, pageSize = 50 } = options;
    
    // 1. 从本地筛选数据
    const allKeys = wx.getStorageInfoSync().keys || [];
    const listKeys = allKeys.filter(k => k.startsWith(keyPrefix));
    
    const list = [];
    listKeys.forEach(k => {
      try {
        const item = wx.getStorageSync(k);
        if (item) list.push({ key: k, ...item });
      } catch (e) {
        console.warn(`[SyncManager] 读取列表项失败: ${k}`);
      }
    });

    // 2. 按时间戳排序（最新的在前）
    list.sort((a, b) => (b._localTimestamp || 0) - (a._localTimestamp || 0));

    // 3. 分页返回
    const start = (page - 1) * pageSize;
    const pagedList = list.slice(start, start + pageSize);

    // 4. 如果需要强制刷新，触发云端同步
    if (forceRefresh && this.isNetworkAvailable()) {
      this.syncFromCloud(keyPrefix);
    }

    return {
      list: pagedList,
      total: list.length,
      hasMore: list.length > start + pageSize
    };
  }

  /**
   * 查询云端是否有更新版本
   */
  async checkCloudVersion(key, localData) {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'syncData',
        data: {
          action: 'get',
          key: key,
          localTimestamp: localData?._localTimestamp || 0
        }
      });

      if (result.success && result.data) {
        const cloudData = result.data;
        const cloudTimestamp = cloudData._cloudTimestamp || 0;
        const localTimestamp = localData?._localTimestamp || 0;

        // 云端更新，以云端为准（Last-Write-Wins）
        if (cloudTimestamp > localTimestamp) {
          console.log(`[SyncManager] 云端数据更新: ${key}`);
          wx.setStorageSync(key, {
            ...cloudData,
            _localTimestamp: cloudTimestamp,
            _syncStatus: 'synced'
          });
        }
        // 本地更新，触发同步到云端
        else if (localTimestamp > cloudTimestamp && localData._syncStatus !== 'synced') {
          this.addToQueue({
            type: 'write',
            key: key,
            data: localData,
            timestamp: localTimestamp,
            retries: 0
          });
          this.triggerBackgroundSync();
        }
      }
    } catch (e) {
      console.warn(`[SyncManager] 云端校验失败: ${key}`, e);
    }
  }

  /**
   * 同步数据到云端
   */
  async syncToCloud(task) {
    try {
      const { result } = await wx.cloud.callFunction({
        name: 'syncData',
        data: {
          action: task.type,
          key: task.key,
          data: task.data
        }
      });

      if (result.success) {
        // 更新本地同步状态
        if (task.type === 'write') {
          const localData = wx.getStorageSync(task.key);
          if (localData) {
            wx.setStorageSync(task.key, {
              ...localData,
              _syncStatus: 'synced',
              _cloudTimestamp: result.cloudTimestamp
            });
          }
        }
        return { success: true };
      } else {
        throw new Error(result.error || 'SYNC_FAILED');
      }
    } catch (e) {
      console.error(`[SyncManager] 同步失败: ${task.key}`, e);
      throw e;
    }
  }

  /**
   * 添加任务到同步队列
   */
  addToQueue(task) {
    // 去重：相同key的写操作，保留最新的
    const existingIndex = this.syncQueue.findIndex(t => t.key === task.key && t.type === task.type);
    if (existingIndex >= 0) {
      // 保留时间戳更新的
      if (task.timestamp >= this.syncQueue[existingIndex].timestamp) {
        this.syncQueue[existingIndex] = task;
      }
      return;
    }
    this.syncQueue.push(task);
  }

  /**
   * 触发后台同步
   */
  async triggerBackgroundSync() {
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }

    this.isSyncing = true;

    while (this.syncQueue.length > 0 && this.isNetworkAvailable()) {
      const task = this.syncQueue[0];

      try {
        await this.syncToCloud(task);
        this.syncQueue.shift(); // 成功，移除任务
      } catch (e) {
        task.retries++;
        if (task.retries >= this.maxRetries) {
          console.error(`[SyncManager] 任务重试耗尽，移入死信队列: ${task.key}`);
          this.syncQueue.shift();
          // TODO: 移入死信队列，稍后人工处理
        } else {
          console.warn(`[SyncManager] 任务失败，${this.retryDelay/1000}秒后重试: ${task.key}`);
          await this.delay(this.retryDelay);
          this.syncQueue.push(this.syncQueue.shift()); // 移到队尾重试
        }
      }
    }

    this.isSyncing = false;
  }

  /**
   * 手动强制同步（如用户下拉刷新时）
   */
  async forceSync() {
    if (!this.isNetworkAvailable()) {
      return { success: false, error: 'NETWORK_UNAVAILABLE' };
    }

    // 收集所有待同步的数据
    const keys = wx.getStorageInfoSync().keys || [];
    keys.forEach(key => {
      try {
        const data = wx.getStorageSync(key);
        if (data && data._syncStatus === 'pending') {
          this.addToQueue({
            type: 'write',
            key: key,
            data: data,
            timestamp: data._localTimestamp,
            retries: 0
          });
        }
      } catch (e) {}
    });

    await this.triggerBackgroundSync();
    return { success: true };
  }

  /**
   * 检查网络状态
   */
  isNetworkAvailable() {
    const networkType = wx.getNetworkTypeSync?.() || { networkType: 'unknown' };
    return networkType.networkType !== 'none';
  }

  /**
   * 延迟工具
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 数据转换工具：为云数据库格式化
   */
  static formatForCloud(data, openid) {
    return {
      ...data,
      _openid: openid,
      _cloudTimestamp: Date.now(),
      _syncVersion: (data._version || 0) + 1
    };
  }

  /**
   * 数据转换工具：本地存储脱敏（移除敏感字段）
   */
  static formatForLocal(data) {
    const { _openid, ...localData } = data;
    return localData;
  }
}

// 导出单例
const syncManager = new SyncManager();
module.exports = syncManager;
