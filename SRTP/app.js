App({
  onLaunch() {
    // 小程序启动时执行
    console.log('用药提醒小程序启动');
    
    // 初始化云开发环境
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true
    });
    console.log('云开发初始化完成');
    
    // 启动全局闹钟检查
    this.startGlobalReminderCheck();
    
    // 检查是否需要显示密码锁（延迟执行，确保页面加载完成）
    setTimeout(() => {
      this.checkLockScreen();
    }, 500);
  },
  
  onShow() {
    // 小程序切换到前台时执行
    console.log('小程序切换到前台');
    
    // 检查并引导订阅通知
    this.checkAndSubscribeNotification();
    
    // 检查是否需要显示密码锁
    setTimeout(() => {
      this.checkLockScreen();
    }, 300);
  },
  
  onHide() {
    // 小程序进入后台
    console.log('小程序进入后台');
    
    // 记录进入后台的时间，用于锁屏判断
    const privacySettings = wx.getStorageSync('privacySettings') || {};
    privacySettings.lastHideTime = new Date().getTime();
    wx.setStorageSync('privacySettings', privacySettings);
  },
  
  onUnload() {
    // 清理定时器
    if (this.globalData.reminderTimer) {
      clearInterval(this.globalData.reminderTimer);
    }
    this.stopReminder();
  },
  
  globalData: {
    userInfo: null,
    reminderTimer: null,
    audioContext: null,
    vibrationInterval: null,
    currentReminder: null,
    notificationTemplateId: 'gxUwJ3_t2rOHZR1bKjJesciFRSBbtCmjZKowY9qUOdw'
  },
  
// 检查是否需要显示密码锁（修复版）
checkLockScreen() {
  console.log('===== 开始锁屏检查 =====');
  
  // 从本地存储读取隐私设置
  const privacySettings = wx.getStorageSync('privacySettings') || {};
  console.log('读取到隐私设置:', privacySettings);
  
  // 如果没有开启密码锁，直接返回
  if (!privacySettings.lockEnabled) {
    console.log('❌ 密码锁未开启，不跳转');
    return;
  }
  
  // 检查是否有密码（直接检查密码字段是否存在）
  const hasPassword = !!(privacySettings.pinPassword || privacySettings.patternPassword);
  console.log('密码存在:', hasPassword);
  
  if (!hasPassword) {
    console.log('❌ 密码未设置，不跳转');
    return;
  }
  
  // 获取当前页面栈
  const pages = getCurrentPages();
  console.log('当前页面栈:', pages.map(p => p.route));
  
  if (pages.length === 0) {
    console.log('⏳ 页面栈为空，等待500ms后重新检查');
    setTimeout(() => {
      this.checkLockScreen();
    }, 500);
    return;
  }
  
  const currentPage = pages[pages.length - 1];
  console.log('当前页面:', currentPage.route);
  
  // 如果当前已经在锁屏页面，不重复跳转
  if (currentPage.route === '/packageA/pages/lock/lock') {
    console.log('✅ 已在锁屏页面，无需跳转');
    return;
  }
  
  // 如果当前在隐私设置页面，也不跳转
  if (currentPage.route === '/packageA/pages/privacy/privacy') {
    console.log('✅ 在隐私设置页面，不跳转锁屏');
    return;
  }
  
  // 获取上次解锁时间
  const lastUnlockTime = privacySettings.lastUnlockTime || 0;
  const now = new Date().getTime();
  
  // 锁屏时间选项（分钟）
  const lockTimeMinutes = [0, 1, 5, 15, 30, 60];
  const lockMinutes = lockTimeMinutes[privacySettings.lockTimeIndex || 2];
  
  // 计算空闲时间（分钟）
  const idleMinutes = (now - lastUnlockTime) / (1000 * 60);
  
  console.log('⏱️ 上次解锁时间:', lastUnlockTime ? new Date(lastUnlockTime).toLocaleString() : '首次启动');
  console.log('⏱️ 当前时间:', new Date(now).toLocaleString());
  console.log('⏱️ 空闲时间:', idleMinutes.toFixed(2), '分钟');
  console.log('⏱️ 设定锁屏时间:', lockMinutes, '分钟');
  
  // 如果是首次启动（lastUnlockTime为0），需要锁屏
  if (lastUnlockTime === 0) {
    console.log('🔒 首次启动，需要锁屏');
    this.navigateToLockScreen();
    return;
  }
  
  // 如果空闲时间超过设定时间，显示锁屏
  if (lockMinutes === 0 || idleMinutes >= lockMinutes) {
    console.log('🔒 需要锁屏，准备跳转');
    this.navigateToLockScreen();
  } else {
    console.log('✅ 不需要锁屏');
  }
},

// 跳转到锁屏页面的方法
navigateToLockScreen() {
  console.log('🚀 正在跳转到锁屏页面...');
  
  // 延迟一点跳转，避免页面栈冲突
  setTimeout(() => {
    wx.navigateTo({
      url: '/pages/lock/lock',
      success: () => {
        console.log('✅ 跳转锁屏成功');
      },
      fail: (err) => {
        console.error('❌ 跳转锁屏失败', err);
        // 如果跳转失败，可能是已经在锁屏页或页面栈问题
      }
    });
  }, 300);
},
  
  // 检查并引导订阅通知
  checkAndSubscribeNotification() {
    // 获取用户设置
    const reminderSettings = wx.getStorageSync('reminderSettings') || {};
    
    // 如果用户已开启通知但未授权，则提示
    if (reminderSettings.notificationEnabled && !reminderSettings.hasSubscribed) {
      // 获取当前页面栈，避免在提醒设置页面重复弹窗
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      
      // 如果当前已经在提醒设置页面，不重复弹窗
      if (currentPage && currentPage.route === '/packageA/pages/reminder-settings/reminder-settings') {
        return;
      }
      
      // 使用wx.showModal友好提示
      wx.showModal({
        title: '开启用药提醒',
        content: '开启后，每次用药时间都会通过微信服务通知提醒您，不错过任何一次服药',
        confirmText: '去授权',
        cancelText: '暂不开启',
        success: (res) => {
          if (res.confirm) {
            // 跳转到提醒设置页面引导授权
            wx.navigateTo({
              url: '/packageA/pages/reminder-settings/reminder-settings?guide=notification'
            });
          }
        }
      });
    }
  },
  
  // 启动全局闹钟检查
  startGlobalReminderCheck() {
    // 立即执行一次
    this.checkAllMedicines();
    
    // 每分钟检查一次
    this.globalData.reminderTimer = setInterval(() => {
      this.checkAllMedicines();
    }, 60000);
  },
  
  // 检查所有药品
  checkAllMedicines() {
    const medicineList = wx.getStorageSync('medicineList') || [];
    if (medicineList.length === 0) return;
    
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                        now.getMinutes().toString().padStart(2, '0');
    
    console.log('检查用药时间:', currentTime);
    
    for (let medicine of medicineList) {
      if (medicine.times && medicine.times.includes(currentTime)) {
        this.triggerReminder(medicine);
        break;
      }
    }
  },
  
  // 触发提醒（全局）
  triggerReminder(medicine) {
    // 避免重复提醒
    if (this.globalData.currentReminder) {
      return;
    }
    
    this.globalData.currentReminder = medicine;
    
    // 获取当前页面栈
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    
    // 获取提醒设置
    const reminderSettings = wx.getStorageSync('reminderSettings') || {};
    const vibrationEnabled = reminderSettings.vibrationEnabled !== false;
    const notificationEnabled = reminderSettings.notificationEnabled || false;
    const ringtone = reminderSettings.selectedRingtone || '默认铃声';
    
    // 播放声音
    this.playReminderSound(ringtone);
    
    // 振动
    if (vibrationEnabled) {
      this.startVibration();
    }
    
    // 获取当前时间
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                        now.getMinutes().toString().padStart(2, '0');
    
    // 如果用户开启了服务通知，发送订阅消息
    if (notificationEnabled) {
      this.sendNotificationReminder(medicine, currentTime);
    }
    
    // 如果当前不在提醒页面，跳转到提醒页面
    if (currentPage && currentPage.route !== '/packageA/pages/reminder/reminder') {
      wx.navigateTo({
        url: `/packageA/pages/reminder/reminder?medicine=${JSON.stringify(medicine)}`,
        fail: (err) => {
          console.log('跳转失败，使用弹窗提醒', err);
          // 如果跳转失败，使用模态框提醒
          this.showModalReminder(medicine);
        }
      });
    } else {
      // 已经在提醒页面，通知页面更新
      if (currentPage && currentPage.route === '/packageA/pages/reminder/reminder') {
        const reminderPage = pages.find(p => p.route === '/packageA/pages/reminder/reminder');
        if (reminderPage) {
          reminderPage.updateReminder(medicine);
        }
      }
    }
  },
  
  // 发送服务通知提醒
  sendNotificationReminder(medicine, time) {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._openid) return;
    
    // 检查是否有订阅状态
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const subStatus = res.subscriptionsSetting;
        const hasSubscribed = subStatus.itemSettings && 
                              subStatus.itemSettings[this.globalData.notificationTemplateId] === 'accept';
        
        if (hasSubscribed) {
          // 已订阅，发送通知
          wx.cloud.callFunction({
            name: 'sendReminderMessage',
            data: {
              openid: userInfo._openid,
              medicine: medicine,
              time: time
            },
            success: (res) => {
              console.log('服务通知发送结果', res);
            },
            fail: (err) => {
              console.error('服务通知发送失败', err);
            }
          });
        } else {
          console.log('用户未订阅通知');
        }
      }
    });
  },
  
  // 播放提醒声音
  playReminderSound(ringtoneName) {
    // 停止之前的播放
    this.stopReminder();
    
    const audioContext = wx.createInnerAudioContext();
    this.globalData.audioContext = audioContext;
    
    // 获取铃声路径
    const pathMap = {
      '默认铃声': '/packageAudio/assets/audio/default.mp3',
      '轻柔提示': '/packageAudio/assets/audio/soft.mp3',
      '经典闹钟': '/packageAudio/assets/audio/alarm.mp3',
      '自然声音': '/packageAudio/assets/audio/nature.mp3'
    };
    
    audioContext.src = pathMap[ringtoneName] || '/packageAudio/assets/audio/default.mp3';
    audioContext.loop = true;
    
    audioContext.onError((err) => {
      console.error('播放失败', err);
    });
    
    audioContext.play();
  },
  
  // 开始振动
  startVibration() {
    this.globalData.vibrationInterval = setInterval(() => {
      wx.vibrateLong({
        fail: () => {
          // 如果不支持长振动，尝试短振动
          wx.vibrateShort();
        }
      });
    }, 2000);
  },
  
  // 停止提醒
  stopReminder() {
    if (this.globalData.audioContext) {
      this.globalData.audioContext.stop();
      this.globalData.audioContext.destroy();
      this.globalData.audioContext = null;
    }
    
    if (this.globalData.vibrationInterval) {
      clearInterval(this.globalData.vibrationInterval);
      this.globalData.vibrationInterval = null;
    }
    
    this.globalData.currentReminder = null;
  },
  
  // 模态框提醒（备用）
  showModalReminder(medicine) {
    wx.showModal({
      title: '用药时间到',
      content: `该服用${medicine.name}了`,
      confirmText: '我已服用',
      cancelText: '稍后提醒',
      success: (res) => {
        if (res.confirm) {
          this.markAsTaken(medicine);
        } else {
          // 稍后提醒，停止当前提醒
          this.stopReminder();
        }
      }
    });
  },
  
  // 标记已服用
  markAsTaken(medicine) {
    // 停止提醒
    this.stopReminder();
    
    // 更新记录
    const todayKey = this.getTodayKey();
    const completedList = wx.getStorageSync(todayKey) || {};
    
    // 获取当前时间
    const now = new Date();
    const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                        now.getMinutes().toString().padStart(2, '0');
    
    // 标记当前时间段的用药
    if (medicine.timeSlots) {
      // 新版数据结构
      medicine.timeSlots.forEach(slot => {
        if (slot.time === currentTime) {
          const slotId = medicine.id + '_' + slot.time;
          completedList[slotId] = { completed: true, markedTime: currentTime };
        }
      });
    } else if (medicine.times) {
      // 旧版数据结构
      medicine.times.forEach(time => {
        if (time === currentTime) {
          const slotId = medicine.id + '_' + time;
          completedList[slotId] = { completed: true, markedTime: currentTime };
        }
      });
    }
    
    wx.setStorageSync(todayKey, completedList);
    
    wx.showToast({
      title: '已记录',
      icon: 'success'
    });
    
    // 返回到首页
    wx.switchTab({
      url: '/pages/index/index'
    });
  },
  
  // 获取当前时间
  getCurrentTime() {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + 
           now.getMinutes().toString().padStart(2, '0');
  },
  
  // 生成今日键
  getTodayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    return 'completed_' + year + month + day;
  }
});