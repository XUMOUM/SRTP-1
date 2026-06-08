// 引入SyncManager和订阅辅助工具
const syncManager = require('../../utils/syncManager.js');
const subscriptionHelper = require('../../utils/subscriptionHelper.js');

Page({
  data: {
    currentTime: '',
    currentDate: '',
    reminderCount: 0,
    completedCount: 0,
    totalCount: 0,
    reminderList: [],
    showCancelModal: false,
    currentMedicineId: null,
    currentMedicineName: null,
    currentTimeSlot: null,
    timer: null,
    expandedMedicineId: null,
    // 新增：前台提醒相关
    pendingForegroundReminders: [],
    showForegroundReminder: false,
    currentForegroundReminder: null
  },

  onLoad: function() {
    this.setCurrentDateTime();
    this.startRealTimeClock();
    this.loadReminderList();
    this.checkForegroundReminders();
    
    // 页面加载时检查订阅状态
    this.checkSubscriptionStatus();
  },

  onShow: function() {
    this.loadReminderList();
    this.checkForegroundReminders();
    
    // 同步云端数据
    this.syncFromCloud();
  },

  onUnload: function() {
    if (this.data.timer) {
      clearInterval(this.data.timer);
    }
  },

  // ================= 时间显示 =================
  
  startRealTimeClock: function() {
    this.updateCurrentTime();

    var that = this;
    this.data.timer = setInterval(function() {
      that.updateCurrentTime();
      // 每分钟检查一次前台提醒
      if (new Date().getSeconds() === 0) {
        that.checkForegroundReminders();
      }
    }, 1000);
  },

  updateCurrentTime: function() {
    var now = new Date();
    var hours = now.getHours().toString().padStart(2, '0');
    var minutes = now.getMinutes().toString().padStart(2, '0');
    var seconds = now.getSeconds().toString().padStart(2, '0');

    this.setData({
      currentTime: hours + ':' + minutes + ':' + seconds
    });
  },

  setCurrentDateTime: function() {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    var weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    var weekDay = weekDays[now.getDay()];

    this.setData({
      currentDate: year + '年' + month + '月' + day + '日 星期' + weekDay
    });

    this.updateCurrentTime();
  },

  getTodayKey: function() {
    var now = new Date();
    var year = now.getFullYear();
    var month = (now.getMonth() + 1).toString().padStart(2, '0');
    var day = now.getDate().toString().padStart(2, '0');
    return year + '-' + month + '-' + day;  // 改为标准日期格式，便于数据库存储
  },

  // ================= 订阅授权管理 =================

  /**
   * 检查订阅状态
   */
  checkSubscriptionStatus: function() {
    wx.cloud.callFunction({
      name: 'updateSubscription',
      data: { action: 'getStatus' },
      success: (res) => {
        if (res.result.success) {
          const status = res.result.data;
          console.log('[index] 订阅状态:', status);
          
          // 如果没有授权且是首次使用，提示开启
          if (!status.longTermValid && status.oneTimeCount === 0) {
            // 延迟3秒后提示，避免打扰
            setTimeout(() => {
              this.showInitialSubscriptionTip();
            }, 3000);
          }
        }
      },
      fail: (err) => {
        console.warn('[index] 获取订阅状态失败:', err);
      }
    });
  },

  /**
   * 首次使用提示开启订阅
   */
  showInitialSubscriptionTip: function() {
    wx.showModal({
      title: '开启用药提醒',
      content: '为了按时提醒您服药，建议开启消息通知。您也可以在"我的-提醒设置"中随时开启。',
      confirmText: '立即开启',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) {
          subscriptionHelper.requestSubscription({
            scenario: 'default',
            onSuccess: () => {
              wx.showToast({ title: '开启成功', icon: 'success' });
            }
          });
        }
      }
    });
  },

  // ================= 提醒列表加载（集成SyncManager） =================

  getPeriodInfo: function(timeStr) {
    var hour = parseInt(timeStr.split(':')[0], 10);
    if (hour >= 5 && hour < 11) return { name: '早上', icon: '🌅', id: 'morning', order: 1 };
    if (hour >= 11 && hour < 16) return { name: '中午', icon: '☀️', id: 'noon', order: 2 };
    if (hour >= 16 && hour < 21) return { name: '晚上', icon: '🌆', id: 'evening', order: 3 };
    return { name: '睡前', icon: '🌙', id: 'night', order: 4 };
  },

  /**
   * 加载提醒列表（离线优先 + 云端同步）
   */
  loadReminderList: async function() {
    var that = this;

    try {
      // 1. 优先从本地加载（即时响应）
      var medicineList = wx.getStorageSync('medicineList') || [];

      // 2. 如果没有本地数据，使用默认值
      if (medicineList.length === 0) {
        medicineList = [
          { id: 1, name: '阿司匹林肠溶片', dosageNumber: '1', dosageUnit: '片', instruction: '饭后服用', times: ['08:00', '12:00', '20:00'], frequency: '3', notes: '防血栓' },
          { id: 2, name: '降压药', dosageNumber: '1', dosageUnit: '粒', instruction: '饭前服用', times: ['07:30'], frequency: '1', notes: '血压稳定时服用' },
          { id: 3, name: '感冒灵冲剂', dosageNumber: '1', dosageUnit: '包', instruction: '开水冲服', times: ['08:00', '21:00'], frequency: '2', notes: '近期感冒' }
        ];
        wx.setStorageSync('medicineList', medicineList);
      }

      // 3. 渲染UI（不等待云端）
      this.renderReminderList(medicineList);

      // 4. 后台同步云端数据
      this.syncFromCloud();

    } catch (e) {
      console.error('[index] 加载提醒列表失败:', e);
    }
  },

  /**
   * 渲染提醒列表
   */
  renderReminderList: function(medicineList) {
    var that = this;
    var todayKey = this.getTodayKey();
    var completedList = wx.getStorageSync('completed_' + todayKey) || {};

    var timeGroups = {};
    var totalSlots = 0;
    var completedSlots = 0;

    medicineList.forEach(function(medicine) {
      var times = medicine.times || ['08:00'];
      if (!Array.isArray(times)) times = [times];

      times.forEach(function(time) {
        var timeStr = time ? time.toString() : '08:00';
        var slotId = medicine.id + '_' + timeStr;
        var completedInfo = completedList[slotId] || { completed: false, markedTime: '' };

        var periodInfo = that.getPeriodInfo(timeStr);
        var groupId = periodInfo.id;

        if (!timeGroups[groupId]) {
          timeGroups[groupId] = {
            id: groupId,
            name: periodInfo.name,
            icon: periodInfo.icon,
            order: periodInfo.order,
            medicines: [],
            total: 0,
            completed: 0,
            expanded: true
          };
        }

        var tag = (medicine.name.indexOf('感冒') !== -1 || medicine.name.indexOf('退烧') !== -1) ? '急症用药' : '慢病长期';

        timeGroups[groupId].medicines.push({
          medicineId: medicine.id,
          slotId: slotId,
          name: medicine.name || '未命名药品',
          dosage: (medicine.dosageNumber || '1') + (medicine.dosageUnit || '片'),
          time: timeStr,
          instruction: medicine.instruction || '',
          completed: completedInfo.completed || false,
          markedTime: completedInfo.markedTime || '',
          tag: tag,
          cycleLabel: '每日' + (medicine.frequency || '1') + '次 | ' + (medicine.times || ['']).length + '个时段'
        });

        timeGroups[groupId].total++;
        totalSlots++;
        if (completedInfo.completed) {
          timeGroups[groupId].completed++;
          completedSlots++;
        }
      });
    });

    var groupedReminderList = Object.keys(timeGroups).map(function(key) {
      return timeGroups[key];
    }).sort(function(a, b) {
      return a.order - b.order;
    });

    this.setData({
      reminderList: groupedReminderList,
      totalCount: totalSlots,
      completedCount: completedSlots,
      reminderCount: totalSlots - completedSlots
    });
  },

  /**
   * 从云端同步数据（后台静默）
   */
  syncFromCloud: function() {
    // 使用SyncManager同步
    syncManager.forceSync().then((res) => {
      if (res.success) {
        console.log('[index] 云端同步完成');
        // 重新加载以显示最新数据
        this.loadReminderListFromCloud();
      }
    }).catch((err) => {
      console.warn('[index] 云端同步失败:', err);
    });
  },

  /**
   * 从云端加载并合并
   */
  loadReminderListFromCloud: function() {
    wx.cloud.callFunction({
      name: 'syncData',
      data: {
        action: 'syncFromCloud',
        key: 'medicine_',
        localTimestamp: 0
      },
      success: (res) => {
        if (res.result.success && res.result.data.length > 0) {
          // 合并云端数据
          const cloudData = res.result.data;
          console.log('[index] 从云端加载到', cloudData.length, '条数据');
          // 这里可以实现合并逻辑
        }
      }
    });
  },

  // ================= 打卡操作（集成订阅索要） =================

  toggleGroupExpand: function(e) {
    var groupId = e.currentTarget.dataset.id;
    var newList = this.data.reminderList.map(function(group) {
      if (group.id === groupId) {
        group.expanded = !group.expanded;
      }
      return group;
    });
    this.setData({ reminderList: newList });
  },

  /**
   * 标记完成（集成云端同步 + 订阅索要）
   */
  markTimeSlotAsCompleted: function(e) {
    var timeSlot = e.currentTarget.dataset.timeslot;
    var now = new Date();
    var markedTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    var todayKey = this.getTodayKey();
    var completedList = wx.getStorageSync('completed_' + todayKey) || {};
    completedList[timeSlot] = { completed: true, markedTime: markedTime };
    wx.setStorageSync('completed_' + todayKey, completedList);

    // 1. 同步到云端（后台静默）
    this.syncCheckinToCloud(timeSlot, todayKey, markedTime);

    // 2. 刷新UI
    this.loadReminderList();
    wx.showToast({ title: '已服药', icon: 'success' });

    // 3. 触发震动（前台兜底的一部分）
    wx.vibrateShort({ type: 'medium' });

    // 4. 获取当前药品信息
    const medicine = this.findMedicineBySlotId(timeSlot);

    // 5. 智能索要下次订阅授权
    this.requestNextSubscription(medicine);
  },

  /**
   * 同步打卡记录到云端
   */
  syncCheckinToCloud: function(timeSlot, date, markedTime) {
    const recordKey = 'record_' + date + '_' + timeSlot;
    const recordData = {
      slotId: timeSlot,
      date: date,
      markedTime: markedTime,
      completed: true,
      checkinTime: new Date()
    };

    syncManager.write(recordKey, recordData).then((res) => {
      console.log('[index] 打卡记录已同步到云端');
    }).catch((err) => {
      console.warn('[index] 打卡记录同步失败（将在网络恢复后重试）:', err);
    });
  },

  /**
   * 根据slotId查找药品
   */
  findMedicineBySlotId: function(slotId) {
    const medicineList = wx.getStorageSync('medicineList') || [];
    for (let medicine of medicineList) {
      const medicineSlotId = medicine.id + '_' + (medicine.times?.[0] || '08:00');
      if (medicineSlotId === slotId) {
        return medicine;
      }
    }
    return null;
  },

  /**
   * 打卡后智能请求下次订阅授权
   */
  requestNextSubscription: function(justCheckedMedicine) {
    const medicineList = wx.getStorageSync('medicineList') || [];
    
    // 使用subscriptionHelper计算下次用药并索要授权
    subscriptionHelper.requestSubscriptionAfterCheckin(
      medicineList, 
      justCheckedMedicine ? justCheckedMedicine.name : null
    );
  },

  // ================= 取消打卡 =================

  cancelMarkAsCompleted: function() {
    var timeSlot = this.data.currentTimeSlot;

    var todayKey = this.getTodayKey();
    var completedList = wx.getStorageSync('completed_' + todayKey) || {};
    completedList[timeSlot] = { completed: false, markedTime: '' };
    wx.setStorageSync('completed_' + todayKey, completedList);

    // 同步取消到云端
    this.syncUncheckToCloud(timeSlot, todayKey);

    this.hideCancelModal();
    this.loadReminderList();
    wx.showToast({ title: '已取消', icon: 'success' });
  },

  syncUncheckToCloud: function(timeSlot, date) {
    const recordKey = 'record_' + date + '_' + timeSlot;
    const recordData = {
      slotId: timeSlot,
      date: date,
      completed: false,
      uncheckTime: new Date()
    };

    syncManager.write(recordKey, recordData).catch((err) => {
      console.warn('[index] 取消打卡同步失败:', err);
    });
  },

  showCancelConfirm: function(e) {
    var medicineId = e.currentTarget.dataset.medicineId;
    var timeSlot = e.currentTarget.dataset.timeslot;

    var medicineName = '';
    this.data.reminderList.forEach(function(group) {
      var med = group.medicines.filter(function(m) {
        return m.slotId === timeSlot;
      })[0];
      if (med) medicineName = med.name;
    });

    this.setData({
      showCancelModal: true,
      currentMedicineId: medicineId,
      currentTimeSlot: timeSlot,
      currentMedicineName: medicineName
    });
  },

  hideCancelModal: function() {
    this.setData({
      showCancelModal: false,
      currentMedicineId: null,
      currentTimeSlot: null,
      currentMedicineName: ''
    });
  },

  // ================= 前台兜底提醒 =================

  /**
   * 检查前台提醒队列
   */
  checkForegroundReminders: function() {
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                       now.getMinutes().toString().padStart(2, '0');

    // 从本地获取待提醒（云端会定期推送）
    const pendingReminders = wx.getStorageSync('foregroundReminders') || [];
    
    // 找到当前时间的提醒
    const currentReminders = pendingReminders.filter(r => {
      return r.scheduledTime === currentTime && r.status === 'pending';
    });

    if (currentReminders.length > 0) {
      // 显示第一个提醒
      this.showForegroundReminder(currentReminders[0]);
      
      // 震动提示
      wx.vibrateLong();
      
      // 标记为已提醒
      this.markReminderShown(currentReminders[0].id);
    }
  },

  showForegroundReminder: function(reminder) {
    this.setData({
      showForegroundReminder: true,
      currentForegroundReminder: reminder
    });
  },

  hideForegroundReminder: function() {
    this.setData({
      showForegroundReminder: false,
      currentForegroundReminder: null
    });
  },

  confirmForegroundReminder: function() {
    // 跳转到打卡页面
    wx.navigateTo({
      url: '/packageA/pages/reminder/reminder?auto=true'
    });
    this.hideForegroundReminder();
  },

  markReminderShown: function(reminderId) {
    let reminders = wx.getStorageSync('foregroundReminders') || [];
    reminders = reminders.map(r => {
      if (r.id === reminderId) {
        return { ...r, status: 'shown' };
      }
      return r;
    });
    wx.setStorageSync('foregroundReminders', reminders);
  },

  // ================= 导航 =================

  navigateToManage: function() {
    wx.switchTab({
      url: '/pages/manage/manage'
    });
  }
});
