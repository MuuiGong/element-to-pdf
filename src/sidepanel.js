"use strict";

const treeNode = document.getElementById("tree");
const emptyNode = document.getElementById("empty");
const emptyHint = document.getElementById("empty-hint");
const hostNode = document.getElementById("page-url");
const statusNode = document.getElementById("status");
const crumbsNode = document.getElementById("crumbs");
const searchInput = document.getElementById("search");
const pickButton = document.getElementById("pick");
const refreshButton = document.getElementById("refresh");
const exportButton = document.getElementById("export");

const nodeElements = new Map();

let panelWindowId = null;
let activeTabId = null;
let selectedNodeId = null;
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
}

function wireEvents() {
  refreshButton.addEventListener("click", () => loadActiveTab());
  pickButton.addEventListener("click", startPicker);
  exportButton.addEventListener("click", () => {
    if (selectedNodeId) exportNode(selectedNodeId);
  });
  searchInput.addEventListener("input", () => applyFilter(searchInput.value));

  treeNode.addEventListener("click", onTreeClick);
  treeNode.addEventListener("dblclick", onTreeDblClick);
  treeNode.addEventListener("mouseover", onTreeHover);
  treeNode.addEventListener("mouseleave", () => {
    lastHoverId = null;
    if (selectedNodeId) highlight(selectedNodeId, false);
    else clearPageHighlight();
  });

  crumbsNode.addEventListener("click", (event) => {
    const crumb = event.target.closest(".crumb");
    if (crumb?.dataset.nodeId) selectNodeById(crumb.dataset.nodeId, { scroll: true });
  });

  window.addEventListener("focus", disarmPicker);
  window.addEventListener("unload", clearPageHighlight);
  document.addEventListener("keydown", onKeyDown, true);
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
      type: "ELEMENT_PDF_GET_DOM_TREE_FOR_TAB",
      tabId: tab.id
    });

    if (token !== loadToken) return;

    if (!response?.ok) {
      throw new Error(response?.error || "Could not read this page.");
    }

    renderTreeRoot(response.tree, response.truncated);
    setStatus(
      response.truncated ? "Large DOM — tree was truncated." : "",
      response.truncated ? "warn" : ""
    );
  } catch (error) {
    if (token !== loadToken) return;
    showEmpty("Couldn't read this page", getErrorMessage(error));
  }
}

function renderTreeRoot(tree, truncated) {
  nodeElements.clear();
  clearSelection();
  treeNode.textContent = "";
  searchInput.value = "";
  treeNode.classList.remove("filtering");

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
  treeNode.hidden = false;
  // restart the entrance animation
  treeNode.style.animation = "none";
  void treeNode.offsetWidth;
  treeNode.style.animation = "";
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

/* ---------- interactions ---------- */

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

function onTreeDblClick(event) {
  const row = event.target.closest(".row");
  const nodeEl = row?.parentElement;
  if (nodeEl?.dataset.nodeId && nodeEl.dataset.kind !== "shadow") {
    exportNode(nodeEl.dataset.nodeId);
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

function selectNodeById(nodeId, options = {}) {
  const nodeEl = nodeElements.get(nodeId);
  if (nodeEl) selectNode(nodeId, nodeEl, options);
}

function selectNode(nodeId, nodeEl, options = {}) {
  if (selectedNodeId) {
    nodeElements.get(selectedNodeId)?.classList.remove("selected");
  }
  treeNode.querySelectorAll(".node.on-path").forEach((el) => el.classList.remove("on-path"));

  selectedNodeId = nodeId;
  nodeEl.classList.add("selected");
  exportButton.disabled = false;

  // reveal: expand every ancestor so the row is visible
  for (let parent = nodeEl.parentElement; parent; parent = parent.parentElement) {
    if (parent.classList?.contains("node")) {
      parent.classList.remove("collapsed");
      parent.setAttribute("aria-expanded", "true");
      parent.classList.add("on-path");
    }
  }

  buildCrumbs(nodeEl);

  if (options.scroll !== false) {
    nodeEl.querySelector(".row")?.scrollIntoView({ block: "nearest" });
  }

  highlight(nodeId, true);
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

  const last = crumbsNode.querySelector(".crumb.is-last");
  last?.scrollIntoView({ inline: "end", block: "nearest" });
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
  exportButton.disabled = true;
  crumbsNode.textContent = "";
}

/* ---------- actions ---------- */

async function exportNode(nodeId) {
  setStatus("Exporting selected element…");
  exportButton.disabled = true;

  try {
    const response = await sendRuntimeMessage({
      type: "ELEMENT_PDF_EXPORT_NODE_FOR_TAB",
      tabId: activeTabId,
      nodeId
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not export the selected element.");
    }

    setStatus("PDF ready — save dialog opened.", "ok");
  } catch (error) {
    setStatus(getErrorMessage(error), "error");
  } finally {
    exportButton.disabled = selectedNodeId == null;
  }
}

async function startPicker() {
  try {
    armPicker();
    await sendRuntimeMessage({
      type: "ELEMENT_PDF_START_PICKER_FOR_TAB",
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
    type: "ELEMENT_PDF_HIGHLIGHT_NODE_FOR_TAB",
    tabId: activeTabId,
    nodeId,
    scrollIntoView
  }).catch(() => undefined);
}

function clearPageHighlight() {
  if (!activeTabId) return;
  sendRuntimeMessage({
    type: "ELEMENT_PDF_CLEAR_HIGHLIGHT_FOR_TAB",
    tabId: activeTabId
  }).catch(() => undefined);
}

/* ---------- search filter ---------- */

function applyFilter(rawQuery) {
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    treeNode.classList.remove("filtering");
    treeNode.querySelectorAll(".node.filtered-out").forEach((el) => {
      el.classList.remove("filtered-out");
    });
    return;
  }

  treeNode.classList.add("filtering");
  const allNodes = treeNode.querySelectorAll(".node");
  allNodes.forEach((el) => el.classList.add("filtered-out"));

  for (const el of allNodes) {
    if (!(el.dataset.search || "").includes(query)) continue;

    for (let cursor = el; cursor; cursor = cursor.parentElement) {
      if (!cursor.classList?.contains("node")) continue;
      cursor.classList.remove("filtered-out");
      if (cursor !== el) {
        cursor.classList.remove("collapsed");
        cursor.setAttribute("aria-expanded", "true");
      }
    }
  }
}

/* ---------- keyboard ---------- */

function onKeyDown(event) {
  const inField = event.target === searchInput;

  if (event.key === "Escape") {
    if (inField && searchInput.value) {
      searchInput.value = "";
      applyFilter("");
    } else {
      searchInput.blur();
      clearSelection();
      clearPageHighlight();
    }
    return;
  }

  if (inField) return;

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
    if (selectedNodeId) {
      event.preventDefault();
      exportNode(selectedNodeId);
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
  return /^https?:|^file:|^about:blank/i.test(url);
}

function restrictedReason(url) {
  if (/^chrome:\/\//i.test(url)) return "Chrome system pages (chrome://) are off-limits to extensions.";
  if (/^(edge|brave|about):/i.test(url)) return "Browser system pages can't be inspected.";
  if (/chrome\.google\.com\/webstore|chromewebstore\.google\.com/i.test(url)) {
    return "The Chrome Web Store blocks extension access.";
  }
  return "Open a normal web page (http/https) to inspect its elements.";
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
