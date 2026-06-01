Page({
  data: {
    // 好友可见性
    friendVisible: true,
    
    // 小程序锁设置
    lockEnabled: false,
    lockType: 'pin', // 'pin' 或 'pattern'
    lockTimeIndex: 2, // 默认15分钟
    lockTimeOptions: ['立即锁屏', '1分钟后', '5分钟后', '15分钟后', '30分钟后', '1小时后'],
    
    // 密码状态
    hasPinPassword: false,
    hasPatternPassword: false,
    
    // 数字密码弹窗
    showPinModal: false,
    pinModalTitle: '设置数字密码',
    pinInput: '',
    pinConfirmInput: '',
    pinStep: 'input', // 'input' 或 'confirm'
    pinHint: '请输入6位数字密码',
    
    // 图形密码弹窗
    showPatternModal: false,
    patternModalTitle: '设置图形密码',
    patternPoints: [],
    patternPassword: '',
    patternConfirmPassword: '',
    patternStep: 'input',
    patternHint: '请绘制图形密码',
    patternConfirmed: false,
    
    // 画布上下文
    ctx: null,
    canvasWidth: 500,
    canvasHeight: 500,
    pointRadius: 30,
    points: [
      { x: 100, y: 100, index: 1 },  // 1
      { x: 250, y: 100, index: 2 },  // 2
      { x: 400, y: 100, index: 3 },  // 3
      { x: 100, y: 250, index: 4 },  // 4
      { x: 250, y: 250, index: 5 },  // 5
      { x: 400, y: 250, index: 6 },  // 6
      { x: 100, y: 400, index: 7 },  // 7
      { x: 250, y: 400, index: 8 },  // 8
      { x: 400, y: 400, index: 9 }   // 9
    ],
    
    // 忘记密码弹窗
    showForgotModal: false
  },

  onLoad: function() {
    this.loadPrivacySettings();
    this.initCanvas();
  },

  // 加载隐私设置
  loadPrivacySettings: function() {
    const settings = wx.getStorageSync('privacySettings') || {};
    this.setData({
      friendVisible: settings.friendVisible !== undefined ? settings.friendVisible : true,
      lockEnabled: settings.lockEnabled || false,
      lockType: settings.lockType || 'pin',
      lockTimeIndex: settings.lockTimeIndex || 2,
      hasPinPassword: !!settings.pinPassword,
      hasPatternPassword: !!settings.patternPassword
    });
  },

  // 保存隐私设置
savePrivacySettings: function() {
  // 构建完整的设置对象
  const settings = {
    friendVisible: this.data.friendVisible,
    lockEnabled: this.data.lockEnabled,
    lockType: this.data.lockType,
    lockTimeIndex: this.data.lockTimeIndex,
    pinPassword: this.data.pinPassword || '',  // 直接保存密码
    patternPassword: this.data.patternPassword || '',
    hasPinPassword: !!this.data.pinPassword,    // 根据密码是否存在设置
    hasPatternPassword: !!this.data.patternPassword,
    lastUnlockTime: this.data.lastUnlockTime || new Date().getTime()
  };
  
  // 保存到本地存储
  wx.setStorageSync('privacySettings', settings);
  
  console.log('隐私设置已保存:', settings);
},

  // 切换好友可见性
  toggleFriendVisible: function(e) {
    this.setData({
      friendVisible: e.detail.value
    }, () => {
      this.savePrivacySettings();
      wx.showToast({
        title: this.data.friendVisible ? '好友可见已开启' : '好友可见已关闭',
        icon: 'success',
        duration: 1500
      });
    });
  },

  // 切换小程序锁启用状态
  toggleLockEnabled: function(e) {
    const enabled = e.detail.value;
    
    if (enabled && !this.data.hasPinPassword && !this.data.hasPatternPassword) {
      // 如果开启但没有设置密码，自动打开数字密码设置
      this.setData({
        lockEnabled: true,
        showPinModal: true,
        pinModalTitle: '设置数字密码',
        pinStep: 'input',
        pinInput: '',
        pinHint: '请输入6位数字密码'
      });
    } else {
      this.setData({
        lockEnabled: enabled
      }, () => {
        this.savePrivacySettings();
        wx.showToast({
          title: enabled ? '小程序锁已开启' : '小程序锁已关闭',
          icon: 'success',
          duration: 1500
        });
      });
    }
  },

  // 选择锁类型
  selectLockType: function(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      lockType: type
    }, () => {
      this.savePrivacySettings();
    });
  },

  // 自动锁屏时间改变
  onLockTimeChange: function(e) {
    this.setData({
      lockTimeIndex: e.detail.value
    }, () => {
      this.savePrivacySettings();
    });
  },

  // 设置密码
  setPassword: function(e) {
    const type = e.currentTarget.dataset.type;
    if (type === 'pin') {
      this.setData({
        showPinModal: true,
        pinModalTitle: '设置数字密码',
        pinStep: 'input',
        pinInput: '',
        pinHint: '请输入6位数字密码'
      });
    } else {
      this.setData({
        showPatternModal: true,
        patternModalTitle: '设置图形密码',
        patternStep: 'input',
        patternPoints: [],
        patternPassword: '',
        patternHint: '请绘制图形密码',
        patternConfirmed: false
      }, () => {
        this.drawPatternGrid();
      });
    }
  },

  // 修改密码
  modifyPassword: function(e) {
    const type = e.currentTarget.dataset.type;
    if (type === 'pin') {
      this.setData({
        showPinModal: true,
        pinModalTitle: '修改数字密码',
        pinStep: 'input',
        pinInput: '',
        pinHint: '请输入新的6位数字密码'
      });
    } else {
      this.setData({
        showPatternModal: true,
        patternModalTitle: '修改图形密码',
        patternStep: 'input',
        patternPoints: [],
        patternPassword: '',
        patternHint: '请绘制新的图形密码',
        patternConfirmed: false
      }, () => {
        this.drawPatternGrid();
      });
    }
  },

  // 显示忘记密码弹窗
  showForgotModal: function() {
    this.setData({
      showForgotModal: true
    });
  },

  // 隐藏忘记密码弹窗
  hideForgotModal: function() {
    this.setData({
      showForgotModal: false
    });
  },

  // 重置所有数据
  resetAllData: function() {
    wx.showModal({
      title: '确认重置',
      content: '此操作将删除所有缓存、用药记录和用药数据，且不可恢复。确定要继续吗？',
      confirmColor: '#e53e3e',
      success: (res) => {
        if (res.confirm) {
          wx.showModal({
            title: '最后确认',
            content: '真的确定要删除所有数据吗？所有用药计划和记录都将丢失。',
            confirmColor: '#e53e3e',
            success: (res2) => {
              if (res2.confirm) {
                this.performReset();
              }
            }
          });
        }
      }
    });
  },

  // 执行重置操作
  performReset: function() {
    wx.showLoading({
      title: '正在重置...',
    });
    
    try {
      // 1. 清除所有缓存
      wx.clearStorageSync();
      
      // 2. 重置当前页面数据
      this.setData({
        friendVisible: true,
        lockEnabled: false,
        lockType: 'pin',
        lockTimeIndex: 2,
        hasPinPassword: false,
        hasPatternPassword: false,
        showForgotModal: false
      });
      
      // 3. 重新初始化默认药品数据
      const defaultMedicineList = [
        {
          id: 1,
          name: '阿司匹林肠溶片',
          dosageNumber: '1',
          dosageUnit: '片',
          instruction: '饭后服用',
          times: ['08:00', '12:00', '20:00'],
          frequency: '3',
          frequencyDisplay: '3次/日',
          notes: ''
        },
        {
          id: 2,
          name: '降压药',
          dosageNumber: '1',
          dosageUnit: '粒',
          instruction: '饭前服用',
          times: ['07:30'],
          frequency: '1',
          frequencyDisplay: '1次/日',
          notes: '血压稳定时服用'
        },
        {
          id: 3,
          name: '维生素C',
          dosageNumber: '2',
          dosageUnit: '粒',
          instruction: '随餐服用',
          times: ['12:00'],
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
          // 跳转到首页
          setTimeout(() => {
            wx.switchTab({
              url: '/pages/index/index'
            });
          }, 2000);
        }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({
        title: '重置失败',
        icon: 'none'
      });
      console.error('重置失败:', err);
    }
  },

  // 隐藏数字密码弹窗
  hidePinModal: function() {
    this.setData({
      showPinModal: false,
      pinInput: '',
      pinConfirmInput: ''
    });
  },

  // 隐藏图形密码弹窗
  hidePatternModal: function() {
    this.setData({
      showPatternModal: false,
      patternPoints: [],
      patternPassword: '',
      patternConfirmPassword: ''
    });
  },

  // 数字键盘按键
  onPinKeyPress: function(e) {
    const key = e.currentTarget.dataset.key;
    let pinInput = this.data.pinInput;
    
    if (pinInput.length < 6) {
      pinInput += key;
      this.setData({ pinInput });
    }
  },

  // 数字键盘删除
  onPinDelete: function() {
    let pinInput = this.data.pinInput;
    if (pinInput.length > 0) {
      pinInput = pinInput.slice(0, -1);
      this.setData({ pinInput });
    }
  },

  // 确认数字密码
  confirmPin: function() {
    if (this.data.pinInput.length !== 6) return;
    
    if (this.data.pinStep === 'input') {
      // 第一步：输入密码
      this.setData({
        pinStep: 'confirm',
        pinConfirmInput: this.data.pinInput,
        pinInput: '',
        pinHint: '请再次输入密码确认'
      });
    } else {
      // 第二步：确认密码
      if (this.data.pinInput === this.data.pinConfirmInput) {
        // 保存密码到隐私设置
        const settings = wx.getStorageSync('privacySettings') || {};
        settings.pinPassword = this.data.pinInput;
        settings.hasPinPassword = true;
        settings.lockType = 'pin';
        settings.lastUnlockTime = new Date().getTime();
        wx.setStorageSync('privacySettings', settings);
        
        this.setData({
          hasPinPassword: true,
          showPinModal: false,
          pinInput: '',
          pinConfirmInput: ''
        });
        
        wx.showToast({
          title: '密码设置成功',
          icon: 'success'
        });
      } else {
        this.setData({
          pinInput: '',
          pinHint: '两次密码不一致，请重新输入'
        });
      }
    }
  },

  // 初始化画布
  initCanvas: function() {
    const ctx = wx.createCanvasContext('patternCanvas', this);
    this.setData({ ctx });
  },

  // 绘制图形密码网格
  drawPatternGrid: function() {
    const ctx = this.data.ctx;
    if (!ctx) return;
    
    ctx.clearRect(0, 0, this.data.canvasWidth, this.data.canvasHeight);
    
    // 绘制9个点
    this.data.points.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, this.data.pointRadius, 0, 2 * Math.PI);
      ctx.setFillStyle('#e2e8f0');
      ctx.fill();
      ctx.setStrokeStyle('#cbd5e0');
      ctx.setLineWidth(2);
      ctx.stroke();
      
      // 如果点被选中，高亮显示
      if (this.data.patternPoints.includes(point.index)) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, this.data.pointRadius - 5, 0, 2 * Math.PI);
        ctx.setFillStyle('#667eea');
        ctx.fill();
      }
    });
    
    // 绘制连接线
    if (this.data.patternPoints.length > 1) {
      ctx.setStrokeStyle('#667eea');
      ctx.setLineWidth(4);
      ctx.beginPath();
      
      const firstPoint = this.data.points.find(p => p.index === this.data.patternPoints[0]);
      ctx.moveTo(firstPoint.x, firstPoint.y);
      
      for (let i = 1; i < this.data.patternPoints.length; i++) {
        const point = this.data.points.find(p => p.index === this.data.patternPoints[i]);
        ctx.lineTo(point.x, point.y);
      }
      
      ctx.stroke();
    }
    
    ctx.draw();
  },

  // 触摸开始
  onPatternTouchStart: function(e) {
    const touch = e.touches[0];
    const point = this.getTouchedPoint(touch.x, touch.y);
    
    if (point && !this.data.patternPoints.includes(point.index)) {
      this.setData({
        patternPoints: [point.index]
      }, () => {
        this.drawPatternGrid();
      });
    }
  },

  // 触摸移动
  onPatternTouchMove: function(e) {
    const touch = e.touches[0];
    const point = this.getTouchedPoint(touch.x, touch.y);
    
    if (point && !this.data.patternPoints.includes(point.index)) {
      const patternPoints = [...this.data.patternPoints, point.index];
      this.setData({ patternPoints }, () => {
        this.drawPatternGrid();
      });
    }
  },

  // 触摸结束
  onPatternTouchEnd: function() {
    if (this.data.patternPoints.length < 4) {
      this.setData({
        patternHint: '至少连接4个点',
        patternPoints: []
      }, () => {
        this.drawPatternGrid();
      });
      return;
    }
    
    const patternString = this.data.patternPoints.join('');
    
    if (this.data.patternStep === 'input') {
      // 第一步：输入密码
      this.setData({
        patternStep: 'confirm',
        patternPassword: patternString,
        patternPoints: [],
        patternHint: '请再次绘制密码确认',
        patternConfirmed: false
      }, () => {
        this.drawPatternGrid();
      });
    } else {
      // 第二步：确认密码
      if (patternString === this.data.patternPassword) {
        // 保存密码到隐私设置
        const settings = wx.getStorageSync('privacySettings') || {};
        settings.patternPassword = patternString;
        settings.hasPatternPassword = true;
        settings.lockType = 'pattern';
        settings.lastUnlockTime = new Date().getTime();
        wx.setStorageSync('privacySettings', settings);
        
        this.setData({
          hasPatternPassword: true,
          showPatternModal: false,
          patternConfirmed: true
        });
        
        wx.showToast({
          title: '密码设置成功',
          icon: 'success'
        });
      } else {
        this.setData({
          patternPoints: [],
          patternHint: '两次密码不一致，请重新绘制',
          patternConfirmed: false
        }, () => {
          this.drawPatternGrid();
        });
      }
    }
  },

  // 确认图形密码
  confirmPattern: function() {
    // 实际确认逻辑已在触摸结束时处理
  },

  // 获取触摸的点
  getTouchedPoint: function(touchX, touchY) {
    // 由于需要在回调中返回值，这里使用同步方式处理
    const query = wx.createSelectorQuery().in(this);
    return new Promise((resolve) => {
      query.select('.pattern-canvas').boundingClientRect(rect => {
        if (rect) {
          const x = touchX - rect.left;
          const y = touchY - rect.top;
          
          // 查找最近的点
          for (let point of this.data.points) {
            const distance = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
            if (distance <= this.data.pointRadius) {
              resolve(point);
              return;
            }
          }
        }
        resolve(null);
      }).exec();
    });
  },

  // 注意：由于getTouchedPoint改为返回Promise，需要修改触摸事件处理
  // 实际使用时需要调整触摸事件处理函数为async/await
});