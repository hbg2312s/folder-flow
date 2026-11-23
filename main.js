/*
 * Folder Flow — 在当前文件夹内连续阅读。
 * 底部薄条翻篇 / 文件夹面板 / 阅读位置记忆。
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
	MarkdownView,
	Platform,
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
	// stat 缺失时按 0 处理，保证排序函数永远返回数字
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
// ---------------- core:end ----------------

const DEFAULT_SETTINGS = {
	showOnDesktop: true,
	showOnMobile: true,
	hideWhenKeyboard: true,
	includeSubfolders: false,
	loop: false,
	rememberScroll: true,
	fallbackSortOrder: 'alphabetical',
};

class FolderSheetModal extends Modal {
	constructor(plugin, file) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.query = '';
		this.listEl = null;
		this.countEl = null;
	}

	onOpen() {
		this.modalEl.addClass('ff-sheet');
		this.containerEl.addClass('ff-sheet-container');

		const folder = this.file.parent;
		this.titleEl.setText(folder ? folder.path : '文件夹');

		const header = this.contentEl.createDiv({ cls: 'ff-sheet-head' });
		this.countEl = header.createDiv({ cls: 'ff-sheet-count' });

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

		const input = this.contentEl.createEl('input', {
			cls: 'ff-search',
			attr: { type: 'search', placeholder: '过滤这个文件夹里的笔记…' },
		});
		input.addEventListener('input', () => {
			this.query = input.getValue ? input.getValue() : input.value;
			this.render();
		});

		this.listEl = this.contentEl.createDiv({ cls: 'ff-list' });
		this.render();
	}

	onClose() {
		this.contentEl.empty();
	}

	render() {
		const list = this.plugin.listFor(this.file);
		const current = this.file.path;
		const query = (this.query || '').trim().toLowerCase();
		const rootPath = this.file.parent ? this.file.parent.path : '';

		if (this.countEl) {
			const pos = positionLabel(list, current);
			this.countEl.setText(list.length + ' 篇' + (pos ? ' · 第 ' + pos.split('/')[0] + ' 篇' : ''));
		}

		this.listEl.empty();
		const shown = list.filter((file) => {
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
			row.createDiv({ cls: 'ff-row-name', text: file.basename });
			if (file.parent && file.parent.path !== rootPath) {
				const rel = file.parent.path.startsWith(rootPath + '/')
					? file.parent.path.slice(rootPath.length + 1)
					: file.parent.path;
				row.createDiv({ cls: 'ff-row-dir', text: rel });
			}
			row.addEventListener('click', () => {
				this.close();
				void this.plugin.openAt(file);
			});
			if (file.path === current) currentRow = row;
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
	}
}

module.exports = class FolderFlowPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		this.scrollMap = {};
		this.barEl = null;
		this.saveScrollTimer = null;

		this.addSettingTab(new FolderFlowSettingTab(this.app, this));

		this.addCommand({
			id: 'next',
			name: '下一篇（同文件夹）',
			checkCallback: (checking) => {
				if (!this.app.workspace.getActiveFile()) return false;
				if (!checking) this.go(1);
				return true;
			},
		});

		this.addCommand({
			id: 'prev',
			name: '上一篇（同文件夹）',
			checkCallback: (checking) => {
				if (!this.app.workspace.getActiveFile()) return false;
				if (!checking) this.go(-1);
				return true;
			},
		});

		this.addCommand({
			id: 'go-first',
			name: '跳到本文件夹第一篇',
			checkCallback: (checking) => {
				if (!this.app.workspace.getActiveFile()) return false;
				if (!checking) this.goEdge('first');
				return true;
			},
		});

		this.addCommand({
			id: 'go-last',
			name: '跳到本文件夹最后一篇',
			checkCallback: (checking) => {
				if (!this.app.workspace.getActiveFile()) return false;
				if (!checking) this.goEdge('last');
				return true;
			},
		});

		this.addCommand({
			id: 'open-sheet',
			name: '打开文件夹面板',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) this.openSheet();
				return true;
			},
		});

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
		});
	}

	onunload() {
		if (this.barEl) {
			this.barEl.remove();
			this.barEl = null;
		}
		if (this.saveScrollTimer) window.clearTimeout(this.saveScrollTimer);
	}

	// ---------- settings ----------

	async loadSettings() {
		const loaded = (await this.loadData()) || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded.settings || {});
		const legacy = loaded.settings ? loaded.settings.hideWhenEditing : undefined;
		if (typeof legacy === 'boolean' && loaded.settings.hideWhenKeyboard === undefined) {
			this.settings.hideWhenKeyboard = legacy;
		}
		this.scrollMap = Object.assign({}, loaded.scrollMap || {});
	}

	async saveSettings() {
		await this.saveData({ settings: this.settings, scrollMap: this.scrollMap });
	}

	// ---------- 列表与排序 ----------

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

	/** 当前笔记所属的阅读序列。定位不到时退回家目录的同级文件。 */
	listFor(file) {
		if (!file || !file.parent) return [file];
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
		label.createEl('span', { cls: 'ff-name', text: '' });
		label.createEl('span', { cls: 'ff-pos', text: '' });
		label.setAttr('aria-label', '打开文件夹面板');
		label.addEventListener('click', () => this.openSheet());

		const next = bar.createEl('button', { cls: 'ff-nav', text: '›' });
		next.setAttr('aria-label', '下一篇');
		next.addEventListener('click', () => this.go(1));

		this.attachSwipe(bar);
		this.barEl = bar;
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
			const dx = event.clientX - startX;
			const dy = event.clientY - startY;
			if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.5) {
				this.go(dx < 0 ? 1 : -1);
			}
		});

		bar.addEventListener('pointercancel', () => {
			tracking = false;
		});
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

		if (!visible) {
			this.barEl.removeClass('is-visible');
			return;
		}

		const list = this.listFor(file);
		const pos = positionLabel(list, file.path);
		const nameEl = this.barEl.querySelector('.ff-name');
		const posEl = this.barEl.querySelector('.ff-pos');
		if (nameEl) nameEl.setText(file.basename);
		if (posEl) posEl.setText(pos);
		this.barEl.toggleClass('is-single', list.length <= 1);
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
				new Notice(delta > 0 ? '已经是这个文件夹的最后一篇了' : '已经是这个文件夹的第一篇了');
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

	openSheet() {
		const file = this.app.workspace.getActiveFile();
		if (!file) return;
		new FolderSheetModal(this, file).open();
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
		this.scrollMap[file.path] = el.scrollTop || 0;
		if (this.saveScrollTimer) window.clearTimeout(this.saveScrollTimer);
		this.saveScrollTimer = window.setTimeout(() => {
			this.saveScrollTimer = null;
			void this.saveSettings();
		}, 800);
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
};