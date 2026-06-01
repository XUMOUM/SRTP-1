// 云函数 searchUser
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

exports.main = async (event, context) => {
  const { keyword } = event
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID
  
  try {
    // 搜索条件：用户ID或手机号匹配
    const _ = db.command
    const users = await db.collection('users').where(_.or([
      { userId: keyword },           // 按用户ID搜索
      { phoneNumber: keyword },       // 按手机号搜索
      { nickName: db.RegExp({         // 按昵称模糊搜索
        regexp: keyword,
        options: 'i'
      })}
    ])).get()
    
    // 过滤掉自己
    const filteredUsers = users.data.filter(u => u._openid !== currentOpenid)
    
    // 检查是否已经是好友
    for (let user of filteredUsers) {
      // 查询是否已经是好友
      const friendRes = await db.collection('friends').where({
        userId: currentOpenid,
        friendId: user._openid,
        status: 'accepted'
      }).get()
      user.isFriend = friendRes.data.length > 0
      
      // 查询是否有待处理的请求
      const requestRes = await db.collection('friends').where({
        userId: currentOpenid,
        friendId: user._openid,
        status: 'pending'
      }).get()
      user.hasPendingRequest = requestRes.data.length > 0
      
      // 查询是否有收到待处理的请求
      const receivedRes = await db.collection('friends').where({
        userId: user._openid,
        friendId: currentOpenid,
        status: 'pending'
      }).get()
      user.hasReceivedRequest = receivedRes.data.length > 0
    }
    
    return {
      success: true,
      users: filteredUsers
    }
    
  } catch (err) {
    console.error('搜索失败', err)
    return {
      success: false,
      error: err.message
    }
  }
}