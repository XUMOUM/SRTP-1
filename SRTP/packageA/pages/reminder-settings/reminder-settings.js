Page({
  data: {
    vibrationEnabled: true,
    notificationEnabled: false,
    hasSubscribed: false,
    showPreview: false,
    showRingtoneModal: false,
    selectedRingtone: '默认铃声',
    ringtones: [
      { id: 1, name: '默认铃声', selected: true, type: 'builtin', path: '' },
      { id: 2, name: '轻柔提示', selected: false, type: 'builtin', path: '' },
      { id: 3, name: '经典闹钟', selected: false, type: 'builtin', path: '' },
      { id: 4, name: '自然声音', selected: false, type: 'builtin', path: '' }
    ],
    customRingtones: [],
    currentAudioContext: null,
    isPlaying: false,
    previewAudioContext: null,
    templateId: 'YOUR_TEMPLATE_ID' // 请替换为您的模板ID
  },

  onLoad: function(options) {
    this.loadSettings();
    this.loadCustomRingtones();
    this.checkSubscriptionStatus();
    
    if (options.guide === 'notification') {
      setTimeout(() => {
        this.subscribeNotification();
      }, 500);
    }
  },

  // 检查订阅状态
  checkSubscriptionStatus: function() {
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const subStatus = res.subscriptionsSetting;
        const hasSubscribed = subStatus.itemSettings && 
                              subStatus.itemSettings[this.data.templateId] === 'accept';
        this.setData({ hasSubscribed });
        
        const settings = wx.getStorageSync('reminderSettings') || {};
        settings.hasSubscribed = hasSubscribed;
        wx.setStorageSync('reminderSettings', settings);
      }
    });
  },

  // 订阅通知
  subscribeNotification: function(callback) {
    wx.requestSubscribeMessage({
      tmplIds: [this.data.templateId],
      success: (res) => {
        if (res[this.data.templateId] === 'accept') {
          this.setData({ hasSubscribed: true });
          
          const settings = wx.getStorageSync('reminderSettings') || {};
          settings.hasSubscribed = true;
          wx.setStorageSync('reminderSettings', settings);
          
          this.saveSubscriptionToCloud();
          
          wx.showToast({
            title: '授权成功',
            icon: 'success'
          });
          
          if (callback) callback();
        } else {
          wx.showToast({
            title: '您拒绝了通知',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        console.error('订阅失败', err);
        if (err.errCode === 20004) {
          wx.showModal({
            title: '提示',
            content: '您已关闭小程序消息通知，请前往设置开启',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting({
                  withSubscriptions: true
                });
              }
            }
          });
        }
      }
    });
  },

  // 保存订阅状态到云端
  saveSubscriptionToCloud: function() {
    const db = wx.cloud.database();
    const userInfo = wx.getStorageSync('userInfo');
    
    if (!userInfo || !userInfo._openid) return;
    
    db.collection('userSettings').where({
      _openid: userInfo._openid
    }).update({
      data: {
        subscribedTemplates: [this.data.templateId],
        updatedAt: db.serverDate()
      }
    }).catch(() => {
      db.collection('userSettings').add({
        data: {
          _openid: userInfo._openid,
          subscribedTemplates: [this.data.templateId],
          createdAt: db.serverDate()
        }
      });
    });
  },

  // 加载设置
  loadSettings: function() {
    const settings = wx.getStorageSync('reminderSettings') || {};
    this.setData({
      vibrationEnabled: settings.vibrationEnabled !== false,
      notificationEnabled: settings.notificationEnabled || false,
      hasSubscribed: settings.hasSubscribed || false
    });
    
    if (settings.selectedRingtone) {
      this.setData({ selectedRingtone: settings.selectedRingtone });
      this.updateRingtoneSelection(settings.selectedRingtone);
    }
  },

  // 加载自定义铃声
  loadCustomRingtones: function() {
    const customRingtones = wx.getStorageSync('customRingtones') || [];
    this.setData({ customRingtones });
  },

  // 保存设置
  saveSettings: function() {
    const settings = {
      vibrationEnabled: this.data.vibrationEnabled,
      notificationEnabled: this.data.notificationEnabled,
      selectedRingtone: this.data.selectedRingtone,
      hasSubscribed: this.data.hasSubscribed
    };
    wx.setStorageSync('reminderSettings', settings);
  },

  // 保存自定义铃声
  saveCustomRingtones: function() {
    wx.setStorageSync('customRingtones', this.data.customRingtones);
  },

  // 切换振动
  toggleVibration: function(e) {
    this.setData({
      vibrationEnabled: e.detail.value
    });
    this.saveSettings();
  },

  // 切换通知开关
  toggleNotification: function(e) {
    const enabled = e.detail.value;
    
    if (enabled && !this.data.hasSubscribed) {
      this.subscribeNotification(() => {
        this.setData({ notificationEnabled: true });
        this.saveSettings();
      });
    } else {
      this.setData({ notificationEnabled: enabled });
      this.saveSettings();
    }
  },

  // 显示铃声选择器
  showRingtonePicker: function() {
    this.setData({
      showRingtoneModal: true,
      showPreview: true
    });
  },

  // 隐藏铃声选择器
  hideRingtoneModal: function() {
    this.stopPreviewRingtone();
    this.setData({
      showRingtoneModal: false
    });
  },

  // 选择铃声
  selectRingtone: function(e) {
    const ringtone = e.currentTarget.dataset.ringtone;
    this.setSelectedRingtone(ringtone.name, ringtone.type);
    this.playRingtonePreview(ringtone);
  },

  // 选择自定义铃声
  selectCustomRingtone: function(e) {
    const ringtone = e.currentTarget.dataset.ringtone;
    this.setSelectedRingtone(ringtone.name, 'custom');
    this.playRingtonePreview(ringtone);
  },

  // 设置选中的铃声
  setSelectedRingtone: function(name, type) {
    const ringtones = this.data.ringtones.map(item => {
      return {
        ...item,
        selected: item.name === name && type === 'builtin'
      };
    });
    
    const customRingtones = this.data.customRingtones.map(item => {
      return {
        ...item,
        selected: item.name === name && type === 'custom'
      };
    });

    this.setData({
      ringtones: ringtones,
      customRingtones: customRingtones,
      selectedRingtone: name,
      showPreview: true
    });
    
    this.saveSettings();
  },

  // 更新铃声选择状态
  updateRingtoneSelection: function(selectedName) {
    const ringtones = this.data.ringtones.map(item => {
      return {
        ...item,
        selected: item.name === selectedName
      };
    });
    this.setData({
      ringtones: ringtones
    });
  },

  // 确认铃声选择
  confirmRingtone: function() {
    this.stopPreviewRingtone();
    this.saveSettings();
    this.hideRingtoneModal();
  },

  // 上传自定义铃声
  uploadCustomRingtone: function() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['mp3', 'wav', 'aac', 'm4a'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].path;
        const fileName = res.tempFiles[0].name;
        const fileSize = res.tempFiles[0].size;
        
        if (fileSize > 5 * 1024 * 1024) {
          wx.showToast({
            title: '文件太大，请选择5MB以内的音频',
            icon: 'none'
          });
          return;
        }
        
        this.processCustomRingtone(tempFilePath, fileName);
      },
      fail: (err) => {
        console.error('选择文件失败:', err);
        wx.showToast({
          title: '选择文件失败',
          icon: 'none'
        });
      }
    });
  },

  // 处理自定义铃声
  processCustomRingtone: function(tempFilePath, fileName) {
    wx.showLoading({
      title: '处理中...',
    });
    
    const audioContext = wx.createInnerAudioContext();
    audioContext.src = tempFilePath;
    
    audioContext.onCanplay(() => {
      setTimeout(() => {
        const duration = Math.round(audioContext.duration);
        audioContext.destroy();
        
        const ringtoneId = Date.now();
        
        const newRingtone = {
          id: ringtoneId,
          name: fileName.replace(/\.[^/.]+$/, ""),
          path: tempFilePath,
          duration: duration,
          selected: false,
          type: 'custom'
        };
        
        const customRingtones = [...this.data.customRingtones, newRingtone];
        this.setData({ customRingtones });
        this.saveCustomRingtones();
        
        wx.hideLoading();
        wx.showToast({
          title: '上传成功',
          icon: 'success'
        });
        
        this.setSelectedRingtone(newRingtone.name, 'custom');
      }, 500);
    });
    
    audioContext.onError((err) => {
      console.error('音频加载失败:', err);
      wx.hideLoading();
      wx.showToast({
        title: '音频文件格式不支持',
        icon: 'none'
      });
    });
  },

  // 播放铃声预览
  playRingtonePreview: function(ringtone) {
    this.stopPreviewRingtone();
    
    let audioPath = '';
    
    if (ringtone.type === 'builtin') {
      audioPath = this.getBuiltinRingtonePath(ringtone.name);
    } else {
      audioPath = ringtone.path;
    }
    
    if (!audioPath) {
      return;
    }
    
    this.data.previewAudioContext = wx.createInnerAudioContext();
    this.data.previewAudioContext.src = audioPath;
    this.data.previewAudioContext.loop = false;
    
    this.data.previewAudioContext.onPlay(() => {
      if (this.data.vibrationEnabled) {
        this.vibratePhone();
      }
    });
    
    this.data.previewAudioContext.onEnded(() => {
      this.data.previewAudioContext.destroy();
      this.data.previewAudioContext = null;
    });
    
    this.data.previewAudioContext.onError((err) => {
      console.error('预览播放失败:', err);
      this.data.previewAudioContext.destroy();
      this.data.previewAudioContext = null;
    });
    
    this.data.previewAudioContext.play();
  },

  // 停止预览铃声
  stopPreviewRingtone: function() {
    if (this.data.previewAudioContext) {
      this.data.previewAudioContext.stop();
      this.data.previewAudioContext.destroy();
      this.data.previewAudioContext = null;
    }
  },

  // 播放铃声
  playRingtone: function() {
    if (this.data.isPlaying) {
      this.stopRingtone();
      return;
    }
    
    let audioPath = '';
    
    const builtinRingtone = this.data.ringtones.find(item => item.selected);
    const customRingtone = this.data.customRingtones.find(item => item.selected);
    
    if (builtinRingtone) {
      audioPath = this.getBuiltinRingtonePath(builtinRingtone.name);
    } else if (customRingtone) {
      audioPath = customRingtone.path;
    }
    
    if (!audioPath) {
      wx.showToast({
        title: '无法播放铃声',
        icon: 'none'
      });
      return;
    }
    
    this.data.currentAudioContext = wx.createInnerAudioContext();
    this.data.currentAudioContext.src = audioPath;
    this.data.currentAudioContext.loop = false;
    
    this.data.currentAudioContext.onPlay(() => {
      this.setData({ isPlaying: true });
      if (this.data.vibrationEnabled) {
        this.vibratePhone();
      }
    });
    
    this.data.currentAudioContext.onEnded(() => {
      this.setData({ isPlaying: false });
      this.data.currentAudioContext.destroy();
      this.data.currentAudioContext = null;
    });
    
    this.data.currentAudioContext.onError((err) => {
      console.error('播放失败:', err);
      this.setData({ isPlaying: false });
      wx.showToast({
        title: '播放失败',
        icon: 'none'
      });
    });
    
    this.data.currentAudioContext.play();
  },

  // 振动
  vibratePhone: function() {
    wx.vibrateShort({
      success: () => {
        console.log('振动成功');
      },
      fail: (err) => {
        console.error('振动失败:', err);
        wx.vibrateLong({
          fail: (err) => {
            console.error('长振动也失败:', err);
          }
        });
      }
    });
  },

  // 获取内置铃声路径
  getBuiltinRingtonePath: function(ringtoneName) {
    const pathMap = {
      '默认铃声': '/packageAudio/assets/audio/default.wav',
      '轻柔提示': '/packageAudio/assets/audio/soft.wav',
      '经典闹钟': '/packageAudio/assets/audio/alarm.wav',
      '自然声音': '/packageAudio/assets/audio/nature.wav'
    };
    return pathMap[ringtoneName] || '/packageAudio/assets/audio/default.wav';
  },

  // 删除自定义铃声
  deleteCustomRingtone: function(e) {
    e.stopPropagation();
    const ringtoneId = e.currentTarget.dataset.id;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个铃声吗？',
      success: (res) => {
        if (res.confirm) {
          const customRingtones = this.data.customRingtones.filter(item => item.id !== ringtoneId);
          this.setData({ customRingtones });
          this.saveCustomRingtones();
          
          const deletedRingtone = this.data.customRingtones.find(item => item.id === ringtoneId);
          if (deletedRingtone && deletedRingtone.selected) {
            this.setSelectedRingtone('默认铃声', 'builtin');
          }
          
          wx.showToast({
            title: '删除成功',
            icon: 'success'
          });
        }
      }
    });
  },

  // 停止铃声
  stopRingtone: function() {
    if (this.data.currentAudioContext) {
      this.data.currentAudioContext.stop();
      this.data.currentAudioContext.destroy();
      this.data.currentAudioContext = null;
    }
    this.setData({ isPlaying: false });
  },

  onUnload: function() {
    this.stopRingtone();
    this.stopPreviewRingtone();
  }
});