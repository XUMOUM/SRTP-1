Page({
  data: {
    searchKeyword: '',
    searchResults: [],
    myContraindications: [],
    conflictCount: 0
  },

  onLoad: function() {
    this.loadMyContraindications();
    this.checkConflicts();
  },

  onShow: function() {
    this.loadMyContraindications();
    this.checkConflicts();
  },

  // 加载我的禁忌
  loadMyContraindications: function() {
    const contra = wx.getStorageSync('myContraindications') || [];
    this.setData({ myContraindications: contra });
  },

  // 保存我的禁忌
  saveMyContraindications: function(contra) {
    wx.setStorageSync('myContraindications', contra);
    this.setData({ myContraindications: contra });
  },

  // 搜索输入
  onSearchInput: function(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  // 搜索禁忌（调用CMeKG知识图谱）
  searchContraindication: function() {
    const keyword = this.data.searchKeyword.trim();
    if (!keyword) {
      wx.showToast({
        title: '请输入搜索关键词',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({ title: '搜索中...' });
    
    // 调用云函数搜索禁忌
    wx.cloud.callFunction({
      name: 'searchContraindication',
      data: { keyword: keyword },
      success: (res) => {
        wx.hideLoading();
        if (res.result.success) {
          this.setData({ searchResults: res.result.data });
        } else {
          wx.showToast({
            title: '搜索失败',
            icon: 'none'
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('搜索失败', err);
        wx.showToast({
          title: '网络错误',
          icon: 'none'
        });
      }
    });
  },

  // 添加禁忌
  addContraindication: function(e) {
    const name = e.currentTarget.dataset.name;
    const desc = e.currentTarget.dataset.desc;
    
    let myContra = this.data.myContraindications;
    
    // 检查是否已存在
    if (myContra.some(item => item.name === name)) {
      wx.showToast({
        title: '该禁忌已存在',
        icon: 'none'
      });
      return;
    }
    
    const newContra = {
      id: Date.now(),
      name: name,
      description: desc,
      addedTime: new Date().toLocaleString()
    };
    
    myContra.push(newContra);
    this.saveMyContraindications(myContra);
    
    // 清空搜索结果
    this.setData({ 
      searchKeyword: '',
      searchResults: []
    });
    
    wx.showToast({
      title: '添加成功',
      icon: 'success'
    });
    
    // 重新检查冲突
    this.checkConflicts();
  },

  // 删除禁忌
  deleteContraindication: function(e) {
    const id = e.currentTarget.dataset.id;
    let myContra = this.data.myContraindications.filter(item => item.id !== id);
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个禁忌项吗？',
      success: (res) => {
        if (res.confirm) {
          this.saveMyContraindications(myContra);
          this.checkConflicts();
          wx.showToast({
            title: '已删除',
            icon: 'success'
          });
        }
      }
    });
  },

  // 检查用药禁忌冲突
  checkConflicts: function() {
    const medicineList = wx.getStorageSync('medicineList') || [];
    const myContra = this.data.myContraindications;
    
    if (medicineList.length === 0 || myContra.length === 0) {
      this.setData({ conflictCount: 0 });
      return;
    }
    
    wx.cloud.callFunction({
      name: 'checkMedicineContraindication',
      data: {
        medicines: medicineList,
        contraindications: myContra
      },
      success: (res) => {
        if (res.result.success) {
          this.setData({ conflictCount: res.result.conflictCount || 0 });
        }
      },
      fail: (err) => {
        console.error('检查冲突失败', err);
      }
    });
  },

  // 跳转到分析页面
  navigateToAnalysis: function() {
    wx.navigateTo({
      url: '/packageA/pages/analysis/analysis'
    });
  }
});