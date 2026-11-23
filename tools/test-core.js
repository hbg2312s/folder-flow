/* 从 main.js 里抽出 core:begin/core:end 之间的纯逻辑，用 node 直接验收。
   这样测的是真正会被打包进插件的代码，不是另一份副本。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainPath = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(mainPath, 'utf8');
const begin = source.indexOf('// ---------------- core:begin ----------------');
const end = source.indexOf('// ---------------- core:end ----------------');
if (begin < 0 || end < 0) {
	console.error('FAIL: 找不到 core 标记');
	process.exit(1);
}
const coreSource = source.slice(begin, end);

const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(
	coreSource +
		'\nmodule.exports = { normOrder, cmpName, sorterFor, sortFiles, collectNotes, indexPath, step, positionLabel, ORDER_KEYS };',
	sandbox,
);
const core = sandbox.module.exports;

let pass = 0;
const failures = [];

function check(name, actual, expected) {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		pass += 1;
		return;
	}
	failures.push(name + '\n  expected: ' + e + '\n  actual:   ' + a);
}

function file(name, opts) {
	const o = opts || {};
	return {
		path: o.path || 'F/' + name,
		basename: name.replace(/\.[^.]+$/, ''),
		name,
		extension: (name.split('.').pop() || ''),
		stat: { mtime: o.mtime || 0, ctime: o.ctime || 0 },
	};
}

function folder(name, children, dirPath) {
	return { path: dirPath || name, basename: name, name, children: children || [] };
}

// 1. 非法排序值不再产生 undefined 排序函数
check('normOrder 非法值兜底', core.normOrder('custom-manual'), 'alphabetical');
check('sorterFor 非法值可用', typeof core.sorterFor('nonsense'), 'function');

// 2. 数字感知排序：2 在 10 前面（localeCompare numeric）
const numeric = [file('10.md'), file('2.md'), file('1.md')];
check(
	'数字命名的自然顺序',
	core.sortFiles(numeric, 'alphabetical').map((f) => f.basename),
	['1', '2', '10'],
);

// 3. 反向与时间排序
check(
	'反向字母顺序',
	core.sortFiles(numeric, 'alphabeticalReverse').map((f) => f.basename),
	['10', '2', '1'],
);
const timed = [
	file('a.md', { mtime: 300, ctime: 900 }),
	file('b.md', { mtime: 100, ctime: 100 }),
	file('c.md', { mtime: 200, ctime: 500 }),
];
check(
	'修改时间：新 → 旧',
	core.sortFiles(timed, 'byModifiedTime').map((f) => f.basename),
	['a', 'c', 'b'],
);
check(
	'创建时间：新 → 旧',
	core.sortFiles(timed, 'byCreatedTime').map((f) => f.basename),
	['a', 'c', 'b'],
);

// 4. stat 缺失不炸
check(
	'stat 缺失不抛错',
	core
		.sortFiles(
			[{ path: 'x', basename: 'x', extension: 'md' }, { path: 'y', basename: 'y', extension: 'md' }],
			'byModifiedTime',
		)
		.map((f) => f.basename),
	['x', 'y'],
);

// 5. 只收本层
const inner = folder('inner', [file('inner2.md'), file('inner1.md')], 'F/inner');
const root = folder('F', [file('b.md'), file('a.md'), inner, file('skip.png')]);
check(
	'本层文件（不递归）',
	core.collectNotes(root, { order: 'alphabetical' }).map((f) => f.basename),
	['a', 'b'],
);

// 6. 递归：本层在前，子文件夹随后
check(
	'本层在前 + 子文件夹随后',
	core.collectNotes(root, { order: 'alphabetical', includeSubfolders: true }).map((f) => f.basename),
	['a', 'b', 'inner1', 'inner2'],
);

// 7. 翻页：中间 / 边界 / 循环
const list = core.collectNotes(root, { order: 'alphabetical' });
check('中间下一项', core.step(list, 'F/a.md', 1, false).target.basename, 'b');
check('中间上一项', core.step(list, 'F/b.md', -1, false).target.basename, 'a');
const atEnd = core.step(list, 'F/b.md', 1, false);
check('末尾不循环：不返回自身', atEnd.target, null);
check('末尾不循环：标记边界', atEnd.atBoundary, true);
check('末尾循环：回到首篇', core.step(list, 'F/b.md', 1, true).target.basename, 'a');
check('首篇循环：回到末篇', core.step(list, 'F/a.md', -1, true).target.basename, 'b');

// 8. 当前文件不在列表里时，不能瞎跳
check('当前不在列表', core.step(list, 'F/other.md', 1, false).target, null);
check('空列表', core.step([], 'F/a.md', 1, false).target, null);

// 9. 位置提示
check('位置 1/2', core.positionLabel(list, 'F/a.md'), '1/2');
check('位置 2/2', core.positionLabel(list, 'F/b.md'), '2/2');
check('位置未知', core.positionLabel(list, 'F/none.md'), '');

console.log('通过 ' + pass + ' 项');
if (failures.length) {
	console.error('\n失败 ' + failures.length + ' 项：\n' + failures.join('\n\n'));
	process.exit(1);
}
console.log('核心逻辑全部通过');