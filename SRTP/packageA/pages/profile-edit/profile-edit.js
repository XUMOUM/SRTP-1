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
    console.log('个人信息编辑页面加载')
    
    // 获取当前日期
    const today = new Date()
    const year = today.getFullYear()
    const month = (today.getMonth() + 1).toString().padStart(2, '0')
    const day = today.getDate().toString().padStart(2, '0')
    
    this.setData({
      currentDate: `${year}-${month}-${day}`
    })
    
    // 加载用户信息
    this.loadUserInfo()
  },

  // 加载用户信息
  loadUserInfo: function() {
    const userInfo = wx.getStorageSync('userInfo') || {}
    console.log('加载用户信息:', userInfo)
    
    // 加载健康档案
    const healthProfile = wx.getStorageSync('healthProfile') || {}
    
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
      originalData: { ...userInfo }
    })
  },

  // 选择头像
  chooseAvatar: function() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0]
        
        // 上传到云存储
        wx.showLoading({ title: '上传中...' })
        
        const cloudPath = `avatars/${Date.now()}.jpg`
        wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath,
          success: (uploadRes) => {
            // 获取云文件ID
            const fileID = uploadRes.fileID
            
            // 获取临时URL用于显示
            wx.cloud.getTempFileURL({
              fileList: [fileID],
              success: (urlRes) => {
                wx.hideLoading()
                this.setData({
                  avatarUrl: urlRes.fileList[0].tempFileURL
                }, () => {
                  this.checkCanSave()
                })
              }
            })
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({
              title: '上传失败',
              icon: 'none'
            })
          }
        })
      }
    })
  },

  // 昵称输入
  onNickNameInput: function(e) {
    this.setData({
      nickName: e.detail.value
    }, () => {
      this.checkCanSave()
    })
  },

  // 性别选择
  onGenderChange: function(e) {
    this.setData({
      genderIndex: e.detail.value
    }, () => {
      this.checkCanSave()
    })
  },

  // 生日选择
  onBirthdayChange: function(e) {
    this.setData({
      birthday: e.detail.value
    }, () => {
      this.checkCanSave()
    })
  },

  // 手机号输入
  onPhoneInput: function(e) {
    this.setData({
      phoneNumber: e.detail.value
    }, () => {
      this.checkCanSave()
    })
  },

  // ===== 健康档案：过敏史 =====
  onAllergyInput: function(e) {
    this.setData({ allergyInput: e.detail.value })
  },
  toggleAllergyOption: function(e) {
    const item = e.currentTarget.dataset.item
    let allergies = this.data.allergies
    const idx = allergies.indexOf(item)
    if (idx >= 0) {
      allergies.splice(idx, 1)
    } else {
      allergies.push(item)
    }
    this.setData({ allergies: allergies }, () => { this.checkCanSave() })
  },
  addAllergy: function() {
    if (!this.data.allergyInput.trim()) return
    let allergies = this.data.allergies
    if (allergies.indexOf(this.data.allergyInput.trim()) < 0) {
      allergies.push(this.data.allergyInput.trim())
      this.setData({ allergies: allergies, allergyInput: '' }, () => { this.checkCanSave() })
    }
  },
  removeAllergy: function(e) {
    const idx = e.currentTarget.dataset.index
    let allergies = this.data.allergies
    allergies.splice(idx, 1)
    this.setData({ allergies: allergies }, () => { this.checkCanSave() })
  },

  // ===== 健康档案：慢性病史 =====
  onChronicInput: function(e) {
    this.setData({ chronicInput: e.detail.value })
  },
  toggleChronicOption: function(e) {
    const item = e.currentTarget.dataset.item
    let chronic = this.data.chronicDiseases
    const idx = chronic.indexOf(item)
    if (idx >= 0) {
      chronic.splice(idx, 1)
    } else {
      chronic.push(item)
    }
    this.setData({ chronicDiseases: chronic }, () => { this.checkCanSave() })
  },
  addChronic: function() {
    if (!this.data.chronicInput.trim()) return
    let chronic = this.data.chronicDiseases
    if (chronic.indexOf(this.data.chronicInput.trim()) < 0) {
      chronic.push(this.data.chronicInput.trim())
      this.setData({ chronicDiseases: chronic, chronicInput: '' }, () => { this.checkCanSave() })
    }
  },
  removeChronic: function(e) {
    const idx = e.currentTarget.dataset.index
    let chronic = this.data.chronicDiseases
    chronic.splice(idx, 1)
    this.setData({ chronicDiseases: chronic }, () => { this.checkCanSave() })
  },

  // ===== 健康档案：手术史 =====
  onSurgeryInput: function(e) {
    this.setData({ surgeryInput: e.detail.value })
  },
  addSurgery: function() {
    if (!this.data.surgeryInput.trim()) return
    let surgeries = this.data.surgeries
    surgeries.push({
      id: Date.now(),
      name: this.data.surgeryInput.trim(),
      time: ''
    })
    this.setData({ surgeries: surgeries, surgeryInput: '' }, () => { this.checkCanSave() })
  },
  onSurgeryTimeChange: function(e) {
    const idx = e.currentTarget.dataset.index
    let surgeries = this.data.surgeries
    surgeries[idx].time = e.detail.value
    this.setData({ surgeries: surgeries }, () => { this.checkCanSave() })
  },
  removeSurgery: function(e) {
    const idx = e.currentTarget.dataset.index
    let surgeries = this.data.surgeries
    surgeries.splice(idx, 1)
    this.setData({ surgeries: surgeries }, () => { this.checkCanSave() })
  },

  // ===== 健康档案：特殊状态 =====
  onSpecialStatusChange: function(e) {
    this.setData({ specialStatusIndex: Number(e.detail.value) }, () => { this.checkCanSave() })
  },

  // 检查是否可保存
  checkCanSave: function() {
    const hasChanges = 
      this.data.avatarUrl !== this.data.originalData.avatarUrl ||
      this.data.nickName !== this.data.originalData.nickName ||
      this.data.genderIndex !== (this.data.originalData.gender || 0) ||
      this.data.birthday !== this.data.originalData.birthday ||
      this.data.phoneNumber !== this.data.originalData.phoneNumber
    
    this.setData({
      canSave: hasChanges && this.data.nickName.trim() !== ''
    })
  },

  // 复制用户ID
  copyUserId: function() {
    wx.setClipboardData({
      data: this.data.userId,
      success: () => {
        wx.showToast({
          title: 'ID已复制',
          icon: 'success'
        })
      }
    })
  },

  // 保存个人信息
  saveProfile: function() {
    if (!this.data.canSave) return
    
    wx.showLoading({ title: '保存中...' })
    
    // 获取当前用户信息
    const userInfo = wx.getStorageSync('userInfo')
    
    if (!userInfo || !userInfo._openid) {
      wx.hideLoading()
      wx.showToast({
        title: '用户信息错误',
        icon: 'none'
      })
      return
    }
    
    const db = wx.cloud.database()
    
    // 更新云数据库
    db.collection('users').where({
      _openid: userInfo._openid
    }).update({
      data: {
        avatarUrl: this.data.avatarUrl,
        nickName: this.data.nickName,
        gender: this.data.genderIndex,
        birthday: this.data.birthday,
        phoneNumber: this.data.phoneNumber,
        updatedAt: db.serverDate()
      },
      success: (res) => {
        // 更新本地存储
        const updatedUserInfo = {
          ...userInfo,
          avatarUrl: this.data.avatarUrl,
          nickName: this.data.nickName,
          gender: this.data.genderIndex,
          birthday: this.data.birthday,
          phoneNumber: this.data.phoneNumber
        }
        wx.setStorageSync('userInfo', updatedUserInfo)
        
        // 同时保存健康档案到本地存储
        const healthProfile = {
          allergies: this.data.allergies,
          chronicDiseases: this.data.chronicDiseases,
          surgeries: this.data.surgeries,
          specialStatusIndex: this.data.specialStatusIndex,
          specialStatusName: this.data.specialStatusOptions[this.data.specialStatusIndex]
        }
        wx.setStorageSync('healthProfile', healthProfile)
        
        wx.hideLoading()
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        })
        
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('保存失败', err)
        wx.showToast({
          title: '保存失败',
          icon: 'none'
        })
      }
    })
  },
  // 获取手机号（在登录后调用）
getPhoneNumber: function(e) {
  if (e.detail.errMsg !== 'getPhoneNumber:ok') {
    wx.showToast({
      title: '获取手机号失败',
      icon: 'none'
    });
    return;
  }
  
  wx.showLoading({ title: '绑定中...' });
  
  // 调用云函数解密手机号
  wx.cloud.callFunction({
    name: 'getPhoneNumber',
    data: {
      cloudID: e.detail.cloudID  // 注意：这里要用cloudID，不是code
    },
    success: res => {
      wx.hideLoading();
      if (res.result.success) {
        const phoneNumber = res.result.phoneNumber;
        
        // 更新到页面
        this.setData({ phoneNumber });
        
        // 保存到云数据库
        this.savePhoneNumber(phoneNumber);
        
        wx.showToast({
          title: '手机号绑定成功',
          icon: 'success'
        });
      }
    },
    fail: err => {
      wx.hideLoading();
      console.error('获取手机号失败', err);
      wx.showToast({
        title: '绑定失败',
        icon: 'none'
      });
    }
  });
},

// 保存手机号到数据库
savePhoneNumber: function(phoneNumber) {
  const userInfo = wx.getStorageSync('userInfo');
  if (!userInfo || !userInfo._openid) return;
  
  const db = wx.cloud.database();
  db.collection('users').where({
    _openid: userInfo._openid
  }).update({
    data: {
      phoneNumber: phoneNumber,
      updatedAt: db.serverDate()
    },
    success: () => {
      // 更新本地存储
      userInfo.phoneNumber = phoneNumber;
      wx.setStorageSync('userInfo', userInfo);
    }
  });
}
})