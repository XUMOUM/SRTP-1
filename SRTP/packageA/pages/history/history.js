Page({
  data: {
    // 日期选择
    currentDate: '',
    selectedDate: '',
    dateRange: [],
    
    // 统计数据
    stats: {
      totalDays: 0,           // 记录天数
      totalMeds: 0,           // 总用药次数
      completedMeds: 0,       // 完成次数
      missedMeds: 0,          // 漏服次数
      completionRate: 0,      // 完成率
      maxStreak: 0,           // 最长连续完成天数
      currentStreak: 0        // 当前连续完成天数
    },
    
    // 每日数据
    dailyRecords: [],
    
    // 图表数据
    chartData: {
      categories: [],         // 日期标签
      series: [{
        name: '完成率',
        data: []              // 每日完成率
      }]
    },
    
    // 选中日期的详情
    selectedDayDetail: null,
    
    // 时间范围
    daysToShow: 30,           // 显示最近30天
    
    // 加载状态
    loading: true
  },

  onLoad: function() {
    // 设置默认日期为今天
    const today = this.formatDate(new Date())
    this.setData({
      selectedDate: today,
      currentDate: today
    })
    
    this.loadHistoryData()
  },

  onShow: function() {
    this.loadHistoryData()
  },

  onPullDownRefresh: function() {
    this.loadHistoryData()
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 1000)
  },

  // 格式化日期 YYYY-MM-DD
  formatDate: function(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  // 获取过去30天的日期数组
  getDateRange: function() {
    const dates = []
    const today = new Date()
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      dates.push(this.formatDate(date))
    }
    
    return dates
  },

  // 加载历史数据
  loadHistoryData: function() {
    this.setData({ loading: true })
    
    // 生成过去30天的日期
    const dateRange = this.getDateRange()
    
    // 从本地存储加载药品列表
    const medicineList = wx.getStorageSync('medicineList') || []
    
    // 加载30天的记录
    const dailyRecords = []
    const completionRates = []
    
    dateRange.forEach(date => {
      // 获取当天的完成记录
      const dayKey = `completed_${date.replace(/-/g, '')}`
      const dayRecords = wx.getStorageSync(dayKey) || {}
      
      // 计算当天完成情况
      let completed = 0
      let total = medicineList.length
      
      medicineList.forEach(medicine => {
        if (dayRecords[medicine.id] && dayRecords[medicine.id].completed) {
          completed++
        }
      })
      
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0
      
      dailyRecords.push({
        date: date,
        displayDate: this.formatDisplayDate(date),
        completed: completed,
        total: total,
        rate: rate,
        records: dayRecords,
        dayOfWeek: this.getDayOfWeek(date)
      })
      
      completionRates.push(rate)
    })
    
    // 计算统计数据
    const stats = this.calculateStats(dailyRecords, medicineList.length)
    
    // 生成图表数据
    const chartData = {
      categories: dailyRecords.map(d => this.formatShortDate(d.date)),
      series: [{
        name: '完成率',
        data: completionRates,
        color: '#667eea'
      }]
    }
    
    this.setData({
      dateRange: dateRange,
      dailyRecords: dailyRecords,
      chartData: chartData,
      stats: stats,
      loading: false
    }, () => {
      // 默认选中今天
      this.selectDate({ detail: { value: dateRange.length - 1 } })
    })
  },

  // 计算统计数据
  calculateStats: function(dailyRecords, totalMedsPerDay) {
    let totalCompleted = 0
    let totalPossible = 0
    let currentStreak = 0
    let maxStreak = 0
    let tempStreak = 0
    
    dailyRecords.forEach(day => {
      totalCompleted += day.completed
      totalPossible += day.total
      
      // 计算连续完成天数
      if (day.rate === 100) {
        tempStreak++
        maxStreak = Math.max(maxStreak, tempStreak)
      } else {
        tempStreak = 0
      }
    })
    
    // 计算当前连续天数（从今天往前）
    for (let i = dailyRecords.length - 1; i >= 0; i--) {
      if (dailyRecords[i].rate === 100) {
        currentStreak++
      } else {
        break
      }
    }
    
    const missedMeds = totalPossible - totalCompleted
    const completionRate = totalPossible > 0 ? Math.round((totalCompleted / totalPossible) * 100) : 0
    
    return {
      totalDays: dailyRecords.length,
      totalMeds: totalPossible,
      completedMeds: totalCompleted,
      missedMeds: missedMeds,
      completionRate: completionRate,
      maxStreak: maxStreak,
      currentStreak: currentStreak
    }
  },

  // 选择日期
  selectDate: function(e) {
    const index = e.detail.value
    const selectedDay = this.data.dailyRecords[index]
    
    if (selectedDay) {
      this.setData({
        selectedDate: selectedDay.date,
        selectedDayDetail: this.getDayDetail(selectedDay)
      })
    }
  },

  // 获取选中日期的详情
  getDayDetail: function(dayRecord) {
    const medicineList = wx.getStorageSync('medicineList') || []
    const dayRecords = dayRecord.records
    
    const medicines = medicineList.map(medicine => {
      const record = dayRecords[medicine.id]
      return {
        id: medicine.id,
        name: medicine.name,
        dosage: medicine.dosageNumber + medicine.dosageUnit,
        time: medicine.times ? medicine.times[0] : '08:00',
        completed: record ? record.completed : false,
        markedTime: record ? record.markedTime : '',
        instruction: medicine.instruction
      }
    })
    
    return {
      date: dayRecord.displayDate,
      dayOfWeek: dayRecord.dayOfWeek,
      medicines: medicines,
      completed: dayRecord.completed,
      total: dayRecord.total,
      rate: dayRecord.rate
    }
  },

  // 格式化显示日期
  formatDisplayDate: function(dateStr) {
    const [year, month, day] = dateStr.split('-')
    return `${month}月${day}日`
  },

  // 格式化短日期 (MM-DD)
  formatShortDate: function(dateStr) {
    const [month, day] = dateStr.split('-').slice(1)
    return `${month}/${day}`
  },

  // 获取星期几
  getDayOfWeek: function(dateStr) {
    const date = new Date(dateStr)
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return weekdays[date.getDay()]
  },

  // 切换日期（上一天/下一天）
  changeDate: function(e) {
    const direction = e.currentTarget.dataset.direction // 'prev' or 'next'
    const currentIndex = this.data.dailyRecords.findIndex(d => d.date === this.data.selectedDate)
    
    let newIndex
    if (direction === 'prev') {
      newIndex = Math.max(0, currentIndex - 1)
    } else {
      newIndex = Math.min(this.data.dailyRecords.length - 1, currentIndex + 1)
    }
    
    this.selectDate({ detail: { value: newIndex } })
  },

  // 查看统计详情
  showStatsDetail: function() {
    wx.showModal({
      title: '统计说明',
      content: `📊 过去30天统计\n\n` +
               `总用药次数：${this.data.stats.totalMeds}次\n` +
               `按时完成：${this.data.stats.completedMeds}次\n` +
               `漏服次数：${this.data.stats.missedMeds}次\n` +
               `完成率：${this.data.stats.completionRate}%\n\n` +
               `🏆 最长连续：${this.data.stats.maxStreak}天\n` +
               `🔥 当前连续：${this.data.stats.currentStreak}天`,
      showCancel: false
    })
  }
})