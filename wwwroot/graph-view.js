/**
 * 散列节点图视图 — Cytoscape 布局 + HTML 类卡片覆盖层
 * 复用 app.js 全局：currentData / createClassCard / selectClass
 */

/** @typedef {'layers'|'graph'} MainViewMode */

/** 浏览器 localStorage：主视图类型（分层 / 节点图） */
const MAIN_VIEW_MODE_STORAGE_KEY = 'csharp_ref_analyzer_main_view_mode';

/** @type {MainViewMode} */
let mainViewMode = 'layers';

/** @type {boolean} 分析结果变更后需重建图 */
let graphDirty = true;

/** @type {import('cytoscape').Core|null} */
let graphCy = null;

/** @type {Map<string, HTMLElement>} classId → 覆盖层卡片 */
const graphCardById = new Map();

/** 卡片拖拽判定阈值（px） */
const GRAPH_CARD_DRAG_THRESHOLD = 5;

/** 层级布局间距 */
const GRAPH_LAYER_X_GAP = 48;
const GRAPH_LAYER_Y_GAP = 80;
/** 层内簇与簇之间的额外间距 */
const GRAPH_CLUSTER_GAP = 112;

/** 引用边颜色（与 app.js refIconSvg 一致） */
const GRAPH_REF_EDGE_COLORS = {
  calls: '#58a6ff',
  extends: '#ffa657',
  implements: '#d2a8ff',
  uses: '#8b9cb3'
};

const layersContainerEl = document.getElementById('layersContainer');
const graphContainer = document.getElementById('graphContainer');
const graphCyRoot = document.getElementById('graphCyRoot');
const graphCardLayer = document.getElementById('graphCardLayer');
const graphRelayoutBtn = document.getElementById('graphRelayoutBtn');
const mainViewTitle = document.getElementById('mainViewTitle');
const layersPanel = document.querySelector('.layers-panel');
const layersSearchRow = document.querySelector('.layers-search-row');
const layersSearchStatusEl = document.getElementById('layersSearchStatus');

/** 将主视图类型写入 localStorage */
function saveMainViewModeToStorage(mode) {
  try {
    localStorage.setItem(MAIN_VIEW_MODE_STORAGE_KEY, mode);
    console.log('[graph-view] 已保存主视图类型到 localStorage', mode);
  } catch (err) {
    console.warn('[graph-view] 保存主视图类型失败', err);
  }
}

/** 读取 localStorage 中保存的主视图类型 */
function readSavedMainViewMode() {
  try {
    const value = localStorage.getItem(MAIN_VIEW_MODE_STORAGE_KEY);
    if (value === 'layers' || value === 'graph') {
      return /** @type {MainViewMode} */ (value);
    }
  } catch (err) {
    console.warn('[graph-view] 读取主视图类型失败', err);
  }
  return null;
}

/** 标记图视图需重建（分析完成后由 app.js 调用） */
function markGraphViewDirty() {
  console.log('[graph-view] 标记图视图脏，下次切到节点图时重建');
  graphDirty = true;
  if (mainViewMode === 'graph') {
    buildGraphView();
  }
}

/** 当前主视图模式（供 app.js 在分析流程中查询） */
function getMainViewMode() {
  return mainViewMode;
}

/** 节点图区域占位文案（分析中 / 无数据） */
function setGraphViewPlaceholder(message) {
  if (!graphCardLayer) {
    return;
  }
  graphCardLayer.innerHTML = `<p class="placeholder graph-placeholder">${message}</p>`;
  console.log('[graph-view] 设置节点图占位', message);
}

/** 初始化视图切换与图工具栏 */
function initGraphView() {
  console.log('[graph-view] 初始化节点图视图');

  const savedMode = readSavedMainViewMode();
  if (savedMode) {
    console.log('[graph-view] 恢复主视图类型', savedMode);
    setMainViewMode(savedMode);
  }

  document.querySelectorAll('.view-toggle-btn[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = /** @type {MainViewMode} */ (btn.getAttribute('data-view'));
      if (mode && mode !== mainViewMode) {
        setMainViewMode(mode);
      }
    });
  });

  graphRelayoutBtn?.addEventListener('click', () => {
    console.log('[graph-view] 用户触发重新布局');
    relayoutGraphView();
  });

  initGraphCardDragHandlers();
  initGraphCardWheelForward();
  initGraphRightPanHandlers();
  initGraphEdgeHoverNav();
  initGraphCardHoverNav();

  window.addEventListener('resize', () => {
    if (mainViewMode === 'graph' && graphCy) {
      graphCy.resize();
      graphCy.fit(undefined, 48);
      syncGraphCardPositions();
    }
  });
}

/** @param {MainViewMode} mode */
function setMainViewMode(mode) {
  mainViewMode = mode;
  saveMainViewModeToStorage(mode);
  console.log('[graph-view] 切换主视图:', mode);

  document.querySelectorAll('.view-toggle-btn[data-view]').forEach((btn) => {
    const active = btn.getAttribute('data-view') === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const isGraph = mode === 'graph';
  layersContainerEl?.classList.toggle('hidden', isGraph);
  graphContainer.classList.toggle('hidden', !isGraph);
  layersPanel?.classList.toggle('layers-panel-graph-mode', isGraph);
  layersSearchRow?.classList.toggle('hidden', isGraph);
  if (isGraph) {
    layersSearchStatusEl?.classList.add('hidden');
  }

  if (mainViewTitle) {
    mainViewTitle.textContent = isGraph ? '引用图' : '调用层级';
  }

  if (isGraph) {
    if (graphDirty || !graphCy) {
      buildGraphView();
    } else {
      graphCy.resize();
      graphCy.fit(undefined, 48);
      syncGraphCardPositions();
    }
  }
}

/** 销毁现有 Cytoscape 实例与覆盖层 */
function destroyGraphView() {
  graphCardById.clear();
  if (graphCardLayer) {
    graphCardLayer.innerHTML = '';
  }
  if (graphCy) {
    graphCy.destroy();
    graphCy = null;
  }
}

/**
 * 合并引用边：同一 from/to/kind 只保留一条
 * @param {Object[]} references
 */
function mergeGraphReferences(references) {
  /** @type {Map<string, { fromId: string, toId: string, kind: string }>} */
  const seen = new Map();
  for (const ref of references) {
    const key = `${ref.fromId}|${ref.toId}|${ref.kind}`;
    if (!seen.has(key)) {
      seen.set(key, { fromId: ref.fromId, toId: ref.toId, kind: ref.kind });
    }
  }
  return [...seen.values()];
}

/** Cytoscape 样式表 */
function buildGraphStylesheet() {
  return [
    {
      selector: 'node',
      style: {
        width: 'data(w)',
        height: 'data(h)',
        shape: 'rectangle',
        'background-opacity': 0,
        'border-opacity': 0,
        label: ''
      }
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        opacity: 0.85
      }
    },
    {
      selector: 'edge[kind = "implements"]',
      style: {
        'line-style': 'dashed'
      }
    },
    {
      selector: 'edge.graph-edge-dim',
      style: {
        opacity: 0.14
      }
    },
    {
      selector: 'edge.graph-edge-highlight-out',
      style: {
        width: 3.5,
        opacity: 1,
        'z-index': 10,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)'
      }
    },
    {
      selector: 'edge.graph-edge-highlight-in',
      style: {
        width: 3.5,
        opacity: 1,
        'z-index': 10,
        'line-color': '#ffa657',
        'target-arrow-color': '#ffa657'
      }
    },
    {
      selector: 'edge.graph-edge-hover',
      style: {
        width: 4.5,
        opacity: 1,
        'z-index': 20,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)'
      }
    },
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0
      }
    }
  ];
}

/** 测量卡片尺寸并写回 Cytoscape 节点 */
function applyGraphNodeDimensions() {
  if (!graphCy) {
    return;
  }

  graphCy.batch(() => {
    for (const node of graphCy.nodes()) {
      const card = graphCardById.get(node.id());
      if (!card) {
        continue;
      }
      const rect = card.getBoundingClientRect();
      const w = Math.max(Math.ceil(rect.width), 200);
      const h = Math.max(Math.ceil(rect.height), 72);
      node.data('w', w);
      node.data('h', h);
    }
  });
  console.log('[graph-view] 已应用节点尺寸，数量:', graphCy.nodes().length);
}

/** @param {string} classId @param {import('cytoscape').NodeSingular|null} cyNode */
function getGraphNodeSize(classId, cyNode) {
  if (cyNode && !cyNode.empty()) {
    return {
      w: cyNode.data('w') || 200,
      h: cyNode.data('h') || 72
    };
  }
  return { w: 200, h: 72 };
}

/**
 * 构建无向邻接表（用于层内连通簇合并）
 * @param {Object[]} references
 * @returns {Map<string, Set<string>>}
 */
function buildGraphAdjacency(references) {
  /** @type {Map<string, Set<string>>} */
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) {
      adj.set(a, new Set());
    }
    if (!adj.has(b)) {
      adj.set(b, new Set());
    }
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const ref of references) {
    link(ref.fromId, ref.toId);
  }
  return adj;
}

/**
 * 层内并查集
 * @param {string[]} classIds
 */
function createGraphUnionFind(classIds) {
  /** @type {Map<string, string>} */
  const parent = new Map(classIds.map((id) => [id, id]));
  const find = (x) => {
    let root = parent.get(x) ?? x;
    while (root !== (parent.get(root) ?? root)) {
      root = parent.get(root) ?? root;
    }
    let cursor = x;
    while (cursor !== root) {
      const next = parent.get(cursor) ?? cursor;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const unite = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(rb, ra);
    }
  };
  return { find, unite };
}

/**
 * 将一层节点按引用关系聚簇：同父节点子节点一簇、层内互引合并、簇间留空
 * @param {string[]} classIds
 * @param {number} level
 * @param {Map<string, number>} classLayerMap
 * @param {Object[]} references
 * @param {Map<string, Set<string>>} adjacency
 * @param {Map<string, number>} placedX 已布局节点的 x（用于簇排序）
 * @returns {string[][]} 从左到右的簇列表，每簇为 classId 数组
 */
function clusterGraphLayerNodes(classIds, level, classLayerMap, references, adjacency, placedX) {
  if (classIds.length <= 1) {
    return classIds.length ? [classIds] : [];
  }

  const layerSet = new Set(classIds);
  const { find, unite } = createGraphUnionFind(classIds);

  // 层内直接相连的节点合并
  for (const id of classIds) {
    for (const nb of adjacency.get(id) || []) {
      if (layerSet.has(nb)) {
        unite(id, nb);
      }
    }
  }

  // 被同一上层类型引用的节点合并（兄弟簇）
  if (level > 0) {
    /** @type {Map<string, Set<string>>} */
    const siblingsByParent = new Map();
    for (const id of classIds) {
      for (const ref of references) {
        if (ref.toId !== id) {
          continue;
        }
        const parentLevel = classLayerMap.get(ref.fromId);
        if (parentLevel !== level - 1) {
          continue;
        }
        if (!siblingsByParent.has(ref.fromId)) {
          siblingsByParent.set(ref.fromId, new Set());
        }
        siblingsByParent.get(ref.fromId).add(id);
      }
    }
    for (const siblings of siblingsByParent.values()) {
      const list = [...siblings];
      for (let i = 1; i < list.length; i += 1) {
        unite(list[0], list[i]);
      }
    }
  }

  /** @type {Map<string, string[]>} */
  const clusterMap = new Map();
  for (const id of classIds) {
    const root = find(id);
    if (!clusterMap.has(root)) {
      clusterMap.set(root, []);
    }
    clusterMap.get(root).push(id);
  }

  const clusters = [...clusterMap.values()].map((ids) => {
    ids.sort((a, b) => a.localeCompare(b));
    let barySum = 0;
    let baryCount = 0;
    for (const id of ids) {
      for (const ref of references) {
        if (ref.toId !== id) {
          continue;
        }
        const px = placedX.get(ref.fromId);
        if (px != null) {
          barySum += px;
          baryCount += 1;
        }
      }
    }
    const barycenter = baryCount > 0 ? barySum / baryCount : Number.MAX_SAFE_INTEGER;
    const label = ids[0] ?? '';
    return { ids, barycenter, label };
  });

  clusters.sort((a, b) => {
    if (a.barycenter !== b.barycenter) {
      return a.barycenter - b.barycenter;
    }
    return a.label.localeCompare(b.label);
  });

  console.log('[graph-view] 第', level, '层聚簇', clusters.length, '簇 /', classIds.length, '节点');
  return clusters.map((c) => c.ids);
}

/**
 * 按 currentData.layers 分层摆放；层内相关节点聚簇，簇间加大间距
 * 复用 app.js buildClassLayerMap；未出现在 layers 中的类型放到最底层
 */
function applyGraphLayeredLayout() {
  if (!graphCy || !currentData?.layers?.length) {
    return;
  }

  const classLayerMap = buildClassLayerMap(currentData.layers);
  let maxKnownLevel = 0;
  for (const layer of currentData.layers) {
    maxKnownLevel = Math.max(maxKnownLevel, layer.level);
  }
  const orphanLevel = maxKnownLevel + 1;

  /** @type {Map<number, string[]>} */
  const idsByLevel = new Map();
  for (const layer of currentData.layers) {
    idsByLevel.set(layer.level, [...layer.classIds]);
  }

  for (const node of graphCy.nodes()) {
    const id = node.id();
    if (classLayerMap.has(id)) {
      continue;
    }
    if (!idsByLevel.has(orphanLevel)) {
      idsByLevel.set(orphanLevel, []);
    }
    idsByLevel.get(orphanLevel).push(id);
    console.log('[graph-view] 未分层类型归入底层:', id);
  }

  const sortedLevels = [...idsByLevel.keys()].sort((a, b) => a - b);
  const adjacency = buildGraphAdjacency(currentData.references);
  /** @type {Map<string, number>} 已放置节点的中心 x，供下一层簇排序 */
  const placedX = new Map();
  let rowTopY = 0;

  graphCy.batch(() => {
    for (const level of sortedLevels) {
      const classIds = idsByLevel.get(level) || [];
      const clusters = clusterGraphLayerNodes(
        classIds,
        level,
        classLayerMap,
        currentData.references,
        adjacency,
        placedX
      );

      /** @type {{ id: string, w: number, h: number }[][]} */
      const clusterNodes = clusters.map((clusterIds) => {
        /** @type {{ id: string, w: number, h: number }[]} */
        const items = [];
        for (const classId of clusterIds) {
          const cyNode = graphCy.getElementById(classId);
          if (!cyNode || cyNode.empty()) {
            continue;
          }
          const { w, h } = getGraphNodeSize(classId, cyNode);
          items.push({ id: classId, w, h });
        }
        return items;
      }).filter((items) => items.length > 0);

      if (!clusterNodes.length) {
        continue;
      }

      const rowMaxH = Math.max(...clusterNodes.flat().map((n) => n.h));
      let rowTotalW = 0;
      for (let ci = 0; ci < clusterNodes.length; ci += 1) {
        const cluster = clusterNodes[ci];
        rowTotalW += cluster.reduce((sum, n) => sum + n.w, 0);
        rowTotalW += GRAPH_LAYER_X_GAP * Math.max(0, cluster.length - 1);
        if (ci < clusterNodes.length - 1) {
          rowTotalW += GRAPH_CLUSTER_GAP;
        }
      }

      let cursorX = -rowTotalW / 2;
      const centerY = rowTopY + rowMaxH / 2;

      for (let ci = 0; ci < clusterNodes.length; ci += 1) {
        const cluster = clusterNodes[ci];
        for (const item of cluster) {
          const centerX = cursorX + item.w / 2;
          nodePosition(item.id, centerX, centerY);
          placedX.set(item.id, centerX);
          cursorX += item.w + GRAPH_LAYER_X_GAP;
        }
        if (ci < clusterNodes.length - 1) {
          cursorX += GRAPH_CLUSTER_GAP;
        }
      }

      rowTopY += rowMaxH + GRAPH_LAYER_Y_GAP;
      console.log('[graph-view] 第', level, '层布局完成, y=', centerY);
    }
  });

  /**
   * @param {string} nodeId
   * @param {number} x
   * @param {number} y
   */
  function nodePosition(nodeId, x, y) {
    graphCy.getElementById(nodeId).position({ x, y });
  }
}

/** 同步 HTML 卡片与 Cytoscape 节点屏幕坐标 */
function syncGraphCardPositions() {
  if (!graphCy || !graphCardLayer) {
    return;
  }

  const zoom = graphCy.zoom();
  for (const node of graphCy.nodes()) {
    const card = graphCardById.get(node.id());
    if (!card) {
      continue;
    }
    const pos = node.renderedPosition();
    const modelW = node.data('w') || 200;
    const modelH = node.data('h') || 72;
    const screenW = modelW * zoom;
    const screenH = modelH * zoom;
    card.style.width = `${modelW}px`;
    card.style.transform = `translate(${pos.x - screenW / 2}px, ${pos.y - screenH / 2}px) scale(${zoom})`;
  }
}

/** 绑定 Cytoscape 事件：平移/缩放/拖拽时同步卡片 */
function bindGraphCyEvents() {
  if (!graphCy) {
    return;
  }

  const sync = () => syncGraphCardPositions();
  graphCy.on('render pan zoom drag position', sync);

  graphCy.on('tap', (evt) => {
    if (evt.target !== graphCy) {
      return;
    }
    if (mainViewMode !== 'graph' || !selectedClassId) {
      return;
    }
    console.log('[graph-view] 点击画布空白，取消选中');
    clearTreePanel();
  });

  graphCy.on('tap', 'edge', (evt) => {
    if (mainViewMode !== 'graph' || !selectedClassId) {
      return;
    }
    const edge = evt.target;
    focusGraphEdgeInSummary(
      edge.source().id(),
      edge.target().id(),
      edge.data('kind') || undefined
    );
  });
}

/**
 * 选中类型时高亮与之直接相连的引用边，其余边淡化
 * @param {string|null} classId
 */
function syncGraphEdgeHighlight(classId) {
  if (!graphCy) {
    return;
  }

  graphEdgeFocusKey = null;
  graphEdgeHoverKey = null;
  clearSummaryNavHighlights();
  clearGraphCardNavHighlights();
  applyGraphEdgeSelectionHighlight(classId);
}

/** 仅更新 Cytoscape 边的高亮/淡化（不碰概要点击固定态） */
function applyGraphEdgeSelectionHighlight(classId) {
  if (!graphCy) {
    return;
  }

  graphCy.batch(() => {
    const edges = graphCy.edges();
    edges.removeClass('graph-edge-highlight-out graph-edge-highlight-in graph-edge-dim graph-edge-hover');

    if (!classId) {
      return;
    }

    let outCount = 0;
    let inCount = 0;
    for (const edge of edges) {
      const sourceId = edge.source().id();
      const targetId = edge.target().id();
      if (sourceId === classId) {
        edge.addClass('graph-edge-highlight-out');
        outCount += 1;
      } else if (targetId === classId) {
        edge.addClass('graph-edge-highlight-in');
        inCount += 1;
      } else {
        edge.addClass('graph-edge-dim');
      }
    }
    console.log('[graph-view] 直接引用边高亮', outCount, '出', inCount, '入, 选中:', classId);
  });
}

/** @type {string|null} 当前悬停高亮的边键 from|to|kind */
let graphEdgeHoverKey = null;

/** @type {string|null} 点击箭头后固定在概要中的边键 from|to|kind（不改变图视图） */
let graphEdgeFocusKey = null;

/** 清除侧栏概要条目上的悬停/点击高亮 */
function clearSummaryNavHighlights() {
  treeContainer?.querySelectorAll('.graph-nav-hover, .graph-nav-focus').forEach((el) => {
    el.classList.remove('graph-nav-hover', 'graph-nav-focus');
  });
}

/** 清除图节点卡片上的悬停联动高亮 */
function clearGraphCardNavHighlights() {
  for (const card of graphCardById.values()) {
    card.classList.remove('graph-nav-hover', 'graph-nav-focus');
  }
}

/** 清除侧栏 + 图卡片联动高亮（悬停用） */
function clearGraphNavPeerHighlights() {
  clearSummaryNavHighlights();
  clearGraphCardNavHighlights();
}

/**
 * 收集 from→to 引用边上的成员名
 * @param {string} fromId
 * @param {string} toId
 * @returns {Set<string>}
 */
function collectMemberNamesForEdge(fromId, toId) {
  /** @type {Set<string>} */
  const memberNames = new Set();
  if (!fromId || !toId || !currentData?.references) {
    return memberNames;
  }
  for (const ref of currentData.references) {
    if (ref.fromId !== fromId || ref.toId !== toId) {
      continue;
    }
    if (ref.memberName) {
      memberNames.add(ref.memberName);
    }
    ref.sites?.forEach((site) => {
      if (site.memberName) {
        memberNames.add(site.memberName);
      }
    });
  }
  return memberNames;
}

/**
 * 仅在右栏概要中高亮与引用边对应的条目（不动图视图）
 * @param {string} fromId
 * @param {string} toId
 * @param {string} [kind]
 */
function applySummaryEdgeFocus(fromId, toId, kind) {
  clearSummaryNavHighlights();

  const memberNames = collectMemberNamesForEdge(fromId, toId);

  treeContainer?.querySelectorAll('[data-graph-edge-from], [data-graph-edge-mode="incoming-member"]').forEach((el) => {
    const matchDirect = el.dataset.graphEdgeFrom === fromId
      && el.dataset.graphEdgeTo === toId
      && (!kind || el.dataset.graphEdgeKind === kind);
    const matchIncomingMember = el.dataset.graphEdgeMode === 'incoming-member'
      && el.dataset.graphEdgeTo === toId
      && (memberNames.size === 0 || memberNames.has(el.dataset.graphEdgeMember));
    if (matchDirect || matchIncomingMember) {
      el.classList.add('graph-nav-focus');
    }
  });

  if (typeof highlightTreeClassEntries === 'function') {
    if (selectedClassId === toId) {
      highlightTreeClassEntries(fromId);
    } else if (selectedClassId === fromId) {
      highlightTreeClassEntries(toId);
    }
  }

  scrollGraphEdgeSummaryEntry(fromId, toId);
}

/** 恢复点击固定的概要条目高亮 */
function restoreGraphEdgeFocusVisuals() {
  if (!graphEdgeFocusKey) {
    return;
  }
  const parts = graphEdgeFocusKey.split('|');
  applySummaryEdgeFocus(parts[0], parts[1], parts[2] === '*' ? undefined : parts[2]);
}

/**
 * 点击图中箭头：在当前类概要中高亮对应条目（不切换选中类、不改变图高亮）
 * @param {string} fromId
 * @param {string} toId
 * @param {string} [kind]
 */
function focusGraphEdgeInSummary(fromId, toId, kind) {
  if (!graphCy || mainViewMode !== 'graph' || !selectedClassId) {
    return;
  }

  graphEdgeFocusKey = `${fromId}|${toId}|${kind || '*'}`;
  console.log('[graph-view] 点击引用边，概要聚焦（图视图不变）', fromId, '→', toId, kind || '');
  applySummaryEdgeFocus(fromId, toId, kind);
}

/** 滚动到概要中与引用边最匹配的条目 */
function scrollGraphEdgeSummaryEntry(fromId, toId) {
  /** @type {string[]} */
  const selectors = [
    `[data-graph-edge-from="${fromId}"][data-graph-edge-to="${toId}"]`,
    `[data-graph-edge-mode="incoming-member"][data-graph-edge-to="${toId}"]`
  ];
  if (selectedClassId === toId) {
    selectors.push(`#summaryReferrers .tree-node[data-class-id="${fromId}"] > .tree-node-inner`);
  }
  if (selectedClassId === fromId) {
    selectors.push(`#summaryCallTree .tree-node[data-class-id="${toId}"] > .tree-node-inner`);
  }

  for (const selector of selectors) {
    const el = treeContainer?.querySelector(selector);
    if (!el) {
      continue;
    }
    el.closest('details')?.setAttribute('open', '');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    console.log('[graph-view] 概要滚动到条目', selector);
    return;
  }
}

/**
 * 悬停引用边时，同步高亮侧栏 IO/成员条目与图节点卡片
 * @param {string|null} fromId
 * @param {string} toId
 * @param {string|null|undefined} memberName
 * @param {string[]|undefined} extraFromIds
 */
function syncGraphNavPeerHighlights(fromId, toId, memberName, extraFromIds) {
  clearSummaryNavHighlights();
  clearGraphCardNavHighlights();

  /** @type {Set<string>} */
  const fromIds = new Set(extraFromIds || []);
  if (fromId) {
    fromIds.add(fromId);
  }

  /** @type {Set<string>} */
  const memberNames = memberName ? new Set([memberName]) : collectMemberNamesForEdge(fromId, toId);
  if (memberName && fromId && toId) {
    for (const name of collectMemberNamesForEdge(fromId, toId)) {
      memberNames.add(name);
    }
  }

  treeContainer?.querySelectorAll('[data-graph-edge-from], [data-graph-edge-mode="incoming-member"]').forEach((el) => {
    const matchDirect = el.dataset.graphEdgeFrom === fromId && el.dataset.graphEdgeTo === toId;
    const matchIncomingMember = el.dataset.graphEdgeMode === 'incoming-member'
      && el.dataset.graphEdgeTo === toId
      && (memberNames.size === 0 || memberNames.has(el.dataset.graphEdgeMember));
    if (matchDirect || matchIncomingMember) {
      el.classList.add('graph-nav-hover');
    }
  });

  for (const [classId, card] of graphCardById) {
    if (classId !== selectedClassId && (fromIds.has(classId) || classId === toId)) {
      card.classList.add('graph-nav-hover');
    }
  }
}

/**
 * 侧栏条目悬停：高亮对应引用边
 * @param {string} fromId
 * @param {string} toId
 * @param {string} [kind]
 */
function syncGraphEdgeHover(fromId, toId, kind) {
  if (!graphCy || mainViewMode !== 'graph') {
    return;
  }

  const hoverKey = `${fromId}|${toId}|${kind || '*'}`;
  if (graphEdgeHoverKey === hoverKey) {
    return;
  }
  graphEdgeHoverKey = hoverKey;

  graphCy.batch(() => {
    let matched = 0;
    for (const edge of graphCy.edges()) {
      edge.removeClass('graph-edge-hover graph-edge-highlight-out graph-edge-highlight-in graph-edge-dim');
      const sourceId = edge.source().id();
      const targetId = edge.target().id();
      const edgeKind = edge.data('kind');
      const isMatch = sourceId === fromId && targetId === toId && (!kind || edgeKind === kind);
      if (isMatch) {
        edge.addClass('graph-edge-hover');
        matched += 1;
      } else {
        edge.addClass('graph-edge-dim');
      }
    }
    console.log('[graph-view] 悬停高亮边', matched, '条', fromId, '→', toId, kind || '');
  });

  syncGraphNavPeerHighlights(fromId, toId);
}

/**
 * IO 端口等：悬停高亮所有引用方 → 当前类的入边（按成员名）
 * @param {string} targetClassId
 * @param {string} memberName
 */
function syncGraphIncomingMemberHover(targetClassId, memberName) {
  if (!graphCy || !currentData || mainViewMode !== 'graph') {
    return;
  }

  const hoverKey = `incoming-member|${targetClassId}|${memberName}`;
  if (graphEdgeHoverKey === hoverKey) {
    return;
  }
  graphEdgeHoverKey = hoverKey;

  /** @type {string[]} */
  const matchingFromIds = [];
  graphCy.batch(() => {
    let matched = 0;
    for (const edge of graphCy.edges()) {
      edge.removeClass('graph-edge-hover graph-edge-highlight-out graph-edge-highlight-in graph-edge-dim');
      const sourceId = edge.source().id();
      const targetId = edge.target().id();
      if (targetId !== targetClassId) {
        edge.addClass('graph-edge-dim');
        continue;
      }

      const refs = currentData.references.filter(
        (r) => r.fromId === sourceId && r.toId === targetClassId
      );
      const usesMember = typeof refUsesMember === 'function'
        && refs.some((r) => refUsesMember(r, memberName));

      if (usesMember) {
        edge.addClass('graph-edge-hover');
        matchingFromIds.push(sourceId);
        matched += 1;
      } else {
        edge.addClass('graph-edge-dim');
      }
    }
    console.log('[graph-view] 悬停入边成员', memberName, matched, '条 →', targetClassId);
  });

  syncGraphNavPeerHighlights(null, targetClassId, memberName, matchingFromIds);
}

/** 侧栏条目移出：恢复图选中态高亮（概要点击固定态保留） */
function clearGraphEdgeHover() {
  if (!graphEdgeHoverKey || graphEdgeHoverKey === graphEdgeFocusKey) {
    return;
  }
  graphEdgeHoverKey = null;
  treeContainer?.querySelectorAll('.graph-nav-hover').forEach((el) => {
    el.classList.remove('graph-nav-hover');
  });
  clearGraphCardNavHighlights();
  applyGraphEdgeSelectionHighlight(selectedClassId);
  if (graphEdgeFocusKey) {
    restoreGraphEdgeFocusVisuals();
  }
}

/** 根据侧栏导航条目触发图悬停高亮 */
function applyGraphEdgeHoverNav(el) {
  if (el.dataset.graphEdgeMode === 'incoming-member') {
    syncGraphIncomingMemberHover(el.dataset.graphEdgeTo, el.dataset.graphEdgeMember);
    return;
  }
  syncGraphEdgeHover(
    el.dataset.graphEdgeFrom,
    el.dataset.graphEdgeTo,
    el.dataset.graphEdgeKind || undefined
  );
}

/** 右栏可导航条目悬停 → 高亮图中对应箭头 */
function initGraphEdgeHoverNav() {
  if (initGraphEdgeHoverNav.initialized || !treeContainer) {
    return;
  }
  initGraphEdgeHoverNav.initialized = true;

  treeContainer.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-graph-edge-from][data-graph-edge-to], [data-graph-edge-mode="incoming-member"]');
    if (!el) {
      return;
    }
    applyGraphEdgeHoverNav(el);
  });

  treeContainer.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-graph-edge-from][data-graph-edge-to], [data-graph-edge-mode="incoming-member"]');
    if (!el) {
      return;
    }
    const related = e.relatedTarget;
    if (related instanceof Node && el.contains(related)) {
      return;
    }
    clearGraphEdgeHover();
  });
}
initGraphEdgeHoverNav.initialized = false;

/** 图节点卡片悬停 → 高亮入/出边及侧栏 IO 端口 */
function initGraphCardHoverNav() {
  if (initGraphCardHoverNav.initialized || !graphCardLayer) {
    return;
  }
  initGraphCardHoverNav.initialized = true;

  graphCardLayer.addEventListener('mouseover', (e) => {
    if (mainViewMode !== 'graph' || !selectedClassId) {
      return;
    }
    const card = e.target.closest('.graph-node-card');
    if (!card) {
      return;
    }
    const cardId = card.dataset.classId;
    if (!cardId || cardId === selectedClassId) {
      return;
    }

    if (card.classList.contains('direct-ref-incoming-highlight')) {
      console.log('[graph-view] 悬停上级引用方卡片', cardId);
      syncGraphEdgeHover(cardId, selectedClassId);
    } else if (card.classList.contains('direct-ref-highlight')) {
      console.log('[graph-view] 悬停下级引用卡片', cardId);
      syncGraphEdgeHover(selectedClassId, cardId);
    }
  });

  graphCardLayer.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.graph-node-card');
    if (!card) {
      return;
    }
    const related = e.relatedTarget;
    if (related instanceof Node && card.contains(related)) {
      return;
    }
    clearGraphEdgeHover();
  });
}
initGraphCardHoverNav.initialized = false;

/** @type {{ card: HTMLElement, classId: string, startX: number, startY: number, nodeX: number, nodeY: number, moved: boolean }|null} */
let graphCardDragState = null;

/** 全局卡片拖拽移动/释放（ponytail: 单 handler，避免每卡片重复绑定） */
function initGraphCardDragHandlers() {
  if (initGraphCardDragHandlers.initialized) {
    return;
  }
  initGraphCardDragHandlers.initialized = true;

  window.addEventListener('mousemove', (e) => {
    if (!graphCardDragState || !graphCy) {
      return;
    }
    const dx = e.clientX - graphCardDragState.startX;
    const dy = e.clientY - graphCardDragState.startY;
    if (!graphCardDragState.moved && Math.hypot(dx, dy) < GRAPH_CARD_DRAG_THRESHOLD) {
      return;
    }
    graphCardDragState.moved = true;
    const zoom = graphCy.zoom();
    graphCy.getElementById(graphCardDragState.classId).position({
      x: graphCardDragState.nodeX + dx / zoom,
      y: graphCardDragState.nodeY + dy / zoom
    });
  });

  window.addEventListener('mouseup', () => {
    if (!graphCardDragState) {
      return;
    }
    const { card, moved } = graphCardDragState;
    if (moved) {
      card.dataset.suppressClick = '1';
      window.setTimeout(() => {
        delete card.dataset.suppressClick;
      }, 0);
    }
    card.classList.remove('graph-card-dragging');
    graphCardDragState = null;
  });
}
initGraphCardDragHandlers.initialized = false;

/**
 * 图视图滚轮统一转发为画布缩放（空白区、卡片、Cy 画布均覆盖；卡片层会挡住 Cytoscape 原生 wheel）
 */
function initGraphCardWheelForward() {
  if (initGraphCardWheelForward.initialized || !graphContainer) {
    return;
  }
  initGraphCardWheelForward.initialized = true;

  graphContainer.addEventListener('wheel', (e) => {
    if (!graphCy || mainViewMode !== 'graph') {
      return;
    }
    if (e.target instanceof Element && e.target.closest('.graph-toolbar')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    console.log('[graph-view] 滚轮缩放画布', { deltaY: e.deltaY });
    forwardGraphCardWheel(e);
  }, { passive: false, capture: true });
}
initGraphCardWheelForward.initialized = false;

/** @type {{ startX: number, startY: number, panX: number, panY: number, moved: boolean }|null} */
let graphPanState = null;

/** 右键拖动画布平移；卡片上右键只平移、不触发选中/菜单（ponytail: 与滚轮转发同一模式） */
function initGraphRightPanHandlers() {
  if (initGraphRightPanHandlers.initialized) {
    return;
  }
  initGraphRightPanHandlers.initialized = true;

  /** @param {MouseEvent} e */
  const onPanStart = (e) => {
    if (e.button !== 2 || !graphCy || mainViewMode !== 'graph') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const pan = graphCy.pan();
    graphPanState = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false
    };
    document.body.classList.add('graph-panning');
    console.log('[graph-view] 右键开始平移画布');
  };

  /** 捕获阶段拦截卡片上的右键，避免冒泡到卡片 click/菜单 */
  graphCyRoot?.addEventListener('mousedown', onPanStart, true);
  graphCardLayer?.addEventListener('mousedown', onPanStart, true);

  graphContainer?.addEventListener('contextmenu', (e) => {
    if (mainViewMode !== 'graph') {
      return;
    }
    e.preventDefault();
  }, true);

  window.addEventListener('mousemove', (e) => {
    if (!graphPanState || !graphCy) {
      return;
    }
    if (!(e.buttons & 2)) {
      document.body.classList.remove('graph-panning');
      graphPanState = null;
      return;
    }
    const dx = e.clientX - graphPanState.startX;
    const dy = e.clientY - graphPanState.startY;
    if (!graphPanState.moved && Math.hypot(dx, dy) < GRAPH_CARD_DRAG_THRESHOLD) {
      return;
    }
    graphPanState.moved = true;
    graphCy.pan({
      x: graphPanState.panX + dx,
      y: graphPanState.panY + dy
    });
  });

  window.addEventListener('mouseup', () => {
    if (!graphPanState) {
      return;
    }
    document.body.classList.remove('graph-panning');
    graphPanState = null;
  });
}
initGraphRightPanHandlers.initialized = false;

/**
 * 卡片滚轮缩放：公式与 Cytoscape 内置 wheel 处理一致
 * @param {WheelEvent} e
 */
function forwardGraphCardWheel(e) {
  if (!graphCy || !graphCyRoot) {
    return;
  }
  const rect = graphCyRoot.getBoundingClientRect();
  const renderedX = e.clientX - rect.left;
  const renderedY = e.clientY - rect.top;
  const sensitivity = graphCy.options().wheelSensitivity ?? 0.2;

  // 与 cytoscape.min.js 内置 wheel 处理相同
  let s = e.deltaY != null
    ? e.deltaY / -250
    : e.wheelDeltaY != null
      ? e.wheelDeltaY / 1000
      : /** @type {WheelEvent & { wheelDelta?: number }} */ (e).wheelDelta / 1000;
  s *= sensitivity;
  if (e.deltaMode === 1) {
    s *= 33;
  }

  const oldZoom = graphCy.zoom();
  let newZoom = oldZoom * Math.pow(10, s);
  newZoom = Math.max(graphCy.minZoom(), Math.min(graphCy.maxZoom(), newZoom));
  if (Math.abs(newZoom - oldZoom) < 1e-9) {
    return;
  }

  graphCy.zoom({
    level: newZoom,
    renderedPosition: { x: renderedX, y: renderedY }
  });
  syncGraphCardPositions();
}

/**
 * 卡片拖拽：在 HTML 层拖动节点，避免与画布平移冲突
 * @param {HTMLElement} card
 * @param {string} classId
 */
function bindGraphCardDrag(card, classId) {
  card.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !graphCy) {
      return;
    }
    const node = graphCy.getElementById(classId);
    if (!node || node.empty()) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const pos = node.position();
    graphCardDragState = {
      card,
      classId,
      startX: e.clientX,
      startY: e.clientY,
      nodeX: pos.x,
      nodeY: pos.y,
      moved: false
    };
    card.classList.add('graph-card-dragging');
    console.log('[graph-view] 开始拖拽卡片:', classId);
  });

  // 拖拽后抑制误触 selectClass
  card.addEventListener('click', (e) => {
    if (card.dataset.suppressClick === '1') {
      e.stopPropagation();
      e.preventDefault();
      delete card.dataset.suppressClick;
    }
  }, true);
}

/** 构建图视图：Cytoscape + HTML 卡片覆盖层 */
function buildGraphView() {
  if (!graphContainer || !graphCyRoot || !graphCardLayer) {
    return;
  }

  destroyGraphView();

  if (!currentData || !currentData.classes.length) {
    setGraphViewPlaceholder('输入文件夹路径后点击「分析」');
    graphDirty = false;
    return;
  }

  console.log('[graph-view] 构建图视图，类型数:', currentData.classes.length, '引用边:', currentData.references.length);

  const classMap = new Map(currentData.classes.map((c) => [c.id, c]));
  /** @type {Map<string, Object[]>} */
  const outRefs = new Map();
  for (const ref of currentData.references) {
    if (!outRefs.has(ref.fromId)) {
      outRefs.set(ref.fromId, []);
    }
    outRefs.get(ref.fromId).push(ref);
  }

  // 先创建 HTML 卡片并测量尺寸
  graphCardLayer.innerHTML = '';
  /** @type {{ data: { id: string, w: number, h: number } }[]} */
  const nodeElements = [];

  for (const cls of currentData.classes) {
    const card = createClassCard(cls, outRefs.get(cls.id) || [], classMap);
    card.classList.add('graph-node-card');
    card.dataset.classId = cls.id;
    bindGraphCardDrag(card, cls.id);
    graphCardLayer.appendChild(card);
    graphCardById.set(cls.id, card);
    nodeElements.push({ data: { id: cls.id, w: 220, h: 80 } });
  }

  const mergedRefs = mergeGraphReferences(currentData.references);
  /** @type {{ data: { id: string, source: string, target: string, kind: string, color: string } }[]} */
  const edgeElements = mergedRefs.map((ref, index) => ({
    data: {
      id: `e-${index}-${ref.fromId}-${ref.toId}-${ref.kind}`,
      source: ref.fromId,
      target: ref.toId,
      kind: ref.kind,
      color: GRAPH_REF_EDGE_COLORS[ref.kind] || GRAPH_REF_EDGE_COLORS.uses
    }
  }));

  graphCy = cytoscape({
    container: graphCyRoot,
    elements: [...nodeElements, ...edgeElements],
    style: buildGraphStylesheet(),
    layout: { name: 'preset' },
    minZoom: 0.15,
    maxZoom: 3,
    wheelSensitivity: 0.2,
    boxSelectionEnabled: false,
    userPanningEnabled: false,
    autoungrabify: true
  });

  applyGraphNodeDimensions();
  bindGraphCyEvents();

  applyGraphLayeredLayout();
  graphCy.fit(undefined, 48);
  syncGraphCardPositions();
  syncGraphEdgeHighlight(selectedClassId);
  if (typeof syncClassCardRefHighlights === 'function' && selectedClassId) {
    syncClassCardRefHighlights(selectedClassId);
  }

  graphDirty = false;
  console.log('[graph-view] 图视图构建完成（层级布局），节点:', nodeElements.length, '边:', edgeElements.length);
}

/** 重新按调用层级排列节点 */
function relayoutGraphView() {
  if (!graphCy) {
    console.log('[graph-view] 无图实例，跳过重新布局');
    return;
  }
  console.log('[graph-view] 重新按层级排列');
  applyGraphLayeredLayout();
  graphCy.fit(undefined, 48);
  syncGraphCardPositions();
  syncGraphEdgeHighlight(selectedClassId);
}
