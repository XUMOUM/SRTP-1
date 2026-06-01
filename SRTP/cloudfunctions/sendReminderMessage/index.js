// 云函数 sendReminderMessage
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

// 获取access_token（需要缓存，有效期2小时）
let accessToken = null
let tokenExpireTime = 0

async function getAccessToken() {
  const now = Date.now()
  if (accessToken && tokenExpireTime > now) {
    return accessToken
  }
  
  const res = await cloud.openapi.auth.getAccessToken()
  accessToken = res.accessToken
  tokenExpireTime = now + (res.expiresIn * 1000) - 300000 // 提前5分钟过期
  return accessToken
}

// 发送订阅消息
async function sendSubscribeMessage(openid, templateId, medicine, time) {
  const token = await getAccessToken()
  
  const data = {
    "time1": { "value": time },           // 服药时间
    "thing2": { "value": medicine.name },  // 药品名称
    "thing3": { "value": medicine.dosageNumber + medicine.dosageUnit }, // 药品用量
    "thing4": { "value": "已到达用药提醒时间，请及时服药" } // 服务内容
  }
  
  const result = await cloud.openapi.subscribeMessage.send({
    touser: openid,
    templateId: templateId,
    page: 'pages/reminder/reminder?auto=true', // 点击跳转到提醒页面
    data: data,
    miniprogramState: 'formal' // 正式版
  })
  
  return result
}

exports.main = async (event, context) => {
  const { openid, medicine, time } = event
  
  try {
    // 从数据库获取用户的模板ID（每个用户可能订阅不同模板）
    const userSetting = await db.collection('userSettings').where({
      _openid: openid
    }).get()
    
    let templateId = 'YOUR_TEMPLATE_ID' // 默认模板ID，先写死，后面可以配置
    
    // 发送消息
    const result = await sendSubscribeMessage(openid, templateId, medicine, time)
    
    return {
      success: true,
      result
    }
  } catch (err) {
    console.error('发送失败', err)
    return {
      success: false,
      error: err
    }
  }
}