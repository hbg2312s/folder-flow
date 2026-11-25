/*
 * Folder Flow — 在当前文件夹内连续阅读。
 * 底部薄条 / 文件夹面板 / 阅读位置记忆 / 续读 / 已读 / 书单。
 *
 * 导航排序逻辑参考 Fabian Untermoser 的 Neighbouring Files（MIT），
 * 重写为无依赖的纯函数，便于单元测试。
 */
'use strict';

const {
	Plugin,
	PluginSettingTab,
	Notice,
	Modal,
	Setting,
	Menu,
	MarkdownView,
	Platform,
	TFile,
} = require('obsidian');

// ---------------- core:begin ----------------
// 纯逻辑：不碰 Obsidian API，可直接在 node 里跑测试。
// 约定的条目形状：{ path, basename, name, extension, stat:{mtime,ctime}, children? }

const ORDER_KEYS = [
	'alphabetical',
	'alphabeticalReverse',
	'byCreatedTime',
	'byCreatedTimeReverse',
	'byModifiedTime',
	'byModifiedTimeReverse',
];

function normOrder(order) {
	return ORDER_KEYS.indexOf(order) >= 0 ? order : 'alphabetical';
}

function cmpName(a, b) {
	return String(a.basename).localeCompare(String(b.basename), undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}

function statOf(file, key) {
	const value = file && file.stat ? Number(file.stat[key]) : 0;
	return Number.isFinite(value) ? value : 0;
}

function sorterFor(order) {
	switch (normOrder(order)) {
		case 'alphabeticalReverse':
			return (a, b) => cmpName(b, a);
		case 'byCreatedTime':
			return (a, b) => statOf(b, 'ctime') - statOf(a, 'ctime');
		case 'byCreatedTimeReverse':
			return (a, b) => statOf(a, 'ctime') - statOf(b, 'ctime');
		case 'byModifiedTime':
			return (a, b) => statOf(b, 'mtime') - statOf(a, 'mtime');
		case 'byModifiedTimeReverse':
			return (a, b) => statOf(a, 'mtime') - statOf(b, 'mtime');
		default:
			return cmpName;
	}
}

function isFolderLike(node) {
	return !!node && Array.isArray(node.children);
}

function sortFiles(files, order) {
	return files.slice().sort(sorterFor(order));
}

/**
 * 收集文件夹里的笔记。
 * 顺序：本层文件（按 order 排序）→ 子文件夹（按名称）→ 子文件夹里的文件…
 * includeSubfolders 为 false 时只收本层。
 */
function collectNotes(root, opts) {
	const options = opts || {};
	const includeSubfolders = !!options.includeSubfolders;
	const extensions = options.extensions || ['md'];
	const order = options.order;

	const out = [];
	const walk = (folder) => {
		if (!isFolderLike(folder)) return;
		const files = [];
		const folders = [];
		for (const child of folder.children) {
			if (isFolderLike(child)) folders.push(child);
			else if (extensions.indexOf(child.extension) >= 0) files.push(child);
		}
		for (const file of sortFiles(files, order)) out.push(file);
		if (!includeSubfolders) return;
		folders.sort(cmpName);
		for (const sub of folders) walk(sub);
	};

	walk(root);
	return out;
}

function indexPath(list, path) {
	for (let i = 0; i < list.length; i += 1) {
		if (list[i].path === path) return i;
	}
	return -1;
}

/**
 * 在列表里移动 delta 步。
 * 返回 { index, target, atBoundary }；到边界且不循环时 target 为 null，
 * 绝不回退成"把当前文件重新打开一次"。
 */
function step(list, path, delta, loop) {
	const index = indexPath(list, path);
	if (index < 0 || !list.length) return { index: -1, target: null, atBoundary: true };

	let next = index + delta;
	let atBoundary = false;

	if (loop && list.length > 1) {
		next = ((next % list.length) + list.length) % list.length;
	} else if (next < 0 || next >= list.length) {
		atBoundary = true;
		next = index;
	}

	return {
		index: next,
		target: atBoundary ? null : list[next],
		atBoundary,
	};
}

/** 显示用的位置字符串：3/12；无法定位时返回空串。 */
function positionLabel(list, path) {
	const index = indexPath(list, path);
	if (index < 0) return '';
	return index + 1 + '/' + list.length;
}

/**
 * 键盘是否弹出：视觉视口相对布局视口明显缩小就算弹出。
 * 取不到数值时按「没弹」处理，宁可多显示也不要莫名隐藏。
 */
function keyboardOpen(visualHeight, layoutHeight) {
	if (!visualHeight || !layoutHeight) return false;
	return visualHeight / layoutHeight < 0.8;
}

/** 把书单里的路径还原成文件列表；不存在或已变成文件夹的条目自动丢弃。 */
function resolveQueue(paths, lookup) {
	const out = [];
	const seen = {};
	for (const path of paths || []) {
		if (!path || seen[path]) continue;
		seen[path] = true;
		const item = lookup(path);
		if (item && !isFolderLike(item)) out.push(item);
	}
	return out;
}

/**
 * 找下一篇（direction=1）或上一篇（direction=-1）未读的笔记。
 * 全部已读时 target 为 null；direction 与 loop 组合决定是否会绕回。
 */
function nextUnread(list, path, readMap, direction, loop) {
	const total = list.length;
	if (!total) return { target: null, scanned: 0 };
	const reads = readMap || {};
	const forward = direction >= 0;
	const start = indexPath(list, path);
	if (start < 0) {
		for (let i = 0; i < total; i += 1) {
			const item = forward ? list[i] : list[total - 1 - i];
			if (!reads[item.path]) return { target: item, scanned: i + 1 };
		}
		return { target: null, scanned: total };
	}
	for (let n = 1; n <= total; n += 1) {
		let index = start + (forward ? n : -n);
		if (loop) index = ((index % total) + total) % total;
		else if (index < 0 || index >= total) break;
		if (index === start) continue;
		const item = list[index];
		if (item && !reads[item.path]) return { target: item, scanned: n };
	}
	return { target: null, scanned: total };
}
/**
 * 把一次滑动转成方向；不够长或两个方向都不到阈值时返回 null。
 * 斜着滑时以位移更大的轴为准。
 */
function swipeDirection(dx, dy, threshold) {
	const limit = threshold || 30;
	if (Math.abs(dx) < limit && Math.abs(dy) < limit) return null;
	if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
	return dy < 0 ? 'up' : 'down';
}
// ---------------- core:end ----------------

const DEFAULT_SETTINGS = {
	showOnDesktop: true,
	showOnMobile: true,
	hideWhenKeyboard: true,
	includeSubfolders: false,
	loop: false,
	rememberScroll: true,
	fallbackSortOrder: 'alphabetical',
	resumeLastNote: true,
	autoMarkRead: false,
	queueMode: false,
	collapsed: false,
	swipeLeft: 'folder-flow:prev',
	swipeRight: 'folder-flow:next',
	swipeUp: '',
	swipeDown: 'folder-flow:collapse',
};

class FolderSheetModal extends Modal {
	constructor(plugin, file) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.query = '';
		this.onlyUnread = false;
		this.listEl = null;
		this.countEl = null;
		this.modeBtn = null;
		this.rows = [];
	}

	onOpen() {
		this.plugin.sheet = this;
		this.modalEl.addClass('ff-sheet');
		this.containerEl.addClass('ff-sheet-container');

		const folder = this.file.parent;
		const inQueue = this.plugin.isQueueActive();
		this.titleEl.setText(inQueue ? '书单' : folder ? folder.path : '文件夹');

		const header = this.contentEl.createDiv({ cls: 'ff-sheet-head' });
		this.countEl = header.createDiv({ cls: 'ff-sheet-count' });
		this.modeBtn = header.createEl('button', { cls: 'ff-mode-btn' });
		this.modeBtn.addEventListener('click', () => {
			this.plugin.toggleQueueMode();
			this.render();
		});

		const toggleRow = this.contentEl.createDiv({ cls: 'ff-sheet-toggle' });
		new Setting(toggleRow)
			.setName('包含子文件夹')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.includeSubfolders).onChange(async (value) => {
					this.plugin.settings.includeSubfolders = value;
					await this.plugin.saveSettings();
					this.render();
				}),
			);
		new Setting(toggleRow)
			.setName('只看未读')
			.addToggle((toggle) =>
				toggle.setValue(this.onlyUnread).onChange((value) => {
					this.onlyUnread = value;
					this.render();
				}),
			);

		const input = this.contentEl.createEl('input', {
			cls: 'ff-search',
			attr: { type: 'search', placeholder: '过滤这个文件夹里的笔记…' },
		});
		input.addEventListener('input', () => {
			this.query = input.value;
			this.render();
		});

		this.listEl = this.contentEl.createDiv({ cls: 'ff-list' });
		this.render();
	}

	onClose() {
		this.plugin.sheet = null;
		this.contentEl.empty();
	}

	render() {
		const list = this.plugin.listFor(this.file);
		const current = this.file.path;
		const reads = this.plugin.readMap;
		const query = (this.query || '').trim().toLowerCase();
		const rootPath = this.plugin.isQueueActive()
			? ''
			: this.file.parent
				? this.file.parent.path
				: '';
		const inQueue = this.plugin.isQueueActive();
		const unread = list.filter((file) => !reads[file.path]).length;

		if (this.countEl) {
			const pos = positionLabel(list, current);
			this.countEl.setText(
				list.length + (inQueue ? ' 篇书单' : ' 篇') +
					(pos ? ' · 第 ' + pos.split('/')[0] + ' 篇' : '') +
					' · 未读 ' + unread,
			);
		}

		if (this.modeBtn) {
			this.modeBtn.setText(inQueue ? '切回文件夹' : '切到书单');
			this.modeBtn.toggleClass('is-hidden', !inQueue && !this.plugin.queue.length);
			this.modeBtn.title = inQueue
				? '按书单顺序阅读'
				: '书单里有 ' + this.plugin.queue.length + ' 篇，点这里切换';
		}

		this.listEl.empty();
		const shown = list.filter((file) => {
			if (this.onlyUnread && reads[file.path]) return false;
			if (!query) return true;
			return file.basename.toLowerCase().indexOf(query) >= 0;
		});

		if (!shown.length) {
			this.listEl.createDiv({ cls: 'ff-empty', text: '没有匹配的笔记' });
			return;
		}

		let currentRow = null;
		for (const file of shown) {
			const row = this.listEl.createDiv({ cls: 'ff-row' });
			if (file.path === current) row.addClass('is-current');
			if (reads[file.path]) row.addClass('is-read');
			if (this.plugin.queue.indexOf(file.path) >= 0) row.addClass('is-queued');

			const nameEl = row.createDiv({ cls: 'ff-row-name', text: file.basename });
			if (reads[file.path]) row.createDiv({ cls: 'ff-row-mark', text: '✓' });
			if (file.parent && file.parent.path !== rootPath && rootPath !== '') {
				const rel = file.parent.path.startsWith(rootPath + '/')
					? file.parent.path.slice(rootPath.length + 1)
					: file.parent.path;
				row.createDiv({ cls: 'ff-row-dir', text: rel });
			}

			row.addEventListener('click', () => {
				this.close();
				void this.plugin.openAt(file);
			});

			row.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				this.plugin.buildRowMenu(file, () => this.render()).showAtMouseEvent(event);
			});

			if (file.path === current) currentRow = row;
			this.rows.push(row);
		}

		if (currentRow) {
			window.setTimeout(() => currentRow.scrollIntoView({ block: 'center' }), 30);
		}
	}
}

class FolderFlowSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('桌面端显示底部薄条')
			.setDesc('在笔记底部显示「‹ 3/12 ›」翻页条。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showOnDesktop).onChange(async (value) => {
					this.plugin.settings.showOnDesktop = value;
					await this.plugin.saveSettings();
					this.plugin.updateBar();
				}),
			);

		new Setting(containerEl)
			.setName('移动端显示底部薄条')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showOnMobile).onChange(async (value) => {
					this.plugin.settings.showOnMobile = value;
					await this.plugin.saveSettings();
					this.plugin.updateBar();
				}),
			);

		new Setting(containerEl)
			.setName('手机键盘弹出时隐藏薄条')
			.setDesc('只在键盘弹出（可能压住移动工具栏）时隐藏；编辑模式下键盘收起时仍然显示。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.hideWhenKeyboard).onChange(async (value) => {
					this.plugin.settings.hideWhenKeyboard = value;
					await this.plugin.saveSettings();
					this.plugin.updateBar();
				}),
			);

		new Setting(containerEl)
			.setName('包含子文件夹')
			.setDesc('序列里包含子文件夹中的笔记（本层文件在前，子文件夹随后）。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.includeSubfolders).onChange(async (value) => {
					this.plugin.settings.includeSubfolders = value;
					await this.plugin.saveSettings();
					this.plugin.updateBar();
				}),
			);

		new Setting(containerEl)
			.setName('循环翻页')
			.setDesc('关闭时到边界只提示，不会把当前笔记重新打开。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.loop).onChange(async (value) => {
					this.plugin.settings.loop = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('记忆阅读位置')
			.setDesc('每篇笔记单独记录滚动位置，翻回去时接着读。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.rememberScroll).onChange(async (value) => {
					this.plugin.settings.rememberScroll = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('启动时续读上次的笔记')
			.setDesc('打开 Obsidian 后如果停在空白页，自动打开上次读到的那篇并回到原位置。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.resumeLastNote).onChange(async (value) => {
					this.plugin.settings.resumeLastNote = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('滚到底自动标记已读')
			.setDesc('离开一篇已滚到底的笔记时自动标为已读。关闭则只能手动标记。')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoMarkRead).onChange(async (value) => {
					this.plugin.settings.autoMarkRead = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('排序兜底')
			.setDesc('读不到文件浏览器排序时使用（手机端容易出现这种情况）。')
			.addDropdown((dropdown) => {
				for (const key of ORDER_KEYS) dropdown.addOption(key, key);
				dropdown
					.setValue(this.plugin.settings.fallbackSortOrder)
					.onChange(async (value) => {
						this.plugin.settings.fallbackSortOrder = normOrder(value);
						await this.plugin.saveSettings();
						this.plugin.updateBar();
					});
			});

		containerEl.createEl('h3', { text: '手势（薄条 / 圆点）' });
		const choices = this.plugin.listCommandChoices();
		const addSwipe = (name, desc, key) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addDropdown((dropdown) => {
					dropdown.addOption('', '（无）');
					for (const command of choices) dropdown.addOption(command.id, command.name);
					const current = this.plugin.settings[key];
					if (current && !choices.some((command) => command.id === current)) {
						dropdown.addOption(current, current + '（已失效）');
					}
					dropdown.setValue(current || '').onChange(async (value) => {
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
					});
				});
		};
		addSwipe('左滑', '默认：上一篇', 'swipeLeft');
		addSwipe('右滑', '默认：下一篇', 'swipeRight');
		addSwipe('上滑', '默认：无', 'swipeUp');
		addSwipe('下滑', '默认：收起薄条', 'swipeDown');
	}
}

module.exports = class FolderFlowPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.scrollMap = this.scrollMap || {};
		this.readMap = this.readMap || {};
		this.queue = this.queue || [];
		this.lastPath = this.lastPath || '';
		this.barEl = null;
		this.dotEl = null;
		this.sheet = null;
		this.saveTimer = null;

		this.addSettingTab(new FolderFlowSettingTab(this.app, this));

		const needsFile = (run) => (checking) => {
			if (!this.app.workspace.getActiveFile()) return false;
			if (!checking) run();
			return true;
		};

		this.addCommand({ id: 'next', name: '下一篇（同文件夹）', checkCallback: needsFile(() => this.go(1)) });
		this.addCommand({ id: 'prev', name: '上一篇（同文件夹）', checkCallback: needsFile(() => this.go(-1)) });
		this.addCommand({ id: 'go-first', name: '跳到本文件夹第一篇', checkCallback: needsFile(() => this.goEdge('first')) });
		this.addCommand({ id: 'go-last', name: '跳到本文件夹最后一篇', checkCallback: needsFile(() => this.goEdge('last')) });
		this.addCommand({ id: 'open-sheet', name: '打开文件夹面板', checkCallback: needsFile(() => this.openSheet()) });
		this.addCommand({ id: 'resume', name: '回到上次阅读的位置', checkCallback: (checking) => {
			if (!this.lastPath) return false;
			if (!checking) void this.resumeLast();
			return true;
		} });
		this.addCommand({ id: 'next-unread', name: '下一篇未读', checkCallback: needsFile(() => this.goUnread(1)) });
		this.addCommand({ id: 'prev-unread', name: '上一篇未读', checkCallback: needsFile(() => this.goUnread(-1)) });
		this.addCommand({ id: 'toggle-read', name: '标记已读 / 未读（当前笔记）', checkCallback: needsFile(() => this.toggleRead()) });
		this.addCommand({ id: 'queue-add', name: '把当前笔记加入书单', checkCallback: needsFile(() => this.addToQueue(this.app.workspace.getActiveFile())) });
		this.addCommand({ id: 'queue-remove', name: '把当前笔记移出书单', checkCallback: needsFile(() => this.removeFromQueue(this.app.workspace.getActiveFile())) });
		this.addCommand({ id: 'queue-clear', name: '清空书单', callback: () => this.clearQueue() });
		this.addCommand({ id: 'queue-toggle', name: '切换书单模式 / 文件夹模式', callback: () => this.toggleQueueMode() });
		this.addCommand({ id: 'toggle-collapse', name: '展开 / 收起阅读薄条', callback: () => this.setCollapsed(!this.settings.collapsed) });
		this.addCommand({ id: 'collapse', name: '收起阅读薄条', callback: () => this.setCollapsed(true) });

		this.registerEvent(this.app.workspace.on('file-open', () => this.updateBar()));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.updateBar()));
		this.registerEvent(this.app.workspace.on('layout-change', () => this.updateBar()));
		this.registerDomEvent(window, 'resize', () => this.updateBar());
		if (window.visualViewport) {
			this.registerDomEvent(window.visualViewport, 'resize', () => this.updateBar());
		}

		this.app.workspace.onLayoutReady(() => {
			this.buildBar();
			this.updateBar();
			this.maybeResume();
		});
	}

	onunload() {
		if (this.barEl) {
			this.barEl.remove();
			this.barEl = null;
		}
		if (this.dotEl) {
			this.dotEl.remove();
			this.dotEl = null;
		}
		this.sheet = null;
		if (this.saveTimer) window.clearTimeout(this.saveTimer);
	}

	// ---------- 持久化 ----------

	async loadSettings() {
		const loaded = (await this.loadData()) || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded.settings || {});
		const legacy = loaded.settings ? loaded.settings.hideWhenEditing : undefined;
		if (typeof legacy === 'boolean' && loaded.settings.hideWhenKeyboard === undefined) {
			this.settings.hideWhenKeyboard = legacy;
		}
		this.scrollMap = Object.assign({}, loaded.scrollMap || {});
		this.readMap = Object.assign({}, loaded.readMap || {});
		this.queue = Array.isArray(loaded.queue) ? loaded.queue.slice() : [];
		this.lastPath = typeof loaded.lastPath === 'string' ? loaded.lastPath : '';
	}

	async saveSettings() {
		await this.saveData({
			settings: this.settings,
			scrollMap: this.scrollMap,
			readMap: this.readMap,
			queue: this.queue,
			lastPath: this.lastPath,
		});
	}

	persistLater() {
		if (this.saveTimer) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveSettings();
		}, 600);
	}

	// ---------- 列表与排序 ----------

	queueFiles() {
		return resolveQueue(this.queue, (path) => this.app.vault.getAbstractFileByPath(path));
	}

	isQueueActive() {
		return !!(this.settings.queueMode && this.queue.length);
	}

	resolveOrder() {
		let order = null;
		try {
			const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
			const state = leaf && leaf.getViewState ? leaf.getViewState().state : null;
			order = state ? state.sortOrder : null;
		} catch (error) {
			order = null;
		}
		return normOrder(order || this.settings.fallbackSortOrder);
	}

	/** 当前笔记所属的阅读序列：书单优先，其次文件夹。 */
	listFor(file) {
		if (!file) return [];
		if (this.isQueueActive()) {
			const queue = this.queueFiles();
			if (indexPath(queue, file.path) >= 0) return queue;
		}
		if (!file.parent) return [file];
		const opts = {
			includeSubfolders: this.settings.includeSubfolders,
			extensions: ['md'],
			order: this.resolveOrder(),
		};
		let list = collectNotes(file.parent, opts);
		if (indexPath(list, file.path) < 0) {
			list = collectNotes(file.parent, Object.assign({}, opts, { includeSubfolders: false }));
		}
		if (indexPath(list, file.path) < 0) list = [file];
		return list;
	}

	// ---------- 薄条 ----------

	buildBar() {
		if (this.barEl) return;
		const bar = document.body.createDiv({ cls: 'folder-flow-bar' });

		const prev = bar.createEl('button', { cls: 'ff-nav', text: '‹' });
		prev.setAttr('aria-label', '上一篇');
		prev.addEventListener('click', () => this.go(-1));

		const label = bar.createEl('button', { cls: 'ff-label' });
		label.createEl('span', { cls: 'ff-badge', text: '' });
		label.createEl('span', { cls: 'ff-name', text: '' });
		label.createEl('span', { cls: 'ff-pos', text: '' });
		label.setAttr('aria-label', '打开文件夹面板');
		label.addEventListener('click', () => this.openSheet());

		const next = bar.createEl('button', { cls: 'ff-nav', text: '›' });
		next.setAttr('aria-label', '下一篇');
		next.addEventListener('click', () => this.go(1));

		const collapse = bar.createEl('button', { cls: 'ff-nav ff-collapse', text: '▾' });
		collapse.setAttr('aria-label', '收起成圆点');
		collapse.addEventListener('click', () => this.setCollapsed(true));

		this.attachSwipe(bar);
		this.barEl = bar;
		this.dotEl = this.buildDot();
	}

	buildDot() {
		const dot = document.body.createEl('button', { cls: 'folder-flow-dot' });
		dot.setAttr('aria-label', '展开阅读薄条');
		dot.createSpan({ cls: 'ff-dot-text', text: '' });

		let startX = 0;
		let startY = 0;
		let tracking = false;
		let swiped = false;
		let longPressed = false;
		let timer = null;

		const clearTimer = () => {
			if (timer) {
				window.clearTimeout(timer);
				timer = null;
			}
		};

		dot.addEventListener('pointerdown', (event) => {
			tracking = true;
			swiped = false;
			longPressed = false;
			startX = event.clientX;
			startY = event.clientY;
			clearTimer();
			timer = window.setTimeout(() => {
				timer = null;
				if (!tracking || swiped) return;
				longPressed = true;
				this.openSheet();
			}, 500);
		});

		dot.addEventListener('pointerup', (event) => {
			clearTimer();
			if (!tracking) return;
			tracking = false;
			if (longPressed) return;
			const direction = swipeDirection(
				event.clientX - startX,
				event.clientY - startY,
				30,
			);
			if (direction) {
				swiped = true;
				this.runSwipe(direction);
				return;
			}
			this.setCollapsed(false);
		});

		dot.addEventListener('pointercancel', () => {
			clearTimer();
			tracking = false;
		});

		return dot;
	}

	setCollapsed(value) {
		this.settings.collapsed = !!value;
		void this.saveSettings();
		this.updateBar();
	}

	attachSwipe(bar) {
		let startX = 0;
		let startY = 0;
		let tracking = false;

		bar.addEventListener('pointerdown', (event) => {
			tracking = true;
			startX = event.clientX;
			startY = event.clientY;
		});

		bar.addEventListener('pointerup', (event) => {
			if (!tracking) return;
			tracking = false;
			const direction = swipeDirection(event.clientX - startX, event.clientY - startY, 30);
			if (direction) this.runSwipe(direction);
		});

		bar.addEventListener('pointercancel', () => {
			tracking = false;
		});
	}

	/** 手势绑定的命令 id；空串表示这个方向不做事。 */
	swipeCommand(direction) {
		if (direction === 'left') return this.settings.swipeLeft;
		if (direction === 'right') return this.settings.swipeRight;
		if (direction === 'up') return this.settings.swipeUp;
		return this.settings.swipeDown;
	}

	runSwipe(direction) {
		const commandId = this.swipeCommand(direction);
		if (!commandId) return;
		this.runCommand(commandId);
	}

	runCommand(commandId) {
		if (!commandId) return;
		const commands = this.app.commands;
		if (!commands || typeof commands.executeCommandById !== 'function') return;
		try {
			commands.executeCommandById(commandId);
		} catch (error) {
			new Notice('命令执行失败：' + commandId);
		}
	}

	/** 设置界面用：列出所有可用命令（含其它插件注册的）。 */
	listCommandChoices() {
		const commands = this.app.commands;
		if (!commands || typeof commands.listCommands !== 'function') return [];
		return commands
			.listCommands()
			.map((command) => ({ id: command.id, name: command.name }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/* 键盘是否弹出：iOS/Android 的 visualViewport 会明显缩小；不缩小就是没弹。 */
	isKeyboardOpen() {
		const viewport = window.visualViewport;
		if (!viewport) return false;
		return keyboardOpen(viewport.height, window.innerHeight);
	}

	updateBar() {
		if (!this.barEl) return;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view ? view.file : this.app.workspace.getActiveFile();

		let visible = !!file && file.extension === 'md';
		if (visible) {
			visible = Platform.isMobile ? this.settings.showOnMobile : this.settings.showOnDesktop;
		}
		if (visible && Platform.isMobile && this.settings.hideWhenKeyboard && this.isKeyboardOpen()) {
			visible = false;
		}

		const dot = this.dotEl;
		if (!visible) {
			this.barEl.removeClass('is-visible');
			if (dot) dot.removeClass('is-visible');
			return;
		}

		const list = this.listFor(file);
		const pos = positionLabel(list, file.path);
		const read = !!this.readMap[file.path];

		if (this.settings.collapsed) {
			this.barEl.removeClass('is-visible');
			if (dot) {
				const textEl = dot.querySelector('.ff-dot-text');
				if (textEl) textEl.setText(pos ? pos.split('/')[0] : '•');
				dot.setAttr('title', file.basename + (pos ? ' · ' + pos : '') + ' · 点击展开');
				dot.toggleClass('is-read', read);
				dot.addClass('is-visible');
			}
			return;
		}

		if (dot) dot.removeClass('is-visible');

		const queueRead = this.isQueueActive() && indexPath(this.queueFiles(), file.path) >= 0;

		const badgeEl = this.barEl.querySelector('.ff-badge');
		const nameEl = this.barEl.querySelector('.ff-name');
		const posEl = this.barEl.querySelector('.ff-pos');
		if (badgeEl) {
			badgeEl.setText(queueRead ? '书单' : '');
			badgeEl.toggleClass('is-hidden', !queueRead);
		}
		if (nameEl) nameEl.setText(file.basename);
		if (posEl) posEl.setText(pos);

		this.barEl.toggleClass('is-single', list.length <= 1);
		this.barEl.toggleClass('is-read', read);
		this.barEl.addClass('is-visible');
	}

	// ---------- 翻页 ----------

	go(delta) {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		const list = this.listFor(file);
		const result = step(list, file.path, delta, this.settings.loop);
		if (!result.target) {
			if (result.atBoundary) {
				new Notice(delta > 0 ? '已经是这个序列的最后一篇了' : '已经是这个序列的第一篇了');
			}
			return;
		}
		void this.openAt(result.target);
	}

	goEdge(edge) {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		const list = this.listFor(file);
		if (!list.length) return;
		const target = edge === 'first' ? list[0] : list[list.length - 1];
		if (target.path === file.path) return;
		void this.openAt(target);
	}

	goUnread(direction) {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		const list = this.listFor(file);
		const result = nextUnread(list, file.path, this.readMap, direction, this.settings.loop);
		if (!result.target) {
			new Notice('这个序列里没有未读的笔记了');
			return;
		}
		void this.openAt(result.target);
	}

	// ---------- 已读 ----------

	setRead(file, value) {
		if (!file) return;
		if (value) this.readMap[file.path] = true;
		else delete this.readMap[file.path];
		this.persistLater();
		this.updateBar();
		if (this.sheet) this.sheet.render();
	}

	toggleRead() {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		const next = !this.readMap[file.path];
		this.setRead(file, next);
		new Notice(next ? '已标记为已读' : '已标记为未读');
	}

	// ---------- 书单 ----------

	addToQueue(file) {
		if (!file || !file.path) return;
		if (this.queue.indexOf(file.path) >= 0) {
			new Notice('已经在书单里了');
			return;
		}
		this.queue.push(file.path);
		this.persistLater();
		this.updateBar();
		if (this.sheet) this.sheet.render();
		new Notice('已加入书单（' + this.queue.length + ' 篇）');
	}

	removeFromQueue(file) {
		if (!file) return;
		const index = this.queue.indexOf(file.path);
		if (index < 0) return;
		this.queue.splice(index, 1);
		if (!this.queue.length) this.settings.queueMode = false;
		this.persistLater();
		this.updateBar();
		if (this.sheet) this.sheet.render();
	}

	clearQueue() {
		if (!this.queue.length) {
			new Notice('书单已经是空的');
			return;
		}
		this.queue = [];
		this.settings.queueMode = false;
		void this.saveSettings();
		this.updateBar();
		if (this.sheet) this.sheet.render();
		new Notice('书单已清空');
	}

	toggleQueueMode() {
		if (!this.queue.length) {
			new Notice('书单是空的：先在面板里长按笔记「加入书单」');
			return;
		}
		this.settings.queueMode = !this.settings.queueMode;
		void this.saveSettings();
		this.updateBar();
		new Notice(this.settings.queueMode ? '按书单顺序阅读' : '按文件夹顺序阅读');
	}

	// ---------- 面板与菜单 ----------

	openSheet() {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		new FolderSheetModal(this, file).open();
	}

	buildRowMenu(file, refresh) {
		const menu = new Menu();
		const read = !!this.readMap[file.path];
		const queued = this.queue.indexOf(file.path) >= 0;

		menu.addItem((item) =>
			item.setTitle('在新标签页打开').setIcon('lucide-file-plus').onClick(async () => {
				await this.app.workspace.getLeaf('tab').openFile(file);
			}),
		);
		if (!Platform.isMobile) {
			menu.addItem((item) =>
				item.setTitle('在右侧打开').setIcon('lucide-columns').onClick(async () => {
					await this.app.workspace.getLeaf('split', 'vertical').openFile(file);
				}),
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(read ? '标记为未读' : '标记为已读')
				.setIcon('lucide-check')
				.onClick(() => {
					this.setRead(file, !read);
					refresh();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(queued ? '从书单移除' : '加入书单')
				.setIcon('lucide-list-plus')
				.onClick(() => {
					if (queued) this.removeFromQueue(file);
					else this.addToQueue(file);
					refresh();
				}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle('复制路径').setIcon('lucide-clipboard').onClick(async () => {
				await navigator.clipboard.writeText(file.path);
				new Notice('已复制路径');
			}),
		);
		menu.addItem((item) =>
			item.setTitle('复制链接').setIcon('lucide-link').onClick(async () => {
				const active = this.app.workspace.getActiveFile();
				const link = this.app.fileManager.generateMarkdownLink(file, active ? active.path : '');
				await navigator.clipboard.writeText(link);
				new Notice('已复制链接');
			}),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle('重命名').setIcon('lucide-edit-3').onClick(() => {
				this.app.fileManager.promptForFileRename(file);
			}),
		);
		menu.addItem((item) =>
			item.setTitle('删除').setIcon('lucide-trash-2').onClick(() => {
				this.app.fileManager.promptForDeletion(file);
			}),
		);
		menu.addItem((item) =>
			item.setTitle('在此文件夹新建笔记').setIcon('lucide-file-plus').onClick(async () => {
				const created = await this.app.fileManager.createNewMarkdownFile(file.parent);
				if (created) {
					if (this.sheet) this.sheet.close();
					await this.openAt(created);
				}
			}),
		);
		return menu;
	}

	// ---------- 打开与位置记忆 ----------

	async openAt(file) {
		if (!file) return;
		if (this.settings.rememberScroll) {
			this.captureScroll(this.app.workspace.getActiveFile());
		}
		const target = this.settings.rememberScroll ? Number(this.scrollMap[file.path]) || 0 : 0;
		const leaf = this.app.workspace.getLeaf(false);
		try {
			await leaf.openFile(file, { active: true, eState: target ? { scroll: target } : undefined });
		} catch (error) {
			new Notice('打开失败：' + (error && error.message ? error.message : file.path));
			return;
		}
		this.lastPath = file.path;
		this.persistLater();
		if (target) this.restoreScrollSoon(target);
		this.updateBar();
	}

	findScrollerEl() {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const root = view ? view.containerEl : null;
		if (!root) return null;
		const selectors = ['.cm-scroller', '.markdown-reading-view', '.markdown-preview-view'];
		for (const selector of selectors) {
			const el = root.querySelector(selector);
			if (el) return el;
		}
		return null;
	}

	captureScroll(file) {
		if (!file) return;
		const el = this.findScrollerEl();
		if (!el) return;
		const top = el.scrollTop || 0;
		this.scrollMap[file.path] = top;
		this.lastPath = file.path;
		if (this.settings.autoMarkRead && !this.readMap[file.path]) {
			const max = Math.max(0, el.scrollHeight - el.clientHeight);
			if (max > 0 && top >= max - 24) {
				this.readMap[file.path] = true;
				if (this.sheet) this.sheet.render();
			}
		}
		this.persistLater();
	}

	restoreScrollSoon(target) {
		const apply = () => {
			const el = this.findScrollerEl();
			if (!el) return;
			const max = Math.max(0, el.scrollHeight - el.clientHeight);
			el.scrollTop = Math.min(Math.max(0, target), max);
		};
		window.setTimeout(apply, 40);
		window.setTimeout(apply, 180);
		window.setTimeout(apply, 420);
	}

	// ---------- 续读 ----------

	async resumeLast() {
		if (!this.lastPath) return false;
		const file = this.app.vault.getAbstractFileByPath(this.lastPath);
		if (!(file instanceof TFile) || file.extension !== 'md') return false;
		await this.openAt(file);
		return true;
	}

	maybeResume() {
		if (!this.settings.resumeLastNote || !this.lastPath) return;
		window.setTimeout(async () => {
			if (this.app.workspace.getActiveFile()) return;
			await this.resumeLast();
		}, 400);
	}
};