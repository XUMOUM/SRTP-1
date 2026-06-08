// 引入SyncManager实现离线优先同步
const syncManager = require('../../../utils/syncManager.js');

Page({
  data: {
    // 用户信息
    userId: '',
    avatarUrl: '',
    nickName: '',
    genderIndex: 0,
    genderOptions: ['保密', '男', '女'],
    birthday: '',
    phoneNumber: '',
    
    // 当前日期（用于日期选择器）
    currentDate: '',
    
    // 是否可保存
    canSave: false,
    
    // 原始数据，用于比较是否修改
    originalData: {},
    
    // 同步状态
    syncStatus: 'synced', // synced | pending | error

    // ===== 新增：健康档案 =====
    // 过敏史
    allergies: [],
    allergyInput: '',
    allergyOptions: ['青霉素', '头孢菌素', '磺胺类', '阿司匹林', '布洛芬', '碘', '麻药', '乳糖', '花粉', '尘螨'],
    
    // 慢性病史
    chronicDiseases: [],
    chronicInput: '',
    chronicOptions: ['高血压', '糖尿病', '胃溃疡', '肝病', '肾病', '心脏病', '哮喘', '甲状腺疾病', '痛风', '癫痫'],
    
    // 手术史
    surgeries: [],
    surgeryInput: '',
    
    // 特殊状态
    specialStatusIndex: 0,
    specialStatusOptions: ['无特殊', '备孕期', '孕期', '哺乳期', '老年（>65岁）', '儿童（<12岁）']
  },

  onLoad: function(options) {
    console.log('个人信息编辑页面加载');
    
    // 获取当前日期
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    
    this.setData({
      currentDate: `${year}-${month}-${day}`
    });
    
    // 加载用户信息（离线优先）
    this.loadUserInfo();
    
    // 后台同步云端
    this.syncFromCloud();
  },

  onShow: function() {
    this.checkSyncStatus();
  },

  // ================= 数据加载（离线优先） =================

  /**
   * 加载用户信息（本地优先 + 云端校验）
   */
  loadUserInfo: function() {
    // 1. 优先从本地加载
    const userInfo = wx.getStorageSync('userInfo') || {};
    const healthProfile = wx.getStorageSync('healthProfile') || {};
    
    console.log('加载本地用户信息:', userInfo);
    console.log('加载本地健康档案:', healthProfile);
    
    this.setData({
      userId: userInfo.userId || '',
      avatarUrl: userInfo.avatarUrl || 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
      nickName: userInfo.nickName || '',
      genderIndex: userInfo.gender || 0,
      birthday: userInfo.birthday || '',
      phoneNumber: userInfo.phoneNumber || '',
      allergies: healthProfile.allergies || [],
      chronicDiseases: healthProfile.chronicDiseases || [],
      surgeries: healthProfile.surgeries || [],
      specialStatusIndex: healthProfile.specialStatusIndex || 0,
      originalData: { ...userInfo, ...healthProfile }
    });
  },

  /**
   * 从云端同步数据
   */
  syncFromCloud: function() {
    wx.cloud.callFunction({
      name: 'syncData',
      data: {
        action: 'get',
        key: 'health_profile'
      },
      success: (res) => {
        if (res.result.success && res.result.data) {
          const cloudProfile = res.result.data;
          const localProfile = wx.getStorageSync('healthProfile') || {};
          
          // 比较时间戳，以云端为准（如果云端更新）
          if (cloudProfile._cloudTimestamp > (localProfile._localTimestamp || 0)) {
            console.log('[profile-edit] 使用云端健康档案');
            
            this.setData({
              allergies: cloudProfile.allergies || [],
              chronicDiseases: cloudProfile.chronicDiseases || [],
              surgeries: cloudProfile.surgeries || [],
              specialStatusIndex: cloudProfile.specialStatusIndex || 0
            });
            
            // 更新本地缓存
            wx.setStorageSync('healthProfile', {
              allergies: cloudProfile.allergies || [],
              chronicDiseases: cloudProfile.chronicDiseases || [],
              surgeries: cloudProfile.surgeries || [],
              specialStatusIndex: cloudProfile.specialStatusIndex || 0,
              specialStatusName: this.data.specialStatusOptions[cloudProfile.specialStatusIndex || 0],
              _localTimestamp: cloudProfile._cloudTimestamp
            });
          }
        }
      },
      fail: (err) => {
        console.warn('[profile-edit] 云端同步失败:', err);
      }
    });
  },

  /**
   * 检查同步状态
   */
  checkSyncStatus: function() {
    try {
      const data = wx.getStorageSync('health_profile');
      if (data && data._syncStatus === 'pending') {
        this.setData({ syncStatus: 'pending' });
        // 尝试同步
        syncManager.forceSync();
      } else {
        this.setData({ syncStatus: 'synced' });
      }
    } catch (e) {
      this.setData({ syncStatus: 'error' });
    }
  },

  // ================= 头像上传 =================

  chooseAvatar: function() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0];
        
        wx.showLoading({ title: '上传中...' });
        
        const cloudPath = `avatars/${Date.now()}.jpg`;
        wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath,
          success: (uploadRes) => {
            const fileID = uploadRes.fileID;
            
            wx.cloud.getTempFileURL({
              fileList: [fileID],
              success: (urlRes) => {
                wx.hideLoading();
                this.setData({
                  avatarUrl: urlRes.fileList[0].tempFileURL
                }, () => {
                  this.checkCanSave();
                });
              },
              fail: () => {
                wx.hideLoading();
                wx.showToast({ title: '获取链接失败', icon: 'none' });
              }
            });
          },
          fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '上传失败', icon: 'none' });
          }
        });
      }
    });
  },

  // ================= 表单操作 =================

  onNickNameInput: function(e) {
    this.setData({ nickName: e.detail.value }, () => { this.checkCanSave(); });
  },

  onGenderChange: function(e) {
    this.setData({ genderIndex: e.detail.value }, () => { this.checkCanSave(); });
  },

  onBirthdayChange: function(e) {
    this.setData({ birthday: e.detail.value }, () => { this.checkCanSave(); });
  },

  onPhoneInput: function(e) {
    this.setData({ phoneNumber: e.detail.value }, () => { this.checkCanSave(); });
  },

  // ================= 健康档案：过敏史 =================
  onAllergyInput: function(e) {
    this.setData({ allergyInput: e.detail.value });
  },
  
  toggleAllergyOption: function(e) {
    const item = e.currentTarget.dataset.item;
    let allergies = [...this.data.allergies];
    const idx = allergies.indexOf(item);
    if (idx >= 0) {
      allergies.splice(idx, 1);
    } else {
      allergies.push(item);
    }
    this.setData({ allergies: allergies }, () => { this.checkCanSave(); });
  },
  
  addAllergy: function() {
    if (!this.data.allergyInput.trim()) return;
    let allergies = [...this.data.allergies];
    if (allergies.indexOf(this.data.allergyInput.trim()) < 0) {
      allergies.push(this.data.allergyInput.trim());
      this.setData({ allergies: allergies, allergyInput: '' }, () => { this.checkCanSave(); });
    }
  },
  
  removeAllergy: function(e) {
    const idx = e.currentTarget.dataset.index;
    let allergies = [...this.data.allergies];
    allergies.splice(idx, 1);
    this.setData({ allergies: allergies }, () => { this.checkCanSave(); });
  },

  // ================= 健康档案：慢性病史 =================
  onChronicInput: function(e) {
    this.setData({ chronicInput: e.detail.value });
  },
  
  toggleChronicOption: function(e) {
    const item = e.currentTarget.dataset.item;
    let chronic = [...this.data.chronicDiseases];
    const idx = chronic.indexOf(item);
    if (idx >= 0) {
      chronic.splice(idx, 1);
    } else {
      chronic.push(item);
    }
    this.setData({ chronicDiseases: chronic }, () => { this.checkCanSave(); });
  },
  
  addChronic: function() {
    if (!this.data.chronicInput.trim()) return;
    let chronic = [...this.data.chronicDiseases];
    if (chronic.indexOf(this.data.chronicInput.trim()) < 0) {
      chronic.push(this.data.chronicInput.trim());
      this.setData({ chronicDiseases: chronic, chronicInput: '' }, () => { this.checkCanSave(); });
    }
  },
  
  removeChronic: function(e) {
    const idx = e.currentTarget.dataset.index;
    let chronic = [...this.data.chronicDiseases];
    chronic.splice(idx, 1);
    this.setData({ chronicDiseases: chronic }, () => { this.checkCanSave(); });
  },

  // ================= 健康档案：手术史 =================
  onSurgeryInput: function(e) {
    this.setData({ surgeryInput: e.detail.value });
  },
  
  addSurgery: function() {
    if (!this.data.surgeryInput.trim()) return;
    let surgeries = [...this.data.surgeries];
    surgeries.push({
      id: Date.now(),
      name: this.data.surgeryInput.trim(),
      time: ''
    });
    this.setData({ surgeries: surgeries, surgeryInput: '' }, () => { this.checkCanSave(); });
  },
  
  onSurgeryTimeChange: function(e) {
    const idx = e.currentTarget.dataset.index;
    let surgeries = [...this.data.surgeries];
    surgeries[idx].time = e.detail.value;
    this.setData({ surgeries: surgeries }, () => { this.checkCanSave(); });
  },
  
  removeSurgery: function(e) {
    const idx = e.currentTarget.dataset.index;
    let surgeries = [...this.data.surgeries];
    surgeries.splice(idx, 1);
    this.setData({ surgeries: surgeries }, () => { this.checkCanSave(); });
  },

  // ================= 健康档案：特殊状态 =================
  onSpecialStatusChange: function(e) {
    this.setData({ specialStatusIndex: Number(e.detail.value) }, () => { this.checkCanSave(); });
  },

  // ================= 保存判断 =================
  checkCanSave: function() {
    const original = this.data.originalData;
    
    const hasChanges = 
      this.data.avatarUrl !== original.avatarUrl ||
      this.data.nickName !== original.nickName ||
      this.data.genderIndex !== (original.gender || 0) ||
      this.data.birthday !== original.birthday ||
      this.data.phoneNumber !== original.phoneNumber ||
      JSON.stringify(this.data.allergies) !== JSON.stringify(original.allergies || []) ||
      JSON.stringify(this.data.chronicDiseases) !== JSON.stringify(original.chronicDiseases || []) ||
      JSON.stringify(this.data.surgeries) !== JSON.stringify(original.surgeries || []) ||
      this.data.specialStatusIndex !== (original.specialStatusIndex || 0);
    
    this.setData({
      canSave: hasChanges && this.data.nickName.trim() !== ''
    });
  },

  copyUserId: function() {
    wx.setClipboardData({
      data: this.data.userId,
      success: () => {
        wx.showToast({ title: 'ID已复制', icon: 'success' });
      }
    });
  },

  // ================= 保存（双写：本地+云端） =================
  saveProfile: function() {
    if (!this.data.canSave) return;
    
    wx.showLoading({ title: '保存中...' });
    
    // 1. 准备健康档案数据
    const healthProfile = {
      allergies: this.data.allergies,
      chronicDiseases: this.data.chronicDiseases,
      surgeries: this.data.surgeries,
      specialStatusIndex: this.data.specialStatusIndex,
      specialStatusName: this.data.specialStatusOptions[this.data.specialStatusIndex]
    };
    
    // 2. 本地写入（即时响应）
    wx.setStorageSync('healthProfile', healthProfile);
    
    const userInfo = wx.getStorageSync('userInfo') || {};
    const updatedUserInfo = {
      ...userInfo,
      avatarUrl: this.data.avatarUrl,
      nickName: this.data.nickName,
      gender: this.data.genderIndex,
      birthday: this.data.birthday,
      phoneNumber: this.data.phoneNumber
    };
    wx.setStorageSync('userInfo', updatedUserInfo);
    
    // 3. 云端同步（后台静默）
    this.syncToCloud(healthProfile, updatedUserInfo);
    
    wx.hideLoading();
    wx.showToast({ title: '保存成功', icon: 'success' });
    
    setTimeout(() => {
      wx.navigateBack();
    }, 1500);
  },

  /**
   * 同步到云端（使用SyncManager）
   */
  syncToCloud: function(healthProfile, userInfo) {
    // 同步健康档案
    syncManager.write('health_profile', healthProfile)
      .then(() => {
        console.log('[profile-edit] 健康档案已同步到云端');
      })
      .catch(err => {
        console.warn('[profile-edit] 健康档案同步失败（将重试）:', err);
      });
    
    // 同步用户基本信息
    syncManager.write('user_info', {
      avatarUrl: userInfo.avatarUrl,
      nickName: userInfo.nickName,
      gender: userInfo.gender,
      birthday: userInfo.birthday,
      phoneNumber: userInfo.phoneNumber
    }).catch(err => {
      console.warn('[profile-edit] 用户信息同步失败:', err);
    });
    
    // 同时更新用户集合（兼容性）
    const db = wx.cloud.database();
    db.collection('users').where({
      _openid: userInfo._openid || ''
    }).update({
      data: {
        avatarUrl: userInfo.avatarUrl,
        nickName: userInfo.nickName,
        gender: userInfo.gender,
        birthday: userInfo.birthday,
        phoneNumber: userInfo.phoneNumber,
        updatedAt: db.serverDate()
      },
      success: () => {
        console.log('[profile-edit] 用户信息已更新到users集合');
      },
      fail: (err) => {
        console.warn('[profile-edit] users集合更新失败:', err);
      }
    });
  },

  // ================= 手机号绑定 =================
  getPhoneNumber: function(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '获取手机号失败', icon: 'none' });
      return;
    }
    
    wx.showLoading({ title: '绑定中...' });
    
    wx.cloud.callFunction({
      name: 'getPhoneNumber',
      data: { cloudID: e.detail.cloudID },
      success: res => {
        wx.hideLoading();
        if (res.result.success) {
          const phoneNumber = res.result.phoneNumber;
          this.setData({ phoneNumber: phoneNumber }, () => {
            this.checkCanSave();
          });
          this.savePhoneNumber(phoneNumber);
          wx.showToast({ title: '手机号绑定成功', icon: 'success' });
        }
      },
      fail: err => {
        wx.hideLoading();
        console.error('获取手机号失败', err);
        wx.showToast({ title: '绑定失败', icon: 'none' });
      }
    });
  },

  savePhoneNumber: function(phoneNumber) {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo || !userInfo._openid) return;
    
    // 本地保存
    userInfo.phoneNumber = phoneNumber;
    wx.setStorageSync('userInfo', userInfo);
    
    // 云端同步
    syncManager.write('user_info', {
      phoneNumber: phoneNumber
    }).catch(err => {
      console.warn('[profile-edit] 手机号同步失败:', err);
    });
    
    // 更新users集合
    const db = wx.cloud.database();
    db.collection('users').where({
      _openid: userInfo._openid
    }).update({
      data: {
        phoneNumber: phoneNumber,
        updatedAt: db.serverDate()
      }
    });
  }
});
