Page({
  data: {
    friends: [],
    expandedFriendId: null,
    showAddFriendModal: false,
    searchKeyword: '',
    searchResults: [],        // 搜索结果
    pendingRequests: [],      // 待处理的好友请求
    currentTab: 'search',     // 'search' 或 'requests'
    currentUserOpenid: ''
  },

  onLoad: function() {
    // 获取当前用户openid
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo && userInfo._openid) {
      this.setData({ currentUserOpenid: userInfo._openid });
    }
    this.loadFriendsData();
  },

  onShow: function() {
    this.refreshData();
  },

  loadFriendsData: function() {
    const friends = wx.getStorageSync('friendsList');
    if (friends && friends.length > 0) {
      this.setData({ friends });
    } else {
      // 使用示例数据
      this.setData({
        friends: this.data.friends
      });
      wx.setStorageSync('friendsList', this.data.friends);
    }
  },

  refreshData: function() {
    this.loadFriendsData();
  },

  // 切换好友展开/折叠
  toggleFriend: function(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      expandedFriendId: this.data.expandedFriendId === id ? null : id
    });
  },

  // 显示添加好友弹窗
  showAddFriendModal: function() {
    this.setData({
      showAddFriendModal: true
    });
  },

  // 隐藏添加好友弹窗
  hideAddFriendModal: function() {
    this.setData({
      showAddFriendModal: false,
      searchKeyword: ''
    });
  },

  // 搜索好友输入
  onSearchInput: function(e) {
    this.setData({
      searchKeyword: e.detail.value
    });
  },

  // 搜索好友（暂未开通）
  searchFriend: function() {
    wx.showToast({
      title: '好友功能暂未开通',
      icon: 'none',
      duration: 2000
    });
  },

  // 下拉刷新
  onPullDownRefresh: function() {
    this.refreshData();
    setTimeout(() => {
      wx.stopPullDownRefresh();
    }, 1000);
  },
  // 加载好友列表时，获取详细信息
async loadFriendsData() {
  const db = wx.cloud.database()
  
  // 查询我的好友关系
  const friendRelations = await db.collection('friends').where({
    userId: this.data.currentUserOpenid,
    status: 'accepted'
  }).get()
  
  if (friendRelations.data.length === 0) return
  
  // 获取好友详细信息（包括昵称、头像、手机号等）
  const friendIds = friendRelations.data.map(f => f.friendId)
  const friends = await db.collection('users').where({
    _openid: db.command.in(friendIds)
  }).get()
  
  this.setData({ friends: friends.data })
},

// 搜索用户
searchUser: function() {
  if (!this.data.searchKeyword.trim()) {
    wx.showToast({
      title: '请输入ID或手机号',
      icon: 'none'
    });
    return;
  }
  
  wx.showLoading({ title: '搜索中...' });
  
  wx.cloud.callFunction({
    name: 'searchUser',
    data: {
      keyword: this.data.searchKeyword.trim()
    },
    success: res => {
      wx.hideLoading();
      if (res.result.success) {
        this.setData({ searchResults: res.result.users });
      } else {
        wx.showToast({
          title: '搜索失败',
          icon: 'none'
        });
      }
    },
    fail: err => {
      wx.hideLoading();
      console.error('搜索失败', err);
      wx.showToast({
        title: '网络错误',
        icon: 'none'
      });
    }
  });
},

// 发送好友请求
sendFriendRequest: function(e) {
  const toUserId = e.currentTarget.dataset.userid;
  const toUserNick = e.currentTarget.dataset.nick;
  
  wx.showModal({
    title: '添加好友',
    content: `发送好友请求给 ${toUserNick}？`,
    success: (res) => {
      if (res.confirm) {
        wx.showLoading({ title: '发送中...' });
        
        wx.cloud.callFunction({
          name: 'sendFriendRequest',
          data: {
            toUserId: toUserId,
            message: '您好，我想添加您为好友'
          },
          success: res => {
            wx.hideLoading();
            if (res.result.success) {
              wx.showToast({
                title: '请求已发送',
                icon: 'success'
              });
              // 更新搜索结果状态
              const searchResults = this.data.searchResults.map(item => {
                if (item._openid === toUserId) {
                  item.hasPendingRequest = true;
                }
                return item;
              });
              this.setData({ searchResults });
            } else {
              wx.showToast({
                title: res.result.message || '发送失败',
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
      }
    }
  });
},

// 加载待处理的好友请求
loadPendingRequests: function() {
  const db = wx.cloud.database();
  
  db.collection('friends').where({
    friendId: this.data.currentUserOpenid,
    status: 'pending'
  }).orderBy('createdAt', 'desc').get().then(res => {
    this.setData({ pendingRequests: res.data });
  }).catch(err => {
    console.error('加载请求失败', err);
  });
},

// 处理好友请求
handleFriendRequest: function(e) {
  const { requestid, action } = e.currentTarget.dataset;
  
  wx.showLoading({ title: action === 'accept' ? '添加中...' : '处理中...' });
  
  wx.cloud.callFunction({
    name: 'handleFriendRequest',
    data: {
      requestId: requestid,
      action: action
    },
    success: res => {
      wx.hideLoading();
      if (res.result.success) {
        wx.showToast({
          title: res.result.message,
          icon: 'success'
        });
        // 刷新数据
        this.loadPendingRequests();
        this.loadFriendsData();
      } else {
        wx.showToast({
          title: res.result.message || '操作失败',
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

// 切换标签
switchTab: function(e) {
  const tab = e.currentTarget.dataset.tab;
  this.setData({ currentTab: tab });
  if (tab === 'requests') {
    this.loadPendingRequests();
  }
},

// 搜索输入
onSearchInput: function(e) {
  this.setData({
    searchKeyword: e.detail.value
  });
},

// 显示添加好友弹窗
showAddFriendModal: function() {
  this.setData({
    showAddFriendModal: true,
    searchKeyword: '',
    searchResults: [],
    currentTab: 'search'
  });
  this.loadPendingRequests(); // 预加载请求
},

// 隐藏添加好友弹窗
hideAddFriendModal: function() {
  this.setData({
    showAddFriendModal: false
  });
},
});
