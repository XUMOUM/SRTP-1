/**
 * 极简单元测试运行器（零外部依赖，基于 Node 内置 assert）
 * 运行：在 SRTP/tests 目录执行  node run.js
 */
const assert = require('assert');

const cases = [];
global.test = (name, fn) => cases.push({ name, fn });
global.assert = assert;

// 注册测试用例
require('./validator.test.js');
require('./analyzer.test.js');
require('./timeWindow.test.js');
require('./imagePreprocess.test.js');
require('./syncManager.test.js');
require('./medicineResolve.test.js');

(async () => {
  let passed = 0;
  let failed = 0;
  console.log(`运行 ${cases.length} 个用例...\n`);
  for (const c of cases) {
    try {
      await c.fn();
      console.log('  \u2713', c.name);
      passed++;
    } catch (e) {
      console.error('  \u2717', c.name, '\n     ', e.message);
      failed++;
    }
  }
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})();
