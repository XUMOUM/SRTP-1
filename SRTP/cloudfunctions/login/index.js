// 云函数login的index.js
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  console.log('用户openid:', openid)
  
  try {
    // 1. 查询用户是否存在
    const userRes = await db.collection('users').where({
      _openid: openid
    }).get()
    
    let userData = {}
    let isNewUser = false
    
    if (userRes.data.length === 0) {
      // 2. 新用户：生成唯一用户ID
      const date = new Date()
      const year = date.getFullYear().toString().slice(-2)
      const month = (date.getMonth() + 1).toString().padStart(2, '0')
      const day = date.getDate().toString().padStart(2, '0')
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
      const userId = `U${year}${month}${day}${random}`
      
      userData = {
        _openid: openid,
        userId: userId,
        nickName: '微信用户',  // 默认名称
        avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
        phoneNumber: '',
        status: 'online',
        lastActive: db.serverDate(),
        createdAt: db.serverDate()
      }
      
      // 3. 存入数据库
      await db.collection('users').add({
        data: userData
      })
      
      isNewUser = true
      console.log('新用户注册:', userId)
    } else {
      // 4. 老用户：更新最后活跃时间
      userData = userRes.data[0]
      await db.collection('users').where({
        _openid: openid
      }).update({
        data: {
          lastActive: db.serverDate(),
          status: 'online'
        }
      })
      console.log('老用户登录:', userData.userId)
    }
    
    // 5. 返回数据
    return {
      success: true,
      userInfo: userData,
      isNewUser: isNewUser,
      openid: openid
    }
    
  } catch (err) {
    console.error('登录失败', err)
    return {
      success: false,
      error: err.message
    }
  }
}