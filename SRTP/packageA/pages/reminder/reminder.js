const app = getApp();

Page({
  data: {
    medicine: null,
    currentTime: '',
    vibrationEnabled: true
  },

  onLoad(options) {
    // 获取传递过来的药品信息
    if (options.medicine) {
      try {
        const medicine = JSON.parse(options.medicine);
        this.setData({ 
          medicine: medicine,
          currentTime: this.getCurrentTime()
        });
      } catch (e) {
        console.error('解析药品信息失败', e);
      }
    }
    
    // 获取振动设置
    const reminderSettings = wx.getStorageSync('reminderSettings') || {};
    this.setData({
      vibrationEnabled: reminderSettings.vibrationEnabled !== false
    });
  },

  onShow() {
    // 更新时间显示
    this.setData({
      currentTime: this.getCurrentTime()
    });
    
    // 每秒更新时间
    this.timeTimer = setInterval(() => {
      this.setData({
        currentTime: this.getCurrentTime()
      });
    }, 1000);
  },

  onHide() {
    // 清理定时器
    if (this.timeTimer) {
      clearInterval(this.timeTimer);
    }
  },

  onUnload() {
    // 清理定时器
    if (this.timeTimer) {
      clearInterval(this.timeTimer);
    }
  },

  // 获取当前时间
  getCurrentTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  },

  // 更新提醒（从app.js调用）
  updateReminder(medicine) {
    this.setData({ 
      medicine: medicine,
      currentTime: this.getCurrentTime()
    });
  },

  // 标记已服用
  markAsTaken() {
    // 调用app.js中的方法
    app.markAsTaken(this.data.medicine);
    // app.markAsTaken会关闭提醒并跳转，所以这里不需要额外操作
  },

  // 稍后提醒
  snooze() {
    wx.showActionSheet({
      itemList: ['10分钟后', '30分钟后', '1小时后', '2小时后'],
      success: (res) => {
        let minutes = 0;
        switch(res.tapIndex) {
          case 0: minutes = 10; break;
          case 1: minutes = 30; break;
          case 2: minutes = 60; break;
          case 3: minutes = 120; break;
        }
        
        // 停止当前提醒
        app.stopReminder();
        
        wx.showToast({
          title: `${minutes}分钟后提醒`,
          icon: 'none'
        });
        
        // 设置定时器重新提醒
        setTimeout(() => {
          const medicineList = wx.getStorageSync('medicineList') || [];
          const medicine = medicineList.find(m => m.id === this.data.medicine.id);
          if (medicine) {
            app.triggerReminder(medicine);
          }
        }, minutes * 60 * 1000);
        
        // 返回上一页
        wx.navigateBack();
      }
    });
  },

  // 关闭提醒
  closeReminder() {
    app.stopReminder();
    wx.navigateBack();
  }
});