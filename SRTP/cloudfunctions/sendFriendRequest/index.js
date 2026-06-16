// 云函数 sendFriendRequest
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { toUserId, message } = event
  const wxContext = cloud.getWXContext()
  const fromUserId = wxContext.OPENID

  if (!toUserId) {
    return { success: false, message: '缺少目标用户' }
  }
  
  try {
    // 1. 检查是否已经是好友
    const existingFriend = await db.collection('friends').where({
      userId: fromUserId,
      friendId: toUserId,
      status: 'accepted'
    }).get()
    
    if (existingFriend.data.length > 0) {
      return { success: false, message: '已经是好友了' }
    }
    
    // 2. 检查是否有待处理的请求
    const existingRequest = await db.collection('friends').where({
      userId: fromUserId,
      friendId: toUserId,
      status: 'pending'
    }).get()
    
    if (existingRequest.data.length > 0) {
      return { success: false, message: '已发送过好友请求' }
    }
    
    // 3. 获取发送方信息
    const fromUser = await db.collection('users').where({
      _openid: fromUserId
    }).limit(1).get()

    const fromProfile = fromUser.data[0] || {}
    
    // 4. 创建好友请求
    await db.collection('friends').add({
      data: {
        userId: fromUserId,
        friendId: toUserId,
        fromUserInfo: {
          nickName: fromProfile.nickName || '微信用户',
          avatarUrl: fromProfile.avatarUrl || '',
          userId: fromProfile.userId || ''
        },
        status: 'pending',
        message: message || '想添加您为好友',
        createdAt: db.serverDate()
      }
    })
    
    return { success: true, message: '请求已发送' }
    
  } catch (err) {
    console.error('发送请求失败', err)
    return { success: false, error: err.message }
  }
}