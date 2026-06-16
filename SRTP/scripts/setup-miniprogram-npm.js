/**
 * 将 @babel/runtime 复制到 miniprogram_npm（lazyCodeLoading 分包页面依赖）
 * npm install 后自动执行；也可手动：node scripts/setup-miniprogram-npm.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', '@babel', 'runtime');
const dst = path.join(root, 'miniprogram_npm', '@babel', 'runtime');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const s = path.join(from, name);
    const d = path.join(to, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(src)) {
  console.error('请先执行 npm install');
  process.exit(1);
}

copyDir(src, dst);
console.log('miniprogram_npm/@babel/runtime 已就绪');
