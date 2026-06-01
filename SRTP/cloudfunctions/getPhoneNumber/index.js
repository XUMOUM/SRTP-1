// 云函数 getPhoneNumber
const cloud = require('wx-server-sdk')
cloud.init()

exports.main = async (event, context) => {
  const { cloudID } = event
  
  try {
    // 通过 cloudID 获取手机号
    const result = await cloud.getOpenData({
      list: [cloudID]
    })
    
    const phoneInfo = result.list[0]
    
    if (phoneInfo && phoneInfo.data) {
      return {
        success: true,
        phoneNumber: phoneInfo.data.phoneNumber
      }
    } else {
      return {
        success: false,
        error: '获取失败'
      }
    }
  } catch (err) {
    return {
      success: false,
      error: err.message
    }
  }
}