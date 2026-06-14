/* SyncManager 纯逻辑单元测试（addToQueue / formatForCloud / formatForLocal） */

// SyncManager 源码在模块顶层调用了 wx.* API（通过实例化单例），
// 在 Node 环境下需要先 stub 全局 wx 对象再 require。
global.wx = {
  setStorageSync: () => {},
  getStorageSync: () => null,
  removeStorageSync: () => {},
  getStorageInfoSync: () => ({ keys: [] }),
  getNetworkTypeSync: () => ({ networkType: 'wifi' }),
  cloud: { callFunction: async () => ({ result: { success: true } }) }
};

// 直接 require SyncManager 类（绕过单例，通过 module.parent 提取类）
// 由于 syncManager.js 导出的是单例，我们重新构造实例以便隔离测试
const syncManagerModule = require('../utils/syncManager.js');

// syncManager.js 导出的是实例，需要拿到类定义
// 我们通过原型链获取原始类
const SyncManager = Object.getPrototypeOf(syncManagerModule).constructor;

/* ── addToQueue 去重逻辑 ── */

test('addToQueue：新任务入队', () => {
  const sm = new SyncManager();
  sm.addToQueue({ type: 'write', key: 'med_1', data: {}, timestamp: 100, retries: 0 });
  assert.strictEqual(sm.syncQueue.length, 1);
});

test('addToQueue：相同 key+type 且时间戳更新，覆盖旧任务', () => {
  const sm = new SyncManager();
  sm.addToQueue({ type: 'write', key: 'med_1', data: { v: 1 }, timestamp: 100, retries: 0 });
  sm.addToQueue({ type: 'write', key: 'med_1', data: { v: 2 }, timestamp: 200, retries: 0 });
  assert.strictEqual(sm.syncQueue.length, 1);
  assert.strictEqual(sm.syncQueue[0].data.v, 2);
  assert.strictEqual(sm.syncQueue[0].timestamp, 200);
});

test('addToQueue：相同 key+type 但时间戳更旧，不覆盖', () => {
  const sm = new SyncManager();
  sm.addToQueue({ type: 'write', key: 'med_1', data: { v: 1 }, timestamp: 200, retries: 0 });
  sm.addToQueue({ type: 'write', key: 'med_1', data: { v: 0 }, timestamp: 100, retries: 0 });
  assert.strictEqual(sm.syncQueue[0].data.v, 1);
});

test('addToQueue：write 与 delete 视为不同任务，两者共存', () => {
  const sm = new SyncManager();
  sm.addToQueue({ type: 'write', key: 'med_1', data: {}, timestamp: 100, retries: 0 });
  sm.addToQueue({ type: 'delete', key: 'med_1', timestamp: 200, retries: 0 });
  assert.strictEqual(sm.syncQueue.length, 2);
});

test('addToQueue：不同 key 独立入队', () => {
  const sm = new SyncManager();
  sm.addToQueue({ type: 'write', key: 'med_1', data: {}, timestamp: 100, retries: 0 });
  sm.addToQueue({ type: 'write', key: 'med_2', data: {}, timestamp: 100, retries: 0 });
  assert.strictEqual(sm.syncQueue.length, 2);
});

/* ── formatForCloud 静态方法 ── */

test('formatForCloud：注入 _openid 与 _cloudTimestamp', () => {
  const before = Date.now();
  const result = SyncManager.formatForCloud({ name: '阿司匹林', _version: 1 }, 'uid_test');
  const after = Date.now();
  assert.strictEqual(result._openid, 'uid_test');
  assert.ok(result._cloudTimestamp >= before && result._cloudTimestamp <= after);
  assert.strictEqual(result._syncVersion, 2); // version + 1
  assert.strictEqual(result.name, '阿司匹林');  // 原字段保留
});

test('formatForCloud：_version 缺失时 _syncVersion 为 1', () => {
  const result = SyncManager.formatForCloud({ name: '布洛芬' }, 'uid_x');
  assert.strictEqual(result._syncVersion, 1);
});

/* ── formatForLocal 静态方法 ── */

test('formatForLocal：移除 _openid 字段', () => {
  const result = SyncManager.formatForLocal({ _openid: 'secret', name: '维生素C', _version: 2 });
  assert.ok(!Object.prototype.hasOwnProperty.call(result, '_openid'));
  assert.strictEqual(result.name, '维生素C');
  assert.strictEqual(result._version, 2);
});

test('formatForLocal：无 _openid 时保持原对象字段不变', () => {
  const result = SyncManager.formatForLocal({ name: '头孢', _version: 1 });
  assert.strictEqual(result.name, '头孢');
});

/* ── isNetworkAvailable ── */

test('isNetworkAvailable：networkType 为 none 时返回 false', () => {
  const sm = new SyncManager();
  const orig = global.wx.getNetworkTypeSync;
  global.wx.getNetworkTypeSync = () => ({ networkType: 'none' });
  assert.strictEqual(sm.isNetworkAvailable(), false);
  global.wx.getNetworkTypeSync = orig;
});

test('isNetworkAvailable：networkType 为 wifi 时返回 true', () => {
  const sm = new SyncManager();
  assert.strictEqual(sm.isNetworkAvailable(), true);
});

/* ── triggerBackgroundSync：并发防护 ── */

test('triggerBackgroundSync：isSyncing 为 true 时立即返回，队列不被消费', async () => {
  const sm = new SyncManager();
  sm.isSyncing = true;
  sm.addToQueue({ type: 'write', key: 'med_guard', data: {}, timestamp: 100, retries: 0 });
  await sm.triggerBackgroundSync();
  assert.strictEqual(sm.syncQueue.length, 1); // 任务仍在队列中
});

/* ── triggerBackgroundSync：重试耗尽 ── */

test('triggerBackgroundSync：同步持续失败达 maxRetries 后任务被丢弃，队列清空', async () => {
  const sm = new SyncManager();
  sm.retryDelay = 0;  // 不等待，加速测试
  // 覆盖 syncToCloud 让它始终失败
  sm.syncToCloud = async () => { throw new Error('模拟网络错误'); };

  sm.addToQueue({ type: 'write', key: 'med_retry', data: {}, timestamp: 100, retries: 0 });
  await sm.triggerBackgroundSync();

  assert.strictEqual(sm.syncQueue.length, 0); // 任务被丢弃
  assert.strictEqual(sm.isSyncing, false);     // 锁被释放
});

test('triggerBackgroundSync：成功同步后队列清空且 isSyncing 复位', async () => {
  const sm = new SyncManager();
  sm.syncToCloud = async () => ({ success: true }); // 始终成功

  sm.addToQueue({ type: 'write', key: 'med_ok', data: {}, timestamp: 100, retries: 0 });
  await sm.triggerBackgroundSync();

  assert.strictEqual(sm.syncQueue.length, 0);
  assert.strictEqual(sm.isSyncing, false);
});
