/**
 * C# 引用分析工具 — 前端逻辑
 */

/** @typedef {'class'|'interface'|'struct'|'record'|'enum'} TypeKind */
/** @typedef {'extends'|'implements'|'calls'|'uses'} RefKind */

/** @type {Object|null} */
let currentData = null;

/** @type {string|null} */
let selectedClassId = null;

/** @type {string|null} 调用树中当前高亮的类型 id（同类多条目） */
let highlightedTreeClassId = null;

/** @typedef {{ type: 'summary' }} LayersNavSummaryView */
/** @typedef {{ type: 'classSource', classId: string, focusLine?: number|null, title?: string|null }} LayersNavClassSourceView */
/** @typedef {LayersNavSummaryView|LayersNavClassSourceView} LayersNavView */
/** @typedef {{ classId: string, view?: LayersNavView }} LayersNavEntry */
/** @type {LayersNavEntry[]} */
let layersNavHistory = [];
/** @type {number} */
let layersNavIndex = -1;
/** @type {boolean} 正在通过后退/前进恢复，避免重复入栈 */
let layersNavApplying = false;

const MAX_TREE_DEPTH = 5;
const MAX_TREE_NODES = 200;
const PATH_HISTORY_MAX = 10;
/** ponytail: 旧版 Cookie 名，仅用于一次性迁移到服务端 */
const PATH_HISTORY_COOKIE_LEGACY = 'csharp_ref_analyzer_paths';
/** @type {string|null} 目录树中高亮的类型 id */
let highlightedFileTreeClassId = null;

/** @type {Set<string>} 已展开的目录路径（/ 分隔，不含文件名） */
let fileTreeExpandedDirs = new Set();

/** @type {Set<string>} 已展开的 .cs 文件路径（用于多类型文件） */
let fileTreeExpandedFiles = new Set();

const FILE_TREE_WIDTH_STORAGE_KEY = 'csharp_ref_analyzer_file_tree_width';
const FILE_TREE_COLLAPSED_STORAGE_KEY = 'csharp_ref_analyzer_file_tree_collapsed';
/** 浏览器 localStorage：本标签页最近一次成功分析的路径（刷新后自动分析） */
const LAST_ANALYSIS_STORAGE_KEY = 'csharp_ref_analyzer_last_analysis';
const FILE_TREE_WIDTH_MIN = 200;
const FILE_TREE_WIDTH_MAX = 520;
const FILE_TREE_WIDTH_DEFAULT = 260;
const TREE_WIDTH_STORAGE_KEY = 'csharp_ref_analyzer_tree_width';
const TREE_WIDTH_MIN = 260;
const TREE_WIDTH_MAX = 720;
const TREE_WIDTH_DEFAULT = 360;
/** 窄屏断点：与 styles.css @media 一致，侧栏改为左右滑出抽屉 */
const MOBILE_LAYOUT_MAX_WIDTH = 1100;
/** 同一文件内相邻引用行间距 ≤ 此值则合并为一块展示 */
const SNIPPET_MERGE_LINE_GAP = 10;

const folderInput = document.getElementById('folderPath');
const analyzeBtn = document.getElementById('analyzeBtn');
const statsBar = document.getElementById('statsBar');
const errorBox = document.getElementById('errorBox');
const layersContainer = document.getElementById('layersContainer');
const layersSearchInput = document.getElementById('layersSearchInput');
const layersSearchClear = document.getElementById('layersSearchClear');
const layersSearchStatus = document.getElementById('layersSearchStatus');
const treeTitle = document.getElementById('treeTitle');
const treeContainer = document.getElementById('treeContainer');
const treeResizeHandle = document.getElementById('treeResizeHandle');
const treePanel = document.getElementById('treePanel');
const fileTreePanel = document.getElementById('fileTreePanel');
const mobileDrawerBackdrop = document.getElementById('mobileDrawerBackdrop');
const openFileTreeDrawerBtn = document.getElementById('openFileTreeDrawerBtn');
const openTreeDrawerBtn = document.getElementById('openTreeDrawerBtn');
const closeFileTreeDrawerBtn = document.getElementById('closeFileTreeDrawerBtn');
const closeTreeDrawerBtn = document.getElementById('closeTreeDrawerBtn');
const fileTreeContainer = document.getElementById('fileTreeContainer');
const expandAllFileTreeBtn = document.getElementById('expandAllFileTreeBtn');
const collapseAllFileTreeBtn = document.getElementById('collapseAllFileTreeBtn');
const fileTreeResizeHandle = document.getElementById('fileTreeResizeHandle');
const toggleFileTreePanelBtn = document.getElementById('toggleFileTreePanelBtn');
const pathHistorySection = document.getElementById('pathHistorySection');
const pathHistoryCards = document.getElementById('pathHistoryCards');
const openHelpBtn = document.getElementById('openHelpBtn');
const helpModal = document.getElementById('helpModal');
const helpModalBackdrop = document.getElementById('helpModalBackdrop');
const helpModalClose = document.getElementById('helpModalClose');
const refDetailModal = document.getElementById('refDetailModal');
const refDetailBackdrop = document.getElementById('refDetailBackdrop');
const refDetailClose = document.getElementById('refDetailClose');
const refDetailBody = document.getElementById('refDetailBody');
const pageHeader = document.getElementById('pageHeader');
const pageHeaderTitle = document.getElementById('pageHeaderTitle');
const headerDefaultActions = document.getElementById('headerDefaultActions');
const headerDetailActions = document.getElementById('headerDetailActions');

/** 主页顶栏默认标题 */
const PAGE_HEADER_DEFAULT_TITLE = 'C# 代码库引用分析';

/** @type {{ parent: Node, next: Node | null } | null} 详情关闭时还原 pageHeader 的 DOM 锚点 */
let pageHeaderHomeAnchor = null;

/** @type {{ filePath: string, focusLine: number, lineCount: number } | null} 内联源码视图状态（同文件跳转复用 DOM） */
let currentInlineSourceView = null;

/** @type {string|null} 源码弹窗内选中文本触发的全文件字符串查找 query */
let refDetailSearchQuery = null;

/**
 * 源码块渲染上下文（选区查找高亮时复用，避免把整文件塞进 data-*）
 * @typedef {{
 *   kind: 'full' | 'snippet',
 *   scannedClassNames: string[],
 *   scannedClassNameToId: Map<string, string>,
 *   linesByNumber: Map<number, string>,
 *   lineRefInfo?: Map<number, { spans: { start: number, length: number }[], terms: Set<string> }>,
 *   metaBaseText: string
 * }} RefDetailBlockRenderCtx
 */

/** @type {WeakMap<HTMLElement, RefDetailBlockRenderCtx>} */
const refDetailBlockRenderCtx = new WeakMap();

/** @type {string[]} */
let savedPaths = [];

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[app] 初始化 UI');
  renderLegendIcons();
  initHelpModal();
  initFileTreePanelResize();
  initFileTreePanelCollapse();
  initTreePanelResize();
  initMobileDrawers();
  await initPathHistory();
  await tryRestoreLastAnalysis();
  analyzeBtn.addEventListener('click', onAnalyze);
  expandAllFileTreeBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    setFileTreeExpanded(true);
  });
  collapseAllFileTreeBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    setFileTreeExpanded(false);
  });
  folderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      onAnalyze();
    }
  });
  initRefDetailModal();
  initPageHeaderHeightSync();
  initLayersSearch();
  initLayersNav();
  initOutlineMemberNav();
  initPathHistoryAutoRefresh();
  if (typeof initGraphView === 'function') {
    initGraphView();
  }
});

/** 切换回标签页时从服务端刷新路径历史（多标签 / 127.0.0.1 与局域网 IP 互开） */
function initPathHistoryAutoRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[app] 标签页可见，刷新路径历史');
      loadPathHistory().then(() => renderPathHistoryCards());
    }
  });
}

// --- 服务端路径历史 ---

/** 页面加载：从服务端读取，必要时迁移旧 Cookie */
async function initPathHistory() {
  await loadPathHistory();
  await migratePathHistoryFromCookie();
  renderPathHistoryCards();
}

/** 从服务端 GET /api/path-history 加载列表 */
async function loadPathHistory() {
  try {
    const resp = await fetch('/api/path-history');
    if (!resp.ok) {
      console.warn('[app] 加载路径历史失败', resp.status);
      savedPaths = [];
      return;
    }

    const data = await resp.json();
    if (!Array.isArray(data.paths)) {
      savedPaths = [];
      return;
    }

    savedPaths = data.paths
      .filter((p) => typeof p === 'string' && p.trim().length > 0)
      .slice(0, PATH_HISTORY_MAX);
    console.log('[app] 已从服务端加载路径历史', savedPaths);
  } catch (err) {
    console.warn('[app] 加载路径历史异常', err);
    savedPaths = [];
  }
}

/** ponytail: 一次性将旧 Cookie 数据 POST 到服务端后清空 Cookie；仅当服务端尚无记录时迁移，避免各 origin 旧 Cookie 互相覆盖 */
async function migratePathHistoryFromCookie() {
  const legacyPaths = readLegacyPathsFromCookie();
  if (!legacyPaths.length) {
    return;
  }

  if (savedPaths.length > 0) {
    console.log('[app] 服务端已有路径历史，跳过 Cookie 迁移并清除旧 Cookie');
    clearLegacyPathHistoryCookie();
    return;
  }

  console.log('[app] 检测到旧 Cookie 路径历史，开始迁移', legacyPaths);

  // Cookie 内为「最新在前」；逐条 POST 会置顶，故从旧到新提交以保留原顺序
  const ordered = [...legacyPaths].reverse();
  for (const folderPath of ordered) {
    try {
      await fetch('/api/path-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath })
      });
    } catch (err) {
      console.warn('[app] 迁移单条路径失败', folderPath, err);
    }
  }

  clearLegacyPathHistoryCookie();
  await loadPathHistory();
}

/** 读取旧版 Cookie 中的路径（迁移专用） */
function readLegacyPathsFromCookie() {
  const raw = readCookie(PATH_HISTORY_COOKIE_LEGACY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((p) => typeof p === 'string' && p.trim().length > 0)
      .slice(0, PATH_HISTORY_MAX);
  } catch (err) {
    console.warn('[app] 解析旧路径 Cookie 失败', err);
    return [];
  }
}

/** 清除旧版路径历史 Cookie */
function clearLegacyPathHistoryCookie() {
  document.cookie = `${PATH_HISTORY_COOKIE_LEGACY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
  console.log('[app] 已清除旧路径 Cookie');
}

/** 读取指定 Cookie 值（仅迁移用） */
function readCookie(name) {
  const prefix = `${name}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return null;
}

/** 从历史中移除一条路径（服务端 DELETE） */
async function removePathFromHistory(folderPath) {
  try {
    const resp = await fetch('/api/path-history', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });

    if (resp.ok) {
      const data = await resp.json();
      savedPaths = Array.isArray(data.paths) ? data.paths : savedPaths.filter((p) => !pathsEqual(p, folderPath));
    } else {
      savedPaths = savedPaths.filter((p) => !pathsEqual(p, folderPath));
    }

    console.log('[app] 已移除历史路径', folderPath);
  } catch (err) {
    console.warn('[app] 移除历史路径失败', err);
    savedPaths = savedPaths.filter((p) => !pathsEqual(p, folderPath));
  }

  renderPathHistoryCards();
}

/** Windows 路径比较忽略大小写 */
function pathsEqual(a, b) {
  return a.trim().replace(/\//g, '\\').toLowerCase() === b.trim().replace(/\//g, '\\').toLowerCase();
}

/** 卡片显示名：取最后一级文件夹 */
function pathDisplayLabel(folderPath) {
  const cleaned = folderPath.trim().replace(/[\\/]+$/, '');
  const segments = cleaned.split(/[/\\]/);
  return segments[segments.length - 1] || cleaned;
}

/** 渲染最近路径小卡片 */
function renderPathHistoryCards() {
  pathHistoryCards.innerHTML = '';

  if (!savedPaths.length) {
    pathHistorySection.classList.add('hidden');
    return;
  }

  pathHistorySection.classList.remove('hidden');
  const current = folderInput.value.trim();

  for (const folderPath of savedPaths) {
    const card = document.createElement('div');
    card.className = 'path-history-card';
    card.title = folderPath;
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    if (current && pathsEqual(current, folderPath)) {
      card.classList.add('active');
    }

    const label = document.createElement('span');
    label.className = 'path-label';
    label.textContent = pathDisplayLabel(folderPath);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.title = '从历史中移除';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removePathFromHistory(folderPath);
    });

    card.appendChild(label);
    card.appendChild(removeBtn);
    card.addEventListener('click', () => selectHistoryPath(folderPath));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectHistoryPath(folderPath);
      }
    });
    pathHistoryCards.appendChild(card);
  }
}

/** 点击历史卡片：填入路径并立即分析 */
function selectHistoryPath(folderPath) {
  folderInput.value = folderPath;
  console.log('[app] 选择历史路径:', folderPath);
  renderPathHistoryCards();
  onAnalyze();
}

// --- end 服务端路径历史 ---

// --- 浏览器最近分析（localStorage，刷新自动恢复） ---

/** 将最近一次成功分析的路径写入 localStorage */
function saveLastAnalysisFolderPath(folderPath) {
  const normalized = (folderPath || '').trim();
  if (!normalized) {
    return;
  }

  try {
    localStorage.setItem(LAST_ANALYSIS_STORAGE_KEY, normalized);
    console.log('[app] 已保存最近分析路径到 localStorage', normalized);
  } catch (err) {
    console.warn('[app] 保存最近分析路径失败', err);
  }
}

/** 读取 localStorage 中的最近分析路径 */
function readLastAnalysisFolderPath() {
  try {
    const value = localStorage.getItem(LAST_ANALYSIS_STORAGE_KEY);
    const trimmed = value?.trim();
    return trimmed || null;
  } catch (err) {
    console.warn('[app] 读取最近分析路径失败', err);
    return null;
  }
}

/** 页面加载：填入最近路径并自动分析（localStorage 优先，否则服务端历史第一条） */
async function tryRestoreLastAnalysis() {
  const folderPath = readLastAnalysisFolderPath() ?? savedPaths[0] ?? null;
  if (!folderPath) {
    console.log('[app] 无最近分析路径，跳过自动分析');
    return;
  }

  folderInput.value = folderPath;
  renderPathHistoryCards();
  console.log('[app] 恢复最近分析并自动执行', folderPath);
  await onAnalyze();
}

// ponytail: 最近分析路径读写自检
(function selfCheckLastAnalysisStorage() {
  const key = LAST_ANALYSIS_STORAGE_KEY + '_selfcheck';
  try {
    localStorage.setItem(key, 'C:\\Temp\\SelfCheck');
    console.assert(
      localStorage.getItem(key) === 'C:\\Temp\\SelfCheck',
      '[selfcheck] localStorage 最近分析路径可写'
    );
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('[selfcheck] localStorage 不可用，刷新后将无法自动分析', err);
  }
})();

// --- end 浏览器最近分析 ---

// --- 调用树面板宽度拖动 ---

/** 设置调用树面板宽度（同步 body 右侧留白） */
function applyTreePanelWidth(widthPx) {
  const clamped = Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(widthPx)));
  document.documentElement.style.setProperty('--tree-width', `${clamped}px`);
  localStorage.setItem(TREE_WIDTH_STORAGE_KEY, String(clamped));
  return clamped;
}

/** 初始化左侧拖动手柄 */
function initTreePanelResize() {
  if (!treeResizeHandle) {
    return;
  }

  const saved = parseInt(localStorage.getItem(TREE_WIDTH_STORAGE_KEY) || '', 10);
  if (!Number.isNaN(saved)) {
    applyTreePanelWidth(saved);
    console.log('[app] 恢复调用树宽度', saved);
  }

  let dragging = false;

  treeResizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    document.body.classList.add('tree-resizing');
    console.log('[app] 开始拖动调用树宽度');
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) {
      return;
    }
    applyTreePanelWidth(window.innerWidth - e.clientX);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove('tree-resizing');
    console.log('[app] 结束拖动调用树宽度', getComputedStyle(document.documentElement).getPropertyValue('--tree-width'));
  });
}

// --- end 调用树面板宽度拖动 ---

// --- 左侧目录树面板宽度拖动 ---

/** 设置目录树面板宽度（同步 body 左侧留白） */
function applyFileTreePanelWidth(widthPx) {
  const clamped = Math.min(FILE_TREE_WIDTH_MAX, Math.max(FILE_TREE_WIDTH_MIN, Math.round(widthPx)));
  document.documentElement.style.setProperty('--file-tree-width', `${clamped}px`);
  localStorage.setItem(FILE_TREE_WIDTH_STORAGE_KEY, String(clamped));
  return clamped;
}

/** 初始化目录树面板拖动手柄 */
function initFileTreePanelResize() {
  if (!fileTreeResizeHandle) {
    return;
  }

  const saved = parseInt(localStorage.getItem(FILE_TREE_WIDTH_STORAGE_KEY) || '', 10);
  if (!Number.isNaN(saved)) {
    applyFileTreePanelWidth(saved);
    console.log('[app] 恢复目录树宽度', saved);
  } else {
    applyFileTreePanelWidth(FILE_TREE_WIDTH_DEFAULT);
  }

  let dragging = false;

  fileTreeResizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    document.body.classList.add('file-tree-resizing');
    console.log('[app] 开始拖动目录树宽度');
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) {
      return;
    }
    applyFileTreePanelWidth(e.clientX);
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.classList.remove('file-tree-resizing');
    console.log('[app] 结束拖动目录树宽度', getComputedStyle(document.documentElement).getPropertyValue('--file-tree-width'));
  });
}

// --- end 目录树面板宽度拖动 ---

// --- 左侧目录树面板折叠（桌面端） ---

/** 侧栏是否处于收起状态 */
function isFileTreePanelCollapsed() {
  return document.body.classList.contains('file-tree-panel-collapsed');
}

/** 同步折叠按钮文案与无障碍属性 */
function updateFileTreePanelToggleBtn() {
  if (!toggleFileTreePanelBtn) {
    return;
  }
  const collapsed = isFileTreePanelCollapsed();
  toggleFileTreePanelBtn.textContent = collapsed ? '»' : '«';
  const label = collapsed ? '展开项目文件侧栏' : '收起项目文件侧栏';
  toggleFileTreePanelBtn.title = label;
  toggleFileTreePanelBtn.setAttribute('aria-label', label);
  toggleFileTreePanelBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

/**
 * 设置左侧项目文件侧栏展开/收起
 * @param {boolean} collapsed
 * @param {boolean} [persist=true] 是否写入 localStorage
 */
function setFileTreePanelCollapsed(collapsed, persist = true) {
  if (isMobileLayout()) {
    document.body.classList.remove('file-tree-panel-collapsed');
    updateFileTreePanelToggleBtn();
    return;
  }

  document.body.classList.toggle('file-tree-panel-collapsed', collapsed);
  if (persist) {
    localStorage.setItem(FILE_TREE_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  }
  updateFileTreePanelToggleBtn();
  console.log('[app] 项目文件侧栏', collapsed ? '已收起' : '已展开');
}

/** 初始化桌面端侧栏折叠按钮与持久化状态 */
function initFileTreePanelCollapse() {
  if (!toggleFileTreePanelBtn) {
    return;
  }

  const savedCollapsed = localStorage.getItem(FILE_TREE_COLLAPSED_STORAGE_KEY) === '1';
  setFileTreePanelCollapsed(savedCollapsed, false);

  toggleFileTreePanelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setFileTreePanelCollapsed(!isFileTreePanelCollapsed());
  });

  window.addEventListener('resize', () => {
    if (isMobileLayout()) {
      document.body.classList.remove('file-tree-panel-collapsed');
    } else {
      const saved = localStorage.getItem(FILE_TREE_COLLAPSED_STORAGE_KEY) === '1';
      document.body.classList.toggle('file-tree-panel-collapsed', saved);
    }
    updateFileTreePanelToggleBtn();
  });

  console.log('[app] 项目文件侧栏折叠已初始化');
}

// --- end 左侧目录树面板折叠 ---

// --- 移动端抽屉（项目文件左、调用树右） ---

/** @type {'tree'|'fileTree'|null} 当前打开的抽屉 */
let activeMobileDrawer = null;

/** 是否处于窄屏布局（侧栏为右侧滑出抽屉） */
function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_LAYOUT_MAX_WIDTH}px)`).matches;
}

/** 初始化移动端抽屉：遮罩、开关按钮、Esc、窗口缩放 */
function initMobileDrawers() {
  openFileTreeDrawerBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('[app] 打开项目文件抽屉');
    openMobileDrawer('fileTree');
  });

  openTreeDrawerBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('[app] 打开调用树抽屉');
    openMobileDrawer('tree');
  });

  closeFileTreeDrawerBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeMobileDrawers();
  });

  closeTreeDrawerBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeMobileDrawers();
  });

  mobileDrawerBackdrop?.addEventListener('click', () => {
    console.log('[app] 点击遮罩关闭抽屉');
    closeMobileDrawers();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !activeMobileDrawer) {
      return;
    }
    if (helpModal && !helpModal.classList.contains('hidden')) {
      return;
    }
    if (refDetailModal && !refDetailModal.classList.contains('hidden')) {
      return;
    }
    e.preventDefault();
    closeMobileDrawers();
  });

  window.addEventListener('resize', () => {
    if (!isMobileLayout()) {
      closeMobileDrawers();
    }
  });

  console.log('[app] 移动端抽屉已初始化');
}

/** 打开指定侧栏抽屉（窄屏：fileTree 从左、tree 从右滑入） */
function openMobileDrawer(which) {
  if (!isMobileLayout()) {
    return;
  }

  activeMobileDrawer = which;
  treePanel?.classList.toggle('mobile-drawer-open', which === 'tree');
  fileTreePanel?.classList.toggle('mobile-drawer-open', which === 'fileTree');
  mobileDrawerBackdrop?.classList.add('visible');
  mobileDrawerBackdrop?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('mobile-drawer-open');
  console.log('[app] 抽屉已打开:', which);
}

/** 关闭全部移动端抽屉 */
function closeMobileDrawers() {
  if (!activeMobileDrawer && !treePanel?.classList.contains('mobile-drawer-open')
      && !fileTreePanel?.classList.contains('mobile-drawer-open')) {
    return;
  }

  activeMobileDrawer = null;
  treePanel?.classList.remove('mobile-drawer-open');
  fileTreePanel?.classList.remove('mobile-drawer-open');
  mobileDrawerBackdrop?.classList.remove('visible');
  mobileDrawerBackdrop?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('mobile-drawer-open');
  console.log('[app] 抽屉已关闭');
}

// --- end 移动端右侧抽屉 ---

/** 归一化相对文件路径为 / 分隔 */
function normalizeFilePath(filePath) {
  return (filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * 从类型列表构建目录树数据
 * @param {Object[]} classes
 * @returns {{ dirs: Map<string, Object>, rootFiles: Object[] }}
 */
function buildFileTreeData(classes) {
  /** @type {Map<string, { name: string, path: string, dirs: Map<string, Object>, files: Object[] }>} */
  const root = { name: '', path: '', dirs: new Map(), files: [] };

  const sorted = [...classes].sort(
    (a, b) => normalizeFilePath(a.filePath).localeCompare(normalizeFilePath(b.filePath)) ||
      a.line - b.line ||
      a.name.localeCompare(b.name)
  );

  /** @type {Map<string, Object[]>} */
  const fileClassMap = new Map();

  for (const cls of sorted) {
    const filePath = normalizeFilePath(cls.filePath);
    if (!fileClassMap.has(filePath)) {
      fileClassMap.set(filePath, []);
    }
    fileClassMap.get(filePath).push(cls);
  }

  for (const [filePath, fileClasses] of fileClassMap) {
    const segments = filePath.split('/').filter(Boolean);
    const fileName = segments.pop() || filePath;
    let node = root;

    let dirPath = '';
    for (const segment of segments) {
      dirPath = dirPath ? `${dirPath}/${segment}` : segment;
      if (!node.dirs.has(segment)) {
        node.dirs.set(segment, { name: segment, path: dirPath, dirs: new Map(), files: [] });
      }
      node = node.dirs.get(segment);
    }

    node.files.push({
      path: filePath,
      name: fileName,
      classes: fileClasses
    });
  }

  return root;
}

/** 分析完成后渲染左侧目录树 */
function renderFileTree(data) {
  if (!fileTreeContainer) {
    return;
  }

  fileTreeExpandedDirs = new Set();
  fileTreeExpandedFiles = new Set();
  highlightedFileTreeClassId = null;

  if (!data?.classes?.length) {
    fileTreeContainer.innerHTML = '<p class="file-tree-placeholder">未找到 .cs 文件</p>';
    console.log('[app] 目录树：无类型数据');
    return;
  }

  const root = buildFileTreeData(data.classes);
  fileTreeContainer.innerHTML = '';
  const treeRoot = document.createElement('div');
  treeRoot.className = 'file-tree-root';
  renderFileTreeDirNode(root, treeRoot);
  fileTreeContainer.appendChild(treeRoot);

  // ponytail: 初始态与「全部折叠」一致（单根保留展开）
  setFileTreeExpanded(false);

  console.log('[app] 目录树已渲染', { files: data.filesScanned, types: data.classes.length });
}

/** 渲染目录节点及其子内容 */
function renderFileTreeDirNode(dirNode, container) {
  const dirEntries = [...dirNode.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const fileEntries = [...dirNode.files].sort((a, b) => a.name.localeCompare(b.name));

  for (const subDir of dirEntries) {
    container.appendChild(createFileTreeDirElement(subDir));
  }

  for (const fileNode of fileEntries) {
    container.appendChild(createFileTreeFileElement(fileNode));
  }
}

/** 创建文件夹节点 DOM */
function createFileTreeDirElement(dirNode) {
  const wrap = document.createElement('div');
  wrap.className = 'file-tree-node file-tree-dir';
  wrap.dataset.dirPath = dirNode.path;

  const expanded = fileTreeExpandedDirs.has(dirNode.path);
  const row = document.createElement('div');
  row.className = 'file-tree-row';
  row.innerHTML = `
    <span class="toggle">${expanded ? '▼' : '▶'}</span>
    <span class="file-tree-icon">📁</span>
    <span class="file-tree-label">${escapeHtml(dirNode.name)}</span>
  `;

  const childrenEl = document.createElement('div');
  childrenEl.className = 'file-tree-children';
  if (!expanded) {
    childrenEl.classList.add('collapsed');
  }
  renderFileTreeDirNode(dirNode, childrenEl);

  const toggleExpand = () => {
    const nowExpanded = childrenEl.classList.toggle('collapsed') === false;
    if (nowExpanded) {
      fileTreeExpandedDirs.add(dirNode.path);
      row.querySelector('.toggle').textContent = '▼';
    } else {
      fileTreeExpandedDirs.delete(dirNode.path);
      row.querySelector('.toggle').textContent = '▶';
    }
    console.log('[app] 目录树文件夹', nowExpanded ? '展开' : '折叠', dirNode.path);
  };

  row.querySelector('.toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpand();
  });
  row.addEventListener('click', toggleExpand);

  wrap.appendChild(row);
  wrap.appendChild(childrenEl);
  return wrap;
}

/** 创建 .cs 文件节点 DOM（单类型直接可选，多类型展开子节点） */
function createFileTreeFileElement(fileNode) {
  const multiType = fileNode.classes.length > 1;
  const wrap = document.createElement('div');
  wrap.className = 'file-tree-node file-tree-file';
  wrap.dataset.filePath = fileNode.path;

  const expanded = fileTreeExpandedFiles.has(fileNode.path);
  const row = document.createElement('div');
  row.className = 'file-tree-row';
  row.dataset.filePath = fileNode.path;

  const toggleSpan = document.createElement('span');
  toggleSpan.className = multiType ? 'toggle' : 'toggle empty';
  toggleSpan.textContent = multiType ? (expanded ? '▼' : '▶') : '';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'file-tree-icon';
  iconSpan.textContent = '📄';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'file-tree-label';
  labelSpan.textContent = fileNode.name;
  labelSpan.title = fileNode.path;

  row.appendChild(toggleSpan);
  row.appendChild(iconSpan);
  row.appendChild(labelSpan);

  if (multiType) {
    const badge = document.createElement('span');
    badge.className = 'file-tree-badge';
    badge.textContent = `${fileNode.classes.length}`;
    row.appendChild(badge);
  }

  const childrenEl = document.createElement('div');
  childrenEl.className = 'file-tree-children';
  if (!multiType || !expanded) {
    childrenEl.classList.add('collapsed');
  }

  for (const cls of fileNode.classes) {
    childrenEl.appendChild(createFileTreeTypeElement(cls));
  }

  const selectFilePrimary = () => {
    console.log('[app] 目录树选中文件', fileNode.path);
    if (fileNode.classes.length === 1) {
      selectClass(fileNode.classes[0].id);
      return;
    }

    const nowExpanded = childrenEl.classList.toggle('collapsed') === false;
    if (nowExpanded) {
      fileTreeExpandedFiles.add(fileNode.path);
      toggleSpan.textContent = '▼';
    } else {
      fileTreeExpandedFiles.delete(fileNode.path);
      toggleSpan.textContent = '▶';
    }
  };

  /** 双击文件行：打开该文件完整源码（多类型时高亮首个类型定义） */
  const openFileSource = () => {
    const cls = [...fileNode.classes].sort((a, b) => a.line - b.line)[0];
    if (!cls) {
      return;
    }
    console.log('[app] 双击目录树文件打开源码:', fileNode.path, cls.id);
    showClassSource(cls);
  };

  row.title = multiType
    ? '单击展开/折叠类型列表；双击查看完整源码'
    : '单击选中并查看调用树；双击查看完整源码';

  const onFileRowClick = (e) => {
    if (e.detail > 1) {
      return;
    }
    selectFilePrimary();
  };

  if (multiType) {
    toggleSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      onFileRowClick(e);
    });
    row.addEventListener('click', onFileRowClick);
  } else {
    row.addEventListener('click', onFileRowClick);
  }

  row.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    openFileSource();
  });

  wrap.appendChild(row);
  if (multiType) {
    wrap.appendChild(childrenEl);
  }
  return wrap;
}

/** 创建文件下类型子节点 DOM */
function createFileTreeTypeElement(cls) {
  const wrap = document.createElement('div');
  wrap.className = 'file-tree-node file-tree-type';
  wrap.dataset.classId = cls.id;
  wrap.dataset.filePath = normalizeFilePath(cls.filePath);

  const row = document.createElement('div');
  row.className = 'file-tree-row';
  row.dataset.classId = cls.id;

  const toggleSpan = document.createElement('span');
  toggleSpan.className = 'toggle empty';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'icon-wrap';
  iconWrap.innerHTML = typeIconSvg(cls.kind);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'file-tree-label';
  labelSpan.textContent = cls.name;
  labelSpan.title = cls.id;

  row.appendChild(toggleSpan);
  row.appendChild(iconWrap);
  row.appendChild(labelSpan);

  if (cls.inCycle) {
    const badge = document.createElement('span');
    badge.className = 'cycle-badge';
    badge.title = '参与循环依赖';
    badge.textContent = '↔';
    row.appendChild(badge);
  }

  row.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[app] 目录树选中类型', cls.id);
    selectClass(cls.id);
  });

  wrap.appendChild(row);
  return wrap;
}

/** 清空目录树并重置高亮 */
function clearFileTreePanel() {
  highlightedFileTreeClassId = null;
  fileTreeExpandedDirs = new Set();
  fileTreeExpandedFiles = new Set();
  if (fileTreeContainer) {
    fileTreeContainer.innerHTML = '<p class="file-tree-placeholder">输入文件夹路径后点击「分析」</p>';
  }
}

/** 展开目录树到指定文件路径的各级父文件夹 */
function expandFileTreePathToFile(filePath) {
  const normalized = normalizeFilePath(filePath);
  const segments = normalized.split('/').filter(Boolean);
  segments.pop();

  let dirPath = '';
  for (const segment of segments) {
    dirPath = dirPath ? `${dirPath}/${segment}` : segment;
    fileTreeExpandedDirs.add(dirPath);
  }

  const fileClasses = currentData?.classes.filter(
    (c) => normalizeFilePath(c.filePath) === normalized
  ) || [];

  if (fileClasses.length > 1) {
    fileTreeExpandedFiles.add(normalized);
  }

  applyFileTreeExpandState();
}

/** 根据 Set 状态同步目录树展开 UI */
function applyFileTreeExpandState() {
  if (!fileTreeContainer) {
    return;
  }

  fileTreeContainer.querySelectorAll('.file-tree-dir').forEach((dirEl) => {
    const dirPath = dirEl.dataset.dirPath || '';
    const expanded = fileTreeExpandedDirs.has(dirPath);
    const children = dirEl.querySelector(':scope > .file-tree-children');
    const toggle = dirEl.querySelector(':scope > .file-tree-row > .toggle');
    if (children) {
      children.classList.toggle('collapsed', !expanded);
    }
    if (toggle) {
      toggle.textContent = expanded ? '▼' : '▶';
    }
  });

  fileTreeContainer.querySelectorAll('.file-tree-file').forEach((fileEl) => {
    const filePath = fileEl.dataset.filePath || '';
    const expanded = fileTreeExpandedFiles.has(filePath);
    const children = fileEl.querySelector(':scope > .file-tree-children');
    const toggle = fileEl.querySelector(':scope > .file-tree-row > .toggle:not(.empty)');
    if (children) {
      children.classList.toggle('collapsed', !expanded);
    }
    if (toggle) {
      toggle.textContent = expanded ? '▼' : '▶';
    }
  });
}

/** 同步目录树高亮到当前选中类型 */
function syncFileTreeSelection(classId) {
  if (!fileTreeContainer || !currentData) {
    return;
  }

  highlightedFileTreeClassId = classId;
  const cls = currentData.classes.find((c) => c.id === classId);
  if (!cls) {
    return;
  }

  expandFileTreePathToFile(cls.filePath);
  const normalizedPath = normalizeFilePath(cls.filePath);
  const typesInFile = currentData.classes.filter(
    (c) => normalizeFilePath(c.filePath) === normalizedPath
  );

  fileTreeContainer.querySelectorAll('.file-tree-row').forEach((row) => {
    row.classList.remove('file-tree-highlight');
  });

  if (typesInFile.length === 1) {
    const fileRow = fileTreeContainer.querySelector(
      `.file-tree-file[data-file-path="${cssEscape(normalizedPath)}"] > .file-tree-row`
    );
    if (fileRow) {
      fileRow.classList.add('file-tree-highlight');
      fileRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  } else {
    const typeRow = fileTreeContainer.querySelector(
      `.file-tree-type[data-class-id="${cssEscape(classId)}"] > .file-tree-row`
    );
    if (typeRow) {
      typeRow.classList.add('file-tree-highlight');
      typeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  console.log('[app] 目录树高亮', { classId, filePath: normalizedPath });
}

/** 目录树顶层根节点数量（直接挂在 .file-tree-root 下的条目） */
function getFileTreeRootCount() {
  const root = fileTreeContainer?.querySelector('.file-tree-root');
  if (!root) {
    return 0;
  }
  return root.querySelectorAll(':scope > .file-tree-node').length;
}

/** 单根时保留展开的目录树根节点路径/文件路径 */
function keepLoneFileTreeRootExpanded() {
  const loneRoot = fileTreeContainer?.querySelector('.file-tree-root > .file-tree-node');
  if (!loneRoot) {
    return;
  }

  if (loneRoot.classList.contains('file-tree-dir') && loneRoot.dataset.dirPath) {
    fileTreeExpandedDirs.add(loneRoot.dataset.dirPath);
    console.log('[app] 目录树单根保留展开目录', loneRoot.dataset.dirPath);
    return;
  }

  if (
    loneRoot.classList.contains('file-tree-file') &&
    loneRoot.dataset.filePath &&
    loneRoot.querySelector('.file-tree-type')
  ) {
    fileTreeExpandedFiles.add(loneRoot.dataset.filePath);
    console.log('[app] 目录树单根保留展开多类型文件', loneRoot.dataset.filePath);
  }
}

/** 全部展开/折叠目录树 */
function setFileTreeExpanded(expanded) {
  if (!fileTreeContainer) {
    return;
  }

  if (expanded) {
    fileTreeContainer.querySelectorAll('.file-tree-dir').forEach((el) => {
      if (el.dataset.dirPath) {
        fileTreeExpandedDirs.add(el.dataset.dirPath);
      }
    });
    fileTreeContainer.querySelectorAll('.file-tree-file').forEach((el) => {
      if (el.dataset.filePath && el.querySelector('.file-tree-type')) {
        fileTreeExpandedFiles.add(el.dataset.filePath);
      }
    });
  } else {
    fileTreeExpandedDirs = new Set();
    fileTreeExpandedFiles = new Set();
    if (getFileTreeRootCount() === 1) {
      keepLoneFileTreeRootExpanded();
    }
  }

  applyFileTreeExpandState();
  const rootCount = getFileTreeRootCount();
  console.log(
    '[app] 目录树',
    expanded ? '全部展开' : rootCount === 1 ? '全部折叠(保留单根)' : '全部折叠(含多根)',
    `(根 ${rootCount})`
  );
}

/** CSS 属性选择器转义（仅处理常见路径字符） */
function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ponytail: 目录树路径构建自检
(function selfCheckFileTree() {
  const sample = buildFileTreeData([
    { id: 'A', name: 'Foo', filePath: 'Src/A.cs', line: 1, kind: 'class' },
    { id: 'B', name: 'Bar', filePath: 'Src/Sub/B.cs', line: 3, kind: 'class' },
    { id: 'C', name: 'Baz', filePath: 'Src/Sub/B.cs', line: 20, kind: 'class' }
  ]);
  console.assert(sample.dirs.has('Src'), '[selfcheck] 目录树含 Src');
  const sub = sample.dirs.get('Src');
  console.assert(sub?.dirs.has('Sub') && sub.files.length === 1, '[selfcheck] 嵌套目录与根下文件');
  console.assert(sub.dirs.get('Sub').files[0].classes.length === 2, '[selfcheck] 同文件多类型');
})();

function typeIconSvg(kind) {
  const cfg = {
    class: { stroke: '#79c0ff', fill: '#79c0ff22', shape: 'rect' },
    interface: { stroke: '#d2a8ff', fill: '#d2a8ff22', shape: 'circle' },
    struct: { stroke: '#7ee787', fill: '#7ee78722', shape: 'hex' },
    record: { stroke: '#ffa657', fill: '#ffa65722', shape: 'record' },
    enum: { stroke: '#ff7b72', fill: '#ff7b7222', shape: 'enum' }
  };
  const c = cfg[kind] || cfg.class;

  if (c.shape === 'rect') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/></svg>`;
  }
  if (c.shape === 'circle') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="${c.stroke}" font-size="10" font-family="sans-serif">I</text></svg>`;
  }
  if (c.shape === 'hex') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,2 20,7 20,17 12,22 4,17 4,7" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/></svg>`;
  }
  if (c.shape === 'record') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="${c.stroke}" font-size="9" font-family="sans-serif">R</text></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="${c.stroke}" font-size="9" font-family="sans-serif">E</text></svg>`;
}

function refIconSvg(kind) {
  const icons = {
    calls: `<svg viewBox="0 0 16 16"><path d="M3 8h8M9 5l3 3-3 3" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    extends: `<svg viewBox="0 0 16 16"><path d="M8 3v6M5 6l3 3 3-3" fill="none" stroke="#ffa657" stroke-width="1.5" stroke-linecap="round"/><path d="M4 13h8" stroke="#ffa657" stroke-width="1.5"/></svg>`,
    implements: `<svg viewBox="0 0 16 16"><path d="M3 8h10" stroke="#d2a8ff" stroke-width="1.5" stroke-dasharray="3 2"/></svg>`,
    uses: `<svg viewBox="0 0 16 16"><circle cx="4" cy="8" r="1.5" fill="#8b9cb3"/><circle cx="8" cy="8" r="1.5" fill="#8b9cb3"/><circle cx="12" cy="8" r="1.5" fill="#8b9cb3"/></svg>`
  };
  return icons[kind] || icons.uses;
}

/** 成员可见性配色 */
const ACCESS_COLORS = {
  public: '#7ee787',
  protected: '#ffa657',
  internal: '#8b9cb3',
  protectedInternal: '#d2a8ff',
  privateProtected: '#ff7b72',
  private: '#6e7681'
};

/** 成员种类字母（与 memberIconSvg 一致） */
const MEMBER_KIND_LETTERS = {
  field: 'F',
  property: 'P',
  method: 'M',
  event: 'E',
  constructor: 'C'
};

/** 成员种类标签（tooltip / 分组标题用） */
const MEMBER_KIND_LABELS = {
  field: '字段',
  property: '属性',
  method: '方法',
  event: '事件',
  constructor: '构造'
};

/** IO 端口种类图标配色（与成员大纲种类色一致） */
const MEMBER_KIND_COLORS = {
  field: '#79c0ff',
  property: '#d2a8ff',
  method: '#ffa657',
  event: '#ff7b72',
  constructor: '#7ee787'
};

/**
 * 成员大纲图标：种类字形 + 可见性边框色
 * @param {'field'|'property'|'method'|'event'|'constructor'} memberKind
 * @param {'public'|'protected'|'internal'|'protectedInternal'|'privateProtected'|'private'} access
 */
function memberIconSvg(memberKind, access) {
  const stroke = ACCESS_COLORS[access] || ACCESS_COLORS.private;
  const letter = MEMBER_KIND_LETTERS[memberKind] || '?';
  const lock = access === 'private'
    ? `<path d="M8 14v-2M6 12h4" stroke="${stroke}" stroke-width="1" opacity="0.7"/>`
    : '';

  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="${stroke}22" stroke="${stroke}" stroke-width="1.5"/>${lock}<text x="12" y="15" text-anchor="middle" fill="${stroke}" font-size="10" font-family="sans-serif" font-weight="600">${letter}</text></svg>`;
}

/** 输入/输出端口种类图标（M/P/F/E/C，无可见性维度） */
function ioPortKindIconSvg(memberKind) {
  const stroke = MEMBER_KIND_COLORS[memberKind] || ACCESS_COLORS.public;
  const letter = MEMBER_KIND_LETTERS[memberKind] || '?';

  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="${stroke}22" stroke="${stroke}" stroke-width="1.5"/><text x="12" y="15" text-anchor="middle" fill="${stroke}" font-size="10" font-family="sans-serif" font-weight="600">${letter}</text></svg>`;
}

/** 可见性中文短标签 */
function accessLabel(access) {
  const labels = {
    public: 'public',
    protected: 'protected',
    internal: 'internal',
    protectedInternal: 'protected internal',
    privateProtected: 'private protected',
    private: 'private'
  };
  return labels[access] || access;
}


/** 大纲请求序号，用于忽略过期响应 */
let outlineFetchToken = 0;

/** @type {{ cls: Object, members: Object[] } | null} 当前右栏大纲对应的类型与成员（供源码导航） */
let currentOutlineContext = null;

/** 初始化帮助弹窗开关 */
function initHelpModal() {
  if (!helpModal) {
    return;
  }

  openHelpBtn?.addEventListener('click', () => {
    console.log('[app] 打开帮助弹窗');
    openHelpModal();
  });
  helpModalClose?.addEventListener('click', closeHelpModal);
  helpModalBackdrop?.addEventListener('click', closeHelpModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !helpModal.classList.contains('hidden')) {
      closeHelpModal();
    }
  });
}

function openHelpModal() {
  helpModal?.classList.remove('hidden');
}

function closeHelpModal() {
  helpModal?.classList.add('hidden');
}

function renderLegendIcons() {
  document.querySelectorAll('.icon-wrap[data-kind]').forEach((el) => {
    const kind = el.getAttribute('data-kind');
    if (kind) {
      el.innerHTML = typeIconSvg(kind);
    }
  });
  document.querySelectorAll('.member-icon-legend[data-member][data-access]').forEach((el) => {
    const member = el.getAttribute('data-member');
    const access = el.getAttribute('data-access');
    if (member && access) {
      el.innerHTML = memberIconSvg(member, access);
    }
  });
  document.querySelectorAll('.ref-icon[data-ref]').forEach((el) => {
    const ref = el.getAttribute('data-ref');
    if (ref) {
      el.innerHTML = refIconSvg(ref);
    }
  });
}

async function onAnalyze() {
  const folderPath = folderInput.value.trim();
  if (!folderPath) {
    showError('请输入文件夹路径');
    return;
  }

  hideError();
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = '分析中…';
  document.body.classList.add('loading');
  statsBar.classList.add('hidden');
  layersContainer.innerHTML = '<p class="placeholder">正在分析，请稍候…</p>';
  setLayersSearchEnabled(false);
  resetLayersNavHistory();
  clearTreePanel();
  clearFileTreePanel();
  console.log('[app] 开始分析:', folderPath);

  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || err.detail || `HTTP ${resp.status}`);
    }

    currentData = await resp.json();
    console.log('[app] 分析完成', currentData);
    saveLastAnalysisFolderPath(folderPath);
    await loadPathHistory();
    renderPathHistoryCards();
    renderResults(currentData);
  } catch (err) {
    console.error('[app] 分析失败', err);
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = '分析';
    document.body.classList.remove('loading');
  }
}

function renderResults(data) {
  statsBar.classList.remove('hidden');
  document.getElementById('statFiles').innerHTML = `文件: <strong>${data.filesScanned}</strong>`;
  document.getElementById('statClasses').innerHTML = `类: <strong>${data.classes.length}</strong>`;
  document.getElementById('statRefs').innerHTML = `引用: <strong>${data.references.length}</strong>`;
  document.getElementById('statCycles').innerHTML = `环: <strong>${data.cycles.length}</strong>`;

  const classMap = new Map(data.classes.map((c) => [c.id, c]));
  const outRefs = new Map();
  for (const ref of data.references) {
    if (!outRefs.has(ref.fromId)) {
      outRefs.set(ref.fromId, []);
    }
    outRefs.get(ref.fromId).push(ref);
  }

  layersContainer.innerHTML = '';

  if (!data.layers.length) {
    layersContainer.innerHTML = '<p class="placeholder">未找到类型定义</p>';
    setLayersSearchEnabled(false);
    clearLayersSearch();
    return;
  }

  for (const layer of data.layers) {
    const block = document.createElement('div');
    block.className = 'layer-block';
    block.dataset.layerLevel = String(layer.level);
    block.dataset.layerTotal = String(layer.classIds.length);

    const title = document.createElement('div');
    title.className = 'layer-title';
    title.textContent = `第 ${layer.level} 层（${layer.classIds.length} 个类型）`;
    block.appendChild(title);

    const cards = document.createElement('div');
    cards.className = 'layer-cards';

    for (const classId of layer.classIds) {
      const cls = classMap.get(classId);
      if (!cls) {
        continue;
      }
      cards.appendChild(createClassCard(cls, outRefs.get(classId) || [], classMap));
    }

    block.appendChild(cards);
    layersContainer.appendChild(block);
  }

  setLayersSearchEnabled(true);
  applyLayersSearchFilter();
  renderFileTree(data);
  clearTreePanel();
  if (typeof markGraphViewDirty === 'function') {
    markGraphViewDirty();
  }
}

// --- 调用层级搜索 ---

/** 绑定搜索框事件 */
function initLayersSearch() {
  layersSearchInput.addEventListener('input', () => {
    console.log('[app] 调用层级搜索:', layersSearchInput.value);
    applyLayersSearchFilter();
  });

  layersSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      clearLayersSearch();
    }
  });

  layersSearchClear.addEventListener('click', () => {
    clearLayersSearch();
    layersSearchInput.focus();
  });

  initLayersBlankDeselect();
}

/** 点击分层视图空白区域取消卡片选中 */
function initLayersBlankDeselect() {
  layersContainer.addEventListener('click', (e) => {
    if (e.target.closest('.class-card')) {
      return;
    }
    if (!selectedClassId) {
      return;
    }
    console.log('[app] 点击层级视图空白，取消选中');
    clearTreePanel();
  });
}

/** 分析完成后启用/禁用搜索框 */
function setLayersSearchEnabled(enabled) {
  layersSearchInput.disabled = !enabled;
  if (!enabled) {
    layersSearchStatus.classList.add('hidden');
    layersSearchClear.classList.add('hidden');
  }
}

/** 清除搜索并恢复全部卡片 */
function clearLayersSearch() {
  const hadValue = layersSearchInput.value.length > 0;
  layersSearchInput.value = '';
  if (hadValue) {
    console.log('[app] 清除调用层级搜索');
  }
  applyLayersSearchFilter();
}

/**
 * 判断类型是否匹配搜索词（空格分隔的多词为 AND）
 * @param {Object} cls
 * @param {string} query
 */
function classMatchesLayersSearch(cls, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const haystack = [
    cls.name,
    cls.namespace,
    cls.id,
    cls.filePath,
    `${cls.filePath}:${cls.line}`
  ].join('\n').toLowerCase();

  const terms = normalized.split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
}

/** 根据当前搜索词过滤层级卡片并更新统计 */
function applyLayersSearchFilter() {
  const query = layersSearchInput.value.trim();
  const hasQuery = query.length > 0;

  layersSearchClear.classList.toggle('hidden', !hasQuery);

  if (!currentData || !currentData.layers.length) {
    layersSearchStatus.classList.add('hidden');
    return;
  }

  let visibleTotal = 0;
  let totalCards = 0;

  document.querySelectorAll('.layer-block').forEach((block) => {
    const layerTotal = Number(block.dataset.layerTotal) || 0;
    let visibleInLayer = 0;

    block.querySelectorAll('.class-card').forEach((card) => {
      totalCards += 1;
      const classId = card.dataset.classId;
      const cls = currentData.classes.find((c) => c.id === classId);
      const matches = cls ? classMatchesLayersSearch(cls, query) : !hasQuery;

      card.classList.toggle('search-hidden', !matches);
      card.classList.toggle('search-match', matches && hasQuery);

      if (matches) {
        visibleInLayer += 1;
        visibleTotal += 1;
      }
    });

    const title = block.querySelector('.layer-title');
    const level = block.dataset.layerLevel ?? '?';
    if (title) {
      title.textContent = hasQuery
        ? `第 ${level} 层（${visibleInLayer}/${layerTotal} 个类型）`
        : `第 ${level} 层（${layerTotal} 个类型）`;
    }

    block.classList.toggle('search-empty', hasQuery && visibleInLayer === 0);
  });

  layersSearchStatus.classList.toggle('hidden', !hasQuery);
  layersSearchStatus.classList.toggle('no-match', hasQuery && visibleTotal === 0);

  if (hasQuery) {
    if (visibleTotal === 0) {
      layersSearchStatus.textContent = `无匹配类型（共 ${totalCards} 个）`;
    } else {
      layersSearchStatus.textContent = `显示 ${visibleTotal} / ${totalCards} 个类型`;
    }
  }

  console.log('[app] 调用层级搜索过滤完成', { query, visibleTotal, totalCards });
}

/**
 * 类名是否与 .cs 文件名（不含扩展名）一致
 * @param {Object} cls
 */
function classNameMatchesFileName(cls) {
  const fileName = (cls.filePath.split(/[/\\]/).pop() || '').replace(/\.cs$/i, '');
  return fileName.localeCompare(cls.name, undefined, { sensitivity: 'accent' }) === 0;
}

// ponytail: 加载时断言搜索/文件名匹配逻辑，失败会在控制台报错
(function selfCheckLayersSearch() {
  const sample = {
    name: 'OrderService',
    namespace: 'MyApp.Services',
    id: 'MyApp.Services.OrderService',
    filePath: 'Services/OrderService.cs',
    line: 12
  };
  console.assert(classMatchesLayersSearch(sample, 'order'), '[selfcheck] 类型名匹配');
  console.assert(classMatchesLayersSearch(sample, 'myapp order'), '[selfcheck] 多词 AND');
  console.assert(classMatchesLayersSearch(sample, 'orderservice.cs'), '[selfcheck] 文件路径匹配');
  console.assert(!classMatchesLayersSearch(sample, 'nomatch'), '[selfcheck] 无匹配');
  console.assert(classNameMatchesFileName(sample), '[selfcheck] 类名与文件名一致');
  console.assert(
    !classNameMatchesFileName({ ...sample, name: 'OtherType' }),
    '[selfcheck] 类名与文件名不一致'
  );
  const directRefs = getDirectOutgoingClassIds('A', [
    { fromId: 'A', toId: 'B', kind: 'calls' },
    { fromId: 'A', toId: 'B', kind: 'uses' },
    { fromId: 'A', toId: 'C', kind: 'uses' },
    { fromId: 'X', toId: 'A', kind: 'calls' }
  ]);
  console.assert(directRefs.size === 2 && directRefs.has('B') && directRefs.has('C'), '[selfcheck] 直接引用去重');
})();

function clearTreePanel() {
  selectedClassId = null;
  highlightedTreeClassId = null;
  highlightedFileTreeClassId = null;
  currentOutlineContext = null;
  outlineFetchToken += 1;
  treeTitle.textContent = '类概要';
  treeContainer.innerHTML = '<p class="tree-placeholder">点击类卡片或目录树中的类型查看类概要</p>';
  document.querySelectorAll('.class-card.selected, .class-card.direct-ref-highlight, .class-card.direct-ref-incoming-highlight').forEach((el) => {
    el.classList.remove('selected', 'direct-ref-highlight', 'direct-ref-incoming-highlight');
  });
  syncReferrerTreeHighlight(new Set());
  if (typeof syncGraphEdgeHighlight === 'function') {
    syncGraphEdgeHighlight(null);
  }
  fileTreeContainer?.querySelectorAll('.file-tree-row.file-tree-highlight').forEach((el) => {
    el.classList.remove('file-tree-highlight');
  });
  closeMobileDrawers();
}

// --- 调用层级导航历史（后退/前进） ---

/** 绑定后退/前进按钮与快捷键 */
function initLayersNav() {
  document.querySelectorAll('[data-layers-nav="back"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateLayersBack();
    });
  });

  document.querySelectorAll('[data-layers-nav="forward"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateLayersForward();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (!e.altKey || isEditableTarget(e.target)) {
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateLayersBack();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateLayersForward();
    }
  });

  updateLayersNavButtons();
}

/** 输入框内不拦截 Alt+方向键 */
function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/** 新分析开始时清空导航栈 */
function resetLayersNavHistory() {
  layersNavHistory = [];
  layersNavIndex = -1;
  updateLayersNavButtons();
  console.log('[app] 调用层级导航历史已重置');
}

/** 归一化导航视图（缺省为仅类概要） */
function normalizeLayersNavView(view) {
  return view ?? { type: 'summary' };
}

/** 两条导航视图是否等价 */
function layersNavViewsEqual(a, b) {
  const va = normalizeLayersNavView(a);
  const vb = normalizeLayersNavView(b);
  if (va.type !== vb.type) {
    return false;
  }
  if (va.type === 'summary') {
    return true;
  }
  return (
    va.classId === vb.classId &&
    (va.focusLine ?? null) === (vb.focusLine ?? null) &&
    (va.title ?? null) === (vb.title ?? null)
  );
}

/** 两条导航历史是否等价（类 + 视图） */
function layersNavEntriesEqual(a, b) {
  if (!a || !b) {
    return false;
  }
  return a.classId === b.classId && layersNavViewsEqual(a.view, b.view);
}

/** 用户主动导航时入栈 */
function pushLayersNavEntry(entry) {
  if (layersNavApplying) {
    return;
  }

  const normalized = {
    classId: entry.classId,
    view: normalizeLayersNavView(entry.view)
  };

  const current = layersNavHistory[layersNavIndex];
  if (current && layersNavEntriesEqual(current, normalized)) {
    return;
  }

  layersNavHistory = layersNavHistory.slice(0, layersNavIndex + 1);
  layersNavHistory.push(normalized);
  layersNavIndex = layersNavHistory.length - 1;
  console.log('[app] 调用层级导航入栈', { index: layersNavIndex, entry: normalized, total: layersNavHistory.length });
  updateLayersNavButtons();
}

/** 恢复一条导航历史（类概要 + 源码视图） */
function applyLayersNavEntry(entry) {
  applyLayersView(entry.classId, { recordNav: false });
  restoreLayersNavView(entry.view);
}

/** 按导航视图恢复或关闭源码面板 */
function restoreLayersNavView(view) {
  const navView = normalizeLayersNavView(view);
  if (navView.type === 'summary') {
    closeRefDetailModal();
    console.log('[app] 导航恢复：仅类概要');
    return;
  }

  const cls = findClassById(navView.classId);
  if (!cls) {
    console.warn('[app] 导航恢复源码：未找到类型', navView.classId);
    closeRefDetailModal();
    return;
  }

  console.log('[app] 导航恢复：类概要 + 源码', navView.classId, navView.focusLine ?? '(完整类型)');
  showClassSource(cls, {
    focusLine: navView.focusLine ?? undefined,
    title: navView.title ?? undefined,
    recordNav: false
  });
}

/** 打开源码前确保右侧类概要与类型一致 */
function ensureLayersSummaryForClass(cls) {
  if (selectedClassId !== cls.id) {
    applyLayersView(cls.id, { recordNav: false });
  }
}

/** 用户打开源码视图时入栈（类概要已在上方同步） */
function recordClassSourceNav(cls, options = {}) {
  if (options.recordNav === false || layersNavApplying) {
    return;
  }

  ensureLayersSummaryForClass(cls);
  pushLayersNavEntry({
    classId: cls.id,
    view: {
      type: 'classSource',
      classId: cls.id,
      focusLine: options.focusLine ?? null,
      title: options.title ?? null
    }
  });
}

/** 同步所有后退/前进按钮的可用状态 */
function updateLayersNavButtons() {
  const canBack = layersNavIndex > 0;
  const canForward = layersNavIndex >= 0 && layersNavIndex < layersNavHistory.length - 1;

  document.querySelectorAll('[data-layers-nav="back"]').forEach((btn) => {
    btn.disabled = !canBack;
  });

  document.querySelectorAll('[data-layers-nav="forward"]').forEach((btn) => {
    btn.disabled = !canForward;
  });
}

function navigateLayersBack() {
  if (layersNavIndex <= 0) {
    return;
  }

  layersNavApplying = true;
  layersNavIndex -= 1;
  const entry = layersNavHistory[layersNavIndex];
  console.log('[app] 调用层级后退', { index: layersNavIndex, entry });
  applyLayersNavEntry(entry);
  layersNavApplying = false;
  updateLayersNavButtons();
}

function navigateLayersForward() {
  if (layersNavIndex < 0 || layersNavIndex >= layersNavHistory.length - 1) {
    return;
  }

  layersNavApplying = true;
  layersNavIndex += 1;
  const entry = layersNavHistory[layersNavIndex];
  console.log('[app] 调用层级前进', { index: layersNavIndex, entry });
  applyLayersNavEntry(entry);
  layersNavApplying = false;
  updateLayersNavButtons();
}

// ponytail: 导航栈入栈/截断逻辑自检
(function selfCheckLayersNav() {
  layersNavHistory = [];
  layersNavIndex = -1;
  layersNavApplying = false;
  pushLayersNavEntry({ classId: 'A', view: { type: 'summary' } });
  pushLayersNavEntry({ classId: 'B', view: { type: 'summary' } });
  console.assert(layersNavHistory.length === 2 && layersNavIndex === 1, '[selfcheck] 导航入栈');
  pushLayersNavEntry({ classId: 'B', view: { type: 'summary' } });
  console.assert(layersNavHistory.length === 2, '[selfcheck] 重复导航不入栈');
  pushLayersNavEntry({ classId: 'B', view: { type: 'classSource', classId: 'B', focusLine: 10 } });
  console.assert(layersNavHistory.length === 3, '[selfcheck] 同类型不同视图可入栈');
  layersNavIndex = 0;
  pushLayersNavEntry({ classId: 'C', view: { type: 'summary' } });
  console.assert(layersNavHistory.length === 2 && layersNavHistory[1].classId === 'C', '[selfcheck] 前进分支截断');
  console.assert(
    layersNavViewsEqual({ type: 'classSource', classId: 'X', focusLine: 1 }, { type: 'classSource', classId: 'X', focusLine: 2 }) === false,
    '[selfcheck] 成员行号不同视为不同视图'
  );
  layersNavHistory = [];
  layersNavIndex = -1;
})();

// --- 右栏类概要分区 ---

/**
 * 创建折叠分区外壳
 * @param {string} id
 * @param {string} title
 * @param {boolean} [open]
 * @param {{ treeControls?: boolean }} [options]
 */
function createSummarySection(id, title, open = true, options = {}) {
  const details = document.createElement('details');
  details.className = 'summary-section';
  details.id = id;
  details.open = open;

  const summary = document.createElement('summary');
  summary.className = 'summary-section-title';

  const body = document.createElement('div');
  body.className = 'summary-section-body';

  if (options.treeControls) {
    const textSpan = document.createElement('span');
    textSpan.className = 'summary-section-title-text';
    textSpan.textContent = title;
    summary.appendChild(textSpan);

    const actions = document.createElement('span');
    actions.className = 'summary-section-title-actions';

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'summary-tree-tool-btn';
    expandBtn.textContent = '全部展开';
    expandBtn.title = '全部展开';
    expandBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[app] 分区全部展开:', id);
      setTreeExpanded(true, body);
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'summary-tree-tool-btn';
    collapseBtn.textContent = '全部折叠';
    collapseBtn.title = '全部折叠';
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[app] 分区全部折叠:', id);
      setTreeExpanded(false, body);
    });

    actions.appendChild(expandBtn);
    actions.appendChild(collapseBtn);
    summary.appendChild(actions);
  } else {
    summary.textContent = title;
  }

  details.appendChild(summary);
  details.appendChild(body);
  return { details, body };
}

/** 渲染类基本信息概要 */
function renderSummaryOverview(cls) {
  const { details, body } = createSummarySection('summaryOverview', '概要');
  treeContainer.appendChild(details);

  const header = document.createElement('div');
  header.className = 'summary-overview-header';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'icon-wrap';
  iconWrap.innerHTML = typeIconSvg(cls.kind);
  header.appendChild(iconWrap);

  const nameBlock = document.createElement('div');
  nameBlock.className = 'summary-overview-names';

  const nameEl = document.createElement('div');
  nameEl.className = 'summary-type-name';
  nameEl.textContent = cls.name;
  nameBlock.appendChild(nameEl);

  if (cls.namespace) {
    const nsEl = document.createElement('div');
    nsEl.className = 'summary-type-ns';
    nsEl.textContent = cls.namespace;
    nameBlock.appendChild(nsEl);
  }

  header.appendChild(nameBlock);
  body.appendChild(header);

  const meta = document.createElement('div');
  meta.className = 'summary-overview-meta';
  meta.innerHTML = `
    <span class="summary-meta-item">${escapeHtml(cls.filePath)}</span>
    <span class="summary-meta-item">L${cls.line}</span>
    ${cls.inCycle ? '<span class="summary-meta-item cycle-badge">↔ 循环依赖</span>' : ''}
  `;
  body.appendChild(meta);
}

/** 渲染成员大纲占位 */
function renderSummaryOutlinePlaceholder() {
  const { details, body } = createSummarySection('summaryOutline', '成员大纲');
  body.innerHTML = '<p class="summary-loading">正在加载成员…</p>';
  treeContainer.appendChild(details);
}

/** 渲染输入/输出占位 */
function renderSummaryIoPlaceholder() {
  const { details, body } = createSummarySection('summaryIo', '输入 / 输出');
  body.innerHTML = '<p class="summary-loading">正在分析输入输出…</p>';
  treeContainer.appendChild(details);
}

/** 创建调用树折叠分区，返回内部容器 */
function renderCallTreeSection(title) {
  const { details, body } = createSummarySection('summaryCallTree', title, true, { treeControls: true });
  body.classList.add('call-tree-body');
  treeContainer.appendChild(details);
  return body;
}

/** 在调用树下方渲染直接引用方分区 */
function renderReferrersSection(classId, cls, classLayerMap) {
  const { roots, truncated, totalCount } = buildReferrerForest(
    classId,
    currentData.references,
    MAX_TREE_NODES
  );

  const title = totalCount === 0
    ? `引用方 — ${cls.name}`
    : `引用方 — ${cls.name}（${totalCount} 个）`;
  const { details, body } = createSummarySection('summaryReferrers', title, true, { treeControls: true });
  body.classList.add('call-tree-body', 'referrers-body');
  treeContainer.appendChild(details);

  if (roots.length === 0) {
    body.innerHTML = `<p class="tree-placeholder">${escapeHtml(cls.name)} 在文件夹内无直接引用方</p>`;
    console.log('[app] 无直接引用方:', classId);
    return body;
  }

  renderTreeForest(roots, body, currentData.classes, truncated, classLayerMap, 'incoming');
  console.log('[app] 引用方分区已渲染', { classId, totalCount, shown: roots.length, truncated });
  return body;
}

/**
 * 按种类分组渲染成员大纲树
 * @param {Object} outline
 */
function fillSummaryOutline(outline) {
  const section = document.getElementById('summaryOutline');
  if (!section) {
    return;
  }

  const body = section.querySelector('.summary-section-body');
  if (!body) {
    return;
  }

  body.innerHTML = '';

  if (!outline.members || outline.members.length === 0) {
    body.innerHTML = '<p class="summary-empty">无成员</p>';
    return;
  }

  const groups = [
    { key: 'field', label: '字段' },
    { key: 'property', label: '属性' },
    { key: 'method', label: '方法' },
    { key: 'event', label: '事件' },
    { key: 'constructor', label: '构造函数' }
  ];

  for (const group of groups) {
    const items = outline.members.filter((m) => m.kind === group.key);
    if (items.length === 0) {
      continue;
    }

    const groupEl = document.createElement('div');
    groupEl.className = 'member-group';

    const groupTitle = document.createElement('div');
    groupTitle.className = 'member-group-title';
    groupTitle.textContent = `${group.label} (${items.length})`;
    groupEl.appendChild(groupTitle);

    for (const member of items) {
      groupEl.appendChild(renderMemberRow(member));
    }

    body.appendChild(groupEl);
  }

  console.log('[app] 成员大纲已渲染', outline.members.length, '项');
}

/**
 * 从成员/端口类型文本解析文件夹内类型 id
 * @param {string} typeText
 * @param {Object|null} contextCls
 * @returns {string|null}
 */
function resolveClassIdFromTypeText(typeText, contextCls) {
  if (!typeText || !currentData?.classes?.length) {
    return null;
  }

  const normalized = typeText.replace(/\?/g, '').replace(/\[\]/g, '').trim();
  if (!normalized || normalized === 'void') {
    return null;
  }

  const simple = normalized.includes('.')
    ? normalized.split('.').pop()
    : normalized;

  let candidates = currentData.classes.filter((c) => c.name === simple);
  if (candidates.length === 0) {
    candidates = currentData.classes.filter(
      (c) => c.id === normalized || c.id.endsWith(`.${normalized}`)
    );
  }
  if (candidates.length === 1) {
    return candidates[0].id;
  }
  if (contextCls?.namespace) {
    const nsMatches = candidates.filter((c) => c.namespace === contextCls.namespace);
    if (nsMatches.length === 1) {
      return nsMatches[0].id;
    }
  }
  return candidates[0]?.id ?? null;
}

/**
 * 引用边是否涉及指定成员（顶层 memberName 或 sites）
 * @param {Object} ref
 * @param {string} memberName
 */
function refUsesMember(ref, memberName) {
  if (!memberName) {
    return false;
  }
  if (ref.memberName === memberName) {
    return true;
  }
  return ref.sites?.some((s) => s.memberName === memberName) ?? false;
}

/**
 * 解析 from→to 引用边的 kind（优先匹配成员名）
 * @param {string} fromId
 * @param {string} toId
 * @param {string|null|undefined} memberName
 */
function resolveGraphRefKind(fromId, toId, memberName) {
  if (!currentData) {
    return 'uses';
  }
  const refs = currentData.references.filter((r) => r.fromId === fromId && r.toId === toId);
  if (!refs.length) {
    return 'uses';
  }
  if (memberName) {
    for (const ref of refs) {
      if (ref.memberName === memberName) {
        return ref.kind;
      }
      if (ref.sites?.some((s) => s.memberName === memberName)) {
        return ref.kind;
      }
    }
  }
  return refs[0].kind;
}

/**
 * 为侧栏可导航条目绑定图边 data-*（供悬停高亮箭头）
 * @param {HTMLElement} el
 * @param {string} fromId
 * @param {string} toId
 * @param {string|null|undefined} memberName
 * @param {string|null|undefined} kindOverride
 */
function attachGraphEdgeNavDataset(el, fromId, toId, memberName, kindOverride) {
  if (!fromId || !toId || fromId === toId) {
    return;
  }
  delete el.dataset.graphEdgeMode;
  delete el.dataset.graphEdgeMember;
  el.dataset.graphEdgeFrom = fromId;
  el.dataset.graphEdgeTo = toId;
  el.dataset.graphEdgeKind = kindOverride || resolveGraphRefKind(fromId, toId, memberName);
}

/**
 * IO 端口 / 成员被外部引用方访问：悬停高亮所有「引用方 → 当前类」入边
 * @param {HTMLElement} el
 * @param {string} targetClassId
 * @param {string} memberName
 */
function attachIncomingMemberGraphEdgeNav(el, targetClassId, memberName) {
  if (!targetClassId || !memberName) {
    return;
  }
  delete el.dataset.graphEdgeFrom;
  delete el.dataset.graphEdgeTo;
  delete el.dataset.graphEdgeKind;
  el.dataset.graphEdgeMode = 'incoming-member';
  el.dataset.graphEdgeTo = targetClassId;
  el.dataset.graphEdgeMember = memberName;
}

/**
 * 为 IO 端口绑定图边导航：优先入边成员访问，否则回落为出边类型引用
 * @param {HTMLElement} item
 * @param {Object} port
 */
function attachIoPortGraphEdgeNav(item, port) {
  if (!selectedClassId || !currentData) {
    return;
  }

  const incomingCount = currentData.references.filter(
    (r) => r.toId === selectedClassId && refUsesMember(r, port.name)
  ).length;

  if (incomingCount > 0) {
    attachIncomingMemberGraphEdgeNav(item, selectedClassId, port.name);
    console.log('[app] IO 端口绑定入边成员导航', port.name, incomingCount, '处引用');
    return;
  }

  if (port.typeText) {
    const toId = resolveClassIdFromTypeText(port.typeText, currentOutlineContext?.cls);
    attachGraphEdgeNavDataset(item, selectedClassId, toId, port.name);
  }
}

/** 从 IO 端口匹配成员定义行（构造参数回落到构造函数行） */
function resolveMemberLineFromPort(port, members) {
  if (!port || !members?.length) {
    return null;
  }

  const kind = resolveIoPortKind(port);
  if (port.source === '构造参数') {
    const ctor = members.find((m) => m.kind === 'constructor');
    return ctor?.line ?? null;
  }

  const match = members.find((m) => m.kind === kind && m.name === port.name);
  return match?.line ?? null;
}

/** 成员大纲 / IO 端口行：treeContainer 事件委托（避免 innerHTML 重建后丢监听） */
function initOutlineMemberNav() {
  if (initOutlineMemberNav.initialized || !treeContainer) {
    return;
  }
  initOutlineMemberNav.initialized = true;

  treeContainer.addEventListener('click', (e) => {
    const memberRow = e.target.closest('.member-row-nav');
    const ioPort = memberRow ? null : e.target.closest('.io-port-nav');
    const navEl = memberRow || ioPort;
    if (!navEl) {
      return;
    }

    // ponytail: 方法/字段统一单击跳转；图边悬停高亮仍走 mouseover，不与单击冲突
    e.preventDefault();
    e.stopPropagation();

    const line = Number(navEl.dataset.memberLine);
    const resolvedLine = Number.isFinite(line) && line >= 1 ? line : null;
    const title = navEl.dataset.memberTitle || '成员';

    console.log('[app] 大纲条目单击导航', title, resolvedLine ? `L${resolvedLine}` : '(无行号)');
    openOutlineMemberSource({ line: resolvedLine, title });
  });

  console.log('[app] 成员大纲/IO 单击导航已绑定（事件委托）');
}
initOutlineMemberNav.initialized = false;

/** 成员大纲 / IO 端口 → 内联源码视图并聚焦到成员行 */
function openOutlineMemberSource({ line, title }) {
  const ctx = currentOutlineContext;
  if (!ctx?.cls?.filePath) {
    console.warn('[app] 成员源码导航：缺少类型上下文');
    return;
  }

  if (!line || line < 1) {
    console.warn('[app] 成员源码导航：无法解析行号', title);
    return;
  }

  console.log('[app] 大纲导航到源码', ctx.cls.name, title, `L${line}`);
  showClassSource(ctx.cls, { title, focusLine: line });
}

// ponytail: IO 端口行号匹配自检
(function selfCheckOutlineMemberNav() {
  const members = [
    { kind: 'field', name: 'BrushColorProp', line: 12 },
    { kind: 'property', name: 'Settings', line: 34 },
    { kind: 'constructor', name: 'Foo', line: 8 }
  ];
  console.assert(
    resolveMemberLineFromPort({ name: 'BrushColorProp', source: '可写字段' }, members) === 12,
    '[selfcheck] IO 字段匹配成员行'
  );
  console.assert(
    resolveMemberLineFromPort({ name: 'Settings', source: 'get' }, members) === 34,
    '[selfcheck] IO 属性 get 匹配成员行'
  );
  console.assert(
    resolveMemberLineFromPort({ name: 'ignored', source: '构造参数' }, members) === 8,
    '[selfcheck] IO 构造参数回落构造函数行'
  );
  console.assert(refUsesMember({ memberName: 'DisplayTexture' }, 'DisplayTexture'), '[selfcheck] refUsesMember 顶层');
  console.assert(
    refUsesMember({ sites: [{ memberName: 'Brush' }] }, 'Brush'),
    '[selfcheck] refUsesMember sites'
  );
  const navProbe = document.createElement('div');
  navProbe.className = 'member-row member-row-nav';
  navProbe.dataset.memberLine = '42';
  console.assert(
    Number(navProbe.dataset.memberLine) === 42,
    '[selfcheck] 成员行导航 data-memberLine'
  );
})();

/** 渲染单条成员行 */
function renderMemberRow(member) {
  const row = document.createElement('div');
  row.className = 'member-row member-row-nav';
  row.title = `${accessLabel(member.access)} ${member.signature} · 单击查看源码`;

  const iconWrap = document.createElement('span');
  iconWrap.className = 'member-icon-wrap';
  iconWrap.innerHTML = memberIconSvg(member.kind, member.access);
  row.appendChild(iconWrap);

  const sig = document.createElement('span');
  sig.className = 'member-signature';
  sig.textContent = member.signature;
  row.appendChild(sig);

  const access = document.createElement('span');
  access.className = `member-access member-access-${member.access}`;
  access.textContent = accessLabel(member.access);
  row.appendChild(access);

  if (member.io === 'input') {
    const badge = document.createElement('span');
    badge.className = 'member-io-badge member-io-input';
    badge.textContent = '输入';
    row.appendChild(badge);
  } else if (member.io === 'output') {
    const badge = document.createElement('span');
    badge.className = 'member-io-badge member-io-output';
    badge.textContent = '输出';
    row.appendChild(badge);
  }

  if (selectedClassId && member.typeText) {
    const toId = resolveClassIdFromTypeText(member.typeText, currentOutlineContext?.cls);
    attachGraphEdgeNavDataset(row, selectedClassId, toId, member.name);
  }

  row.dataset.memberLine = String(member.line ?? 0);
  row.dataset.memberTitle = `成员 — ${member.signature}`;

  return row;
}

/**
 * 渲染输入/输出清单
 * @param {Object} outline
 */
function fillSummaryIo(outline) {
  const section = document.getElementById('summaryIo');
  if (!section) {
    return;
  }

  const body = section.querySelector('.summary-section-body');
  if (!body) {
    return;
  }

  body.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'io-grid';

  const members = outline.members || [];
  grid.appendChild(renderIoColumn('输入', outline.inputs || [], 'input', members));
  grid.appendChild(renderIoColumn('输出', outline.outputs || [], 'output', members));
  body.appendChild(grid);

  console.log('[app] 输入输出已渲染', outline.inputs?.length ?? 0, '输入', outline.outputs?.length ?? 0, '输出');
}

/** 从 IO 端口推断成员种类（兼容旧 API 无 kind 字段） */
function resolveIoPortKind(port) {
  if (port.kind && MEMBER_KIND_LETTERS[port.kind]) {
    return port.kind;
  }

  const source = port.source || '';
  if (source.includes('构造')) return 'constructor';
  if (source.includes('方法') || source.includes('返回值')) return 'method';
  if (source.includes('属性') || source === 'get' || source === 'set' || source === 'init') return 'property';
  if (source.includes('event')) return 'event';
  if (source.includes('字段') || source.includes('readonly') || source.includes('const') || source.includes('可写')) {
    return 'field';
  }

  return 'field';
}

/** 渲染输入或输出列 */
function renderIoColumn(title, ports, kind, members = []) {
  const col = document.createElement('div');
  col.className = `io-column io-column-${kind}`;

  const colTitle = document.createElement('div');
  colTitle.className = 'io-column-title';
  colTitle.textContent = `${title} (${ports.length})`;
  col.appendChild(colTitle);

  if (ports.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'summary-empty';
    empty.textContent = '无';
    col.appendChild(empty);
    return col;
  }

  const list = document.createElement('div');
  list.className = 'io-list';

  for (const port of ports) {
    const memberKind = resolveIoPortKind(port);

    const item = document.createElement('div');
    item.className = 'io-port io-port-nav';
    item.title = `${port.name} · 单击查看源码`;

    const header = document.createElement('div');
    header.className = 'io-port-header';

    const kindWrap = document.createElement('span');
    kindWrap.className = 'io-port-kind-wrap';
    kindWrap.title = MEMBER_KIND_LABELS[memberKind] || memberKind;
    kindWrap.innerHTML = ioPortKindIconSvg(memberKind);
    header.appendChild(kindWrap);

    const nameEl = document.createElement('span');
    nameEl.className = 'io-port-name';
    nameEl.textContent = port.name;
    header.appendChild(nameEl);

    item.appendChild(header);

    if (port.typeText) {
      const typeEl = document.createElement('span');
      typeEl.className = 'io-port-type';
      typeEl.textContent = port.typeText;
      item.appendChild(typeEl);
    }

    if (port.source) {
      const sourceEl = document.createElement('span');
      sourceEl.className = 'io-port-source';
      sourceEl.textContent = port.source;
      item.appendChild(sourceEl);
    }

    attachIoPortGraphEdgeNav(item, port);

    const portLine = resolveMemberLineFromPort(port, members);
    const portLabel = [port.name, port.typeText, port.source].filter(Boolean).join(' · ');
    item.dataset.memberLine = String(portLine ?? 0);
    item.dataset.memberTitle = `成员 — ${portLabel}`;

    list.appendChild(item);
  }

  col.appendChild(list);
  return col;
}

/** 异步拉取类型大纲并填充右栏 */
async function fetchClassOutline(cls) {
  if (!currentData?.rootPath || !cls) {
    return;
  }

  const token = ++outlineFetchToken;
  console.log('[app] 拉取类型大纲', cls.name, cls.filePath, cls.line);

  try {
    const resp = await fetch('/api/class-outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: currentData.rootPath,
        filePath: cls.filePath,
        line: cls.line,
        typeName: cls.name
      })
    });

    if (token !== outlineFetchToken) {
      console.log('[app] 忽略过期大纲响应', cls.name);
      return;
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || err.detail || `HTTP ${resp.status}`);
    }

    const outline = await resp.json();
    currentOutlineContext = { cls, members: outline.members || [] };
    fillSummaryOutline(outline);
    fillSummaryIo(outline);
  } catch (err) {
    if (token !== outlineFetchToken) {
      return;
    }

    console.error('[app] 加载类型大纲失败', err);
    currentOutlineContext = null;
    const outlineSection = document.getElementById('summaryOutline');
    const ioSection = document.getElementById('summaryIo');
    const msg = escapeHtml(err instanceof Error ? err.message : String(err));

    outlineSection?.querySelector('.summary-section-body')?.replaceChildren(
      (() => {
        const p = document.createElement('p');
        p.className = 'summary-error';
        p.textContent = err instanceof Error ? err.message : String(err);
        return p;
      })()
    );
    ioSection?.querySelector('.summary-section-body')?.replaceChildren(
      (() => {
        const p = document.createElement('p');
        p.className = 'summary-error';
        p.textContent = err instanceof Error ? err.message : String(err);
        return p;
      })()
    );
  }
}

/**
 * 应用调用层级选中态与右侧类概要（调用树 + 引用方）
 * @param {string} classId
 * @param {{ scrollToCard?: boolean, recordNav?: boolean, navView?: LayersNavView }} [options]
 */
function applyLayersView(classId, options = {}) {
  const scrollToCard = options.scrollToCard !== false;
  const recordNav = options.recordNav === true;

  selectedClassId = classId;
  highlightedTreeClassId = null;

  /** @type {Set<string>} 调用树第一层：当前类直接引用的目标类型 */
  const directIncomingIds = currentData
    ? getDirectIncomingClassIds(classId, currentData.references)
    : new Set();

  document.querySelectorAll('.class-card').forEach((el) => {
    const cardId = el.dataset.classId;
    const matched = cardId === classId;
    el.classList.toggle('selected', matched);
    if (matched && scrollToCard) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  syncClassCardRefHighlights(classId);

  if (typeof syncGraphEdgeHighlight === 'function') {
    syncGraphEdgeHighlight(classId);
  }

  if (currentData?.classes.some((c) => c.id === classId)) {
    syncFileTreeSelection(classId);
  }

  if (!currentData) {
    if (recordNav) {
      pushLayersNavEntry({ classId, view: options.navView ?? { type: 'summary' } });
    }
    return;
  }

  const cls = currentData.classes.find((c) => c.id === classId);
  if (!cls) {
    if (recordNav) {
      pushLayersNavEntry({ classId, view: options.navView ?? { type: 'summary' } });
    }
    return;
  }

  treeTitle.textContent = `类概要 — ${cls.name}`;
  treeContainer.innerHTML = '';

  renderSummaryOverview(cls);
  renderSummaryOutlinePlaceholder();
  renderSummaryIoPlaceholder();
  fetchClassOutline(cls);

  const classLayerMap = buildClassLayerMap(currentData.layers);
  const callTreeTitle = `调用树 — ${cls.name}`;
  const callTreeBody = renderCallTreeSection(callTreeTitle);
  const tree = buildCallTree(classId, currentData.references, MAX_TREE_DEPTH, MAX_TREE_NODES);
  renderTree(tree, callTreeBody, currentData.classes, classLayerMap, 'outgoing');
  renderReferrersSection(classId, cls, classLayerMap);
  syncReferrerTreeHighlight(directIncomingIds);

  if (recordNav) {
    pushLayersNavEntry({ classId, view: options.navView ?? { type: 'summary' } });
  }

  // 窄屏：选中类型后自动从右侧打开调用树抽屉
  if (isMobileLayout()) {
    openMobileDrawer('tree');
  }
}

function createClassCard(cls, refs, classMap) {
  const card = document.createElement('div');
  card.className = 'class-card';
  card.dataset.classId = cls.id;

  if (cls.id === selectedClassId) {
    card.classList.add('selected');
  }

  const header = document.createElement('div');
  header.className = 'class-card-header';

  const iconWrap = document.createElement('span');
  iconWrap.className = 'icon-wrap';
  iconWrap.innerHTML = typeIconSvg(cls.kind);
  header.appendChild(iconWrap);

  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = cls.name;
  header.appendChild(nameEl);

  if (cls.inCycle) {
    const badge = document.createElement('span');
    badge.className = 'cycle-badge';
    badge.title = '参与循环依赖';
    badge.textContent = '↔';
    header.appendChild(badge);
  }

  card.appendChild(header);

  // 类名与 .cs 文件名一致时，路径信息冗余，不展示
  if (!classNameMatchesFileName(cls)) {
    const file = document.createElement('div');
    file.className = 'file';
    file.textContent = `${cls.filePath}:${cls.line}`;
    card.appendChild(file);
  }

  if (refs.length) {
    const grouped = groupOutgoingRefsByTarget(refs);
    const kinds = [...new Set(refs.map((r) => r.kind))];
    const summary = document.createElement('div');
    summary.className = 'refs-summary';
    summary.textContent = `引用 ${grouped.length} 个类型 (${kinds.join(', ')})`;
    card.appendChild(summary);
  }

  const actions = document.createElement('div');
  actions.className = 'class-card-actions';

  const sourceBtn = document.createElement('button');
  sourceBtn.type = 'button';
  sourceBtn.className = 'class-card-action-btn';
  sourceBtn.title = '查看该类型完整源码';
  sourceBtn.textContent = '源码';
  sourceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[app] 查看类型完整源码:', cls.id);
    showClassSource(cls);
  });
  actions.appendChild(sourceBtn);
  card.appendChild(actions);

  card.addEventListener('click', () => selectClass(cls.id));
  card.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    console.log('[app] 双击层卡片打开源码:', cls.id);
    showClassSource(cls);
  });
  return card;
}

/** 按目标类型合并对外引用边（同一 toId 算一条） */
function groupOutgoingRefsByTarget(refs) {
  /** @type {Map<string, { toId: string, kinds: Set<string>, members: Set<string>, siteCount: number }>} */
  const byTarget = new Map();

  for (const ref of refs) {
    let group = byTarget.get(ref.toId);
    if (!group) {
      group = { toId: ref.toId, kinds: new Set(), members: new Set(), siteCount: 0 };
      byTarget.set(ref.toId, group);
    }
    group.kinds.add(ref.kind);
    for (const name of collectRefMemberNames(ref)) {
      group.members.add(name);
    }
    group.siteCount += outgoingRefSiteCount(ref);
  }

  return [...byTarget.values()];
}

/** 汇总边上的成员名（边级 + 各 site） */
function collectRefMemberNames(ref) {
  const names = new Set();
  if (ref.memberName) {
    names.add(ref.memberName);
  }
  if (ref.sites) {
    for (const site of ref.sites) {
      if (site.memberName) {
        names.add(site.memberName);
      }
    }
  }
  return [...names];
}

function outgoingRefSiteCount(ref) {
  if (ref.sites?.length) {
    return ref.sites.length;
  }
  return ref.count ?? 1;
}

function selectClass(classId, options = {}) {
  const recordNav = options.recordNav !== false;
  console.log('[app] 选中类:', classId, recordNav ? '' : '(历史导航)');
  if (recordNav && !layersNavApplying) {
    closeRefDetailModal();
  }
  applyLayersView(classId, { ...options, recordNav, navView: { type: 'summary' } });
}

/**
 * 构建被引用森林：每个直接引用方为根，其下挂一层目标类
 * @returns {{ roots: Object[], truncated: boolean, totalCount: number }}
 */
function buildReferrerForest(targetId, references, maxRoots) {
  /** @type {Map<string, Object>} fromId -> 代表边 */
  const byFrom = new Map();

  const incoming = references
    .filter((r) => r.toId === targetId)
    .sort((a, b) => a.fromId.localeCompare(b.fromId) || a.kind.localeCompare(b.kind));

  for (const edge of incoming) {
    if (!byFrom.has(edge.fromId)) {
      byFrom.set(edge.fromId, edge);
    }
  }

  const sortedFromIds = [...byFrom.keys()].sort((a, b) => a.localeCompare(b));
  const totalCount = sortedFromIds.length;
  const truncated = totalCount > maxRoots;
  const limitedFromIds = sortedFromIds.slice(0, maxRoots);

  const roots = limitedFromIds.map((fromId) => {
    const edge = byFrom.get(fromId);
    return {
      classId: fromId,
      kind: 'uses',
      children: [{
        classId: targetId,
        kind: edge.kind,
        children: [],
        truncated: false
      }],
      truncated: false
    };
  });

  console.log('[app] 被引用森林', { targetId, totalCount, shown: roots.length, truncated });
  return { roots, truncated, totalCount };
}

/**
 * 当前类型在调用树中直接引用的目标 id（与 buildCallTree 第一层子节点一致，按 toId 去重）
 * @param {string} classId
 * @param {Object[]} references
 * @returns {Set<string>}
 */
function getDirectOutgoingClassIds(classId, references) {
  /** @type {Set<string>} */
  const targetIds = new Set();
  for (const ref of references) {
    if (ref.fromId === classId) {
      targetIds.add(ref.toId);
    }
  }
  return targetIds;
}

/**
 * 直接引用当前类型的来源 id（引用方分区第一层，按 fromId 去重）
 * @param {string} classId
 * @param {Object[]} references
 * @returns {Set<string>}
 */
function getDirectIncomingClassIds(classId, references) {
  /** @type {Set<string>} */
  const fromIds = new Set();
  for (const ref of references) {
    if (ref.toId === classId) {
      fromIds.add(ref.fromId);
    }
  }
  return fromIds;
}

/**
 * 同步卡片上、下级直接引用次级高亮（分层视图 + 节点图）
 * @param {string|null} classId
 */
function syncClassCardRefHighlights(classId) {
  document.querySelectorAll('.class-card').forEach((el) => {
    el.classList.remove('direct-ref-highlight', 'direct-ref-incoming-highlight');
  });

  if (!classId || !currentData) {
    return;
  }

  const directRefIds = getDirectOutgoingClassIds(classId, currentData.references);
  const directIncomingIds = getDirectIncomingClassIds(classId, currentData.references);

  document.querySelectorAll('.class-card').forEach((el) => {
    const cardId = el.dataset.classId;
    if (!cardId || cardId === classId) {
      return;
    }
    if (directRefIds.has(cardId)) {
      el.classList.add('direct-ref-highlight');
    } else if (directIncomingIds.has(cardId)) {
      el.classList.add('direct-ref-incoming-highlight');
    }
  });

  if (directRefIds.size > 0 || directIncomingIds.size > 0) {
    console.log('[app] 次级高亮', directRefIds.size, '下级', directIncomingIds.size, '上级引用方');
  }
}

/** 引用方分区树：高亮直接引用当前类型的根节点 */
function syncReferrerTreeHighlight(referrerIds) {
  const section = document.getElementById('summaryReferrers');
  if (!section) {
    return;
  }

  section.querySelectorAll('.tree-node').forEach((el) => {
    const inner = el.querySelector(':scope > .tree-node-inner');
    if (!inner) {
      return;
    }
    const depth = Number(el.dataset.depth) || 0;
    const isReferrerRoot = depth === 0 && referrerIds.has(el.dataset.classId);
    inner.classList.toggle('tree-node-referrer-highlight', isReferrerRoot);
  });
}

function buildCallTree(rootId, references, maxDepth, maxNodes) {
  const outgoing = new Map();
  for (const ref of references) {
    if (!outgoing.has(ref.fromId)) {
      outgoing.set(ref.fromId, []);
    }
    outgoing.get(ref.fromId).push(ref);
  }

  const visited = new Set([rootId]);
  let nodeCount = 1;
  let truncated = false;

  function buildNode(classId, depth) {
    const node = { classId, kind: 'uses', children: [], truncated: false };
    if (depth >= maxDepth || nodeCount >= maxNodes) {
      if (depth >= maxDepth && outgoing.has(classId)) {
        node.truncated = true;
      }
      return node;
    }

    const edges = outgoing.get(classId) || [];
    const seenTargets = new Set();

    for (const edge of edges.sort((a, b) => a.toId.localeCompare(b.toId))) {
      if (seenTargets.has(edge.toId)) {
        continue;
      }
      seenTargets.add(edge.toId);

      if (nodeCount >= maxNodes) {
        node.truncated = true;
        truncated = true;
        break;
      }

      const child = { classId: edge.toId, kind: edge.kind, children: [], truncated: false };
      node.children.push(child);
      nodeCount++;

      if (!visited.has(edge.toId)) {
        visited.add(edge.toId);
        const sub = buildNode(edge.toId, depth + 1);
        child.children = sub.children;
        child.truncated = sub.truncated;
        visited.delete(edge.toId);
      }
    }

    return node;
  }

  const root = buildNode(rootId, 0);
  root.truncated = root.truncated || truncated;
  return root;
}

/**
 * 从分层结果构建 类型 id → 全局调用层级 映射
 * @param {{ level: number, classIds: string[] }[]} layers
 * @returns {Map<string, number>}
 */
function buildClassLayerMap(layers) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const layer of layers) {
    for (const classId of layer.classIds) {
      map.set(classId, layer.level);
    }
  }
  console.log('[app] 构建类型层级映射', map.size, '个类型');
  return map;
}

function renderTree(node, container, allClasses, classLayerMap, sectionMode = 'outgoing') {
  container.innerHTML = '';
  const classMap = new Map(allClasses.map((c) => [c.id, c]));
  container.appendChild(renderTreeNode(node, classMap, 0, null, 1, classLayerMap, sectionMode));

  if (node.truncated) {
    appendTruncatedNote(container);
  }
}

/** 渲染多根被引用森林 */
function renderTreeForest(roots, container, allClasses, truncated, classLayerMap, sectionMode = 'outgoing') {
  container.innerHTML = '';
  const classMap = new Map(allClasses.map((c) => [c.id, c]));

  const forest = document.createElement('div');
  forest.className = 'tree-forest';

  for (const root of roots) {
    forest.appendChild(renderTreeNode(root, classMap, 0, null, roots.length, classLayerMap, sectionMode));
  }

  container.appendChild(forest);

  if (truncated) {
    appendTruncatedNote(container, `已截断（引用方上限 ${MAX_TREE_NODES}）`);
  }
}

/** 调用树截断提示 */
function appendTruncatedNote(container, message) {
  const note = document.createElement('p');
  note.className = 'truncated-note';
  note.textContent = message || `已截断（深度上限 ${MAX_TREE_DEPTH} 或节点上限 ${MAX_TREE_NODES}）`;
  container.appendChild(note);
}

function renderTreeNode(node, classMap, depth, parentClassId, rootCount = 1, classLayerMap, sectionMode = 'outgoing') {
  const wrap = document.createElement('div');
  wrap.className = 'tree-node';
  wrap.dataset.depth = String(depth);
  wrap.dataset.classId = node.classId;

  const inner = document.createElement('div');
  inner.className = 'tree-node-inner';

  const hasChildren = node.children && node.children.length > 0;
  const toggle = document.createElement('span');
  toggle.className = 'toggle' + (hasChildren ? '' : ' empty');
  inner.appendChild(toggle);

  if (depth > 0) {
    const refIcon = document.createElement('span');
    refIcon.className = 'ref-icon';
    refIcon.innerHTML = refIconSvg(node.kind);
    refIcon.title = node.kind;
    inner.appendChild(refIcon);
  }

  const cls = classMap.get(node.classId);
  const iconWrap = document.createElement('span');
  iconWrap.className = 'icon-wrap';
  iconWrap.innerHTML = typeIconSvg(cls ? cls.kind : 'class');
  inner.appendChild(iconWrap);

  const layerLevel = classLayerMap?.get(node.classId);
  if (layerLevel !== undefined) {
    const layerBadge = document.createElement('span');
    layerBadge.className = 'tree-layer-badge';
    layerBadge.textContent = `L${layerLevel}`;
    layerBadge.title = `调用层级第 ${layerLevel} 层`;
    inner.appendChild(layerBadge);
  }

  const label = document.createElement('span');
  label.className = 'tree-node-label';
  label.textContent = cls ? cls.name : node.classId.split('.').pop();
  const fqName = cls ? `${cls.namespace ? cls.namespace + '.' : ''}${cls.name}` : node.classId;
  label.title = layerLevel !== undefined
    ? `${fqName}（第 ${layerLevel} 层）`
    : fqName;
  inner.appendChild(label);

  if (cls && cls.inCycle) {
    const badge = document.createElement('span');
    badge.className = 'cycle-badge';
    badge.textContent = '↔';
    inner.appendChild(badge);
  }

  inner.classList.add('tree-node-clickable');
  if (sectionMode === 'incoming' && depth === 0 && selectedClassId) {
    attachGraphEdgeNavDataset(
      inner,
      node.classId,
      selectedClassId,
      null,
      node.children?.[0]?.kind
    );
  } else if (depth > 0 && parentClassId) {
    attachGraphEdgeNavDataset(inner, parentClassId, node.classId, null, node.kind);
  }
  if (sectionMode === 'incoming' && depth === 0) {
    inner.title = '单击高亮同类条目；双击查看该引用方指向目标类的全部引用代码';
  } else if (depth === 0) {
    inner.title = '单击高亮同类条目；双击查看类型定义处源码';
  } else {
    inner.title = '单击高亮同类条目；双击查看父类引用当前类的源码';
  }
  inner.addEventListener('click', () => {
    highlightTreeClassEntries(node.classId);
  });
  inner.addEventListener('dblclick', () => {
    openTreeNodeReferenceDetail(node, cls, classMap, depth, parentClassId, sectionMode);
  });

  const actions = document.createElement('div');
  actions.className = 'tree-node-actions';

  const refBtn = document.createElement('button');
  refBtn.type = 'button';
  refBtn.className = 'tree-action-btn';
  refBtn.textContent = '引';
  if (sectionMode === 'incoming' && depth === 0) {
    refBtn.title = '查看该引用方指向目标类的全部引用代码（同双击条目）';
  } else if (depth === 0) {
    refBtn.title = '查看类型定义处源码（同双击条目）';
  } else {
    refBtn.title = '查看被引用的位置（同双击条目）';
  }
  refBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[app] 调用树条目打开引用代码:', node.classId, { depth, sectionMode });
    openTreeNodeReferenceDetail(node, cls, classMap, depth, parentClassId, sectionMode);
  });
  actions.appendChild(refBtn);

  if (cls) {
    const sourceBtn = document.createElement('button');
    sourceBtn.type = 'button';
    sourceBtn.className = 'tree-action-btn';
    sourceBtn.title = '查看该类型完整源码';
    sourceBtn.textContent = '源码';
    sourceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('[app] 调用树条目打开完整源码:', node.classId);
      showClassSource(cls);
    });
    actions.appendChild(sourceBtn);
  }

  const focusBtn = document.createElement('button');
  focusBtn.type = 'button';
  focusBtn.className = 'tree-action-btn';
  focusBtn.title = '在调用层级中选中，并以此为根查看调用树';
  focusBtn.textContent = '根';
  focusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    console.log('[app] 调用树条目设为根:', node.classId);
    selectClass(node.classId);
  });
  actions.appendChild(focusBtn);

  inner.appendChild(actions);

  wrap.appendChild(inner);

  if (hasChildren) {
    wrap.dataset.expandable = '1';
    // ponytail: 默认等同「全部折叠」——单根保留 depth=0 展开，多根则根也收起
    const startExpanded = depth === 0 && rootCount === 1;
    wrap.dataset.expanded = startExpanded ? '1' : '0';
    toggle.textContent = startExpanded ? '▼' : '▶';

    const childrenEl = document.createElement('div');
    childrenEl.className = 'tree-children';
    if (!startExpanded) {
      childrenEl.classList.add('hidden');
    }
    for (const child of node.children) {
      childrenEl.appendChild(renderTreeNode(child, classMap, depth + 1, node.classId, rootCount, classLayerMap, sectionMode));
    }
    wrap.appendChild(childrenEl);

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = wrap.dataset.expanded === '1';
      setNodeExpanded(wrap, !expanded);
    });
  }

  return wrap;
}

/** 单击调用树条目：高亮树中所有同类型条目 */
function highlightTreeClassEntries(classId) {
  highlightedTreeClassId = classId;
  console.log('[app] 调用树高亮同类条目:', classId);

  const nodes = treeContainer.querySelectorAll('.tree-node');
  let matchCount = 0;
  for (const el of nodes) {
    const inner = el.querySelector(':scope > .tree-node-inner');
    if (!inner) {
      continue;
    }
    const matched = el.dataset.classId === classId;
    inner.classList.toggle('tree-node-class-highlight', matched);
    if (matched) {
      matchCount++;
    }
  }

  console.log(`[app] 调用树高亮 ${matchCount} 个条目`);
}

/** 双击调用树条目：打开引用代码详情 */
function openTreeNodeReferenceDetail(node, cls, classMap, depth, parentClassId, sectionMode = 'outgoing') {
  if (!currentData || !cls) {
    return;
  }

  // 被引用森林：根=引用方、子=目标类；双击根应展示引用点，而非引用方的类型定义
  if (sectionMode === 'incoming' && depth === 0 && node.children?.length >= 1) {
    const targetId = node.children[0].classId;
    const targetCls = classMap.get(targetId);
    const refs = currentData.references.filter(
      (r) => r.fromId === node.classId && r.toId === targetId
    );
    console.log('[app] 打开引用代码详情（被引用·根）', {
      from: node.classId,
      to: targetId,
      refCount: refs.length
    });
    showReferenceDetail({
      fromClass: cls,
      toClass: targetCls,
      refs,
      isRoot: false
    });
    return;
  }

  const isRoot = depth === 0;
  /** @type {Object[]} */
  let refs = [];
  if (!isRoot && parentClassId) {
    refs = currentData.references.filter(
      (r) => r.fromId === parentClassId && r.toId === node.classId
    );
  }

  console.log('[app] 打开引用代码详情', {
    from: isRoot ? cls.id : parentClassId,
    to: node.classId,
    isRoot,
    refCount: refs.length
  });
  showReferenceDetail({
    fromClass: isRoot ? cls : classMap.get(parentClassId),
    toClass: cls,
    refs,
    isRoot
  });
}

/** 展开或折叠单个树节点 */
function setNodeExpanded(nodeEl, expanded) {
  const childBox = nodeEl.querySelector(':scope > .tree-children');
  const toggle = nodeEl.querySelector(':scope > .tree-node-inner > .toggle');
  if (!childBox) {
    return;
  }

  nodeEl.dataset.expanded = expanded ? '1' : '0';
  childBox.classList.toggle('hidden', !expanded);
  if (toggle && !toggle.classList.contains('empty')) {
    toggle.textContent = expanded ? '▼' : '▶';
  }
}

/** 调用树顶层根节点数量 */
function getCallTreeRootCount(container) {
  if (!container) {
    return 0;
  }
  const forest = container.querySelector('.tree-forest');
  if (forest) {
    return forest.querySelectorAll(':scope > .tree-node').length;
  }
  return container.querySelectorAll(':scope > .tree-node').length;
}

/** 调用树节点在「全部折叠」时是否应保持展开 */
function shouldKeepCallTreeNodeExpanded(expanded, rootCount, depth) {
  if (expanded) {
    return true;
  }
  return rootCount === 1 && depth === 0;
}

/** 树分区全部展开或折叠（单根保留根展开，多根则根也折叠） */
function setTreeExpanded(expanded, container) {
  if (!container) {
    console.log('[app] 树分区容器不存在，跳过', expanded ? '展开' : '折叠');
    return;
  }
  const nodes = container.querySelectorAll('.tree-node[data-expandable="1"]');
  if (nodes.length === 0) {
    console.log('[app] 树分区无子节点，跳过', expanded ? '展开' : '折叠');
    return;
  }

  const rootCount = getCallTreeRootCount(container);
  nodes.forEach((nodeEl) => {
    const depth = Number(nodeEl.dataset.depth || '0');
    const keepExpanded = shouldKeepCallTreeNodeExpanded(expanded, rootCount, depth);
    setNodeExpanded(nodeEl, keepExpanded);
  });

  console.log(
    '[app] 树分区',
    expanded ? '全部展开' : rootCount === 1 ? '全部折叠(保留单根)' : '全部折叠(含多根)',
    `(${nodes.length} 个节点, 根 ${rootCount})`
  );
}

// ponytail: 树「全部折叠」单根/多根策略自检
(function selfCheckSmartTreeCollapse() {
  console.assert(
    shouldKeepCallTreeNodeExpanded(false, 1, 0) === true,
    '[selfcheck] 单根折叠保留根'
  );
  console.assert(
    shouldKeepCallTreeNodeExpanded(false, 1, 2) === false,
    '[selfcheck] 单根折叠收起子层'
  );
  console.assert(
    shouldKeepCallTreeNodeExpanded(false, 4, 0) === false,
    '[selfcheck] 多根折叠收起根'
  );
  console.assert(
    shouldKeepCallTreeNodeExpanded(true, 4, 0) === true,
    '[selfcheck] 全部展开'
  );
})();

// --- 主页顶栏（默认 / 源码详情共用） ---

/** 同步顶栏高度 CSS 变量，供内联源码视口 top 偏移 */
function syncPageHeaderHeightVar() {
  if (!pageHeader) {
    return;
  }

  const heightPx = pageHeader.offsetHeight;
  document.documentElement.style.setProperty('--page-header-height', `${heightPx}px`);
  console.log('[app] 顶栏高度同步', heightPx);
}

/** 监听顶栏尺寸变化（详情标题换行、窄屏工具栏等） */
function initPageHeaderHeightSync() {
  if (!pageHeader) {
    return;
  }

  syncPageHeaderHeightVar();
  const observer = new ResizeObserver(() => {
    syncPageHeaderHeightVar();
  });
  observer.observe(pageHeader);
  window.addEventListener('resize', syncPageHeaderHeightVar);
}

/** 记录 pageHeader 在主页中的原始 DOM 位置（仅首次） */
function capturePageHeaderHomeAnchor() {
  if (!pageHeader || pageHeaderHomeAnchor) {
    return;
  }

  pageHeaderHomeAnchor = {
    parent: pageHeader.parentNode,
    next: pageHeader.nextSibling
  };
  console.log('[app] 记录顶栏主页锚点');
}

/** 详情打开：顶栏挂到 ref-modal-panel 内、置于 refDetailBody 之上 */
function mountPageHeaderInRefModal() {
  capturePageHeaderHomeAnchor();
  const panel = refDetailModal?.querySelector('.ref-modal-panel');
  if (!panel || !pageHeader || !refDetailBody) {
    return;
  }

  if (pageHeader.parentNode !== panel) {
    panel.insertBefore(pageHeader, refDetailBody);
    console.log('[app] 顶栏挂入源码面板');
  }

  pageHeader.classList.add('header-in-ref-modal');
}

/** 详情关闭：顶栏还原到主页原始位置 */
function restorePageHeaderHome() {
  if (!pageHeader || !pageHeaderHomeAnchor) {
    return;
  }

  const { parent, next } = pageHeaderHomeAnchor;
  if (next) {
    parent.insertBefore(pageHeader, next);
  } else {
    parent.appendChild(pageHeader);
  }

  pageHeader.classList.remove('header-in-ref-modal');
  syncPageHeaderHeightVar();
  console.log('[app] 顶栏还原到主页');
}

/** 恢复主页默认顶栏：标题 + 帮助按钮 */
function setPageHeaderDefault() {
  if (pageHeaderTitle) {
    pageHeaderTitle.textContent = PAGE_HEADER_DEFAULT_TITLE;
  }

  pageHeader?.classList.remove('header-detail-mode');
  headerDefaultActions?.classList.remove('hidden');
  headerDetailActions?.classList.add('hidden');
  restorePageHeaderHome();
  console.log('[app] 顶栏恢复默认');
}

/** 源码/引用详情模式：更换标题，隐藏帮助、显示关闭 */
function setPageHeaderDetail(title) {
  if (pageHeaderTitle) {
    pageHeaderTitle.textContent = title;
  }

  pageHeader?.classList.add('header-detail-mode');
  headerDefaultActions?.classList.add('hidden');
  headerDetailActions?.classList.remove('hidden');
  syncPageHeaderHeightVar();
  console.log('[app] 顶栏切换详情', title);
}

// ponytail: 顶栏模式切换自检
(function selfCheckPageHeader() {
  setPageHeaderDetail('测试 — Foo');
  console.assert(pageHeaderTitle?.textContent === '测试 — Foo', '[selfcheck] 详情标题');
  console.assert(pageHeader?.classList.contains('header-detail-mode'), '[selfcheck] 详情模式 class');
  console.assert(headerDetailActions && !headerDetailActions.classList.contains('hidden'), '[selfcheck] 关闭按钮可见');
  setPageHeaderDefault();
  console.assert(pageHeaderTitle?.textContent === PAGE_HEADER_DEFAULT_TITLE, '[selfcheck] 默认标题恢复');
})();

// --- 引用代码详情模态框 ---

/** 初始化模态框关闭交互 */
function initRefDetailModal() {
  if (!refDetailModal) {
    return;
  }

  refDetailClose?.addEventListener('click', closeRefDetailModal);
  refDetailBackdrop?.addEventListener('click', closeRefDetailModal);
  refDetailModal.addEventListener('click', onRefDetailTypeNavClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !refDetailModal.classList.contains('hidden')) {
      closeRefDetailModal();
    }
  });

  // ponytail: 模态框内滚轮到底/顶时不再链式滚动背后主界面面板
  refDetailModal.addEventListener(
    'wheel',
    (e) => {
      if (refDetailModal.classList.contains('hidden')) {
        return;
      }

      if (!modalWheelShouldBlock(e.target, e.deltaY)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      console.log('[app] 拦截模态框滚轮穿透', { deltaY: e.deltaY });
    },
    { passive: false }
  );

  // 选中文本 → 全文件字符串查找高亮
  refDetailBody?.addEventListener('mouseup', onRefDetailTextSelectionSearch);
  refDetailBody?.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift' || e.key.startsWith('Arrow')) {
      onRefDetailTextSelectionSearch();
    }
  });
}

/** 模态框内是否应拦截滚轮（任一祖先滚动容器仍可滚动则不拦截） */
function modalWheelShouldBlock(target, deltaY) {
  let el = target instanceof Element ? target : null;
  while (el && el !== refDetailModal) {
    const { overflowY } = getComputedStyle(el);
    const scrollable =
      overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    if (scrollable && el.scrollHeight > el.clientHeight + 1 && wheelCanScroll(el, deltaY)) {
      return false;
    }
    el = el.parentElement;
  }
  return true;
}

/** 判断滚动容器是否还能沿滚轮方向继续滚动 */
function wheelCanScroll(el, deltaY) {
  if (!el || deltaY === 0) {
    return false;
  }

  const maxScrollTop = el.scrollHeight - el.clientHeight;
  if (deltaY < 0) {
    return el.scrollTop > 0;
  }
  return el.scrollTop < maxScrollTop - 1;
}

/**
 * 打开源码/引用详情容器
 * @param {boolean} inline true=内联到中间主视口（替代主区域、无遮罩）；false=右侧滑出弹窗
 */
function openRefDetailModal(inline = false) {
  refDetailModal?.classList.remove('hidden');
  document.body.classList.add('ref-modal-open');
  mountPageHeaderInRefModal();

  if (refDetailModal) {
    if (inline) {
      refDetailModal.classList.add('-inline');
      document.body.classList.add('ref-modal-inline');
      syncPageHeaderHeightVar();
      console.log('[app] 源码内联打开，占满中间视口');
    } else {
      refDetailModal.classList.remove('-inline');
      document.body.classList.remove('ref-modal-inline');
      currentInlineSourceView = null;
    }
  }

  if (isMobileLayout()) {
    const vw = window.innerWidth;
    const gutter = 36; // 与 --code-mobile-gutter 2.25rem 近似
    const lineNum = 44; // 与 --code-line-num-width 2.75rem 近似
    const computedSize = Math.max(9, Math.min(12.48, (vw - gutter - lineNum) / 80));
    console.log('[app] 打开源码模态框（窄屏 80 列缩放）', {
      viewportWidth: vw,
      targetCols: 80,
      estimatedFontPx: computedSize.toFixed(1)
    });
  } else {
    console.log('[app] 打开源码模态框');
  }
}

function closeRefDetailModal() {
  refDetailModal?.classList.add('hidden');
  refDetailModal?.classList.remove('-inline');
  document.body.classList.remove('ref-modal-open');
  document.body.classList.remove('ref-modal-inline');
  refDetailSearchQuery = null;
  refDetailBody.innerHTML = '';
  currentInlineSourceView = null;
  setPageHeaderDefault();
  console.log('[app] 关闭源码模态框');
}

/** 选区是否落在源码行文本单元格内 */
function refDetailSelectionInCodeLine(node) {
  if (!node) {
    return false;
  }

  const el = node instanceof Element ? node : node.parentElement;
  return Boolean(el?.closest('.code-snippet .line-text'));
}

/**
 * 从当前选区提取用于字符串查找的 query
 * @returns {string|null}
 */
function getRefDetailSearchQueryFromSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return null;
  }

  const { anchorNode, focusNode } = sel;
  if (
    !refDetailBody ||
    (!refDetailBody.contains(anchorNode) && !refDetailBody.contains(focusNode))
  ) {
    return null;
  }

  if (!refDetailSelectionInCodeLine(anchorNode) && !refDetailSelectionInCodeLine(focusNode)) {
    return null;
  }

  let text = sel.toString();
  if (!text.trim()) {
    return null;
  }

  // ponytail: 跨行选中时取首行非空片段，避免带换行符在全文件 indexOf 搜不到
  if (text.includes('\n')) {
    text = text.split('\n').find((line) => line.trim()) ?? text;
  }

  text = text.trim();
  return text.length > 0 ? text : null;
}

/** 选区变化：用选中字符串在全文件内查找并高亮 */
function onRefDetailTextSelectionSearch() {
  if (!refDetailModal || refDetailModal.classList.contains('hidden')) {
    return;
  }

  const query = getRefDetailSearchQueryFromSelection();
  applyRefDetailSearchHighlight(query);
}

/**
 * 在 raw 行文本中查找 query 的全部非重叠出现位置（字面量 indexOf）
 * @param {string} text
 * @param {string} query
 * @returns {{ start: number, end: number }[]}
 */
function findSubstringRanges(text, query) {
  if (!query) {
    return [];
  }

  /** @type {{ start: number, end: number }[]} */
  const ranges = [];
  let idx = 0;

  while (idx < text.length) {
    const found = text.indexOf(query, idx);
    if (found === -1) {
      break;
    }

    ranges.push({ start: found, end: found + query.length });
    idx = found + query.length;
  }

  return ranges;
}

/** @type {WeakMap<HTMLPreElement, ResizeObserver>} */
const codeSnippetOverviewObservers = new WeakMap();

/**
 * 为可滚动源码区套上 shell + overview ruler（VS Code 滚动条标记轨）
 * @param {HTMLPreElement} pre
 * @returns {HTMLDivElement}
 */
function wrapCodeSnippetInShell(pre) {
  const shell = document.createElement('div');
  shell.className = 'code-snippet-shell';

  const ruler = document.createElement('div');
  ruler.className = 'code-snippet-overview-ruler';
  ruler.setAttribute('aria-hidden', 'true');
  ruler.title = '查找匹配位置（点击跳转）';

  ruler.addEventListener('click', (e) => {
    const mark = e.target.closest('.code-snippet-overview-mark');
    if (mark instanceof HTMLElement && mark.dataset.line) {
      const row = pre.querySelector(`tr[data-line="${mark.dataset.line}"]`);
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      console.log('[app] overview 标记跳转 L', mark.dataset.line);
      return;
    }

    const rect = ruler.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / Math.max(rect.height, 1);
    const maxScroll = pre.scrollHeight - pre.clientHeight;
    pre.scrollTo({ top: ratio * maxScroll, behavior: 'smooth' });
    console.log('[app] overview 标尺比例跳转', ratio.toFixed(3));
  });

  shell.appendChild(pre);
  shell.appendChild(ruler);
  ensureCodeSnippetOverviewObserver(pre);
  return shell;
}

/** 监听源码区尺寸变化，重算 overview 标记位置 */
function ensureCodeSnippetOverviewObserver(pre) {
  if (codeSnippetOverviewObservers.has(pre)) {
    return;
  }

  const observer = new ResizeObserver(() => {
    const stored = pre.dataset.searchMatchLines;
    if (!stored) {
      return;
    }

    try {
      const lineNumbers = JSON.parse(stored);
      if (Array.isArray(lineNumbers) && lineNumbers.length > 0) {
        renderCodeSnippetOverviewMarks(pre, lineNumbers);
      }
    } catch {
      /* ponytail: dataset 损坏时忽略 */
    }
  });

  observer.observe(pre);
  codeSnippetOverviewObservers.set(pre, observer);
}

/**
 * 在 overview ruler 上绘制匹配行标记（整文件压缩映射到可视区高度）
 * @param {HTMLPreElement} pre
 * @param {number[]} lineNumbers 含匹配的行号（可重复，内部会去重）
 */
function renderCodeSnippetOverviewMarks(pre, lineNumbers) {
  const shell = pre.closest('.code-snippet-shell');
  const ruler = shell?.querySelector('.code-snippet-overview-ruler');
  if (!ruler) {
    return;
  }

  const uniqueLines = [...new Set(lineNumbers.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  pre.dataset.searchMatchLines = uniqueLines.length ? JSON.stringify(uniqueLines) : '';

  ruler.replaceChildren();
  ruler.classList.toggle('is-visible', uniqueLines.length > 0);

  if (!uniqueLines.length) {
    return;
  }

  const scrollHeight = pre.scrollHeight;
  const rulerHeight = pre.clientHeight;
  if (scrollHeight <= 0 || rulerHeight <= 0) {
    return;
  }

  for (const lineNum of uniqueLines) {
    const row = pre.querySelector(`tr[data-line="${lineNum}"]`);
    if (!row) {
      continue;
    }

    const mark = document.createElement('div');
    mark.className = 'code-snippet-overview-mark';
    mark.dataset.line = String(lineNum);
    mark.title = `L${lineNum}`;

    const top = (row.offsetTop / scrollHeight) * rulerHeight;
    const height = Math.max((row.offsetHeight / scrollHeight) * rulerHeight, 2);
    mark.style.top = `${top}px`;
    mark.style.height = `${height}px`;
    ruler.appendChild(mark);
  }

  console.log('[app] overview 标尺标记', uniqueLines.length, '行');
}

/** 更新单个源码块顶栏上的查找匹配数 */
function refreshRefDetailBlockSearchMeta(block, matchCount) {
  const ctx = refDetailBlockRenderCtx.get(block);
  const fileLine = block.querySelector('.ref-detail-meta .file-line');
  if (!ctx || !fileLine) {
    return;
  }

  if (refDetailSearchQuery) {
    fileLine.textContent = `${ctx.metaBaseText} · 「${refDetailSearchQuery}」${matchCount} 处匹配`;
  } else {
    fileLine.textContent = ctx.metaBaseText;
  }
}

/** 将选区 query 应用到弹窗内所有源码块（保留既有引用/类型高亮） */
function applyRefDetailSearchHighlight(query) {
  const normalized = query?.trim() || null;
  if (normalized === refDetailSearchQuery) {
    return;
  }

  refDetailSearchQuery = normalized;
  if (!refDetailBody) {
    return;
  }

  let totalMatches = 0;
  for (const block of refDetailBody.querySelectorAll('.ref-detail-block')) {
    const ctx = refDetailBlockRenderCtx.get(block);
    if (!ctx) {
      continue;
    }

    const pre = block.querySelector('.code-snippet');
    if (!pre) {
      continue;
    }

    let blockMatches = 0;
    /** @type {number[]} */
    const matchLines = [];
    for (const tr of pre.querySelectorAll('tr')) {
      const lineNum = parseInt(tr.dataset.line ?? tr.querySelector('.line-num')?.textContent ?? '', 10);
      if (!Number.isFinite(lineNum)) {
        continue;
      }

      const rawText = ctx.linesByNumber.get(lineNum) ?? '';
      if (normalized) {
        const lineHits = findSubstringRanges(rawText, normalized);
        blockMatches += lineHits.length;
        if (lineHits.length > 0) {
          matchLines.push(lineNum);
        }
      }

      const textTd = tr.querySelector('.line-text');
      if (!textTd) {
        continue;
      }

      /** @type {{ start: number, length: number }[]} */
      let spans = [];
      /** @type {string[]} */
      const fallbackTerms = [...ctx.scannedClassNames];

      if (ctx.kind === 'snippet' && ctx.lineRefInfo) {
        const refInfo = ctx.lineRefInfo.get(lineNum);
        spans = refInfo?.spans ?? [];
        if (refInfo?.terms) {
          for (const term of refInfo.terms) {
            fallbackTerms.push(term);
          }
        }
      }

      textTd.innerHTML = renderCodeLineWithHighlights(
        rawText,
        spans,
        fallbackTerms,
        ctx.scannedClassNameToId,
        normalized
      );
    }

    refreshRefDetailBlockSearchMeta(block, blockMatches);
    requestAnimationFrame(() => renderCodeSnippetOverviewMarks(pre, matchLines));
    totalMatches += blockMatches;
  }

  console.log('[app] 源码字符串查找高亮', { query: normalized, matchCount: totalMatches });
}

/** 内联源码是否已打开且为同一文件 */
function isSameInlineSourceFile(filePath) {
  if (
    !currentInlineSourceView ||
    !refDetailModal ||
    refDetailModal.classList.contains('hidden') ||
    !refDetailModal.classList.contains('-inline')
  ) {
    return false;
  }

  return currentInlineSourceView.filePath === normalizeFilePath(filePath);
}

/** 更新内联源码块顶栏标题与行号说明 */
function updateInlineSourceMeta(block, focusLine, title) {
  if (title) {
    setPageHeaderDetail(title);
  }

  const kindLabel = block.querySelector('.ref-detail-meta .kind-label');
  if (kindLabel) {
    kindLabel.textContent = '成员定位';
  }

  const fileLine = block.querySelector('.ref-detail-meta .file-line');
  if (fileLine && currentInlineSourceView) {
    fileLine.textContent =
      `${currentInlineSourceView.filePath}（共 ${currentInlineSourceView.lineCount} 行，聚焦 L${focusLine}）`;
  }
}

/** 触发目标行脉冲高亮（同文件跳转动画） */
function pulseCodeLineFocus(row) {
  if (!row) {
    return;
  }

  row.classList.remove('code-line-focus-pulse');
  // ponytail: 强制重排以重启动画
  void row.offsetWidth;
  row.classList.add('code-line-focus-pulse');
  row.addEventListener(
    'animationend',
    () => {
      row.classList.remove('code-line-focus-pulse');
    },
    { once: true }
  );
}

/**
 * 同文件内切换成员聚焦：平滑滚动 + 行脉冲，不重新请求源码
 * @returns {boolean} 是否已就地更新
 */
function animateClassSourceFocus(block, focusLine, title) {
  const pre = block?.querySelector('.code-snippet-full');
  if (!pre || !focusLine) {
    return false;
  }

  const nextRow = pre.querySelector(`tr[data-line="${focusLine}"]`);
  if (!nextRow) {
    console.warn('[app] 同文件源码动画：找不到目标行', focusLine);
    return false;
  }

  const prevRow = pre.querySelector('.code-line-focus');
  if (prevRow && prevRow !== nextRow) {
    prevRow.classList.remove('code-line-focus', 'code-line-focus-pulse');
  }

  nextRow.classList.add('code-line-focus');
  pulseCodeLineFocus(nextRow);
  scrollClassSourceToFocus(block, focusLine, { smooth: true });
  updateInlineSourceMeta(block, focusLine, title);

  if (currentInlineSourceView) {
    currentInlineSourceView.focusLine = focusLine;
  }

  console.log('[app] 同文件源码动画聚焦', focusLine);
  return true;
}

/** 点击源码中的已扫描类型名 → 跳转该类型完整源码并同步选中调用树 */
function onRefDetailTypeNavClick(e) {
  const navBtn = e.target.closest('.code-type-nav');
  if (!navBtn || !refDetailModal || refDetailModal.classList.contains('hidden')) {
    return;
  }

  const classId = navBtn.dataset.classId;
  if (!classId) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const cls = findClassById(classId);
  if (!cls) {
    console.warn('[app] 源码导航：未找到类型', classId);
    return;
  }

  console.log('[app] 源码内点击导航到类型:', classId);
  showClassSource(cls);
}

/** 在模态框中展示类型完整源码（整文件，高亮类型定义行并滚动聚焦） */
async function showClassSource(cls, options = {}) {
  if (!currentData?.rootPath || !cls) {
    showError('缺少分析数据，请先分析文件夹');
    return;
  }

  ensureLayersSummaryForClass(cls);

  const focusLine = options.focusLine ?? null;
  if (focusLine && isSameInlineSourceFile(cls.filePath)) {
    const existingBlock = refDetailBody.querySelector('.ref-detail-block');
    if (
      animateClassSourceFocus(
        existingBlock,
        focusLine,
        options.title ?? `成员 — L${focusLine}`
      )
    ) {
      recordClassSourceNav(cls, options);
      return;
    }
  }

  setPageHeaderDetail(options.title ?? `完整源码 — ${cls.name}`);
  refDetailSearchQuery = null;
  refDetailBody.innerHTML = '<p class="ref-detail-loading">正在加载源码…</p>';
  openRefDetailModal(true);

  try {
    const resp = await fetch('/api/class-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderPath: currentData.rootPath,
        filePath: cls.filePath,
        line: cls.line,
        typeName: cls.name
      })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || err.detail || `HTTP ${resp.status}`);
    }

    const source = await resp.json();
    refDetailBody.innerHTML = '';
    const block = renderClassSourceBlock(source, { focusLine });
    refDetailBody.appendChild(block);
    currentInlineSourceView = {
      filePath: normalizeFilePath(source.filePath),
      focusLine: focusLine ?? source.startLine,
      lineCount: source.lines.length
    };
    scrollClassSourceToFocus(block, focusLine ?? source.startLine);
    recordClassSourceNav(cls, options);
  } catch (err) {
    console.error('[app] 加载类型源码失败', err);
    currentInlineSourceView = null;
    refDetailBody.innerHTML = `<p class="ref-detail-error">${escapeHtml(
      err instanceof Error ? err.message : String(err)
    )}</p>`;
  }
}

/** 渲染类型完整源码块 */
function renderClassSourceBlock(source, options = {}) {
  const focusLine = options.focusLine;
  const block = document.createElement('div');
  block.className = 'ref-detail-block';

  const meta = document.createElement('div');
  meta.className = 'ref-detail-meta';

  const kindLabel = document.createElement('span');
  kindLabel.className = 'kind-label';
  kindLabel.textContent = focusLine ? '成员定位' : '完整类型';
  meta.appendChild(kindLabel);

  const fileLine = document.createElement('span');
  fileLine.className = 'file-line';
  if (focusLine) {
    fileLine.textContent = `${source.filePath}（共 ${source.lines.length} 行，聚焦 L${focusLine}）`;
  } else {
    const typeLineCount = source.endLine - source.startLine + 1;
    fileLine.textContent = `${source.filePath}（共 ${source.lines.length} 行，类型 L${source.startLine}–${source.endLine} ${typeLineCount} 行已高亮）`;
  }
  meta.appendChild(fileLine);
  block.appendChild(meta);

  const scannedClassNames = getScannedClassNamesForHighlight();
  const scannedClassNameToId = getScannedClassNameToIdMap();
  /** @type {Map<number, string>} */
  const linesByNumber = new Map(source.lines.map((l) => [l.number, l.text]));
  refDetailBlockRenderCtx.set(block, {
    kind: 'full',
    scannedClassNames,
    scannedClassNameToId,
    linesByNumber,
    metaBaseText: fileLine.textContent
  });

  const pre = document.createElement('pre');
  pre.className = 'code-snippet code-snippet-full';
  const table = document.createElement('table');
  console.log('[app] 完整源码行内高亮扫描类型数', scannedClassNames.length);

  for (const line of source.lines) {
    const tr = document.createElement('tr');
    tr.dataset.line = String(line.number);
    if (line.highlight) {
      tr.classList.add('code-line-highlight');
    }
    if (focusLine && line.number === focusLine) {
      tr.classList.add('code-line-focus');
    }

    const numTd = document.createElement('td');
    numTd.className = 'line-num';
    numTd.textContent = String(line.number);

    const textTd = document.createElement('td');
    textTd.className = 'line-text';
    textTd.innerHTML = renderCodeLineWithHighlights(
      line.text,
      [],
      scannedClassNames,
      scannedClassNameToId
    );

    tr.appendChild(numTd);
    tr.appendChild(textTd);
    table.appendChild(tr);
  }

  pre.appendChild(table);
  block.appendChild(wrapCodeSnippetInShell(pre));
  return block;
}

/** 将源码视图滚动到指定行（居中）；smooth 时用于同文件成员跳转动画 */
function scrollClassSourceToFocus(block, startLine, options = {}) {
  const pre = block.querySelector('.code-snippet-full');
  if (!pre) {
    return;
  }

  const focusRow =
    pre.querySelector(`tr[data-line="${startLine}"]`) ??
    pre.querySelector('.code-line-highlight');
  if (!focusRow) {
    return;
  }

  console.log('[app] 源码视图聚焦到行', startLine, options.smooth ? '(平滑)' : '');
  requestAnimationFrame(() => {
    const centerOffset =
      focusRow.offsetTop - pre.clientHeight / 2 + focusRow.clientHeight / 2;
    const targetTop = Math.max(0, centerOffset);
    if (options.smooth) {
      pre.scrollTo({ top: targetTop, behavior: 'smooth' });
    } else {
      pre.scrollTop = targetTop;
    }
  });
}

/** @typedef {{ fromClass: Object, toClass: Object, refs: Object[], isRoot: boolean }} RefDetailParams */

/**
 * 展示引用点或类型定义的源码片段
 * @param {RefDetailParams} params
 */
async function showReferenceDetail(params) {
  const { fromClass, toClass, refs, isRoot } = params;
  if (!currentData?.rootPath || !toClass) {
    showError('缺少分析数据，请先分析文件夹');
    return;
  }

  if (isRoot) {
    return showClassSource(toClass, { title: `类型定义 — ${toClass.name}` });
  }

  const folderPath = currentData.rootPath;
  setPageHeaderDetail(`引用代码 — ${fromClass?.name || '?'} → ${toClass.name}`);
  refDetailSearchQuery = null;
  refDetailBody.innerHTML = '<p class="ref-detail-loading">正在加载源码…</p>';
  openRefDetailModal();

  /** @type {{ ref: Object|null, site: Object, filePath: string, line: number }[]} */
  const tasks = [];

  if (!fromClass) {
    refDetailBody.innerHTML = '<p class="ref-detail-error">找不到父类信息</p>';
    return;
  }

  for (const ref of refs) {
    const sites = (ref.sites && ref.sites.length > 0)
      ? ref.sites
      : [{ line: ref.line, memberName: ref.memberName }];
    for (const site of sites) {
      tasks.push({
        ref,
        site,
        filePath: fromClass.filePath,
        line: site.line
      });
    }
  }

  if (tasks.length === 0) {
    refDetailBody.innerHTML = '<p class="ref-detail-error">未找到已解析的引用点（可能为外部类型或未收录的边）</p>';
    return;
  }

  const uniqueTasks = dedupeSnippetTasks(tasks);
  if (uniqueTasks.length < tasks.length) {
    console.log('[app] 引用代码去重', { before: tasks.length, after: uniqueTasks.length });
  }

  const groupedTasks = groupNearbySnippetTasks(uniqueTasks);
  if (groupedTasks.length < uniqueTasks.length) {
    console.log('[app] 引用代码合并邻近行', { tasks: uniqueTasks.length, groups: groupedTasks.length });
  }

  try {
    const snippets = await Promise.all(
      groupedTasks.map(async (group) => {
        const highlightLines = [...group.lines].sort((a, b) => a - b);
        const resp = await fetch('/api/snippet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            folderPath,
            filePath: group.filePath,
            line: highlightLines[0],
            contextLines: 3,
            highlightLines: highlightLines.length > 1 ? highlightLines : undefined
          })
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.error || err.detail || `HTTP ${resp.status}`);
        }

        const snippet = await resp.json();
        return { ...group, snippet, targetTypeName: toClass.name };
      })
    );

    refDetailBody.innerHTML = '';
    for (const item of snippets) {
      refDetailBody.appendChild(renderSnippetBlock(item));
    }
  } catch (err) {
    console.error('[app] 加载源码片段失败', err);
    refDetailBody.innerHTML = `<p class="ref-detail-error">${escapeHtml(
      err instanceof Error ? err.message : String(err)
    )}</p>`;
  }
}

/** 同一 file:line 只展示一块（多条引用 kind 合并元信息） */
function dedupeSnippetTasks(tasks) {
  /** @type {Map<string, Object>} */
  const byKey = new Map();

  for (const task of tasks) {
    const key = `${task.filePath}:${task.line}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...task,
        mergedKinds: task.ref ? [task.ref.kind] : [],
        sites: [{ ...task.site, line: task.line }]
      });
      continue;
    }

    if (task.ref && !existing.mergedKinds.includes(task.ref.kind)) {
      existing.mergedKinds.push(task.ref.kind);
    }

    existing.sites.push({ ...task.site, line: task.line });
    if (!existing.site.memberName && task.site.memberName) {
      existing.site.memberName = task.site.memberName;
    }
  }

  return [...byKey.values()];
}

/** 同一文件内行号接近的引用合并为一组（一个代码块窗口） */
function groupNearbySnippetTasks(tasks) {
  const sorted = [...tasks].sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line
  );

  /** @type {Object[]} */
  const groups = [];

  for (const task of sorted) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.filePath === task.filePath &&
      task.line - prev.maxLine <= SNIPPET_MERGE_LINE_GAP
    ) {
      prev.tasks.push(task);
      prev.lines.push(task.line);
      prev.maxLine = task.line;
      if (task.ref && task.mergedKinds) {
        for (const kind of task.mergedKinds) {
          if (!prev.mergedKinds.includes(kind)) {
            prev.mergedKinds.push(kind);
          }
        }
      }
      if (task.site?.memberName && !prev.memberNames.includes(task.site.memberName)) {
        prev.memberNames.push(task.site.memberName);
      }
      continue;
    }

    groups.push({
      filePath: task.filePath,
      tasks: [task],
      lines: [task.line],
      maxLine: task.line,
      ref: task.ref,
      mergedKinds: [...(task.mergedKinds || (task.ref ? [task.ref.kind] : []))],
      memberNames: task.site?.memberName ? [task.site.memberName] : []
    });
  }

  return groups;
}

/** 引用 site 去重键（同行同列同成员视为一处） */
function refSiteDedupeKey(lineNum, site) {
  const line = site?.line ?? lineNum;
  const span =
    site?.spanStart != null && site?.spanLength > 0
      ? `${site.spanStart}:${site.spanLength}`
      : 'n';
  const member = site?.memberName ?? '';
  return `${line}|${span}|${member}`;
}

/** 从 snippet 任务列表收集去重后的 site */
function collectUniqueRefSitesFromTasks(tasks) {
  /** @type {Map<string, { line: number, site: Object }>} */
  const unique = new Map();

  for (const task of tasks) {
    const siteList = task.sites?.length ? task.sites : task.site ? [task.site] : [];
    for (const site of siteList) {
      const lineNum = site.line ?? task.line;
      const key = refSiteDedupeKey(lineNum, site);
      if (!unique.has(key)) {
        unique.set(key, { line: lineNum, site });
      }
    }
  }

  return [...unique.values()];
}

/** 本代码块内引用处数（去重后，不用整条边的 ref.count） */
function snippetGroupSiteCount(item) {
  if (item.tasks?.length) {
    return collectUniqueRefSitesFromTasks(item.tasks).length;
  }
  return item.lines?.length ?? 1;
}

/** 渲染单个代码块（可含多行高亮） */
function renderSnippetBlock(item) {
  const block = document.createElement('div');
  block.className = 'ref-detail-block';

  const meta = document.createElement('div');
  meta.className = 'ref-detail-meta';

  if (item.ref) {
    const icon = document.createElement('span');
    icon.className = 'ref-icon';
    icon.innerHTML = refIconSvg(item.ref.kind);
    meta.appendChild(icon);

    const kindLabel = document.createElement('span');
    kindLabel.className = 'kind-label';
    const kinds = item.mergedKinds && item.mergedKinds.length > 1
      ? item.mergedKinds.join(', ')
      : item.ref.kind;
    kindLabel.textContent = kinds;
    meta.appendChild(kindLabel);

    if (item.memberNames && item.memberNames.length > 0) {
      const member = document.createElement('span');
      member.className = 'member-name';
      member.textContent = item.memberNames.join(', ');
      meta.appendChild(member);
    } else if (item.site?.memberName) {
      const member = document.createElement('span');
      member.className = 'member-name';
      member.textContent = item.site.memberName;
      meta.appendChild(member);
    }

    const localSiteCount = snippetGroupSiteCount(item);
    if (localSiteCount > 1) {
      const count = document.createElement('span');
      count.textContent = `${localSiteCount} 处引用`;
      meta.appendChild(count);
    }
  } else {
    const defLabel = document.createElement('span');
    defLabel.className = 'kind-label';
    defLabel.textContent = '类型定义';
    meta.appendChild(defLabel);
  }

  const fileLine = document.createElement('span');
  fileLine.className = 'file-line';
  const sortedLines = item.lines ? [...item.lines].sort((a, b) => a - b) : [item.snippet.highlightLine];
  if (sortedLines.length > 1) {
    fileLine.textContent = `${item.snippet.filePath}:${sortedLines[0]}–${sortedLines[sortedLines.length - 1]}`;
  } else {
    fileLine.textContent = `${item.snippet.filePath}:${sortedLines[0]}`;
  }
  meta.appendChild(fileLine);
  block.appendChild(meta);

  const scannedClassNames = getScannedClassNamesForHighlight();
  const scannedClassNameToId = getScannedClassNameToIdMap();
  const lineRefInfo = buildLineRefHighlightMap(item);
  /** @type {Map<number, string>} */
  const linesByNumber = new Map(item.snippet.lines.map((l) => [l.number, l.text]));
  refDetailBlockRenderCtx.set(block, {
    kind: 'snippet',
    scannedClassNames,
    scannedClassNameToId,
    linesByNumber,
    lineRefInfo,
    metaBaseText: fileLine.textContent
  });

  const pre = document.createElement('pre');
  pre.className = 'code-snippet';
  const table = document.createElement('table');

  for (const line of item.snippet.lines) {
    const tr = document.createElement('tr');
    tr.dataset.line = String(line.number);
    if (line.highlight) {
      tr.className = 'code-line-highlight';
    }

    const numTd = document.createElement('td');
    numTd.className = 'line-num';
    numTd.textContent = String(line.number);

    const textTd = document.createElement('td');
    textTd.className = 'line-text';
    const refInfo = lineRefInfo.get(line.number);
    /** @type {Set<string>} */
    const inlineTerms = new Set(refInfo?.terms ?? []);
    for (const name of scannedClassNames) {
      inlineTerms.add(name);
    }
    textTd.innerHTML = renderCodeLineWithHighlights(
      line.text,
      refInfo?.spans ?? [],
      [...inlineTerms],
      scannedClassNameToId
    );

    tr.appendChild(numTd);
    tr.appendChild(textTd);
    table.appendChild(tr);
  }

  pre.appendChild(table);
  block.appendChild(wrapCodeSnippetInShell(pre));
  return block;
}

function findClassById(classId) {
  return currentData?.classes?.find((c) => c.id === classId) ?? null;
}

/** 从当前分析结果收集已扫描类型的简单名（长名优先，配合 \\b 边界减少误匹配） */
function getScannedClassNamesForHighlight() {
  if (!currentData?.classes?.length) {
    return [];
  }

  const names = [...new Set(currentData.classes.map((c) => c.name).filter(Boolean))];
  names.sort((a, b) => b.length - a.length);
  return names;
}

/**
 * 简单名 → 类型 id（ponytail: 同名多类型取首个，与后端 bySimple 行为一致）
 * @returns {Map<string, string>}
 */
function getScannedClassNameToIdMap() {
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!currentData?.classes?.length) {
    return map;
  }

  for (const cls of currentData.classes) {
    if (cls.name && !map.has(cls.name)) {
      map.set(cls.name, cls.id);
    }
  }

  return map;
}

/** HTML 转义（错误信息展示） */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 正则字面量转义 */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 合并重叠的列范围（保留可导航 classId）
 * @param {{ start: number, end: number, classId?: string }[]} ranges
 */
function mergeColumnRanges(ranges) {
  if (!ranges.length) {
    return [];
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  /** @type {{ start: number, end: number, classId?: string }[]} */
  const merged = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
      if (cur.classId && !last.classId) {
        last.classId = cur.classId;
      }
    } else {
      merged.push({ ...cur });
    }
  }

  return merged;
}

/**
 * 在源码行中按标识符名查找候选高亮范围（无列信息时的回退）
 * @param {string} text
 * @param {string[]} terms
 * @param {Map<string, string>|null} nameToIdMap
 */
function findIdentifierRanges(text, terms, nameToIdMap = null) {
  /** @type {{ start: number, end: number, classId?: string }[]} */
  const ranges = [];

  for (const term of terms) {
    if (!term) {
      continue;
    }

    const classId = nameToIdMap?.get(term);
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, 'g');
    let match = re.exec(text);
    while (match) {
      /** @type {{ start: number, end: number, classId?: string }} */
      const range = { start: match.index, end: match.index + match[0].length };
      if (classId) {
        range.classId = classId;
      }
      ranges.push(range);
      match = re.exec(text);
    }
  }

  return ranges;
}

// #region C# 语法高亮（行级 tokenizer，ponytail: 不处理跨行字符串/注释）

/** C# 关键字集合（IDE 常见着色） */
const CS_KEYWORDS = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked',
  'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else',
  'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for',
  'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock',
  'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params',
  'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed',
  'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using',
  'var', 'virtual', 'void', 'volatile', 'while', 'async', 'await', 'record', 'init',
  'required', 'file', 'when', 'nameof', 'and', 'or', 'not', 'partial', 'where', 'yield',
  'dynamic', 'global', 'let', 'from', 'select', 'get', 'set', 'value', 'add', 'remove'
]);

/** 类型关键字（着色与 PascalCase 类型名一致） */
const CS_TYPE_KEYWORDS = new Set([
  'bool', 'byte', 'char', 'decimal', 'double', 'float', 'int', 'long', 'object', 'sbyte',
  'short', 'string', 'uint', 'ulong', 'ushort', 'void', 'dynamic'
]);

/**
 * 读取 C# 字符串字面量（含 $@"…"、$"…"、@"…"、"…"）
 * @param {string} text
 * @param {number} i 起始引号或 $ 的位置
 * @returns {{ end: number } | null}
 */
function readCSharpStringLiteral(text, i) {
  let j = i;
  if (text[j] === '$') {
    j += 1;
  }

  let verbatim = false;
  if (text[j] === '@') {
    verbatim = true;
    j += 1;
  }

  if (text[j] !== '"') {
    return null;
  }

  j += 1;
  if (verbatim) {
    while (j < text.length) {
      if (text[j] === '"') {
        if (text[j + 1] === '"') {
          j += 2;
          continue;
        }
        return { end: j + 1 };
      }
      j += 1;
    }
    return { end: text.length };
  }

  while (j < text.length) {
    if (text[j] === '\\') {
      j += 2;
      continue;
    }
    if (text[j] === '"') {
      return { end: j + 1 };
    }
    j += 1;
  }

  return { end: text.length };
}

/**
 * 读取字符字面量 'a' / '\n'
 * @param {string} text
 * @param {number} i 起始 ' 的位置
 */
function readCSharpCharLiteral(text, i) {
  let j = i + 1;
  while (j < text.length) {
    if (text[j] === '\\') {
      j += 2;
      continue;
    }
    if (text[j] === '\'') {
      return { end: j + 1 };
    }
    j += 1;
  }
  return { end: text.length };
}

/**
 * 读取数字字面量
 * @param {string} text
 * @param {number} i
 */
function readCSharpNumberLiteral(text, i) {
  let j = i;
  if (text.startsWith('0x', j) || text.startsWith('0X', j)) {
    j += 2;
    while (j < text.length && /[\da-fA-F_]/.test(text[j])) {
      j += 1;
    }
  } else if (text.startsWith('0b', j) || text.startsWith('0B', j)) {
    j += 2;
    while (j < text.length && /[01_]/.test(text[j])) {
      j += 1;
    }
  } else {
    while (j < text.length && /[\d_]/.test(text[j])) {
      j += 1;
    }
    if (text[j] === '.' && /[\d_]/.test(text[j + 1] ?? '')) {
      j += 1;
      while (j < text.length && /[\d_]/.test(text[j])) {
        j += 1;
      }
    }
    if (text[j] === 'e' || text[j] === 'E') {
      j += 1;
      if (text[j] === '+' || text[j] === '-') {
        j += 1;
      }
      while (j < text.length && /[\d_]/.test(text[j])) {
        j += 1;
      }
    }
  }

  while (j < text.length && /[uUlLmMfFdD]/.test(text[j])) {
    j += 1;
  }

  return { end: j };
}

/**
 * 对单行 C# 源码做词法切分
 * @param {string} text
 * @returns {{ start: number, end: number, cls: string }[]}
 */
function tokenizeCSharpLine(text) {
  /** @type {{ start: number, end: number, cls: string }[]} */
  const tokens = [];
  let i = 0;

  while (i < text.length) {
    const rest = text.slice(i);

    if (rest.startsWith('//')) {
      tokens.push({ start: i, end: text.length, cls: 'cs-comment' });
      break;
    }

    if (rest.startsWith('/*')) {
      const closeIdx = text.indexOf('*/', i + 2);
      const end = closeIdx === -1 ? text.length : closeIdx + 2;
      tokens.push({ start: i, end, cls: 'cs-comment' });
      i = end;
      continue;
    }

    if (text[i] === '#') {
      tokens.push({ start: i, end: text.length, cls: 'cs-preprocessor' });
      break;
    }

    if (text[i] === '$' || text[i] === '@' || text[i] === '"') {
      const str = readCSharpStringLiteral(text, i);
      if (str) {
        tokens.push({ start: i, end: str.end, cls: 'cs-string' });
        i = str.end;
        continue;
      }
    }

    if (text[i] === '\'') {
      const ch = readCSharpCharLiteral(text, i);
      tokens.push({ start: i, end: ch.end, cls: 'cs-string' });
      i = ch.end;
      continue;
    }

    if (/[\d.]/.test(text[i]) && (/\d/.test(text[i]) || /\d/.test(text[i + 1] ?? ''))) {
      const num = readCSharpNumberLiteral(text, i);
      if (num.end > i) {
        tokens.push({ start: i, end: num.end, cls: 'cs-number' });
        i = num.end;
        continue;
      }
    }

    const wordMatch = rest.match(/^[A-Za-z_][\w]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      const end = i + word.length;
      if (CS_KEYWORDS.has(word)) {
        tokens.push({
          start: i,
          end,
          cls: CS_TYPE_KEYWORDS.has(word) ? 'cs-type' : 'cs-keyword'
        });
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ start: i, end, cls: 'cs-type' });
      }
      i = end;
      continue;
    }

    i += 1;
  }

  return tokens;
}

/**
 * 按断点合并语法 token 与引用/查找范围，输出 HTML
 * @param {string} text
 * @param {{ start: number, end: number, cls: string }[]} syntaxTokens
 * @param {{ start: number, end: number, classId?: string }[]} refRanges
 * @param {{ start: number, end: number }[]} searchRanges
 */
function renderSegmentedCodeLine(text, syntaxTokens, refRanges, searchRanges = []) {
  /** @type {Set<number>} */
  const breakpoints = new Set([0, text.length]);

  for (const token of syntaxTokens) {
    breakpoints.add(token.start);
    breakpoints.add(token.end);
  }

  for (const range of refRanges) {
    breakpoints.add(Math.max(0, Math.min(range.start, text.length)));
    breakpoints.add(Math.max(0, Math.min(range.end, text.length)));
  }

  for (const range of searchRanges) {
    breakpoints.add(Math.max(0, Math.min(range.start, text.length)));
    breakpoints.add(Math.max(0, Math.min(range.end, text.length)));
  }

  const points = [...breakpoints].sort((a, b) => a - b);
  let html = '';

  for (let pi = 0; pi < points.length - 1; pi += 1) {
    const start = points[pi];
    const end = points[pi + 1];
    if (start >= end) {
      continue;
    }

    const segment = text.slice(start, end);
    const mid = start + segment.length / 2;
    const syntaxCls = syntaxTokens.find((t) => t.start <= mid && t.end > mid)?.cls ?? '';
    const matchingRefs = refRanges.filter((r) => start < r.end && end > r.start);
    const isRef = matchingRefs.length > 0;
    const classId = matchingRefs.find((r) => r.classId)?.classId;
    const isSearch = searchRanges.some((r) => start < r.end && end > r.start);

    const inner = syntaxCls
      ? `<span class="${syntaxCls}">${escapeHtml(segment)}</span>`
      : escapeHtml(segment);

    if (isRef && classId) {
      html += `<button type="button" class="code-ref-inline code-type-nav" data-class-id="${escapeHtml(
        classId
      )}" title="查看 ${escapeHtml(segment)} 源码">${inner}</button>`;
    } else if (isRef) {
      html += `<mark class="code-ref-inline">${inner}</mark>`;
    } else if (isSearch) {
      html += `<mark class="code-search-inline">${inner}</mark>`;
    } else {
      html += inner;
    }
  }

  return html;
}

// #endregion

/**
 * 渲染带语法高亮与行内引用高亮的源码行
 * @param {string} text
 * @param {{ start: number, length: number }[]} spans 0-based 列范围
 * @param {string[]} fallbackTerms 无列信息时按标识符名匹配
 * @param {Map<string, string>|null} nameToIdMap 已扫描类型简单名 → id，用于可点击导航
 * @param {string|null} searchQuery 选区触发的字面量字符串查找
 */
function renderCodeLineWithHighlights(text, spans, fallbackTerms, nameToIdMap = null, searchQuery = null) {
  /** @type {{ start: number, end: number, classId?: string }[]} */
  let refRanges = spans
    .filter((s) => s.start >= 0 && s.length > 0)
    .map((s) => {
      /** @type {{ start: number, end: number, classId?: string }} */
      const range = { start: s.start, end: s.start + s.length };
      if (nameToIdMap) {
        const classId = nameToIdMap.get(text.slice(range.start, range.end));
        if (classId) {
          range.classId = classId;
        }
      }
      return range;
    });

  if (refRanges.length === 0 && fallbackTerms.length > 0) {
    refRanges = findIdentifierRanges(text, fallbackTerms, nameToIdMap);
  }

  refRanges = mergeColumnRanges(refRanges);

  if (fallbackTerms.length > 0) {
    for (const r of findIdentifierRanges(text, fallbackTerms, nameToIdMap)) {
      const covered = refRanges.some((ex) => r.start >= ex.start && r.end <= ex.end);
      if (!covered) {
        refRanges.push(r);
      }
    }
    refRanges = mergeColumnRanges(refRanges);
  }

  const syntaxTokens = tokenizeCSharpLine(text);
  const searchRanges = searchQuery ? findSubstringRanges(text, searchQuery) : [];

  if (syntaxTokens.length === 0 && refRanges.length === 0 && searchRanges.length === 0) {
    return escapeHtml(text);
  }

  return renderSegmentedCodeLine(text, syntaxTokens, refRanges, searchRanges);
}

/**
 * 从引用任务汇总每行的列范围与回退标识符
 * @param {Object} item
 */
function buildLineRefHighlightMap(item) {
  /** @type {Map<number, { spans: { start: number, length: number }[], terms: Set<string> }>} */
  const map = new Map();

  const ensureLine = (lineNum) => {
    if (!map.has(lineNum)) {
      map.set(lineNum, { spans: [], terms: new Set() });
    }
    return map.get(lineNum);
  };

  const addSite = (lineNum, site) => {
    if (!site) {
      return;
    }

    const entry = ensureLine(lineNum);
    if (site.spanStart != null && site.spanLength > 0) {
      const spanKey = refSiteDedupeKey(lineNum, site);
      const exists = entry.spans.some(
        (s) => refSiteDedupeKey(lineNum, { spanStart: s.start, spanLength: s.length, memberName: site.memberName }) === spanKey
      );
      if (!exists) {
        entry.spans.push({ start: site.spanStart, length: site.spanLength });
      }
    }

    if (site.memberName) {
      entry.terms.add(site.memberName);
    }
  };

  const tasks = item.tasks?.length
    ? item.tasks
    : (item.line ? [{ line: item.line, site: item.site, sites: item.sites }] : []);

  for (const { line, site } of collectUniqueRefSitesFromTasks(tasks)) {
    addSite(line, site);
  }

  const highlightLines = item.lines?.length ? item.lines : [];
  if (item.targetTypeName) {
    for (const lineNum of highlightLines) {
      ensureLine(lineNum).terms.add(item.targetTypeName);
    }
  }

  return map;
}

// ponytail: 行内高亮 + 语法着色自检
(function selfCheckInlineHighlight() {
  const html = renderCodeLineWithHighlights('var x = new Human();', [{ start: 12, length: 5 }], []);
  console.assert(html.includes('code-ref-inline') && html.includes('Human'), '[selfcheck] 列范围行内高亮');
  console.assert(html.includes('cs-keyword') && html.includes('cs-type'), '[selfcheck] C# 语法着色');

  const fallback = renderCodeLineWithHighlights('helper.DoWork();', [], ['DoWork']);
  console.assert(fallback.includes('DoWork') && fallback.includes('code-ref-inline'), '[selfcheck] 标识符回退高亮');

  const commentLine = renderCodeLineWithHighlights('// TODO: fix', [], []);
  console.assert(commentLine.includes('cs-comment'), '[selfcheck] 注释着色');

  const stringLine = renderCodeLineWithHighlights('var s = "hello";', [], []);
  console.assert(stringLine.includes('cs-string'), '[selfcheck] 字符串着色');
})();

// ponytail: 源码弹窗内已扫描类型名行内高亮 + 可点击导航
(function selfCheckScannedClassHighlight() {
  const saved = currentData;
  currentData = {
    classes: [
      { id: 'Sample.Human', name: 'Human' },
      { id: 'Sample.AppRunner', name: 'AppRunner' }
    ]
  };
  const names = getScannedClassNamesForHighlight();
  const nameToId = getScannedClassNameToIdMap();
  const html = renderCodeLineWithHighlights(
    'Human h = new AppRunner();',
    [],
    names,
    nameToId
  );
  console.assert(names.length === 2, '[selfcheck] 扫描类型名收集');
  console.assert(
    (html.match(/code-type-nav/g) ?? []).length >= 2,
    '[selfcheck] 扫描类型可点击导航'
  );
  console.assert(html.includes('data-class-id="Sample.Human"'), '[selfcheck] 导航携带类型 id');
  currentData = saved;
})();

// ponytail: 卡片引用按目标类型聚合
(function selfCheckGroupOutgoingRefsByTarget() {
  const grouped = groupOutgoingRefsByTarget([
    { toId: 'A', kind: 'uses', memberName: '_x', sites: [{ line: 1 }] },
    { toId: 'A', kind: 'calls', memberName: 'Run', sites: [{ line: 2 }, { line: 3 }] },
    { toId: 'B', kind: 'uses', sites: [{ line: 4 }] }
  ]);
  console.assert(grouped.length === 2, '[selfcheck] 应按目标类型聚合为 2 类');
  const a = grouped.find((g) => g.toId === 'A');
  console.assert(a?.kinds.size === 2 && a.siteCount === 3, '[selfcheck] 同类应合并 kind 与处数');
})();

// ponytail: 代码块计数用本块 site 数，不用整条边 ref.count
(function selfCheckSnippetGroupSiteCount() {
  const oneLineOneSite = snippetGroupSiteCount({ tasks: [{ sites: [{ line: 31 }] }], lines: [31] });
  const dupSites = snippetGroupSiteCount({
    tasks: [{ sites: [{ line: 31, spanStart: 8, spanLength: 7, memberName: '_canvas' }, { line: 31, spanStart: 8, spanLength: 7, memberName: '_canvas' }] }],
    lines: [31]
  });
  const threeLines = snippetGroupSiteCount({ tasks: [{ line: 10 }, { line: 12 }], lines: [10, 12, 14] });
  console.assert(oneLineOneSite === 1, '[selfcheck] 单块单处应为 1');
  console.assert(dupSites === 1, '[selfcheck] 重复 site 应去重');
  console.assert(threeLines === 2, '[selfcheck] 无 sites 时回退 tasks 条数');
})();

// ponytail: 选区字符串查找高亮 + overview 标尺
(function selfCheckRefDetailSearchHighlight() {
  const ranges = findSubstringRanges('foo bar foo', 'foo');
  console.assert(ranges.length === 2 && ranges[0].start === 0 && ranges[1].start === 8, '[selfcheck] 字面量 indexOf 查找');

  const html = renderCodeLineWithHighlights('int count = 0;', [], [], null, 'count');
  console.assert(html.includes('code-search-inline') && html.includes('count'), '[selfcheck] 查找高亮 markup');

  const refWins = renderCodeLineWithHighlights('Human;', [], ['Human'], null, 'Hum');
  console.assert(refWins.includes('code-ref-inline') && !refWins.includes('code-search-inline'), '[selfcheck] 引用高亮优先于查找高亮');

  const pre = document.createElement('pre');
  pre.className = 'code-snippet code-snippet-full';
  pre.innerHTML =
    '<table><tr data-line="1"><td class="line-num">1</td><td class="line-text">foo</td></tr>' +
    '<tr data-line="50"><td class="line-num">50</td><td class="line-text">foo bar</td></tr></table>';
  Object.defineProperty(pre, 'scrollHeight', { value: 500, configurable: true });
  Object.defineProperty(pre, 'clientHeight', { value: 200, configurable: true });
  const shell = wrapCodeSnippetInShell(pre);
  renderCodeSnippetOverviewMarks(pre, [1, 50]);
  const marks = shell.querySelectorAll('.code-snippet-overview-mark');
  console.assert(marks.length === 2 && shell.querySelector('.code-snippet-overview-ruler.is-visible'), '[selfcheck] overview 标尺标记');
})();

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}
