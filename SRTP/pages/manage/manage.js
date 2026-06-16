// 引入SyncManager实现离线优先数据同步
const syncManager = require('../../utils/syncManager.js');
// OCR 前的图片预处理（灰度+对比度+缩放，失败自动降级）
const { preprocessForOCR } = require('../../utils/imagePreprocess.js');

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
      // 1. 优先从本地加载（即时响应）；无数据时保持空态，由 UI 引导用户添加
      let medicineList = wx.getStorageSync('medicineList') || [];

      // 2. 更新UI
      this.updateMedicineList(medicineList);

      // 3. 后台同步云端数据（首次进入若本地为空，会从云端合并已有药品）
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
   * 从云端同步数据（双向合并，Last-Write-Wins）
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
        const cloudData = res.result.data;
        console.log('[manage] 从云端加载到', cloudData.length, '条数据');

        // 将云端数据合并回本地 medicineList（云端较新则覆盖，云端独有则新增）
        const merged = this.mergeCloudMedicines(this.data.medicineList, cloudData);
        if (merged.changed) {
          this.saveMedicineList(merged.list);
          console.log('[manage] 已合并云端更新到本地');
        }
      }

      this.setData({ syncStatus: 'synced' });
    } catch (e) {
      console.warn('[manage] 云端同步失败:', e);
      this.setData({ syncStatus: 'error' });
    }
  },

  /**
   * 合并云端药品数据到本地列表
   * 冲突解决：Last-Write-Wins（按最后修改时间）
   * @returns {{ list: Array, changed: boolean }}
   */
  mergeCloudMedicines: function(localList, cloudDocs) {
    const stripMeta = (doc) => {
      const clean = {};
      Object.keys(doc).forEach(k => {
        // 移除云端/同步元数据字段（以 _ 开头，如 _id/_openid/_key/_cloudTimestamp）
        if (!k.startsWith('_')) clean[k] = doc[k];
      });
      return clean;
    };
    const modifiedTime = (item) => item.updateTime || item.createTime || 0;
    const cloudModifiedTime = (doc) => doc.updateTime || doc.createTime || doc._cloudTimestamp || 0;

    const byId = {};
    (localList || []).forEach(item => {
      if (item && item.id != null) byId[item.id] = item;
    });

    let changed = false;

    cloudDocs.forEach(doc => {
      const cloudMed = stripMeta(doc);
      if (cloudMed.id == null) return; // 没有业务 id 的脏数据，跳过

      const localMed = byId[cloudMed.id];
      if (!localMed) {
        // 云端独有，新增到本地
        byId[cloudMed.id] = cloudMed;
        changed = true;
      } else if (cloudModifiedTime(doc) > modifiedTime(localMed)) {
        // 云端更新，覆盖本地
        byId[cloudMed.id] = { ...localMed, ...cloudMed };
        changed = true;
      }
    });

    return { list: Object.keys(byId).map(k => byId[k]), changed };
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
      sizeType: ['original', 'compressed'],
      sourceType: sourceType,
      success: (res) => {
        const tempFilePath = res.tempFilePaths[0];
        wx.showLoading({ title: '识别中...', mask: true });
        // 先做图片预处理（增强对比度），再识别；预处理失败会自动返回原图
        preprocessForOCR(tempFilePath)
          .then((processedPath) => this.recognizePrescription(processedPath))
          .catch(() => this.recognizePrescription(tempFilePath));
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
            const text = this.extractOcrText(ocrRes);
            if (!text) {
              wx.showToast({ title: '未识别到文字，请重拍', icon: 'none' });
              return;
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

  /**
   * 从 OCR 返回结果中稳健提取纯文本
   * 兼容多种返回结构：
   *   - data.ocr_comm_res.items[].text        （OcrAllInOne 通用印刷体）
   *   - data.text_detections[].detected_text  （旧版/其他 OCR）
   *   - data.items[].text / data.words_result[].words 等常见变体
   * data 可能是字符串(JSON)或已解析对象，均做兼容。
   * 关键：绝不把整个 JSON 原样作为识别文本返回，避免文本超长。
   */
  extractOcrText: function(ocrRes) {
    let data = ocrRes && ocrRes.data !== undefined ? ocrRes.data : ocrRes;

    // data 若是 JSON 字符串则先解析
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (e) {
        // 不是 JSON，直接当作纯文本返回（截断保护）
        return data.slice(0, 4000).trim();
      }
    }

    if (!data || typeof data !== 'object') return '';

    const lines = [];
    const pushText = (v) => {
      if (typeof v === 'string' && v.trim()) lines.push(v.trim());
    };

    // 1) OcrAllInOne 通用印刷体：ocr_comm_res.items[].text
    if (data.ocr_comm_res && Array.isArray(data.ocr_comm_res.items)) {
      data.ocr_comm_res.items.forEach(it => pushText(it && it.text));
    }
    // 2) 部分版本直接是 items[].text
    if (lines.length === 0 && Array.isArray(data.items)) {
      data.items.forEach(it => pushText(it && (it.text || it.detected_text)));
    }
    // 3) 旧版 text_detections[].detected_text
    if (lines.length === 0 && Array.isArray(data.text_detections)) {
      data.text_detections.forEach(it => pushText(it && it.detected_text));
    }
    // 4) 百度系 words_result[].words
    if (lines.length === 0 && Array.isArray(data.words_result)) {
      data.words_result.forEach(it => pushText(it && it.words));
    }

    let text = lines.join('\n').trim();
    // 截断保护：远小于云函数 5000 上限，避免超长
    if (text.length > 4000) text = text.slice(0, 4000);
    return text;
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
   * 获取健康档案（禁忌分析用）
   */
  getUserHealthContext: function() {
    var healthProfile = wx.getStorageSync('healthProfile') || {};
    var userDiseases = (healthProfile.chronicDiseases || []).concat(
      healthProfile.specialStatusName && healthProfile.specialStatusName !== '无特殊'
        ? [healthProfile.specialStatusName]
        : []
    );
    var userAllergies = healthProfile.allergies || [];
    return { userDiseases: userDiseases, userAllergies: userAllergies };
  },

  /**
   * 调用禁忌分析云函数（Promise 封装）
   */
  callContraindicationCheck: function(newMedicineName, currentMedicines, userDiseases, userAllergies) {
    return new Promise(function(resolve, reject) {
      wx.cloud.callFunction({
        name: 'checkMedicineContraindication',
        data: {
          newMedicineName: newMedicineName,
          currentMedicines: currentMedicines,
          userDiseases: userDiseases,
          userAllergies: userAllergies
        },
        success: function(res) { resolve(res.result || {}); },
        fail: reject
      });
    });
  },

  /** 格式化禁忌预警文案 */
  formatContraindicationAlert: function(warnings) {
    var alertMsg = '';
    warnings.forEach(function(w, index) {
      var medPrefix = w.medicineName ? '【' + w.medicineName + '】' : '';
      alertMsg += (index + 1) + '. ' + medPrefix + '【' + w.level + '】' + w.title + '：\n' + w.detail + '\n\n';
    });
    return alertMsg;
  },

  /**
   * 批量药品禁忌检测（同批新增药品也会纳入相互作用检查）
   */
  checkMedicinesSafety: function(medicinesToCheck, baseMedicineList) {
    var self = this;
    var health = this.getUserHealthContext();
    var existingNames = baseMedicineList.map(function(item) { return item.name; });
    var state = { aggregatedWarnings: [], checkFailed: false };

    var chain = Promise.resolve();
    medicinesToCheck.forEach(function(med, index) {
      chain = chain.then(function() {
        var currentForCheck = existingNames.concat(
          medicinesToCheck.slice(0, index).map(function(m) { return m.name; })
        );
        return self.callContraindicationCheck(
          med.name,
          currentForCheck,
          health.userDiseases,
          health.userAllergies
        ).then(function(result) {
          if (result && result.hasWarning && result.warnings) {
            result.warnings.forEach(function(w) {
              state.aggregatedWarnings.push({
                level: w.level,
                title: w.title,
                detail: w.detail,
                medicineName: med.name
              });
            });
          }
        }).catch(function(err) {
          console.error('[manage] 安全检测失败', med.name, err);
          state.checkFailed = true;
        });
      });
    });

    return chain.then(function() { return state; });
  },

  /**
   * 展示禁忌预警弹窗，确认后执行 callback
   */
  confirmAfterSafetyCheck: function(options) {
    var warnings = options.warnings || [];
    var checkFailed = options.checkFailed;
    var onConfirm = options.onConfirm;

    if (checkFailed && warnings.length === 0) {
      wx.showModal({
        title: '安全检测失败',
        content: '无法连接到云端进行安全检测，是否继续添加？',
        success: function(modalRes) {
          if (modalRes.confirm) onConfirm();
        }
      });
      return;
    }

    if (warnings.length > 0) {
      wx.showModal({
        title: '⚠️ 用药安全预警',
        content: this.formatContraindicationAlert(warnings),
        confirmText: '执意添加',
        confirmColor: '#ff4d4f',
        cancelText: '取消',
        success: function(modalRes) {
          if (modalRes.confirm) onConfirm();
        }
      });
      return;
    }

    onConfirm();
  },

  /**
   * 筛选待添加的 AI 解析药品（去重、跳过校验失败项）
   */
  collectParsedMedicinesToAdd: function(medicines, medicineList) {
    var toAdd = [];
    medicines.forEach(function(med) {
      if (med._hasValidationError) {
        console.warn('[manage] 跳过有校验错误的药品:', med._validationErrors);
        return;
      }
      var exists = medicineList.some(function(item) {
        return item.name === med.name && item.dosageNumber === med.dosageNumber;
      });
      if (!exists) toAdd.push(med);
    });
    return toAdd;
  },

  /**
   * 执行 AI 解析结果的批量添加（含云端同步）
   */
  executeAddParsedMedicines: function(medicinesToAdd, medicineList) {
    var addedCount = 0;
    var nextId = medicineList.length > 0
      ? Math.max.apply(Math, medicineList.map(function(m) { return m.id; })) + 1
      : 1;

    medicinesToAdd.forEach(function(med) {
      var frequencyNum = parseInt(med.frequency, 10) || 1;
      var medicineToSave = {
        id: nextId,
        name: med.name,
        dosageNumber: med.dosageNumber,
        dosageUnit: med.dosageUnit,
        instruction: med.instruction || '无特殊要求',
        times: med.times || ['08:00'],
        frequency: frequencyNum.toString(),
        frequencyDisplay: frequencyNum + '次/日',
        notes: med.notes || '',
        createTime: Date.now()
      };
      nextId++;
      medicineList.push(medicineToSave);
      addedCount++;

      syncManager.write('medicine_' + medicineToSave.id, medicineToSave).then(function() {
        console.log('[manage] AI添加药品已同步到云端:', medicineToSave.name);
      }).catch(function(err) {
        console.warn('[manage] 云端同步失败（将重试）:', err);
      });
    });

    this.saveMedicineList(medicineList);
    this.hideParsedModal();
    wx.showToast({ title: '已添加' + addedCount + '种药品', icon: 'success' });
  },

  /**
   * 添加所有解析的药品（与手动添加一致，先走禁忌分析）
   */
  addAllMedicines: function() {
    var medicines = this.data.parsedMedicines;
    if (!medicines || medicines.length === 0) return;

    var medicineList = this.data.medicineList;
    var toAdd = this.collectParsedMedicinesToAdd(medicines, medicineList);

    if (toAdd.length === 0) {
      wx.showToast({ title: '没有可添加的药品', icon: 'none' });
      return;
    }

    var self = this;
    wx.showLoading({ title: '安全检测中...', mask: true });

    this.checkMedicinesSafety(toAdd, medicineList).then(function(safetyResult) {
      wx.hideLoading();
      self.confirmAfterSafetyCheck({
        warnings: safetyResult.aggregatedWarnings,
        checkFailed: safetyResult.checkFailed,
        onConfirm: function() {
          self.executeAddParsedMedicines(toAdd, medicineList);
        }
      });
    }).catch(function(err) {
      wx.hideLoading();
      console.error('[manage] 批量安全检测异常', err);
      wx.showModal({
        title: '安全检测失败',
        content: '无法连接到云端进行安全检测，是否继续添加？',
        success: function(modalRes) {
          if (modalRes.confirm) {
            self.executeAddParsedMedicines(toAdd, medicineList);
          }
        }
      });
    });
  },


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

    if (!this.validateMedicine(medicine)) {
      return;
    }

    var medicineList = this.data.medicineList;
    var currentMedicines = medicineList.map(function(item) { return item.name; });
    var health = this.getUserHealthContext();
    var self = this;

    wx.showLoading({ title: '安全检测中...', mask: true });

    this.callContraindicationCheck(
      medicine.name,
      currentMedicines,
      health.userDiseases,
      health.userAllergies
    ).then(function(result) {
      wx.hideLoading();
      self.confirmAfterSafetyCheck({
        warnings: (result && result.hasWarning && result.warnings)
          ? result.warnings.map(function(w) {
              return {
                level: w.level,
                title: w.title,
                detail: w.detail,
                medicineName: medicine.name
              };
            })
          : [],
        checkFailed: false,
        onConfirm: function() {
          self.executeAddMedicine(medicine, medicineList);
        }
      });
    }).catch(function(err) {
      wx.hideLoading();
      console.error('安全检测失败', err);
      self.confirmAfterSafetyCheck({
        warnings: [],
        checkFailed: true,
        onConfirm: function() {
          self.executeAddMedicine(medicine, medicineList);
        }
      });
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
