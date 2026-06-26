"use strict";

const treeNode = document.getElementById("tree");
const emptyNode = document.getElementById("empty");
const emptyHint = document.getElementById("empty-hint");
const hostNode = document.getElementById("page-url");
const statusNode = document.getElementById("status");
const crumbsNode = document.getElementById("crumbs");
const searchInput = document.getElementById("search");
const searchCount = document.getElementById("search-count");
const searchClear = document.getElementById("search-clear");
const searchKey = document.getElementById("search-key");
const pickButton = document.getElementById("pick");
const refreshButton = document.getElementById("refresh");
const exportButton = document.getElementById("export");
const helpButton = document.getElementById("help");
const helpPop = document.getElementById("help-pop");
const selinfoNode = document.getElementById("selinfo");
const selinfoMain = document.getElementById("selinfo-main");
const selinfoDim = document.getElementById("selinfo-dim");
const optsToggle = document.getElementById("opts-toggle");
const optsNode = document.getElementById("opts");
const optFilename = document.getElementById("opt-filename");
const optBg = document.getElementById("opt-bg");
const optSaveAs = document.getElementById("opt-saveas");
const optEop = document.getElementById("opt-eop");

const OPTIONS_KEY = "epdfOptions";
const SEEN_KEY = "epdfSeen";

const nodeElements = new Map();

let panelWindowId = null;
let activeTabId = null;
let selectedNodeId = null;
let selectedFrameId = 0;
let hasSelection = false;
let lastHoverId = null;
let pickArmed = false;
let loadToken = 0;

init();

async function init() {
  try {
    const win = await chrome.windows.getCurrent();
    panelWindowId = win?.id ?? null;
  } catch (_error) {
    panelWindowId = null;
  }

  loadOptions();
  wireEvents();
  await loadActiveTab();

  chrome.tabs.onActivated.addListener((info) => {
    if (panelWindowId !== null && info.windowId !== panelWindowId) return;
    activeTabId = info.tabId;
    loadActiveTab();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== activeTabId) return;
    if (changeInfo.status === "complete" || changeInfo.url) {
      loadActiveTab();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "ELEMENT_TO_PDF_PICKED") {
      if (Number.isInteger(activeTabId) && sender?.tab?.id === activeTabId) {
        onPicked(message, sender);
      }
    }
    return false;
  });
}

function wireEvents() {
  refreshButton.addEventListener("click", () => loadActiveTab());
  pickButton.addEventListener("click", startPicker);
  exportButton.addEventListener("click", () => exportSelection());

  searchInput.addEventListener("input", () => onSearchInput());
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    onSearchInput();
    searchInput.focus();
  });

  treeNode.addEventListener("click", onTreeClick);
  treeNode.addEventListener("dblclick", onTreeDblClick);
  treeNode.addEventListener("mouseover", onTreeHover);
  treeNode.addEventListener("mouseleave", () => {
    lastHoverId = null;
    clearHoverHighlight();
  });

  crumbsNode.addEventListener("click", (event) => {
    const crumb = event.target.closest(".crumb");
    if (crumb?.dataset.nodeId) selectNodeById(crumb.dataset.nodeId, { scroll: true });
  });

  optsToggle.addEventListener("click", toggleOptions);
  helpButton.addEventListener("click", (event) => {
    event.stopPropagation();
    helpPop.hidden = !helpPop.hidden;
  });
  document.addEventListener("click", (event) => {
    if (helpPop.hidden) return;
    if (helpPop.contains(event.target) || helpButton.contains(event.target)) return;
    helpPop.hidden = true;
  });

  for (const input of [optBg, optSaveAs, optEop, optFilename]) {
    input.addEventListener("change", saveOptions);
  }

  window.addEventListener("focus", disarmPicker);
  window.addEventListener("unload", clearPageHighlight);
  document.addEventListener("keydown", onKeyDown, true);
}

/* ---------- options ---------- */

function loadOptions() {
  chrome.storage?.local?.get(OPTIONS_KEY, (result) => {
    const saved = result?.[OPTIONS_KEY];
    if (!saved || typeof saved !== "object") return;
    if (typeof saved.background === "boolean") optBg.checked = saved.background;
    if (typeof saved.saveAs === "boolean") optSaveAs.checked = saved.saveAs;
    if (typeof saved.exportOnPick === "boolean") optEop.checked = saved.exportOnPick;
    if (typeof saved.filename === "string") optFilename.value = saved.filename;
  });
}

function saveOptions() {
  chrome.storage?.local?.set({
    [OPTIONS_KEY]: {
      background: optBg.checked,
      saveAs: optSaveAs.checked,
      exportOnPick: optEop.checked,
      filename: optFilename.value.trim()
    }
  });
}

function exportOptions() {
  return {
    background: optBg.checked,
    saveAs: optSaveAs.checked,
    filename: optFilename.value.trim()
  };
}

function toggleOptions() {
  const willOpen = optsNode.hidden;
  optsNode.hidden = !willOpen;
  optsToggle.setAttribute("aria-expanded", String(willOpen));
}

/* ---------- tab + tree loading ---------- */

async function getActiveTab() {
  const query = panelWindowId !== null
    ? { active: true, windowId: panelWindowId }
    : { active: true, lastFocusedWindow: true };
  const [tab] = await chrome.tabs.query(query);
  return tab || null;
}

async function loadActiveTab() {
  const token = ++loadToken;
  let tab;
  try {
    tab = await getActiveTab();
  } catch (_error) {
    tab = null;
  }

  if (token !== loadToken) return;

  if (!tab?.id) {
    showEmpty("No active tab", "Switch to a browser tab to inspect it.");
    return;
  }

  activeTabId = tab.id;
  setHost(tab.url);

  if (!isInspectableUrl(tab.url)) {
    showEmpty("This page can't be inspected", restrictedReason(tab.url));
    return;
  }

  setStatus("Reading element tree…");

  try {
    const response = await sendRuntimeMessage({
      type: "ELEMENT_TO_PDF_GET_DOM_TREE_FOR_TAB",
      tabId: tab.id
    });

    if (token !== loadToken) return;

    if (!response?.ok) {
      throw new Error(response?.error || "Could not read this page.");
    }

    renderTreeRoot(response.tree, response.truncated);

    if (response.truncated) {
      setStatus("Large DOM — tree was truncated.", "warn");
    } else {
      setStatus("");
      maybeFirstRunTip();
    }
  } catch (error) {
    if (token !== loadToken) return;
    showEmpty("Couldn't read this page", getPageReadErrorMessage(error, tab.url));
  }
}

function maybeFirstRunTip() {
  chrome.storage?.local?.get(SEEN_KEY, (result) => {
    if (result?.[SEEN_KEY]) return;
    setStatus("Tip: click a node or Pick on the page, then Export. Press the ? for shortcuts.");
    chrome.storage?.local?.set({ [SEEN_KEY]: true });
  });
}

function renderTreeRoot(tree, truncated) {
  nodeElements.clear();
  clearSelection();
  treeNode.textContent = "";
  searchInput.value = "";
  onSearchInput();

  if (!tree) {
    showEmpty("Empty page", "Nothing to show for this document.");
    return;
  }

  treeNode.appendChild(renderNode(tree, 0));
  if (truncated) {
    const note = document.createElement("div");
    note.className = "truncated";
    note.textContent = "DOM tree truncated";
    treeNode.appendChild(note);
  }

  emptyNode.hidden = true;
}

/* ---------- node rendering ---------- */

function renderNode(node, depth) {
  if (node.type === "shadow-root") {
    return renderShadowNode(node, depth);
  }

  const el = document.createElement("div");
  el.className = "node";
  el.dataset.nodeId = node.nodeId;
  el.setAttribute("role", "treeitem");
  nodeElements.set(node.nodeId, el);

  const children = node.children || [];
  const hasChildren = children.length > 0;

  const row = document.createElement("div");
  row.className = "row";

  const twisty = document.createElement("span");
  twisty.className = hasChildren ? "twisty" : "twisty leaf";
  row.appendChild(twisty);

  const label = document.createElement("span");
  label.className = "label";
  label.append(...labelParts(node, hasChildren));
  row.appendChild(label);

  el.appendChild(row);
  el.dataset.search = searchText(node);
  el.dataset.crumb = crumbText(node);

  if (hasChildren) {
    const group = document.createElement("div");
    group.className = "children";
    group.setAttribute("role", "group");

    for (const child of children) {
      group.appendChild(renderNode(child, depth + 1));
    }

    if (node.truncated) {
      const note = document.createElement("div");
      note.className = "truncated";
      note.textContent = "DOM tree truncated";
      group.appendChild(note);
    }

    el.appendChild(group);

    if (depth >= 2) {
      el.classList.add("collapsed");
      el.setAttribute("aria-expanded", "false");
    } else {
      el.setAttribute("aria-expanded", "true");
    }
  }

  return el;
}

function renderShadowNode(node, depth) {
  const el = document.createElement("div");
  el.className = "node";
  el.dataset.nodeId = node.nodeId;
  el.dataset.kind = "shadow";
  el.setAttribute("role", "treeitem");

  const children = node.children || [];
  const hasChildren = children.length > 0;

  const row = document.createElement("div");
  row.className = "row";

  const twisty = document.createElement("span");
  twisty.className = hasChildren ? "twisty" : "twisty leaf";
  row.appendChild(twisty);

  const label = document.createElement("span");
  label.className = "label";
  const tag = document.createElement("span");
  tag.className = "shadow-tag";
  tag.textContent = "#shadow-root";
  label.appendChild(tag);
  row.appendChild(label);

  el.appendChild(row);
  el.dataset.search = "#shadow-root";

  if (hasChildren) {
    const group = document.createElement("div");
    group.className = "children";
    for (const child of children) {
      group.appendChild(renderNode(child, depth + 1));
    }
    el.appendChild(group);
    if (depth >= 2) el.classList.add("collapsed");
  }

  return el;
}

function labelParts(node, hasChildren) {
  const parts = [];
  parts.push(span("t-punct", "<"));
  parts.push(span("t-tag", node.tagName || "?"));

  if (node.idAttr) {
    parts.push(span("t-id", `#${node.idAttr}`));
  }

  for (const className of node.classList || []) {
    parts.push(span("t-class", `.${className}`));
  }

  parts.push(span("t-punct", ">"));

  if (hasChildren) {
    parts.push(span("t-ellipsis", "…"));
  }

  if (node.text) {
    parts.push(span("t-text", ` ${node.text}`));
  }

  return parts;
}

function span(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function searchText(node) {
  const classes = (node.classList || []).map((name) => `.${name}`).join(" ");
  return `${node.tagName || ""} #${node.idAttr || ""} ${classes} ${node.text || ""}`
    .toLowerCase();
}

function crumbText(node) {
  if (node.idAttr) return `${node.tagName}#${node.idAttr}`;
  const first = (node.classList || [])[0];
  return first ? `${node.tagName}.${first}` : node.tagName || "node";
}

/* ---------- tree interactions ---------- */

function onTreeClick(event) {
  const twisty = event.target.closest(".twisty");
  if (twisty && !twisty.classList.contains("leaf")) {
    toggleNode(twisty.closest(".node"));
    return;
  }

  const row = event.target.closest(".row");
  const nodeEl = row?.parentElement;
  if (nodeEl?.dataset.nodeId && nodeEl.dataset.kind !== "shadow") {
    selectNode(nodeEl.dataset.nodeId, nodeEl, { scroll: true });
  }
}

async function onTreeDblClick(event) {
  const row = event.target.closest(".row");
  const nodeEl = row?.parentElement;
  if (nodeEl?.dataset.nodeId && nodeEl.dataset.kind !== "shadow") {
    await selectNode(nodeEl.dataset.nodeId, nodeEl, { scroll: true });
    exportSelection();
  }
}

function onTreeHover(event) {
  const row = event.target.closest(".row");
  const nodeEl = row?.parentElement;
  const nodeId = nodeEl?.dataset.nodeId;
  if (!nodeId || nodeEl.dataset.kind === "shadow" || nodeId === lastHoverId) return;
  lastHoverId = nodeId;
  highlight(nodeId, false);
}

function toggleNode(nodeEl) {
  if (!nodeEl) return;
  const collapsed = nodeEl.classList.toggle("collapsed");
  nodeEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

/* ---------- selection ---------- */

function selectNodeById(nodeId, options = {}) {
  const nodeEl = nodeElements.get(nodeId);
  if (nodeEl) selectNode(nodeId, nodeEl, options);
}

async function selectNode(nodeId, nodeEl, options = {}) {
  markTreeSelection(nodeEl);

  selectedNodeId = nodeId;
  selectedFrameId = 0;
  hasSelection = true;
  exportButton.disabled = false;

  buildCrumbs(nodeEl);

  if (options.scroll !== false) {
    nodeEl.querySelector(".row")?.scrollIntoView({ block: "nearest" });
  }

  if (options.knownInfo) showSelInfo(options.knownInfo);

  const info = await selectInPage(nodeId, options.scroll !== false);
  if (info) showSelInfo(info);
  return info;
}

function markTreeSelection(nodeEl) {
  if (selectedNodeId) {
    nodeElements.get(selectedNodeId)?.classList.remove("selected");
  }
  treeNode.querySelectorAll(".node.on-path").forEach((el) => el.classList.remove("on-path"));

  nodeEl.classList.add("selected");
  for (let parent = nodeEl.parentElement; parent; parent = parent.parentElement) {
    if (parent.classList?.contains("node")) {
      parent.classList.remove("collapsed");
      parent.setAttribute("aria-expanded", "true");
      parent.classList.add("on-path");
    }
  }
}

async function selectInPage(nodeId, scroll) {
  try {
    const response = await sendRuntimeMessage({
      type: "ELEMENT_TO_PDF_SELECT_NODE_FOR_TAB",
      tabId: activeTabId,
      nodeId,
      scrollIntoView: scroll
    });
    return response?.ok ? response.info : null;
  } catch (_error) {
    return null;
  }
}

function onPicked(message, sender) {
  disarmPicker();
  const info = message.info || null;
  const nodeId = message.nodeId || null;
  selectedFrameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;

  if (nodeId && nodeElements.has(nodeId)) {
    selectNode(nodeId, nodeElements.get(nodeId), { scroll: true, knownInfo: info });
  } else {
    if (selectedNodeId) {
      nodeElements.get(selectedNodeId)?.classList.remove("selected");
    }
    treeNode.querySelectorAll(".node.on-path").forEach((el) => el.classList.remove("on-path"));
    selectedNodeId = null;
    crumbsNode.textContent = "";
    hasSelection = true;
    exportButton.disabled = false;
    if (info) showSelInfo(info);
    setStatus(`Selected ${info?.label || "element"} (outside the loaded tree)`);
  }

  if (optEop.checked) exportSelection();
}

function showSelInfo(info) {
  if (!info) {
    selinfoNode.hidden = true;
    return;
  }
  selinfoMain.textContent = info.label || info.selector || "element";
  const pages = info.pages > 1 ? `${info.pages} pages` : "1 page";
  selinfoDim.textContent = `${info.width}×${info.height}px · ${pages}`;
  selinfoNode.hidden = false;
}

function buildCrumbs(nodeEl) {
  const chain = [];
  for (let el = nodeEl; el; el = el.parentElement) {
    if (el.classList?.contains("node") && el.dataset.crumb) {
      chain.unshift(el);
    }
  }

  crumbsNode.textContent = "";
  const start = Math.max(0, chain.length - 7);
  if (start > 0) {
    crumbsNode.appendChild(crumbChip("…", null));
    crumbsNode.appendChild(crumbSep());
  }

  chain.slice(start).forEach((el, index, shown) => {
    crumbsNode.appendChild(crumbChip(el.dataset.crumb, el.dataset.nodeId, index === shown.length - 1));
    if (index < shown.length - 1) crumbsNode.appendChild(crumbSep());
  });

  crumbsNode.querySelector(".crumb.is-last")?.scrollIntoView({ inline: "end", block: "nearest" });
}

function crumbChip(text, nodeId, isLast = false) {
  const chip = document.createElement("span");
  chip.className = isLast ? "crumb is-last" : "crumb";
  chip.textContent = text;
  if (nodeId) chip.dataset.nodeId = nodeId;
  return chip;
}

function crumbSep() {
  return span("crumb-sep", "›");
}

function clearSelection() {
  if (selectedNodeId) {
    nodeElements.get(selectedNodeId)?.classList.remove("selected");
  }
  treeNode.querySelectorAll(".node.on-path").forEach((el) => el.classList.remove("on-path"));
  selectedNodeId = null;
  selectedFrameId = 0;
  hasSelection = false;
  exportButton.disabled = true;
  crumbsNode.textContent = "";
  selinfoNode.hidden = true;
}

/* ---------- actions ---------- */

async function exportSelection() {
  if (!hasSelection) return;

  setStatus("Exporting selected element…");
  exportButton.disabled = true;

  try {
    const response = await sendRuntimeMessage({
      type: "ELEMENT_TO_PDF_EXPORT_SELECTION_FOR_TAB",
      tabId: activeTabId,
      frameId: selectedFrameId,
      options: exportOptions()
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not export the selected element.");
    }

    setStatus(optSaveAs.checked ? "PDF ready — save dialog opened." : "PDF saved to Downloads.", "ok");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    exportButton.disabled = !hasSelection;
  }
}

async function startPicker() {
  try {
    armPicker();
    await sendRuntimeMessage({
      type: "ELEMENT_TO_PDF_START_PICKER_FOR_TAB",
      tabId: activeTabId
    });
    setStatus("Pick mode — click an element on the page.");
  } catch (error) {
    disarmPicker();
    setStatus(getErrorMessage(error), "error");
  }
}

function armPicker() {
  pickArmed = true;
  pickButton.classList.add("armed");
}

function disarmPicker() {
  if (!pickArmed) return;
  pickArmed = false;
  pickButton.classList.remove("armed");
}

function highlight(nodeId, scrollIntoView) {
  if (!activeTabId || !nodeId) return;
  sendRuntimeMessage({
    type: "ELEMENT_TO_PDF_HIGHLIGHT_NODE_FOR_TAB",
    tabId: activeTabId,
    nodeId,
    scrollIntoView
  }).catch(() => undefined);
}

function clearPageHighlight() {
  if (!activeTabId) return;
  sendRuntimeMessage({
    type: "ELEMENT_TO_PDF_CLEAR_HIGHLIGHT_FOR_TAB",
    tabId: activeTabId,
    scope: "all"
  }).catch(() => undefined);
}

function clearHoverHighlight() {
  if (!activeTabId) return;
  sendRuntimeMessage({
    type: "ELEMENT_TO_PDF_CLEAR_HIGHLIGHT_FOR_TAB",
    tabId: activeTabId,
    scope: "hover-top"
  }).catch(() => undefined);
}

/* ---------- search filter ---------- */

function onSearchInput() {
  const value = searchInput.value;
  const has = value.trim().length > 0;
  searchClear.hidden = !has;
  searchKey.hidden = has;
  applyFilter(value);
}

function applyFilter(rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  unmarkLabels();

  if (!query) {
    treeNode.classList.remove("filtering");
    treeNode.querySelectorAll(".node.filtered-out").forEach((el) => el.classList.remove("filtered-out"));
    searchCount.hidden = true;
    return;
  }

  treeNode.classList.add("filtering");
  const allNodes = treeNode.querySelectorAll(".node");
  allNodes.forEach((el) => el.classList.add("filtered-out"));

  let matches = 0;
  for (const el of allNodes) {
    if (!(el.dataset.search || "").includes(query)) continue;
    matches += 1;
    markLabel(el.querySelector(":scope > .row > .label"), query);

    for (let cursor = el; cursor; cursor = cursor.parentElement) {
      if (!cursor.classList?.contains("node")) continue;
      cursor.classList.remove("filtered-out");
      if (cursor !== el) {
        cursor.classList.remove("collapsed");
        cursor.setAttribute("aria-expanded", "true");
      }
    }
  }

  searchCount.hidden = false;
  searchCount.textContent = String(matches);
  searchCount.classList.toggle("none", matches === 0);
}

function markLabel(labelEl, query) {
  if (!labelEl) return;
  for (const sp of labelEl.children) {
    const original = sp.textContent;
    const lower = original.toLowerCase();
    if (!lower.includes(query)) continue;

    sp.dataset.o = original;
    sp.textContent = "";
    let index = 0;
    let found;
    while ((found = lower.indexOf(query, index)) !== -1) {
      if (found > index) sp.appendChild(document.createTextNode(original.slice(index, found)));
      const mark = document.createElement("mark");
      mark.textContent = original.slice(found, found + query.length);
      sp.appendChild(mark);
      index = found + query.length;
    }
    if (index < original.length) sp.appendChild(document.createTextNode(original.slice(index)));
  }
}

function unmarkLabels() {
  treeNode.querySelectorAll(".label span[data-o]").forEach((sp) => {
    sp.textContent = sp.dataset.o;
    delete sp.dataset.o;
  });
}

function selectFirstMatch() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return;

  const match = Array.from(treeNode.querySelectorAll(".node")).find((el) => {
    return el.dataset.kind !== "shadow"
      && (el.dataset.search || "").includes(query)
      && el.querySelector(":scope > .row")?.offsetParent !== null;
  });

  if (match) {
    selectNode(match.dataset.nodeId, match, { scroll: true });
    searchInput.blur();
  }
}

/* ---------- keyboard ---------- */

function onKeyDown(event) {
  const inField = event.target === searchInput || event.target === optFilename;

  if (event.key === "Escape") {
    if (!helpPop.hidden) {
      helpPop.hidden = true;
      return;
    }
    if (!optsNode.hidden) {
      toggleOptions();
      return;
    }
    if (inField && searchInput.value) {
      searchInput.value = "";
      onSearchInput();
    } else {
      searchInput.blur();
      clearSelection();
      clearPageHighlight();
    }
    return;
  }

  if (inField) {
    if (event.key === "Enter" && event.target === searchInput) {
      event.preventDefault();
      selectFirstMatch();
    }
    return;
  }

  if (event.key === "?") {
    event.preventDefault();
    helpPop.hidden = !helpPop.hidden;
    return;
  }

  if (event.key === "/") {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  if (event.key === "p" || event.key === "P") {
    event.preventDefault();
    startPicker();
    return;
  }

  if (event.key === "r" || event.key === "R") {
    event.preventDefault();
    loadActiveTab();
    return;
  }

  if (event.key === "Enter") {
    if (hasSelection) {
      event.preventDefault();
      exportSelection();
    }
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(event.key === "ArrowDown" ? 1 : -1);
    return;
  }

  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    handleArrowExpand(event.key === "ArrowRight");
  }
}

function visibleRows() {
  return Array.from(treeNode.querySelectorAll(".node")).filter((el) => {
    return el.dataset.kind !== "shadow" && el.querySelector(":scope > .row")?.offsetParent !== null;
  });
}

function moveSelection(delta) {
  const rows = visibleRows();
  if (!rows.length) return;

  const index = rows.findIndex((el) => el.dataset.nodeId === selectedNodeId);
  const next = index === -1
    ? (delta > 0 ? 0 : rows.length - 1)
    : Math.min(rows.length - 1, Math.max(0, index + delta));

  const target = rows[next];
  if (target) selectNode(target.dataset.nodeId, target, { scroll: true });
}

function handleArrowExpand(expand) {
  const nodeEl = selectedNodeId ? nodeElements.get(selectedNodeId) : null;
  if (!nodeEl) return;

  const hasChildren = !!nodeEl.querySelector(":scope > .children");
  const collapsed = nodeEl.classList.contains("collapsed");

  if (expand) {
    if (hasChildren && collapsed) {
      toggleNode(nodeEl);
    } else if (hasChildren) {
      const firstChild = nodeEl.querySelector(":scope > .children > .node");
      if (firstChild) selectNode(firstChild.dataset.nodeId, firstChild, { scroll: true });
    }
    return;
  }

  if (hasChildren && !collapsed) {
    toggleNode(nodeEl);
    return;
  }

  const parent = nodeEl.parentElement?.closest(".node");
  if (parent) selectNode(parent.dataset.nodeId, parent, { scroll: true });
}

/* ---------- view helpers ---------- */

function setHost(url) {
  if (!url) {
    hostNode.textContent = "—";
    hostNode.title = "";
    return;
  }

  try {
    const parsed = new URL(url);
    hostNode.textContent = parsed.hostname
      ? parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "")
      : url;
  } catch (_error) {
    hostNode.textContent = url;
  }

  hostNode.title = url;
}

function showEmpty(title, hint) {
  treeNode.textContent = "";
  nodeElements.clear();
  clearSelection();
  emptyNode.querySelector(".empty-title").textContent = title;
  emptyHint.textContent = hint || "";
  emptyNode.hidden = false;
  setStatus("");
}

function setStatus(message, kind = "") {
  statusNode.textContent = message || "";
  statusNode.className = "status" + (kind ? ` ${kind}` : "");
}

function isInspectableUrl(url) {
  if (!url) return false;
  if (isChromeWebStoreUrl(url)) return false;
  if (/^(chrome|chrome-extension|edge|brave|opera|vivaldi|devtools):\/\//i.test(url)) return false;
  if (/^(view-source|data|blob):/i.test(url)) return false;
  return /^https?:|^file:|^about:blank/i.test(url);
}

function restrictedReason(url) {
  if (isChromeWebStoreUrl(url)) {
    return "Chrome Web Store and Developer Dashboard pages block extension access.";
  }
  if (/^chrome:\/\//i.test(url)) return "Chrome system pages (chrome://) are off-limits to extensions.";
  if (/^chrome-extension:\/\//i.test(url)) return "Extension pages can't be inspected.";
  if (/^(edge|brave|opera|vivaldi|devtools):\/\//i.test(url)) return "Browser system pages can't be inspected.";
  if (/^about:/i.test(url) && !/^about:blank/i.test(url)) return "Browser system pages can't be inspected.";
  if (/^file:/i.test(url)) {
    return "Local files require file access to be enabled for this extension.";
  }
  return "Open a normal web page (http/https) to inspect its elements.";
}

function isChromeWebStoreUrl(url) {
  return /(^https?:\/\/chrome\.google\.com\/webstore\b|^https?:\/\/chromewebstore\.google\.com\b)/i.test(url);
}

function sendRuntimeMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error("Extension runtime is not available."));
  }
  return chrome.runtime.sendMessage(message);
}

function getErrorMessage(error) {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function getPageReadErrorMessage(error, url) {
  if (!isInspectableUrl(url)) {
    return restrictedReason(url);
  }

  const message = getErrorMessage(error);

  if (/cannot access contents|extensions gallery|chrome web store|webstore/i.test(message)) {
    return isChromeWebStoreUrl(url)
      ? "Chrome Web Store and Developer Dashboard pages block extension access."
      : "Chrome blocked extension access to this page.";
  }

  if (/missing host permission|cannot access.*permission|host permission/i.test(message)) {
    return "Grant this extension site access for the page, then refresh the tab.";
  }

  if (/receiving end does not exist|message port closed|could not establish connection/i.test(message)) {
    return "Refresh this page and try again. If you just reloaded or updated the extension, existing tabs need a refresh before they can be inspected.";
  }

  if (/^file:/i.test(url)) {
    return "Enable 'Allow access to file URLs' for this extension, then refresh the file page.";
  }

  return message || "Could not read this page.";
}
