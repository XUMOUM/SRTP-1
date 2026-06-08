// 引入SyncManager实现离线优先数据同步
const syncManager = require('../../utils/syncManager.js');

Page({
  data: {
    medicineList: [],
    groupedMedicine: [],
    showMedicineModal: false,
    showDeleteModal: false,
    showEditConfirmModal: false,
    isEditing: false,
    currentMedicine: {
      id: null,
      name: '',
      dosageNumber: '',
      dosageUnit: '',
      instruction: '',
      times: ['08:00'],
      frequency: '',
      frequencyDisplay: '',
      notes: ''
    },
    currentMedicineName: '',
    instructionOptions: ['饭前服用', '饭后服用', '随餐服用', '空腹服用', '睡前服用', '晨起服用', '必要时服用', '无特殊要求'],
    instructionIndex: 0,
    originalMedicineData: null,
    showErrorToast: false,
    errorMessage: '',
    dosageNumberError: false,
    frequencyError: false,
    // OCR相关变量
    showOCRModal: false,
    ocrResultText: '',
    // AI解析结果相关变量
    parsedMedicines: [],
    showParsedResultModal: false,
    // 加载状态
    loading: false,
    // 云端同步状态
    syncStatus: 'synced' // synced | pending | error
  },

  onLoad: function() {
    this.loadMedicineList();
  },

  onShow: function() {
    this.loadMedicineList();
    this.checkSyncStatus();
  },

  // ================= 数据加载（离线优先） =================

  /**
   * 加载药品列表（离线优先 + 云端同步）
   */
  loadMedicineList: async function() {
    this.setData({ loading: true });

    try {
      // 1. 优先从本地加载（即时响应）
      let medicineList = wx.getStorageSync('medicineList') || [];

      // 2. 如果没有本地数据，使用默认值
      if (medicineList.length === 0) {
        medicineList = [
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
        wx.setStorageSync('medicineList', medicineList);
        
        // 首次初始化后同步到云端
        this.syncAllMedicinesToCloud(medicineList);
      }

      // 3. 更新UI
      this.updateMedicineList(medicineList);

      // 4. 后台同步云端数据
      this.syncFromCloud();

    } catch (e) {
      console.error('[manage] 加载药品列表失败:', e);
      this.showError('加载数据失败，请重试');
    } finally {
      this.setData({ loading: false });
    }
  },

  /**
   * 更新药品列表UI
   */
  updateMedicineList: function(medicineList) {
    this.setData({
      medicineList: medicineList,
      groupedMedicine: this.groupByFrequency(medicineList)
    });
  },

  /**
   * 按频次分组
   */
  groupByFrequency: function(medicineList) {
    var groups = {};
    var groupsOrder = [];

    medicineList.forEach(function(med) {
      var freq = med.frequency || '1';
      var freqLabel = freq + '次/日';
      if (!groups[freq]) {
        groups[freq] = {
          frequency: freq,
          label: freqLabel,
          expanded: true,
          count: 0,
          link: '',
          items: []
        };
        groupsOrder.push(freq);
      }
      
      var timesStr = (med.times || ['08:00']).map(function(t) {
        return t.length >= 5 ? t.slice(0, 2) + ':' + t.slice(3, 5) : t;
      }).join(', ');
      
      groups[freq].items.push({
        ...med,
        icon: freq === '1' ? '💊' : freq === '2' ? '💊💊' : '💊💊💊',
        timesDisplay: timesStr
      });
      groups[freq].count++;
    });

    var result = [];
    var sortedKeys = ['3', '2', '1', '0.5', '0.25'];
    for (var i = 0; i < sortedKeys.length; i++) {
      if (groups[sortedKeys[i]]) {
        result.push(groups[sortedKeys[i]]);
      }
    }
    for (var key in groups) {
      if (sortedKeys.indexOf(key) < 0) {
        result.push(groups[key]);
      }
    }

    return result;
  },

  /**
   * 从云端同步数据
   */
  syncFromCloud: async function() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'syncData',
        data: {
          action: 'syncFromCloud',
          keyPrefix: 'medicine_',
          localTimestamp: 0
        }
      });

      if (res.result.success && res.result.data && res.result.data.length > 0) {
        // 合并云端数据到本地
        const cloudData = res.result.data;
        console.log('[manage] 从云端加载到', cloudData.length, '条数据');
        
        // 这里可以实现更复杂的合并逻辑
        this.setData({ syncStatus: 'synced' });
      }
    } catch (e) {
      console.warn('[manage] 云端同步失败:', e);
      this.setData({ syncStatus: 'error' });
    }
  },

  /**
   * 检查同步状态
   */
  checkSyncStatus: function() {
    const keys = wx.getStorageInfoSync().keys || [];
    let pendingCount = 0;
    
    keys.forEach(key => {
      if (key.startsWith('medicine_')) {
        try {
          const data = wx.getStorageSync(key);
          if (data && data._syncStatus === 'pending') {
            pendingCount++;
          }
        } catch (e) {}
      }
    });

    this.setData({
      syncStatus: pendingCount > 0 ? 'pending' : 'synced'
    });

    // 尝试同步
    if (pendingCount > 0) {
      syncManager.forceSync();
    }
  },

  /**
   * 批量同步所有药品到云端
   */
  syncAllMedicinesToCloud: function(medicineList) {
    medicineList.forEach(med => {
      const key = 'medicine_' + med.id;
      syncManager.write(key, med).catch(err => {
        console.warn('[manage] 同步药品失败:', med.name, err);
      });
    });
  },

  // ================= 分组展开/折叠 =================

  toggleGroup: function(e) {
    var freq = e.currentTarget.dataset.freq;
    var list = this.data.groupedMedicine;
    for (var i = 0; i < list.length; i++) {
      if (list[i].frequency === freq) {
        list[i].expanded = !list[i].expanded;
        break;
      }
    }
    this.setData({ groupedMedicine: list });
  },

  // ================= 添加药品 =================

  showAddOptions: function() {
    wx.showActionSheet({
      itemList: ['手动输入用药信息', 'OCR识别处方 (AI解析)'],
      success: (res) => {
        switch(res.tapIndex) {
          case 0:
            this.showAddModal();
            break;
          case 1:
            this.chooseImageSource();
            break;
        }
      }
    });
  },

  showAddModal: function() {
    this.setData({
      showMedicineModal: true,
      isEditing: false,
      currentMedicine: {
        id: null,
        name: '',
        dosageNumber: '',
        dosageUnit: '',
        instruction: '',
        times: ['08:00'],
        frequency: '',
        frequencyDisplay: '',
        notes: ''
      },
      instructionIndex: 0,
      showErrorToast: false,
      dosageNumberError: false,
      frequencyError: false,
      originalMedicineData: null
    });
  },

  // ================= OCR识别（集成新版AI解析） =================

  chooseImageSource: function() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (res) => {
        let sourceType = [];
        switch(res.tapIndex) {
          case 0: sourceType = ['camera']; break;
          case 1: sourceType = ['album']; break;
        }
        this.chooseImage(sourceType);
      }
    });
  },

  chooseImage: function(sourceType) {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: sourceType,
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0];
        wx.showLoading({ title: '识别中...', mask: true });
        this.recognizePrescription(tempFilePath);
      }
    });
  },

  recognizePrescription: function(imagePath) {
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: imagePath,
      success: (res) => {
        const imageBase64 = wx.arrayBufferToBase64(res.data);
        wx.serviceMarket.invokeService({
          service: 'wx79ac3de8be320b71',
          api: 'OcrAllInOne',
          data: { img_data: imageBase64, data_type: 2, ocr_type: 8 },
          success: (ocrRes) => {
            wx.hideLoading();
            let text = '';
            try {
              const resultData = JSON.parse(ocrRes.data);
              if (resultData.text_detections) {
                text = resultData.text_detections.map(item => item.detected_text).join('\n');
              } else {
                text = JSON.stringify(resultData, null, 2);
              }
            } catch (e) {
              text = JSON.stringify(ocrRes, null, 2);
            }
            this.setData({ showOCRModal: true, ocrResultText: text });
          },
          fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '识别失败', icon: 'none' });
          }
        });
      }
    });
  },

  hideOCRModal: function() {
    this.setData({ showOCRModal: false, ocrResultText: '' });
  },

  useOCRResult: function() {
    this.setData({ showOCRModal: false });
    this.parseWithAI(this.data.ocrResultText);
  },

  /**
   * AI解析OCR文本（集成新版校验）
   */
  parseWithAI: function(ocrText) {
    wx.showLoading({ title: 'AI解析中...', mask: true });
    
    wx.cloud.callFunction({
      name: 'parseMedicineByAI',
      data: { ocrText: ocrText },
      success: (res) => {
        wx.hideLoading();
        const result = res.result;
        
        if (result.success) {
          const medicines = result.medicines;
          
          if (medicines && medicines.length > 0) {
            // 有校验警告时提示用户
            if (result.hasValidationWarning) {
              wx.showModal({
                title: '解析完成（需核对）',
                content: result.message || '处方已解析，但部分内容可能需要核对，请检查药品信息',
                showCancel: false,
                success: () => {
                  this.setData({ 
                    parsedMedicines: medicines, 
                    showParsedResultModal: true 
                  });
                }
              });
            } else {
              this.setData({ 
                parsedMedicines: medicines, 
                showParsedResultModal: true 
              });
              wx.showToast({ title: `解析到${medicines.length}种药品`, icon: 'success' });
            }
          } else {
            wx.showModal({ 
              title: '解析失败', 
              content: '未能从处方中识别到药品信息，请手动输入', 
              showCancel: false 
            });
          }
        } else if (result.fallback) {
          // ⭐ Schema校验失败，触发fallback手动输入
          wx.showModal({
            title: '自动解析失败',
            content: result.error || '处方解析存在错误，建议手动输入',
            confirmText: '手动输入',
            cancelText: '取消',
            success: (modalRes) => {
              if (modalRes.confirm) {
                // 预填充OCR识别的原始文本到备注
                this.setData({
                  showMedicineModal: true,
                  isEditing: false,
                  currentMedicine: {
                    id: null,
                    name: '',
                    dosageNumber: '',
                    dosageUnit: '',
                    instruction: '',
                    times: ['08:00'],
                    frequency: '',
                    frequencyDisplay: '',
                    notes: '原始OCR：' + ocrText.substring(0, 100) + (ocrText.length > 100 ? '...' : '')
                  }
                });
              }
            }
          });
        } else {
          wx.showModal({ 
            title: '解析失败', 
            content: result.error || '请检查网络后重试', 
            showCancel: false 
          });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showModal({ 
          title: '网络错误', 
          content: '请检查网络后重试', 
          showCancel: false 
        });
      }
    });
  },

  hideParsedModal: function() {
    this.setData({ showParsedResultModal: false, parsedMedicines: [] });
  },

  /**
   * 添加所有解析的药品
   */
  addAllMedicines: function() {
    const medicines = this.data.parsedMedicines;
    if (!medicines || medicines.length === 0) return;

    let addedCount = 0;
    let currentMedicineList = this.data.medicineList;

    medicines.forEach(med => {
      // 跳过有校验错误的
      if (med._hasValidationError) {
        console.warn('[manage] 跳过有校验错误的药品:', med._validationErrors);
        return;
      }

      // 检查是否已存在
      const exists = currentMedicineList.some(item => 
        item.name === med.name && 
        item.dosageNumber === med.dosageNumber
      );

      if (!exists) {
        const newId = currentMedicineList.length > 0 
          ? Math.max(...currentMedicineList.map(m => m.id)) + 1 
          : 1;

        const frequencyNum = parseInt(med.frequency) || 1;

        currentMedicineList.push({
          id: newId,
          name: med.name,
          dosageNumber: med.dosageNumber,
          dosageUnit: med.dosageUnit,
          instruction: med.instruction || '无特殊要求',
          times: med.times || ['08:00'],
          frequency: frequencyNum.toString(),
          frequencyDisplay: frequencyNum + '次/日',
          notes: med.notes || ''
        });

        addedCount++;
      }
    });

    // 保存
    this.saveMedicineList(currentMedicineList);
    this.hideParsedModal();

    wx.showToast({ 
      title: `已添加${addedCount}种药品`, 
      icon: 'success' 
    });
  },

  // ================= 编辑药品（修复数据回显） =================

  /**
   * 显示编辑弹窗（修复版：正确回显数据）
   */
  showEditModal: function(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    const medicineList = this.data.medicineList;
    
    // 找到要编辑的药品
    const medicine = medicineList.find(item => item.id === id);
    
    if (!medicine) {
      wx.showToast({ title: '药品不存在', icon: 'none' });
      return;
    }

    // 深拷贝，避免引用问题
    const medicineCopy = JSON.parse(JSON.stringify(medicine));

    // 计算instruction的下标
    const instructionIndex = this.data.instructionOptions.findIndex(
      item => item === medicineCopy.instruction
    );

    // 提取frequency的数字部分
    let frequencyNumber = medicineCopy.frequency;
    if (medicineCopy.frequencyDisplay) {
      const match = medicineCopy.frequencyDisplay.match(/(\d+)/);
      if (match) frequencyNumber = match[1];
    }

    this.setData({
      showMedicineModal: true,
      isEditing: true,
      currentMedicine: {
        ...medicineCopy,
        frequency: frequencyNumber  // 确保是数字字符串
      },
      instructionIndex: instructionIndex >= 0 ? instructionIndex : 0,
      showErrorToast: false,
      dosageNumberError: false,
      frequencyError: false,
      originalMedicineData: medicineCopy  // 保存原始数据用于对比
    });

    console.log('[manage] 编辑模式，当前数据:', this.data.currentMedicine);
  },

  /**
   * 更新药品（修复版：正确处理更新逻辑）
   */
  updateMedicine: function() {
    const medicine = this.data.currentMedicine;
    
    // 校验
    if (!this.validateMedicine(medicine)) {
      return;
    }

    // 检查是否有修改
    const original = this.data.originalMedicineData;
    const hasChanges = JSON.stringify(medicine) !== JSON.stringify(original);

    if (!hasChanges) {
      wx.showToast({ title: '未做任何修改', icon: 'none' });
      this.hideMedicineModal();
      return;
    }

    // 显示确认弹窗
    this.setData({
      showEditConfirmModal: true,
      currentMedicineName: medicine.name
    });
  },

  /**
   * 确认更新
   */
  confirmUpdateMedicine: function() {
    const medicine = this.data.currentMedicine;
    const medicineList = this.data.medicineList;

    // 找到并更新
    const index = medicineList.findIndex(item => item.id === medicine.id);
    
    if (index === -1) {
      wx.showToast({ title: '药品不存在', icon: 'none' });
      this.hideEditConfirmModal();
      return;
    }

    // 构建更新后的数据
    const frequencyNum = parseInt(medicine.frequency) || 1;
    const updatedMedicine = {
      ...medicine,
      frequency: frequencyNum.toString(),
      frequencyDisplay: frequencyNum + '次/日',
      updateTime: Date.now()
    };

    // 更新列表
    medicineList[index] = updatedMedicine;

    // 保存
    this.saveMedicineList(medicineList);

    this.hideEditConfirmModal();
    this.hideMedicineModal();
    
    wx.showToast({ title: '修改成功', icon: 'success' });
  },

  // ================= 添加/保存药品 =================

  /**
   * 校验药品数据
   */
  validateMedicine: function(medicine) {
    if (!medicine.name || medicine.name.trim() === '') {
      this.showError('请输入药品名称');
      return false;
    }

    if (!medicine.dosageNumber || medicine.dosageNumber.trim() === '') {
      this.showError('请输入用药剂量');
      this.setData({ dosageNumberError: true });
      return false;
    }

    if (!medicine.times || medicine.times.length === 0) {
      this.showError('请设置用药时间');
      return false;
    }

    // 校验times格式
    const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
    for (let time of medicine.times) {
      if (!timePattern.test(time)) {
        this.showError('用药时间格式错误，应为HH:MM');
        return false;
      }
    }

    return true;
  },

  /**
   * 添加药品（集成云端同步）
   */
  addMedicine: function() {
    var medicine = this.data.currentMedicine;

    // 基础校验
    if (!this.validateMedicine(medicine)) {
      return;
    }

    var medicineList = this.data.medicineList;

    // 准备禁忌分析数据
    var currentMedicines = medicineList.map(item => item.name);
    var healthProfile = wx.getStorageSync('healthProfile') || {};
    var userDiseases = (healthProfile.chronicDiseases || []).concat(
      healthProfile.specialStatusName && healthProfile.specialStatusName !== '无特殊' 
        ? [healthProfile.specialStatusName] 
        : []
    );
    var userAllergies = healthProfile.allergies || [];

    wx.showLoading({ title: '安全检测中...', mask: true });

    // 调用禁忌分析
    wx.cloud.callFunction({
      name: 'checkMedicineContraindication',
      data: {
        newMedicineName: medicine.name,
        currentMedicines: currentMedicines,
        userDiseases: userDiseases,
        userAllergies: userAllergies
      },
      success: (res) => {
        wx.hideLoading();
        var result = res.result;

        if (result && result.hasWarning) {
          // 有警告，显示高危弹窗
          var alertMsg = '';
          result.warnings.forEach((w, index) => {
            alertMsg += (index + 1) + '. 【' + w.level + '】' + w.title + '：\n' + w.detail + '\n\n';
          });

          wx.showModal({
            title: '⚠️ 用药安全预警',
            content: alertMsg,
            confirmText: '执意添加',
            confirmColor: '#ff4d4f',
            cancelText: '取消',
            success: (modalRes) => {
              if (modalRes.confirm) {
                this.executeAddMedicine(medicine, medicineList);
              }
            }
          });
        } else {
          // 无冲突，直接添加
          this.executeAddMedicine(medicine, medicineList);
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('安全检测失败', err);
        // 网络失败时允许用户继续
        wx.showModal({
          title: '安全检测失败',
          content: '无法连接到云端进行安全检测，是否继续添加？',
          success: (modalRes) => {
            if (modalRes.confirm) {
              this.executeAddMedicine(medicine, medicineList);
            }
          }
        });
      }
    });
  },

  /**
   * 执行添加（集成SyncManager同步）
   */
  executeAddMedicine: function(medicine, medicineList) {
    var newId = medicineList.length > 0 
      ? Math.max.apply(Math, medicineList.map(item => item.id)) + 1 
      : 1;
    var frequencyNum = parseInt(medicine.frequency) || 1;

    var medicineToSave = {
      ...medicine,
      id: newId,
      frequency: frequencyNum.toString(),
      frequencyDisplay: frequencyNum + '次/日',
      createTime: Date.now()
    };

    medicineList.push(medicineToSave);

    // 保存到本地
    this.saveMedicineList(medicineList);
    this.hideMedicineModal();

    wx.showToast({ title: '添加成功', icon: 'success' });

    // ⭐ 后台同步到云端
    const key = 'medicine_' + newId;
    syncManager.write(key, medicineToSave).then(() => {
      console.log('[manage] 新药品已同步到云端');
    }).catch(err => {
      console.warn('[manage] 云端同步失败（将重试）:', err);
    });
  },

  /**
   * 保存药品列表（本地存储）
   */
  saveMedicineList: function(medicineList) {
    wx.setStorageSync('medicineList', medicineList);
    this.setData({
      medicineList: medicineList,
      groupedMedicine: this.groupByFrequency(medicineList)
    });
  },

  // ================= 删除药品 =================

  showDeleteConfirm: function(e) {
    const id = parseInt(e.currentTarget.dataset.id, 10);
    const medicine = this.data.medicineList.find(m => m.id === id);
    
    if (medicine) {
      this.setData({
        showDeleteModal: true,
        currentMedicine: medicine,
        currentMedicineName: medicine.name
      });
    }
  },

  hideDeleteModal: function() {
    this.setData({ showDeleteModal: false });
  },

  deleteMedicine: function() {
    const medicine = this.data.currentMedicine;
    let medicineList = this.data.medicineList.filter(item => item.id !== medicine.id);

    this.saveMedicineList(medicineList);
    this.hideDeleteModal();

    // ⭐ 同步删除到云端
    const key = 'medicine_' + medicine.id;
    syncManager.delete(key).catch(err => {
      console.warn('[manage] 云端删除失败:', err);
    });

    wx.showToast({ title: '删除成功', icon: 'success' });
  },

  // ================= 表单操作 =================

  hideMedicineModal: function() {
    this.setData({ showMedicineModal: false });
  },

  hideEditConfirmModal: function() {
    this.setData({ showEditConfirmModal: false });
  },

  hideErrorToast: function() {
    this.setData({ showErrorToast: false });
  },

  showError: function(message) {
    this.setData({ showErrorToast: true, errorMessage: message });
    setTimeout(() => { this.setData({ showErrorToast: false }); }, 3000);
  },

  onNameInput: function(e) {
    this.setData({ 'currentMedicine.name': e.detail.value });
  },

  onDosageNumberInput: function(e) {
    this.setData({ 
      'currentMedicine.dosageNumber': e.detail.value,
      dosageNumberError: false
    });
  },

  onDosageUnitInput: function(e) {
    this.setData({ 'currentMedicine.dosageUnit': e.detail.value });
  },

  onInstructionChange: function(e) {
    const index = e.detail.value;
    this.setData({ 
      instructionIndex: index, 
      'currentMedicine.instruction': this.data.instructionOptions[index] 
    });
  },

  onTimeChange: function(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value;
    const times = [...this.data.currentMedicine.times];
    times[index] = value;
    this.setData({ 'currentMedicine.times': times });
  },

  addTimePicker: function() {
    const times = [...this.data.currentMedicine.times, '08:00'];
    this.setData({ 'currentMedicine.times': times });
  },

  removeTimePicker: function(e) {
    const index = e.currentTarget.dataset.index;
    const times = this.data.currentMedicine.times.filter((_, i) => i !== index);
    this.setData({ 'currentMedicine.times': times });
  },

  onFrequencyInput: function(e) {
    this.setData({ 
      'currentMedicine.frequency': e.detail.value,
      frequencyError: false
    });
  },

  onNotesInput: function(e) {
    this.setData({ 'currentMedicine.notes': e.detail.value });
  }
});
