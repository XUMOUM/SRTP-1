// 云函数 handleFriendRequest
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

exports.main = async (event, context) => {
  const { requestId, action } = event // action: 'accept' 或 'reject'
  const wxContext = cloud.getWXContext()
  const currentOpenid = wxContext.OPENID
  
  try {
    // 获取请求信息
    const requestRes = await db.collection('friends').doc(requestId).get()
    const request = requestRes.data
    
    // 验证权限：只有接收方可以处理
    if (request.friendId !== currentOpenid) {
      return { success: false, message: '无权限操作' }
    }
    
    if (action === 'accept') {
      // 开启事务，保证数据一致性
      const transaction = await db.startTransaction()
      
      try {
        // 更新原请求状态
        await transaction.collection('friends').doc(requestId).update({
          data: {
            status: 'accepted',
            updatedAt: db.serverDate()
          }
        })
        
        // 添加双向好友关系
        await transaction.collection('friends').add({
          data: {
            userId: request.userId,
            friendId: request.friendId,
            status: 'accepted',
            createdAt: db.serverDate()
          }
        })
        
        await transaction.collection('friends').add({
          data: {
            userId: request.friendId,
            friendId: request.userId,
            status: 'accepted',
            createdAt: db.serverDate()
          }
        })
        
        await transaction.commit()
        return { success: true, message: '已同意好友请求' }
        
      } catch (err) {
        await transaction.rollback()
        throw err
      }
      
    } else {
      // 拒绝请求
      await db.collection('friends').doc(requestId).update({
        data: {
          status: 'rejected',
          updatedAt: db.serverDate()
        }
      })
      return { success: true, message: '已拒绝好友请求' }
    }
    
  } catch (err) {
    console.error('处理请求失败', err)
    return { success: false, error: err.message }
  }
}