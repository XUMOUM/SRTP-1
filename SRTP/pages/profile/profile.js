Page({
  data: {
    userInfo: {
      avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
      nickName: '未登录',
      userId: ''
    },
    showLoginModal: false,
    isLoggedIn: false,
    // 新增弹窗控制变量
    showAboutModal: false,
    showHelpModal: false
  },

  onLoad: function() {
    this.checkLoginStatus();
  },

  onShow: function() {
    this.checkLoginStatus();
  },

  // 检查登录状态
  checkLoginStatus: function() {
    var userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo.nickName && userInfo.nickName !== '未登录') {
      this.setData({
        userInfo: userInfo,
        isLoggedIn: true,
        healthProfile: wx.getStorageSync('healthProfile') || {}
      });
    } else {
      // 如果没有登录信息，确保使用默认头像
      this.setData({
        userInfo: {
          avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
          nickName: '未登录',
          userId: ''
        },
        isLoggedIn: false
      });
    }
  },

  // 处理用户卡片点击
  handleUserCardTap: function() {
    if (!this.data.isLoggedIn) {
      this.showLoginModal();
    }
    // 如果已登录，点击用户卡片不做任何操作
  },

  // 显示登录弹窗
  showLoginModal: function() {
    this.setData({
      showLoginModal: true
    });
  },
  
  // 使用微信信息登录
  loginWithWechat: function() {
    var that = this;
    
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: function(profileRes) {
        const userInfo = profileRes.userInfo;
        
        wx.showLoading({
          title: '登录中...',
        });
        
        // 调用云函数
        wx.cloud.callFunction({
          name: 'login',
          data: {
            nickName: userInfo.nickName,
            avatarUrl: userInfo.avatarUrl
          },
          success: res => {
            wx.hideLoading();
            
            if (res.result.success) {
              const userData = res.result.userInfo;
              wx.setStorageSync('userInfo', userData);
              
              that.setData({
                userInfo: userData,
                showLoginModal: false,
                isLoggedIn: true
              });
              
              wx.showToast({
                title: '登录成功',
                icon: 'success'
              });
            } else {
              wx.showToast({
                title: '登录失败',
                icon: 'none'
              });
            }
          },
          fail: err => {
            wx.hideLoading();
            wx.showToast({
              title: '网络错误',
              icon: 'none'
            });
          }
        });
      },
      fail: function(err) {
        console.log('用户拒绝授权', err);
      }
    });
  },
  
  // 手动注册（不适用微信信息）
  manualRegister: function() {
    this.hideLoginModal();
    // 跳转到个人信息设置页面
    wx.navigateTo({
      url: '/packageA/pages/profile-edit/profile-edit?mode=register'
    });
  },

  // 隐藏登录弹窗
  hideLoginModal: function() {
    this.setData({
      showLoginModal: false
    });
  },

// 开始微信登录流程（使用新版API）
startWxLogin: function() {
  var that = this;
  
  // 使用 wx.login 获取code
  wx.login({
    success: function(loginRes) {
      if (loginRes.code) {
        // 直接调用云函数，不弹授权窗
        wx.showLoading({
          title: '登录中...',
        });
        
        wx.cloud.callFunction({
          name: 'login',
          data: {
            code: loginRes.code  // 传递code，云函数中可以通过这个获取openid
          },
          success: res => {
            wx.hideLoading();
            
            if (res.result.success) {
              const userData = res.result.userInfo;
              
              // 保存到本地存储
              wx.setStorageSync('userInfo', userData);
              
              that.setData({
                userInfo: userData,
                showLoginModal: false,
                isLoggedIn: true
              });
              
              wx.showToast({
                title: '登录成功',
                icon: 'success'
              });
              
              // 新用户提示
              if (res.result.isNewUser) {
                wx.showModal({
                  title: '欢迎新用户',
                  content: '您的用户ID是：' + userData.userId + '\n好友可以通过这个ID搜索到您',
                  showCancel: false
                });
              }
            } else {
              wx.showToast({
                title: '登录失败',
                icon: 'none'
              });
            }
          },
          fail: err => {
            wx.hideLoading();
            console.error('云函数调用失败', err);
            wx.showToast({
              title: '网络错误',
              icon: 'none'
            });
          }
        });
      }
    }
  });
},

  // 导航到提醒设置
  navigateToReminderSettings: function() {
    wx.navigateTo({
      url: '/packageA/pages/reminder-settings/reminder-settings'
  })
},

  // 导航到药品管理
  navigateToMedicineManagement: function() {
    wx.switchTab({
      url: '/pages/manage/manage'
    });
  },

// 导航到用药记录
navigateToHistory: function() {
  wx.navigateTo({
    url: '/packageA/pages/history/history'
  });
},

// 导航到隐私设置
navigateToPrivacy: function() {
  wx.navigateTo({
    url: '/packageA/pages/privacy/privacy'
  });
},

  // === 新增：关于我们 ===
  navigateToAbout: function() {
    this.setData({
      showAboutModal: true
    });
  },

  // 隐藏关于我们弹窗
  hideAboutModal: function() {
    this.setData({
      showAboutModal: false
    });
  },

  // === 新增：帮助与反馈 ===
  navigateToHelp: function() {
    this.setData({
      showHelpModal: true
    });
  },

  // 隐藏帮助与反馈弹窗
  hideHelpModal: function() {
    this.setData({
      showHelpModal: false
    });
  },

  // 复制邮箱到剪贴板
  copyEmail: function() {
    wx.setClipboardData({
      data: 'xu_zi666666@126.com',
      success: function() {
        wx.showToast({
          title: '邮箱已复制',
          icon: 'success',
          duration: 1500
        });
      }
    });
  },
  // 跳转到个人信息编辑页面
navigateToProfileEdit: function() {
  if (!this.data.isLoggedIn) {
    this.showLoginModal();
    return;
  }
  wx.navigateTo({
    url: '/packageA/pages/profile-edit/profile-edit'
  });
},
// 导航到禁忌管理
navigateToContraindication: function() {
  wx.navigateTo({
    url: '/packageA/pages/contraindication/contraindication'
  });
},
// 退出登录
handleLogout: function() {
  var self = this;
  wx.showModal({
    title: '确认退出',
    content: '退出登录后需要重新授权登录',
    success: function(res) {
      if (res.confirm) {
        // 清除所有登录相关缓存
        wx.setStorageSync('userInfo', {
          avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
          nickName: '',
          userId: ''
        });
        wx.setStorageSync('userId', '');
        self.setData({
          isLoggedIn: false,
          userInfo: {
            avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
            nickName: '未登录',
            userId: ''
          }
        });
        wx.showToast({ title: '已退出', icon: 'success' });
      }
    }
  });
}
})