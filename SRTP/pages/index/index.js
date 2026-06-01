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
    expandedMedicineId: null
  },

  onLoad: function() {
    this.setCurrentDateTime();
    this.startRealTimeClock();
    this.loadReminderList();
  },

  onShow: function() {
    this.loadReminderList();
  },

  onUnload: function() {
    if (this.data.timer) {
      clearInterval(this.data.timer);
    }
  },

  startRealTimeClock: function() {
    this.updateCurrentTime();

    var that = this;
    this.data.timer = setInterval(function() {
      that.updateCurrentTime();
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
    return 'completed_' + year + month + day;
  },

  // ================= 纯 ES5 语法重构区域 =================

  // 辅助函数:根据具体时间划分早中晚
  getPeriodInfo: function(timeStr) {
    var hour = parseInt(timeStr.split(':')[0], 10);
    if (hour >= 5 && hour < 11) return { name: '早上', icon: '🌅', id: 'morning', order: 1 };
    if (hour >= 11 && hour < 16) return { name: '中午', icon: '☀️', id: 'noon', order: 2 };
    if (hour >= 16 && hour < 21) return { name: '晚上', icon: '🌆', id: 'evening', order: 3 };
    return { name: '睡前', icon: '🌙', id: 'night', order: 4 };
  },

  loadReminderList: function() {
    var medicineList = wx.getStorageSync('medicineList') || [];
    var that = this; // 关键:保存 this 引用,防止在 function 内部丢失

    // 如果没有数据,使用默认数据
    if (medicineList.length === 0) {
      medicineList = [
        { id: 1, name: '阿司匹林肠溶片', dosageNumber: '1', dosageUnit: '片', instruction: '饭后服用', times: ['08:00', '12:00', '20:00'], frequency: '3', notes: '防血栓' },
        { id: 2, name: '降压药', dosageNumber: '1', dosageUnit: '粒', instruction: '饭前服用', times: ['07:30'], frequency: '1', notes: '血压稳定时服用' },
        { id: 3, name: '感冒灵冲剂', dosageNumber: '1', dosageUnit: '包', instruction: '开水冲服', times: ['08:00', '21:00'], frequency: '2', notes: '近期感冒' }
      ];
      wx.setStorageSync('medicineList', medicineList);
    }

    var todayKey = this.getTodayKey();
    var completedList = wx.getStorageSync(todayKey) || {};

    var timeGroups = {};
    var totalSlots = 0;
    var completedSlots = 0;

    // 换回传统的 function() 循环
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

        // 用 indexOf 替换 ES6 的 includes,防止不兼容
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

    // 抛弃 Object.values,用 ES5 的 Object.keys 手动映射
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

  markTimeSlotAsCompleted: function(e) {
    var timeSlot = e.currentTarget.dataset.timeslot;
    var now = new Date();
    var markedTime = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

    var todayKey = this.getTodayKey();
    var completedList = wx.getStorageSync(todayKey) || {};
    completedList[timeSlot] = { completed: true, markedTime: markedTime };
    wx.setStorageSync(todayKey, completedList);

    this.loadReminderList();
    wx.showToast({ title: '已服药', icon: 'success' });
  },

  cancelMarkAsCompleted: function() {
    var timeSlot = this.data.currentTimeSlot;

    var todayKey = this.getTodayKey();
    var completedList = wx.getStorageSync(todayKey) || {};
    completedList[timeSlot] = { completed: false, markedTime: '' };
    wx.setStorageSync(todayKey, completedList);

    this.hideCancelModal();
    this.loadReminderList();
    wx.showToast({ title: '已取消', icon: 'success' });
  },

  showCancelConfirm: function(e) {
    var medicineId = e.currentTarget.dataset.medicineId;
    var timeSlot = e.currentTarget.dataset.timeslot;

    var medicineName = '';
    this.data.reminderList.forEach(function(group) {
      // 抛弃 find 方法,用 filter 替代以保证绝对兼容
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

  navigateToManage: function() {
    wx.switchTab({
      url: '/pages/manage/manage'
    });
  }
});