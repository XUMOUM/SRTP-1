const app = getApp();

Page({
  data: {
    lockType: 'pin',           // 密码类型：pin/pattern
    inputPassword: '',          // 当前输入的密码
    errorMessage: '',           // 错误提示
    maxAttempts: 5,             // 最大尝试次数
    attempts: 0,                 // 已尝试次数
    isLocked: false,             // 是否已锁定
    lockTime: 0                   // 锁定时间（秒）
  },

  onLoad: function() {
    // 获取密码设置
    const privacySettings = wx.getStorageSync('privacySettings') || {};
    
    this.setData({
      lockType: privacySettings.lockType || 'pin'
    });
    
    // 如果没有设置密码，直接进入首页
    if (!privacySettings.lockEnabled) {
      this.goToIndex();
    }
  },

  // 数字键盘按键
  onKeyPress: function(e) {
    if (this.data.isLocked) return;
    
    const key = e.currentTarget.dataset.key;
    let inputPassword = this.data.inputPassword;
    
    if (inputPassword.length < 6) {
      inputPassword += key;
      this.setData({ inputPassword });
      
      // 输入满6位时验证
      if (inputPassword.length === 6) {
        this.verifyPassword(inputPassword);
      }
    }
  },

  // 删除键
  onDelete: function() {
    if (this.data.isLocked) return;
    
    let inputPassword = this.data.inputPassword;
    if (inputPassword.length > 0) {
      inputPassword = inputPassword.slice(0, -1);
      this.setData({ inputPassword });
    }
  },

  // 验证密码
  verifyPassword: function(password) {
    const privacySettings = wx.getStorageSync('privacySettings') || {};
    const correctPassword = privacySettings.pinPassword || '';
    
    if (password === correctPassword) {
      // 密码正确，更新最后解锁时间
      privacySettings.lastUnlockTime = new Date().getTime();
      wx.setStorageSync('privacySettings', privacySettings);
      
      console.log('✅ 解锁成功，已更新解锁时间:', new Date(privacySettings.lastUnlockTime).toLocaleString());
      
      this.goToIndex();
    } else {
      // 密码错误
      const attempts = this.data.attempts + 1;
      const remaining = this.data.maxAttempts - attempts;
      
      if (attempts >= this.data.maxAttempts) {
        // 超过最大尝试次数，锁定
        this.lockForMinutes(5);
      } else {
        this.setData({
          inputPassword: '',
          attempts: attempts,
          errorMessage: `密码错误，还剩${remaining}次机会`
        });
        
        // 震动提示
        wx.vibrateShort();
      }
    }
  },

  // 锁定一段时间
  lockForMinutes: function(minutes) {
    const lockTime = minutes * 60;
    this.setData({
      isLocked: true,
      lockTime: lockTime,
      errorMessage: `尝试次数过多，已锁定${minutes}分钟`
    });
    
    // 倒计时
    this.lockTimer = setInterval(() => {
      let time = this.data.lockTime - 1;
      if (time <= 0) {
        clearInterval(this.lockTimer);
        this.setData({
          isLocked: false,
          lockTime: 0,
          attempts: 0,
          errorMessage: ''
        });
      } else {
        this.setData({ lockTime: time });
      }
    }, 1000);
  },

  // 忘记密码
  forgotPassword: function() {
    wx.showModal({
      title: '忘记密码',
      content: '忘记密码后需要清除所有数据才能重置。确定要继续吗？',
      confirmColor: '#e53e3e',
      success: (res) => {
        if (res.confirm) {
          this.resetAllData();
        }
      }
    });
  },

  // 重置所有数据
  resetAllData: function() {
    wx.showLoading({ title: '重置中...' });
    
    try {
      // 清除所有缓存
      wx.clearStorageSync();
      
      // 重新初始化默认数据
      const defaultMedicineList = [
        {
          id: 1,
          name: '阿司匹林肠溶片',
          dosageNumber: '1',
          dosageUnit: '片',
          instruction: '饭后服用',
          times: ['08:00'],
          frequency: '1',
          frequencyDisplay: '1次/日',
          notes: ''
        }
      ];
      wx.setStorageSync('medicineList', defaultMedicineList);
      
      wx.hideLoading();
      wx.showToast({
        title: '重置成功',
        icon: 'success',
        duration: 2000,
        success: () => {
          setTimeout(() => {
            this.goToIndex();
          }, 2000);
        }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({
        title: '重置失败',
        icon: 'none'
      });
    }
  },

  // 切换账号
  switchAccount: function() {
    wx.showModal({
      title: '切换账号',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          // 清除用户信息
          wx.removeStorageSync('userInfo');
          // 跳转到登录页
          wx.reLaunch({
            url: '/pages/profile/profile'
          });
        }
      }
    });
  },

  // 跳转到首页
  goToIndex: function() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  onUnload: function() {
    if (this.lockTimer) {
      clearInterval(this.lockTimer);
    }
  }
});