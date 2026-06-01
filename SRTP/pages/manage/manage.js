Page({
  data: {
    medicineList: [],
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
    instructionOptions: ['饭前服用', '饭后服用', '随餐服用', '无特殊要求', '其他'],
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
    showParsedResultModal: false
  },

  onLoad: function() {
    this.loadMedicineList();
  },

  onShow: function() {
    this.loadMedicineList();
  },

  // 加载药品列表
  loadMedicineList: function() {
    var medicineList = wx.getStorageSync('medicineList') || [];
    
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
    }
    
    this.setData({
      groupedMedicine: this.groupByFrequency(medicineList)
    });
  },

  // ⭐ 按频次折叠分组
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
      // 把时间格式化成简写标签
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

    // 还原原有的 link 关系（如果存在）
    medicineList.forEach(function(med) {
      var freq = med.frequency || '1';
      if (groups[freq]) {
        groups[freq].link = (med.link ? med.link.split(',') : []).filter(function(l) { return l; }).join('→') || '';
      }
    });

    var result = [];
    var sortedKeys = ['3', '2', '1', '0.5', '0.25'];
    for (var i = 0; i < sortedKeys.length; i++) {
      if (groups[sortedKeys[i]]) {
        result.push(groups[sortedKeys[i]]);
      }
    }
    // 添加未被排序覆盖的
    for (var key in groups) {
      if (sortedKeys.indexOf(key) < 0) {
        result.push(groups[key]);
      }
    }

    return result;
  },

  // ⭐ 展开/折叠分组
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

  // 保存药品列表
  saveMedicineList: function(medicineList) {
    wx.setStorageSync('medicineList', medicineList);
    this.setData({
      medicineList: medicineList,
      groupedMedicine: this.groupByFrequency(medicineList)
    });
  },

  showAddOptions: function() {
    wx.showActionSheet({
      itemList: ['手动输入用药信息', 'OCR识别处方 (beta)'],
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

  parseWithAI: function(ocrText) {
    wx.showLoading({ title: 'AI解析中...', mask: true });
    wx.cloud.callFunction({
      name: 'parseMedicineByAI',
      data: { ocrText: ocrText },
      success: (res) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          const medicines = res.result.medicines;
          if (medicines && medicines.length > 0) {
            this.setData({ parsedMedicines: medicines, showParsedResultModal: true });
            wx.showToast({ title: `解析到${medicines.length}种药品`, icon: 'success' });
          } else {
            wx.showModal({ title: '解析失败', content: '未能从处方中识别到药品信息', showCancel: false });
          }
        }
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showModal({ title: '网络错误', content: '请检查网络后重试', showCancel: false });
      }
    });
  },

  showOCRResult: function(ocrData) { /* 保留原有逻辑 */ },
  hideOCRModal: function() { this.setData({ showOCRModal: false, ocrResultText: '' }); },
  useOCRResult: function() { this.setData({ showOCRModal: false }); this.parseWithAI(this.data.ocrResultText); },
  deleteMedicineItem: function(e) { /* 保留原有逻辑 */ },
  addAllMedicines: function() { /* 保留原有逻辑，这里未来也可以接入禁忌分析 */ },
  hideParsedModal: function() { this.setData({ showParsedResultModal: false, parsedMedicines: [] }); },

  showAddModal: function() {
    this.setData({
      showMedicineModal: true,
      isEditing: false,
      currentMedicine: {
        id: null, name: '', dosageNumber: '', dosageUnit: '', instruction: '', times: ['08:00'], frequency: '', frequencyDisplay: '', notes: ''
      },
      instructionIndex: 0, showErrorToast: false, dosageNumberError: false, frequencyError: false
    });
  },

  showEditModal: function(e) {
    const id = e.currentTarget.dataset.id;
    const medicineList = this.data.medicineList;
    const medicine = medicineList.find(item => item.id === id);
    if (medicine) {
      this.setData({ originalMedicineData: JSON.parse(JSON.stringify(medicine)) });
      const instructionIndex = this.data.instructionOptions.findIndex(item => item === medicine.instruction);
      const frequencyNumber = medicine.frequencyDisplay ? medicine.frequencyDisplay.replace('次/日', '') : medicine.frequency;
      this.setData({
        showMedicineModal: true, isEditing: true, currentMedicine: { ...medicine, frequency: frequencyNumber },
        instructionIndex: instructionIndex >= 0 ? instructionIndex : 0, showErrorToast: false
      });
    }
  },

  hideMedicineModal: function() { this.setData({ showMedicineModal: false }); },
  showDeleteConfirm: function(e) { /* 保留原有逻辑 */ },
  hideDeleteModal: function() { this.setData({ showDeleteModal: false }); },
  hideEditConfirmModal: function() { this.setData({ showEditConfirmModal: false }); },
  hideErrorToast: function() { this.setData({ showErrorToast: false }); },

  onNameInput: function(e) { this.setData({ 'currentMedicine.name': e.detail.value }); },
  onDosageNumberInput: function(e) { /* 保留原有逻辑 */ this.setData({ 'currentMedicine.dosageNumber': e.detail.value }); },
  onDosageUnitInput: function(e) { this.setData({ 'currentMedicine.dosageUnit': e.detail.value }); },
  onInstructionChange: function(e) {
    const index = e.detail.value;
    this.setData({ instructionIndex: index, 'currentMedicine.instruction': this.data.instructionOptions[index] });
  },
  onTimeChange: function(e) {
    const index = e.currentTarget.dataset.index;
    const value = e.detail.value;
    const times = [...this.data.currentMedicine.times];
    times[index] = value;
    this.setData({ 'currentMedicine.times': times });
  },
  addTimePicker: function() { /* 保留原有逻辑 */ },
  removeTimePicker: function(e) { /* 保留原有逻辑 */ },
  onFrequencyInput: function(e) { this.setData({ 'currentMedicine.frequency': e.detail.value }); },
  onNotesInput: function(e) { this.setData({ 'currentMedicine.notes': e.detail.value }); },
  
  showError: function(message) {
    this.setData({ showErrorToast: true, errorMessage: message });
    setTimeout(() => { this.setData({ showErrorToast: false }); }, 3000);
  },

  // ================= 核心重构区域：集成知识图谱查杀 =================

  addMedicine: function() {
    var medicine = this.data.currentMedicine;
    var that = this; // 保证回调函数里的 this 指向正确

    // 1. 基础表单空值校验
    if (!medicine.name) { this.showError('请输入药品名称'); return; }
    if (!medicine.dosageNumber) { this.showError('请输入用药剂量'); return; }
    if (!medicine.times || medicine.times.length === 0) { this.showError('请设置用药时间'); return; }

    var medicineList = this.data.medicineList;
    
    // 2. 准备用于 CMeKG 禁忌分析的核心数据
    // 提取当前列表中已有的全部药品名称
    var currentMedicines = medicineList.map(function(item) { return item.name; });
    
    // ⭐ 从用户健康档案读取真实病史，替代硬编码
    var healthProfile = wx.getStorageSync('healthProfile') || {};
    var userDiseases = (healthProfile.chronicDiseases || []).concat(
      healthProfile.specialStatusName && healthProfile.specialStatusName !== '无特殊' ? [healthProfile.specialStatusName] : []
    );
    // 同时把过敏史也加入检查范围
    var userAllergies = healthProfile.allergies || [];

    wx.showLoading({ title: 'AI 知识图谱诊断中...', mask: true });

    // 3. 呼叫刚刚写好的云函数“最强大脑”
    wx.cloud.callFunction({
      name: 'checkMedicineContraindication',
      data: {
        newMedicineName: medicine.name,
        currentMedicines: currentMedicines,
        userDiseases: userDiseases,
        userAllergies: userAllergies
      },
      success: function(res) {
        wx.hideLoading();
        var result = res.result;

        // 4. 命运的判决：如果有警告，呼出极其震撼的本地高危弹窗
        if (result && result.hasWarning) {
          var alertMsg = '';
          result.warnings.forEach(function(w, index) {
            alertMsg += (index + 1) + ". 【" + w.level + "】" + w.title + "：\n" + w.detail + "\n\n";
          });

          // 呼叫微信原生的超强模态弹窗
          wx.showModal({
            title: '🚨 用药安全高危预警',
            content: alertMsg,
            confirmText: '执意添加',
            confirmColor: '#ff4d4f', // 危险的红色按钮
            cancelText: '取消用药',
            success: function(modalRes) {
              if (modalRes.confirm) {
                // 如果患者头铁，依然允许写入本地（执行真正保存动作）
                that.executeAddMedicine(medicine, medicineList);
              }
            }
          });
        } else {
          // 如果没有冲突，一路绿灯，直接调用原有的保存逻辑
          that.executeAddMedicine(medicine, medicineList);
        }
      },
      fail: function(err) {
        wx.hideLoading();
        console.error('知识图谱连接失败', err);
        // 为了防备比赛现场网络不好，如果云端断开，提供容错方案
        wx.showModal({
          title: '校验服务离线',
          content: '无法连接到云端知识图谱，是否直接强制添加？',
          success: function(modalRes) {
            if (modalRes.confirm) {
              that.executeAddMedicine(medicine, medicineList);
            }
          }
        });
      }
    });
  },

  // 真正的保存写入操作被抽离到了这个安全屋里
  executeAddMedicine: function(medicine, medicineList) {
    var newId = medicineList.length > 0 ? Math.max.apply(Math, medicineList.map(function(item) { return item.id; })) + 1 : 1;
    var frequencyNum = parseInt(medicine.frequency) || 1;
    var frequencyDisplay = frequencyNum + '次/日';

    var medicineToSave = Object.assign({}, medicine, {
      id: newId,
      frequency: frequencyNum.toString(),
      frequencyDisplay: frequencyDisplay
    });

    medicineList.push(medicineToSave);

    this.saveMedicineList(medicineList);
    this.hideMedicineModal();

    wx.showToast({
      title: '已入库',
      icon: 'success'
    });
  },

  // ================= 编辑与删除操作区 =================
  
  updateMedicine: function() {
    /* ...原有逻辑... */
    this.setData({ showEditConfirmModal: true, currentMedicineName: this.data.currentMedicine.name });
  },

  confirmUpdateMedicine: function() {
    /* ...原有逻辑简化版... */
    const medicine = this.data.currentMedicine;
    const medicineList = this.data.medicineList;
    const index = medicineList.findIndex(item => item.id === medicine.id);
    if (index !== -1) {
      medicineList[index] = medicine;
      this.saveMedicineList(medicineList);
    }
    this.hideEditConfirmModal();
    this.hideMedicineModal();
    wx.showToast({ title: '修改成功', icon: 'success' });
  },

  deleteMedicine: function() {
    const medicine = this.data.currentMedicine;
    let medicineList = this.data.medicineList;
    medicineList = medicineList.filter(item => item.id !== medicine.id);
    this.saveMedicineList(medicineList);
    this.hideDeleteModal();
    wx.showToast({ title: '删除成功', icon: 'success' });
  }
});