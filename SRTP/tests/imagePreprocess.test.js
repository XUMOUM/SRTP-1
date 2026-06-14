/* 图片预处理纯函数单元测试（fitSize） */
const { fitSize } = require('../utils/imagePreprocess.js');

test('小图不缩放（宽高均小于 maxDim）', () => {
  const r = fitSize(800, 600, 1600);
  assert.strictEqual(r.width, 800);
  assert.strictEqual(r.height, 600);
});

test('等宽等高大图按比例缩放', () => {
  const r = fitSize(3200, 3200, 1600);
  assert.strictEqual(r.width, 1600);
  assert.strictEqual(r.height, 1600);
});

test('横向超限：宽为长边，以宽缩放', () => {
  const r = fitSize(3200, 1600, 1600);
  assert.strictEqual(r.width, 1600);
  assert.strictEqual(r.height, 800);
});

test('纵向超限：高为长边，以高缩放', () => {
  const r = fitSize(800, 3200, 1600);
  assert.strictEqual(r.width, 400);
  assert.strictEqual(r.height, 1600);
});

test('恰好等于 maxDim 不缩放', () => {
  const r = fitSize(1600, 1200, 1600);
  assert.strictEqual(r.width, 1600);
  assert.strictEqual(r.height, 1200);
});

test('极端长宽比，短边缩放后仍为正整数', () => {
  const r = fitSize(6400, 100, 1600);
  assert.strictEqual(r.width, 1600);
  assert.ok(r.height >= 1);
});

test('正方形大图缩放后保持正方形', () => {
  const r = fitSize(2000, 2000, 1600);
  assert.strictEqual(r.width, r.height);
  assert.strictEqual(r.width, 1600);
});
