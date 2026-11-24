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
		'\nmodule.exports = { normOrder, cmpName, sorterFor, sortFiles, collectNotes, indexPath, step, positionLabel, keyboardOpen, resolveQueue, nextUnread, ORDER_KEYS };',
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

// 10. 键盘检测：视口明显缩小才算弹出，取不到数据不隐藏
check('键盘收起', core.keyboardOpen(1000, 1000), false);
check('键盘收起（轻微抖动）', core.keyboardOpen(950, 1000), false);
check('键盘弹出', core.keyboardOpen(560, 1000), true);
check('无 visualViewport', core.keyboardOpen(undefined, 1000), false);
check('高度为 0 不误判', core.keyboardOpen(0, 1000), false);

// 11. 书单还原：丢弃不存在的条目与文件夹，重复路径只留一次
const files = {
	'F/a.md': file('a.md'),
	'F/b.md': file('b.md'),
	'F/c.md': file('c.md'),
	'F/d.md': file('d.md'),
	'F/folder': folder('folder', []),
};
const lookup = (p) => files[p] || null;
const queue = core.resolveQueue(
	['F/a.md', 'F/missing.md', 'F/b.md', 'F/a.md', 'F/folder'],
	lookup,
);
check('书单还原', queue.map((f) => f.basename), ['a', 'b']);
check('书单空输入', core.resolveQueue(undefined, lookup), []);

// 12. 找未读：跳过已读、按方向、可循环
const seq = ['F/a.md', 'F/b.md', 'F/c.md', 'F/d.md'].map((p) => files[p]);
const reads = { 'F/a.md': true, 'F/b.md': true, 'F/c.md': true };
check('下一篇未读（跳到 d）', core.nextUnread(seq, 'F/a.md', reads, 1, false).target.basename, 'd');
check('上一封未读（从 d 往回，a 已读则无）', core.nextUnread(seq, 'F/d.md', reads, -1, false).target, null);
check('全部已读', core.nextUnread(seq, 'F/a.md', { 'F/a.md': 1, 'F/b.md': 1, 'F/c.md': 1, 'F/d.md': 1 }, 1, true).target, null);
check(
	'循环找到前面的未读',
	core.nextUnread(seq, 'F/c.md', { 'F/b.md': 1, 'F/c.md': 1, 'F/d.md': 1 }, 1, true).target.basename,
	'a',
);
check('当前不在列表时从头找', core.nextUnread(seq, 'F/other.md', { 'F/a.md': 1 }, 1, false).target.basename, 'b');
check('空列表不炸', core.nextUnread([], 'F/a.md', {}, 1, false).target, null);

console.log('通过 ' + pass + ' 项');
if (failures.length) {
	console.error('\n失败 ' + failures.length + ' 项：\n' + failures.join('\n\n'));
	process.exit(1);
}
console.log('核心逻辑全部通过');