/**
 * OCR 图片预处理工具
 *
 * 目的：在调用 OCR 前对处方图片做轻量增强，提升文字识别率：
 *   1. 等比缩放到最大边 MAX_DIM（过大图片既慢又可能超限）
 *   2. 灰度化 + 对比度增强（弱化背景、突出文字笔画）
 *
 * 设计原则：任何一步失败都安全降级为返回原图路径，绝不阻断 OCR 主流程。
 *
 * 用法：
 *   const { preprocessForOCR } = require('../../utils/imagePreprocess.js');
 *   const path = await preprocessForOCR(tempFilePath);
 */

const MAX_DIM = 1600;     // 最大边长（像素）
const CONTRAST = 1.35;    // 对比度增强系数（>1 增强）

/**
 * 获取图片信息（Promise 化）
 */
function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject
    });
  });
}

/**
 * 计算等比缩放后的尺寸
 */
function fitSize(width, height, maxDim) {
  if (width <= maxDim && height <= maxDim) {
    return { width, height };
  }
  const ratio = width >= height ? maxDim / width : maxDim / height;
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio)
  };
}

/**
 * 预处理图片，返回处理后的临时文件路径；失败时返回原路径
 * @param {string} filePath - 原图临时路径
 * @returns {Promise<string>}
 */
function preprocessForOCR(filePath) {
  return new Promise((resolve) => {
    // 能力检测：缺少离线 canvas 能力时直接降级
    if (typeof wx.createOffscreenCanvas !== 'function') {
      resolve(filePath);
      return;
    }

    getImageInfo(filePath).then((info) => {
      const { width: targetW, height: targetH } = fitSize(info.width, info.height, MAX_DIM);

      const canvas = wx.createOffscreenCanvas({ type: '2d', width: targetW, height: targetH });
      const ctx = canvas.getContext('2d');
      const img = canvas.createImage();

      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, targetW, targetH);

          // 灰度 + 对比度增强
          const imageData = ctx.getImageData(0, 0, targetW, targetH);
          const data = imageData.data;
          const intercept = 128 * (1 - CONTRAST);
          for (let i = 0; i < data.length; i += 4) {
            // 加权灰度
            const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            // 线性对比度拉伸并裁剪到 [0,255]
            let v = CONTRAST * gray + intercept;
            v = v < 0 ? 0 : v > 255 ? 255 : v;
            data[i] = data[i + 1] = data[i + 2] = v;
          }
          ctx.putImageData(imageData, 0, 0);

          wx.canvasToTempFilePath({
            canvas,
            fileType: 'jpg',
            quality: 0.92,
            success: (res) => resolve(res.tempFilePath || filePath),
            fail: () => resolve(filePath)
          });
        } catch (e) {
          console.warn('[imagePreprocess] 处理失败，使用原图:', e);
          resolve(filePath);
        }
      };

      img.onerror = () => resolve(filePath);
      img.src = filePath;
    }).catch(() => resolve(filePath));
  });
}

module.exports = {
  preprocessForOCR,
  fitSize
};
