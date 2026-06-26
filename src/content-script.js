(() => {
  const CONTENT_SCRIPT_VERSION = "0.3.2";
  const INSTANCE_ID = `${CONTENT_SCRIPT_VERSION}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  globalThis.__elementToPdfContentScriptVersion = CONTENT_SCRIPT_VERSION;
  globalThis.__elementToPdfContentScriptInstanceId = INSTANCE_ID;

  const DEVTOOLS_EXPORT_EVENT = "__ELEMENT_TO_PDF_DEVTOOLS_EXPORT__";
  const MAX_CAPTURE_WIDTH = 19200;
  const MAX_CAPTURE_HEIGHT = 19200;
  const MAX_EMBEDDED_ASSET_BYTES = 12 * 1024 * 1024;
  const MAX_DOM_TREE_NODES = 1800;
  const MAX_DOM_TEXT_LENGTH = 80;
  const CAPTURE_STYLE_PROPERTIES = [
    "accent-color",
    "align-content",
    "align-items",
    "align-self",
    "aspect-ratio",
    "background",
    "background-clip",
    "background-color",
    "background-image",
    "background-origin",
    "background-position",
    "background-repeat",
    "background-size",
    "border",
    "border-block",
    "border-block-color",
    "border-block-style",
    "border-block-width",
    "border-collapse",
    "border-color",
    "border-image",
    "border-inline",
    "border-inline-color",
    "border-inline-style",
    "border-inline-width",
    "border-radius",
    "border-spacing",
    "border-style",
    "border-width",
    "bottom",
    "box-decoration-break",
    "box-shadow",
    "box-sizing",
    "caption-side",
    "clear",
    "clip-path",
    "color",
    "column-gap",
    "columns",
    "content",
    "cursor",
    "direction",
    "display",
    "filter",
    "flex",
    "flex-basis",
    "flex-direction",
    "flex-flow",
    "flex-grow",
    "flex-shrink",
    "flex-wrap",
    "float",
    "font",
    "font-family",
    "font-feature-settings",
    "font-kerning",
    "font-size",
    "font-stretch",
    "font-style",
    "font-variant",
    "font-weight",
    "gap",
    "grid",
    "grid-area",
    "grid-auto-columns",
    "grid-auto-flow",
    "grid-auto-rows",
    "grid-column",
    "grid-row",
    "grid-template",
    "grid-template-areas",
    "grid-template-columns",
    "grid-template-rows",
    "height",
    "inset",
    "justify-content",
    "justify-items",
    "justify-self",
    "left",
    "letter-spacing",
    "line-height",
    "list-style",
    "margin",
    "max-height",
    "max-width",
    "min-height",
    "min-width",
    "object-fit",
    "object-position",
    "opacity",
    "order",
    "outline",
    "overflow",
    "overflow-wrap",
    "overflow-x",
    "overflow-y",
    "padding",
    "place-content",
    "place-items",
    "place-self",
    "pointer-events",
    "position",
    "right",
    "row-gap",
    "table-layout",
    "text-align",
    "text-decoration",
    "text-indent",
    "text-overflow",
    "text-shadow",
    "text-transform",
    "top",
    "transform",
    "transform-origin",
    "vertical-align",
    "visibility",
    "white-space",
    "width",
    "word-break",
    "word-spacing",
    "z-index"
  ];

  let pickerActive = false;
  let hoverTarget = null;
  let overlayHost = null;
  let overlayBox = null;
  let overlayLabel = null;
  let selectionBox = null;
  let hoverEl = null;
  let selectionEl = null;
  let toastHost = null;
  let pseudoRuleCounter = 0;
  let nextDomNodeId = 1;
  let domNodeRegistry = new Map();
  let lastDomTreeTruncated = false;
  let visualCaptureRegistry = new Map();
  let sourcePrintRegistry = new Map();
  let pickerMode = "export";
  let selectedElement = null;
  let lastPickerHoverNotify = 0;
  let overlayRaf = 0;

  document.addEventListener(DEVTOOLS_EXPORT_EVENT, (event) => {
    if (isCurrentInstance()) handleDevtoolsExportEvent(event);
  }, true);
  // Keep the persistent selection/hover boxes aligned when the page scrolls.
  window.addEventListener("scroll", () => {
    if (isCurrentInstance()) scheduleOverlayReposition();
  }, true);
  window.addEventListener("resize", () => {
    if (isCurrentInstance()) scheduleOverlayReposition();
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isCurrentInstance()) {
      return false;
    }

    if (!message || typeof message !== "object") {
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_START_PICKER") {
      startPicker(message.mode === "select" ? "select" : "export");
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_STOP_PICKER") {
      stopPicker();
      selectedElement = null;
      clearAllOverlays();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_CLEAR_PICKER_OVERLAY") {
      if (pickerActive) {
        hoverTarget = null;
        clearHoverOverlay();
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_EXPORT_STATUS") {
      showToast(message.message || "PDF export status changed.", message.kind || "info");
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_GET_DOM_TREE") {
      const result = buildDomTreeSnapshot();
      sendResponse({
        ok: true,
        tree: result.tree,
        truncated: result.truncated,
        title: document.title,
        url: location.href
      });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_HIGHLIGHT_NODE") {
      try {
        const element = getRegisteredElement(message.nodeId);
        if (message.scrollIntoView) {
          scrollRegisteredElementIntoView(element);
        }
        setHoverElement(element);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({
          ok: false,
          error: getErrorMessage(error)
        });
      }
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_CLEAR_HIGHLIGHT") {
      clearHoverOverlay();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_EXPORT_NODE") {
      exportRegisteredElement(message.nodeId).then(sendResponse);
      return true;
    }

    if (message.type === "ELEMENT_TO_PDF_SELECT_NODE") {
      try {
        const element = getRegisteredElement(message.nodeId);
        selectedElement = element;
        if (message.scrollIntoView) {
          scrollRegisteredElementIntoView(element);
        }
        setSelectionElement(element);
        sendResponse({ ok: true, info: getSelectionInfo(element) });
      } catch (error) {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      }
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_EXPORT_SELECTION") {
      exportSelection(message.options).then(sendResponse);
      return true;
    }

    if (message.type === "ELEMENT_TO_PDF_GET_SELECTION_INFO") {
      if (selectedElement && selectedElement.isConnected) {
        sendResponse({ ok: true, info: getSelectionInfo(selectedElement) });
      } else {
        sendResponse({ ok: false });
      }
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_PREPARE_SOURCE_PRINT") {
      prepareSourcePrint(message.sourcePrintId).then(sendResponse);
      return true;
    }

    if (message.type === "ELEMENT_TO_PDF_RESTORE_SOURCE_PRINT") {
      restoreSourcePrint(message.sourcePrintId);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_PREPARE_SCROLL_CAPTURE") {
      respondWithElementAction(message.captureId, sendResponse, (entry) => {
        return getScrollCaptureMetrics(entry.element);
      });
      return false;
    }

    if (message.type === "ELEMENT_TO_PDF_SCROLL_CAPTURE_TO") {
      scrollCaptureTo(message.captureId, message.scrollTop).then(sendResponse);
      return true;
    }

    if (message.type === "ELEMENT_TO_PDF_RESTORE_SCROLL_CAPTURE") {
      respondWithElementAction(message.captureId, sendResponse, (entry) => {
        entry.element.scrollTop = entry.originalScrollTop;
        entry.element.scrollLeft = entry.originalScrollLeft;
        return { ok: true };
      });
      return false;
    }

    return false;
  });

  function isCurrentInstance() {
    return globalThis.__elementToPdfContentScriptInstanceId === INSTANCE_ID;
  }

  function startPicker(mode = "export") {
    if (pickerActive) return;

    pickerMode = mode === "select" ? "select" : "export";
    pickerActive = true;
    hoverTarget = null;
    ensureOverlay();
    clearHoverOverlay();
    if (isTopFrame()) {
      showToast(
        pickerMode === "select"
          ? "Click an element to select it in the panel. Press Esc to cancel."
          : "Click an element to export it as PDF. Press Esc to cancel.",
        "info"
      );
    }

    document.addEventListener("mousemove", handlePickerMouseMove, true);
    document.addEventListener("mouseover", handlePickerMouseMove, true);
    document.addEventListener("click", handlePickerClick, true);
    document.addEventListener("contextmenu", blockPickerContextMenu, true);
    document.addEventListener("keydown", handlePickerKeyDown, true);
    window.addEventListener("scroll", handlePickerScrollOrResize, true);
    window.addEventListener("resize", handlePickerScrollOrResize, true);
  }

  function stopPicker() {
    if (!pickerActive) return;

    pickerActive = false;
    hoverTarget = null;
    clearHoverOverlay();

    document.removeEventListener("mousemove", handlePickerMouseMove, true);
    document.removeEventListener("mouseover", handlePickerMouseMove, true);
    document.removeEventListener("click", handlePickerClick, true);
    document.removeEventListener("contextmenu", blockPickerContextMenu, true);
    document.removeEventListener("keydown", handlePickerKeyDown, true);
    window.removeEventListener("scroll", handlePickerScrollOrResize, true);
    window.removeEventListener("resize", handlePickerScrollOrResize, true);
  }

  function handlePickerMouseMove(event) {
    if (!pickerActive) return;

    const target = getElementFromEvent(event);
    if (!target || isExtensionOverlayNode(target)) return;

    hoverTarget = target;
    setHoverElement(target);
    notifyPickerHover();
  }

  function handlePickerClick(event) {
    if (!pickerActive) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const target = hoverTarget || getElementFromEvent(event);
    const mode = pickerMode;
    stopPicker();
    notifyPickerDone();

    if (!target || isExtensionOverlayNode(target)) {
      showToast("No element was selected.", "error");
      return;
    }

    if (mode === "select") {
      selectPickedElement(target);
    } else {
      exportElement(target, "picker");
    }
  }

  function blockPickerContextMenu(event) {
    if (!pickerActive) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function handlePickerKeyDown(event) {
    if (event.key !== "Escape") return;

    event.preventDefault();
    event.stopPropagation();
    stopPicker();
    notifyPickerDone();
    showToast("Element picker cancelled.", "info");
  }

  function handlePickerScrollOrResize() {
    if (!pickerActive || !hoverTarget) return;
    renderOverlays();
  }

  function handleDevtoolsExportEvent(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || isExtensionOverlayNode(target)) return;

    event.preventDefault();
    event.stopPropagation();
    exportElement(target, "devtools");
  }

  async function exportElement(element, captureMode, options = null) {
    try {
      clearHoverOverlay();
      await waitForNextPaint();

      const payload = await buildCapturePayload(element, captureMode, options);
      const response = await sendRuntimeMessage({
        type: "ELEMENT_TO_PDF_SNAPSHOT",
        payload
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Background worker rejected the capture.");
      }

      return response;
    } catch (error) {
      console.warn("element-to-pdf: capture failed", error);
      showToast(getErrorMessage(error), "error");
      return {
        ok: false,
        error: getErrorMessage(error)
      };
    }
  }

  function buildDomTreeSnapshot() {
    nextDomNodeId = 1;
    domNodeRegistry = new Map();
    lastDomTreeTruncated = false;

    const counter = { count: 0 };
    const tree = buildDomNode(document.documentElement, counter);

    return {
      tree,
      truncated: lastDomTreeTruncated
    };
  }

  function buildDomNode(element, counter) {
    if (!(element instanceof Element)) return null;
    if (counter.count >= MAX_DOM_TREE_NODES) {
      lastDomTreeTruncated = true;
      return null;
    }

    counter.count += 1;
    const nodeId = `n${nextDomNodeId++}`;
    domNodeRegistry.set(nodeId, element);

    const children = [];

    if (element.shadowRoot) {
      const shadowChildren = buildShadowRootChildren(element.shadowRoot, counter);
      if (shadowChildren.length) {
        children.push({
          type: "shadow-root",
          nodeId: `${nodeId}:shadow`,
          children: shadowChildren
        });
      }
    }

    for (const child of element.children) {
      if (isExtensionOverlayNode(child)) continue;

      const childNode = buildDomNode(child, counter);
      if (childNode) {
        children.push(childNode);
      }
    }

    return {
      type: "element",
      nodeId,
      tagName: element.tagName.toLowerCase(),
      idAttr: element.id || "",
      classList: Array.from(element.classList || []).slice(0, 4),
      text: getElementTextPreview(element),
      children,
      truncated: lastDomTreeTruncated
    };
  }

  function buildShadowRootChildren(root, counter) {
    const children = [];

    for (const child of root.children) {
      const childNode = buildDomNode(child, counter);
      if (childNode) {
        children.push(childNode);
      }
    }

    return children;
  }

  function getElementTextPreview(element) {
    const directText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!directText) return "";
    return directText.length > MAX_DOM_TEXT_LENGTH
      ? `${directText.slice(0, MAX_DOM_TEXT_LENGTH - 1)}...`
      : directText;
  }

  function getRegisteredElement(nodeId) {
    const element = domNodeRegistry.get(nodeId);
    if (!element || !element.isConnected) {
      throw new Error("Selected DOM node is no longer available.");
    }

    return element;
  }

  function exportRegisteredElement(nodeId) {
    const element = getRegisteredElement(nodeId);
    return exportElement(element, "panel-tree");
  }

  function scrollRegisteredElementIntoView(element) {
    try {
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    } catch (_error) {
      // Some elements (e.g. detached or SVG nodes) reject scrollIntoView options.
    }
  }

  function selectPickedElement(element) {
    selectedElement = element;
    setSelectionElement(element);

    const info = getSelectionInfo(element);
    const nodeId = findRegisteredNodeId(element);

    sendRuntimeMessage({
      type: "ELEMENT_TO_PDF_PICKED",
      nodeId,
      info
    }).catch(() => undefined);

    showToast("Selected. Review it in the panel, then export.", "info");
  }

  function notifyPickerDone() {
    sendRuntimeMessage({ type: "ELEMENT_TO_PDF_PICKER_DONE" }).catch(() => undefined);
  }

  function notifyPickerHover() {
    const now = Date.now();
    if (now - lastPickerHoverNotify < 90) return;
    lastPickerHoverNotify = now;
    sendRuntimeMessage({ type: "ELEMENT_TO_PDF_PICKER_HOVER" }).catch(() => undefined);
  }

  function isTopFrame() {
    try {
      return window.top === window;
    } catch (_error) {
      return false;
    }
  }

  function findRegisteredNodeId(element) {
    for (const [nodeId, node] of domNodeRegistry) {
      if (node === element) return nodeId;
    }
    return null;
  }

  function describeElement(element) {
    let label = element.tagName.toLowerCase();
    if (element.id) {
      label += `#${element.id}`;
    } else {
      label += Array.from(element.classList || [])
        .slice(0, 2)
        .map((className) => `.${className}`)
        .join("");
    }
    return label;
  }

  function getSelectionInfo(element) {
    const rect = getSourcePrintRect(element);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    return {
      label: describeElement(element),
      selector: getReadableSelector(element),
      width,
      height,
      pages: 1,
      orientation: width > height ? "landscape" : "portrait"
    };
  }

  async function exportSelection(options) {
    if (!selectedElement || !selectedElement.isConnected) {
      return {
        ok: false,
        error: "No element is selected. Pick or click an element first."
      };
    }

    return exportElement(selectedElement, "panel", options);
  }

  function sanitizeExportOptions(options) {
    if (!options || typeof options !== "object") return null;

    const clean = {};
    if (typeof options.background === "boolean") clean.background = options.background;
    if (typeof options.saveAs === "boolean") clean.saveAs = options.saveAs;
    if (typeof options.filename === "string" && options.filename.trim()) {
      clean.filename = options.filename.trim();
    }

    return Object.keys(clean).length ? clean : null;
  }

  async function buildCapturePayload(source, captureMode, options = null) {
    pseudoRuleCounter = 0;

    const sourcePrintPayload = buildSourcePrintPayload(source, captureMode, options);
    if (sourcePrintPayload) {
      return sourcePrintPayload;
    }

    const rect = source.getBoundingClientRect();
    const visualPayload = buildVisualCapturePayload(source);
    if (visualPayload) {
      return {
        captureKind: "visual",
        captureMode,
        title: document.title || source.tagName.toLowerCase(),
        sourceUrl: location.href,
        selector: getReadableSelector(source),
        width: clampDimension(visualPayload.width, MAX_CAPTURE_WIDTH),
        height: clampDimension(visualPayload.height, MAX_CAPTURE_HEIGHT),
        screenshotCrop: visualPayload.screenshotCrop
      };
    }

    const width = clampDimension(
      Math.max(rect.width, source.offsetWidth, 1),
      MAX_CAPTURE_WIDTH
    );
    const height = clampDimension(
      Math.max(rect.height, source.scrollHeight, source.offsetHeight, 1),
      MAX_CAPTURE_HEIGHT
    );
    const pseudoCss = [];
    const assetCache = new Map();
    const clone = await cloneElement(source, pseudoCss, assetCache);

    normalizeRootClone(clone, width);

    return {
      captureKind: "dom",
      captureMode,
      title: document.title || source.tagName.toLowerCase(),
      sourceUrl: location.href,
      selector: getReadableSelector(source),
      width,
      height,
      fragment: clone.outerHTML,
      pseudoCss: await replaceCssUrls(pseudoCss.join("\n"), assetCache),
      screenshotCrop: null
    };
  }

  function buildSourcePrintPayload(source, captureMode, options = null) {
    const rect = getSourcePrintRect(source);
    if (!rect || rect.width < 1 || rect.height < 1) return null;

    const sourcePrintId = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    sourcePrintRegistry.set(sourcePrintId, {
      element: source,
      cleanup: null,
      originalTargetAttribute: source.getAttribute("data-element-to-pdf-source-print")
    });

    setTimeout(() => {
      const entry = sourcePrintRegistry.get(sourcePrintId);
      if (entry && !entry.cleanup) {
        sourcePrintRegistry.delete(sourcePrintId);
      }
    }, 120000);

    return {
      captureKind: "source-print",
      captureMode,
      title: document.title || source.tagName.toLowerCase(),
      sourceUrl: location.href,
      selector: getReadableSelector(source),
      sourcePrintId,
      options: sanitizeExportOptions(options),
      width: clampDimension(rect.width, MAX_CAPTURE_WIDTH),
      height: clampDimension(rect.height, MAX_CAPTURE_HEIGHT)
    };
  }

  async function prepareSourcePrint(sourcePrintId) {
    const entry = getSourcePrintEntry(sourcePrintId);
    const element = entry.element;
    const rect = getSourcePrintRect(element);
    const width = clampDimension(rect.width, MAX_CAPTURE_WIDTH);
    const height = clampDimension(rect.height, MAX_CAPTURE_HEIGHT);

    // Collapse the document down to just the selected element so Chrome prints
    // exactly one element-sized page instead of the element followed by blank
    // pages. The previous approach relied on `visibility: hidden`, which keeps
    // every hidden node's layout box, so the body still spanned the full
    // document height and paginated into many empty pages. Here we instead walk
    // the element's ancestor chain and `display: none` every sibling (which
    // actually removes their height), then neutralize each ancestor's own box.
    // The selected element stays live and styled in place.
    const keptAncestors = [];
    const hiddenSiblings = [];
    let child = element;

    while (child) {
      const parent = child.parentNode;
      if (!parent || parent.nodeType === Node.DOCUMENT_NODE) break;

      for (const sibling of parent.children) {
        if (sibling === child || isExtensionOverlayNode(sibling)) continue;
        hiddenSiblings.push({
          element: sibling,
          value: sibling.style.getPropertyValue("display"),
          priority: sibling.style.getPropertyPriority("display")
        });
        sibling.style.setProperty("display", "none", "important");
      }

      const host = parent instanceof ShadowRoot ? parent.host : parent;

      if (
        host instanceof Element &&
        host !== document.documentElement &&
        host !== document.body
      ) {
        host.setAttribute("data-element-to-pdf-keep", sourcePrintId);
        keptAncestors.push(host);
      }

      child = host;
    }

    element.setAttribute("data-element-to-pdf-source-print", sourcePrintId);

    const style = document.createElement("style");
    style.setAttribute("data-element-to-pdf-source-print-style", sourcePrintId);
    style.textContent = buildSourcePrintCss(sourcePrintId, width, height);
    document.documentElement.append(style);

    entry.cleanup = () => {
      style.remove();

      for (const ancestor of keptAncestors) {
        ancestor.removeAttribute("data-element-to-pdf-keep");
      }

      if (entry.originalTargetAttribute === null) {
        element.removeAttribute("data-element-to-pdf-source-print");
      } else {
        element.setAttribute("data-element-to-pdf-source-print", entry.originalTargetAttribute);
      }

      for (const record of hiddenSiblings) {
        if (record.value) {
          record.element.style.setProperty("display", record.value, record.priority);
        } else {
          record.element.style.removeProperty("display");
        }
      }

      entry.cleanup = null;
      sourcePrintRegistry.delete(sourcePrintId);
    };

    await waitForNextPaint();

    return {
      ok: true,
      dimensions: {
        width,
        height
      }
    };
  }

  function restoreSourcePrint(sourcePrintId) {
    const entry = sourcePrintRegistry.get(sourcePrintId);
    if (!entry?.cleanup) return;
    entry.cleanup();
  }

  function getSourcePrintEntry(sourcePrintId) {
    const entry = sourcePrintRegistry.get(sourcePrintId);
    if (!entry?.element?.isConnected) {
      throw new Error("Print target is no longer available.");
    }

    return entry;
  }

  function buildSourcePrintCss(sourcePrintId, width, height) {
    const id = cssEscape(sourcePrintId);
    const targetSelector = `[data-element-to-pdf-source-print="${id}"]`;
    const keepSelector = `[data-element-to-pdf-keep="${id}"]`;

    return `
      @media print {
        @page {
          size: ${width}px ${height}px;
          margin: 0;
        }

        html,
        body {
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          width: ${width}px !important;
          min-width: 0 !important;
          max-width: none !important;
          height: ${height}px !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          display: block !important;
          transform: none !important;
          background: #ffffff !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        ${keepSelector} {
          position: static !important;
          margin: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          width: auto !important;
          min-width: 0 !important;
          max-width: none !important;
          height: auto !important;
          min-height: 0 !important;
          max-height: none !important;
          overflow: visible !important;
          transform: none !important;
          inset: auto !important;
          float: none !important;
          gap: 0 !important;
          grid-template-columns: none !important;
          grid-template-rows: none !important;
          grid-template-areas: none !important;
          background: transparent !important;
          box-shadow: none !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        ${keepSelector}::before,
        ${keepSelector}::after {
          content: none !important;
          display: none !important;
        }

        ${targetSelector} {
          position: static !important;
          margin: 0 !important;
          width: ${width}px !important;
          height: ${height}px !important;
          min-width: 0 !important;
          max-width: none !important;
          min-height: 0 !important;
          max-height: none !important;
          box-sizing: border-box !important;
          transform: none !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        [data-element-to-pdf-overlay],
        [data-element-to-pdf-toast] {
          display: none !important;
          visibility: hidden !important;
        }
      }
    `;
  }

  function buildVisualCapturePayload(source) {
    const rect = getTopDocumentVisualRect(source);
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    const scrollInfo = getScrollableCaptureInfo(source);
    const captureId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

    visualCaptureRegistry.set(captureId, {
      element: source,
      originalScrollTop: source.scrollTop,
      originalScrollLeft: source.scrollLeft
    });

    setTimeout(() => {
      visualCaptureRegistry.delete(captureId);
    }, 120000);

    return {
      captureKind: "visual",
      captureMode: "full-element-screenshot",
      title: document.title || source.tagName.toLowerCase(),
      sourceUrl: location.href,
      selector: getReadableSelector(source),
      width: Math.ceil(rect.width),
      height: Math.ceil(scrollInfo.scrollable ? scrollInfo.scrollHeight : rect.height),
      screenshotCrop: {
        captureId,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: scrollInfo.scrollable ? scrollInfo.scrollHeight : rect.height,
        boxHeight: rect.height,
        scrollable: scrollInfo.scrollable,
        scrollHeight: scrollInfo.scrollHeight,
        clientHeight: scrollInfo.clientHeight,
        viewportWidth: Math.max(1, getTopViewportWidth()),
        viewportHeight: Math.max(1, getTopViewportHeight())
      }
    };
  }

  function getScrollableCaptureInfo(element) {
    const computed = getComputedStyle(element);
    const overflowY = computed.overflowY;
    const allowsVerticalScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    const scrollHeight = Math.ceil(element.scrollHeight || 0);
    const clientHeight = Math.ceil(element.clientHeight || 0);
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);

    if (!allowsVerticalScroll || maxScrollTop <= 1 || clientHeight <= 0) {
      return {
        scrollable: false,
        scrollHeight,
        clientHeight
      };
    }

    const originalScrollTop = element.scrollTop;
    const probeScrollTop = Math.min(maxScrollTop, Math.max(1, originalScrollTop + 1));
    element.scrollTop = probeScrollTop;
    const canActuallyScroll = Math.round(element.scrollTop) !== Math.round(originalScrollTop) || originalScrollTop > 0;
    element.scrollTop = originalScrollTop;

    return {
      scrollable: canActuallyScroll,
      scrollHeight,
      clientHeight
    };
  }

  function getTopDocumentVisualRect(element) {
    const rect = getElementViewportUnionRect(element);
    return translateViewportRectToTopDocument(rect);
  }

  function getSourcePrintRect(element) {
    const rect = element.getBoundingClientRect();
    return translateViewportRectToTopDocument(rect, !isInFixedPositionContext(element));
  }

  function isInFixedPositionContext(element) {
    let node = element;

    while (node && node.nodeType === Node.ELEMENT_NODE) {
      if (getComputedStyle(node).position === "fixed") {
        return true;
      }

      node = node.parentElement;
    }

    return false;
  }

  function getElementViewportUnionRect(element) {
    const base = element.getBoundingClientRect();
    let left = base.left;
    let top = base.top;
    let right = base.right;
    let bottom = base.bottom;

    for (const child of element.querySelectorAll("*")) {
      if (isExtensionOverlayNode(child)) continue;

      for (const rect of child.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;

        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
    }

    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };
  }

  function getTopDocumentRect(element) {
    const rect = element.getBoundingClientRect();
    return translateViewportRectToTopDocument(rect);
  }

  function translateViewportRectToTopDocument(rect, includeScroll = true) {
    let left = rect.left;
    let top = rect.top;
    let currentWindow = window;
    let topWindow = window;

    try {
      while (currentWindow !== currentWindow.parent) {
        const frame = currentWindow.frameElement;
        if (!frame) break;

        const frameRect = frame.getBoundingClientRect();
        left += frameRect.left;
        top += frameRect.top;
        currentWindow = currentWindow.parent;
        topWindow = currentWindow;
      }
    } catch (_error) {
      // Cross-origin frame offsets cannot always be walked. Top-frame captures still work exactly.
    }

    let scrollX = window.scrollX;
    let scrollY = window.scrollY;

    try {
      scrollX = topWindow.scrollX;
      scrollY = topWindow.scrollY;
    } catch (_error) {
      // Keep the local scroll fallback.
    }

    return {
      x: left + (includeScroll ? scrollX : 0),
      y: top + (includeScroll ? scrollY : 0),
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height)
    };
  }

  function getTopDocumentBoxRect(element) {
    const rect = element.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    let currentWindow = window;
    let topWindow = window;

    try {
      while (currentWindow !== currentWindow.parent) {
        const frame = currentWindow.frameElement;
        if (!frame) break;

        const frameRect = frame.getBoundingClientRect();
        left += frameRect.left;
        top += frameRect.top;
        currentWindow = currentWindow.parent;
        topWindow = currentWindow;
      }
    } catch (_error) {
      // Cross-origin frame offsets cannot always be walked.
    }

    let scrollX = window.scrollX;
    let scrollY = window.scrollY;

    try {
      scrollX = topWindow.scrollX;
      scrollY = topWindow.scrollY;
    } catch (_error) {
      // Keep the local scroll fallback.
    }

    return {
      x: left + scrollX,
      y: top + scrollY,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height)
    };
  }

  function getScrollCaptureMetrics(element) {
    const box = getTopDocumentBoxRect(element);

    return {
      ok: true,
      box,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth
    };
  }

  async function scrollCaptureTo(captureId, scrollTop) {
    try {
      const entry = getVisualCaptureEntry(captureId);
      entry.element.scrollTop = Math.max(0, Number(scrollTop) || 0);
      entry.element.scrollLeft = 0;
      await waitForNextPaint();

      return getScrollCaptureMetrics(entry.element);
    } catch (error) {
      return {
        ok: false,
        error: getErrorMessage(error)
      };
    }
  }

  function respondWithElementAction(captureId, sendResponse, action) {
    try {
      const entry = getVisualCaptureEntry(captureId);
      sendResponse(action(entry));
    } catch (error) {
      sendResponse({
        ok: false,
        error: getErrorMessage(error)
      });
    }
  }

  function getVisualCaptureEntry(captureId) {
    const entry = visualCaptureRegistry.get(captureId);
    if (!entry?.element?.isConnected) {
      throw new Error("Capture target is no longer available.");
    }

    return entry;
  }

  function getTopViewportWidth() {
    try {
      return window.top?.innerWidth || window.innerWidth || document.documentElement.clientWidth;
    } catch (_error) {
      return window.innerWidth || document.documentElement.clientWidth;
    }
  }

  function getTopViewportHeight() {
    try {
      return window.top?.innerHeight || window.innerHeight || document.documentElement.clientHeight;
    } catch (_error) {
      return window.innerHeight || document.documentElement.clientHeight;
    }
  }

  async function cloneElement(source, pseudoCss, assetCache) {
    const clone = source.cloneNode(true);
    const sourceElements = [source, ...source.querySelectorAll("*")];
    const cloneElements = [clone, ...clone.querySelectorAll("*")];

    for (let index = 0; index < sourceElements.length; index += 1) {
      const sourceElement = sourceElements[index];
      const cloneElementNode = cloneElements[index];
      if (!cloneElementNode) continue;

      inlineComputedStyle(sourceElement, cloneElementNode);
      copyLiveElementState(sourceElement, cloneElementNode);
      expandScrollableElement(sourceElement, cloneElementNode, index === 0);
      addPseudoElementRules(sourceElement, cloneElementNode, pseudoCss);
      absolutizeResourceAttributes(cloneElementNode);
      replaceCanvasWithImage(sourceElement, cloneElementNode);
    }

    await embedImageElements(sourceElements, cloneElements, assetCache);
    await embedInlineStyleUrls(cloneElements, assetCache);

    return clone;
  }

  function inlineComputedStyle(source, clone) {
    const computed = getComputedStyle(source);
    clone.setAttribute("style", buildStyleText(computed));
  }

  function copyLiveElementState(source, clone) {
    const tagName = source.tagName;

    if (tagName === "INPUT") {
      clone.setAttribute("value", source.value);

      if (source.checked) {
        clone.setAttribute("checked", "");
      } else {
        clone.removeAttribute("checked");
      }
      return;
    }

    if (tagName === "TEXTAREA") {
      clone.textContent = source.value;
      return;
    }

    if (tagName === "SELECT") {
      const sourceOptions = source.querySelectorAll("option");
      const cloneOptions = clone.querySelectorAll("option");

      for (let index = 0; index < sourceOptions.length; index += 1) {
        if (!cloneOptions[index]) continue;

        if (sourceOptions[index].selected) {
          cloneOptions[index].setAttribute("selected", "");
        } else {
          cloneOptions[index].removeAttribute("selected");
        }
      }
    }
  }

  function expandScrollableElement(source, clone, isRoot) {
    const computed = getComputedStyle(source);
    const hasVerticalOverflow = source.scrollHeight > source.clientHeight + 2;
    const isVerticalScrollContainer = computed.overflowY === "auto" || computed.overflowY === "scroll";

    if (hasVerticalOverflow && (isRoot || isVerticalScrollContainer)) {
      clone.style.setProperty("height", `${source.scrollHeight}px`, "important");
      clone.style.setProperty("max-height", "none", "important");
      clone.style.setProperty("overflow-y", "visible", "important");
    }
  }

  function addPseudoElementRules(source, clone, pseudoCss) {
    addPseudoElementRule(source, clone, pseudoCss, "::before");
    addPseudoElementRule(source, clone, pseudoCss, "::after");
  }

  function addPseudoElementRule(source, clone, pseudoCss, pseudo) {
    const computed = getComputedStyle(source, pseudo);
    const content = computed.getPropertyValue("content");

    if (!content || content === "none" || content === "normal") return;
    if (computed.getPropertyValue("display") === "none") return;

    const id = clone.getAttribute("data-element-to-pdf-node") || `n${pseudoRuleCounter += 1}`;
    clone.setAttribute("data-element-to-pdf-node", id);
    pseudoCss.push(`[data-element-to-pdf-node="${cssEscape(id)}"]${pseudo}{${buildStyleText(computed)}}`);
  }

  function replaceCanvasWithImage(source, clone) {
    if (!(source instanceof HTMLCanvasElement) || !(clone instanceof HTMLCanvasElement)) return;

    try {
      const image = document.createElement("img");
      image.src = source.toDataURL("image/png");
      image.setAttribute("style", clone.getAttribute("style") || "");
      image.width = source.width;
      image.height = source.height;
      clone.replaceWith(image);
    } catch (_error) {
      // Tainted canvases cannot be serialized; leave the cloned canvas in place.
    }
  }

  async function embedImageElements(sourceElements, cloneElements, assetCache) {
    for (let index = 0; index < sourceElements.length; index += 1) {
      const sourceElement = sourceElements[index];
      const cloneElementNode = cloneElements[index];
      if (!cloneElementNode) continue;

      const imageUrl = getElementImageUrl(sourceElement);
      if (!imageUrl) continue;

      const dataUrl =
        readRenderedImageDataUrl(sourceElement) ||
        (await resolveAssetDataUrl(imageUrl, assetCache).catch(() => ""));
      if (!dataUrl) continue;

      setCloneImageUrl(cloneElementNode, dataUrl);
    }
  }

  async function embedInlineStyleUrls(cloneElements, assetCache) {
    for (const element of cloneElements) {
      if (!element?.hasAttribute?.("style")) continue;

      const style = element.getAttribute("style");
      if (!style || !style.includes("url(")) continue;

      element.setAttribute("style", await replaceCssUrls(style, assetCache));
    }
  }

  function getElementImageUrl(element) {
    if (element instanceof HTMLImageElement) {
      return element.currentSrc || element.src || element.getAttribute("src") || "";
    }

    if (element instanceof SVGImageElement) {
      return (
        element.href?.baseVal ||
        element.getAttribute("href") ||
        element.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
        ""
      );
    }

    return "";
  }

  function setCloneImageUrl(element, dataUrl) {
    if (element instanceof HTMLImageElement) {
      element.src = dataUrl;
      element.removeAttribute("srcset");
      element.removeAttribute("sizes");

      if (element.parentElement?.tagName === "PICTURE") {
        element.parentElement.querySelectorAll("source").forEach((source) => {
          source.removeAttribute("srcset");
          source.removeAttribute("sizes");
        });
      }
      return;
    }

    if (element instanceof SVGImageElement) {
      element.setAttribute("href", dataUrl);
      element.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
    }
  }

  function readRenderedImageDataUrl(element) {
    if (!(element instanceof HTMLImageElement)) return "";
    if (!element.complete || !element.naturalWidth || !element.naturalHeight) return "";

    try {
      const canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;

      const context = canvas.getContext("2d");
      if (!context) return "";

      context.drawImage(element, 0, 0);
      return canvas.toDataURL("image/png");
    } catch (_error) {
      return "";
    }
  }

  async function replaceCssUrls(cssText, assetCache) {
    if (!cssText || !cssText.includes("url(")) {
      return cssText;
    }

    const matches = Array.from(cssText.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g));
    let replaced = cssText;

    for (const match of matches) {
      const rawUrl = match[2];
      if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("#")) continue;

      const dataUrl = await resolveAssetDataUrl(rawUrl, assetCache).catch(() => "");
      if (!dataUrl) continue;

      replaced = replaced.replace(match[0], `url("${dataUrl}")`);
    }

    return replaced;
  }

  async function resolveAssetDataUrl(url, assetCache) {
    const absoluteUrl = toAbsoluteUrl(url);
    if (!absoluteUrl) return "";
    if (absoluteUrl.startsWith("data:")) return absoluteUrl;

    if (assetCache.has(absoluteUrl)) {
      return assetCache.get(absoluteUrl);
    }

    const pending = fetchAssetDataUrl(absoluteUrl).catch((error) => {
      console.warn("element-to-pdf: asset embed failed", absoluteUrl, error);
      return "";
    });

    assetCache.set(absoluteUrl, pending);
    const dataUrl = await pending;
    assetCache.set(absoluteUrl, dataUrl);
    return dataUrl;
  }

  async function fetchAssetDataUrl(url) {
    if (url.startsWith("blob:")) {
      return fetchAssetInPageContext(url);
    }

    const response = await sendRuntimeMessage({
      type: "ELEMENT_TO_PDF_FETCH_ASSET",
      url
    });

    if (response?.ok && response.dataUrl) {
      return response.dataUrl;
    }

    return fetchAssetInPageContext(url);
  }

  async function fetchAssetInPageContext(url) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "force-cache"
    });

    if (!response.ok) {
      throw new Error(`Could not fetch asset (${response.status}).`);
    }

    const blob = await response.blob();
    if (blob.size > MAX_EMBEDDED_ASSET_BYTES) {
      throw new Error("Asset is too large to embed.");
    }

    return blobToDataUrl(blob);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Could not encode asset."));
      reader.readAsDataURL(blob);
    });
  }

  function absolutizeResourceAttributes(element) {
    for (const attribute of ["src", "href", "poster"]) {
      if (!element.hasAttribute(attribute)) continue;

      const value = element.getAttribute(attribute);
      if (!value || value.startsWith("#")) continue;

      try {
        element.setAttribute(attribute, new URL(value, location.href).href);
      } catch (_error) {
        // Ignore invalid author-provided URLs.
      }
    }

    if (element.hasAttribute("srcset")) {
      element.setAttribute("srcset", absolutizeSrcset(element.getAttribute("srcset")));
    }
  }

  function toAbsoluteUrl(url) {
    if (!url || typeof url !== "string") return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;

    try {
      return new URL(trimmed, location.href).href;
    } catch (_error) {
      return "";
    }
  }

  function absolutizeSrcset(srcset) {
    return srcset
      .split(",")
      .map((candidate) => {
        const parts = candidate.trim().split(/\s+/);
        if (!parts[0]) return "";

        try {
          parts[0] = new URL(parts[0], location.href).href;
        } catch (_error) {
          return candidate.trim();
        }

        return parts.join(" ");
      })
      .filter(Boolean)
      .join(", ");
  }

  function normalizeRootClone(clone, width) {
    const position = clone.style.getPropertyValue("position");

    if (position === "fixed" || position === "absolute") {
      clone.style.setProperty("position", "relative", "important");
      clone.style.setProperty("inset", "auto", "important");
      clone.style.setProperty("left", "auto", "important");
      clone.style.setProperty("right", "auto", "important");
      clone.style.setProperty("top", "auto", "important");
      clone.style.setProperty("bottom", "auto", "important");
    }

    clone.style.setProperty("margin", "0", "important");
    clone.style.setProperty("width", `${width}px`, "important");
    clone.style.setProperty("box-sizing", "border-box", "important");
  }

  function buildStyleText(style) {
    const declarations = [];

    for (const property of CAPTURE_STYLE_PROPERTIES) {
      const value = style.getPropertyValue(property);
      const priority = style.getPropertyPriority(property);

      if (!value) continue;
      declarations.push(`${property}:${value}${priority ? " !important" : ""};`);
    }

    return declarations.join("");
  }

  function ensureOverlay() {
    if (overlayHost && overlayBox && overlayLabel && selectionBox) return;

    overlayHost = document.createElement("div");
    overlayHost.setAttribute("data-element-to-pdf-overlay", "true");
    overlayHost.style.all = "initial";

    const shadow = overlayHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .sel,
        .box {
          position: fixed;
          z-index: 2147483647;
          pointer-events: none;
          box-sizing: border-box;
          display: none;
        }

        .sel {
          border: 2px solid #1a73e8;
          background: rgba(26, 115, 232, 0.10);
        }

        .box {
          border: 1px dashed #1a73e8;
          background: rgba(26, 115, 232, 0.05);
        }

        .label {
          position: fixed;
          z-index: 2147483647;
          pointer-events: none;
          max-width: min(420px, calc(100vw - 24px));
          padding: 4px 7px;
          border-radius: 4px;
          background: #1a73e8;
          color: white;
          font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: none;
        }
      </style>
      <div class="sel"></div>
      <div class="box"></div>
      <div class="label"></div>
    `;

    selectionBox = shadow.querySelector(".sel");
    overlayBox = shadow.querySelector(".box");
    overlayLabel = shadow.querySelector(".label");
    document.documentElement.append(overlayHost);
  }

  function positionBox(box, target) {
    const rect = target.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const left = Math.max(0, Math.min(rect.left, viewportWidth));
    const top = Math.max(0, Math.min(rect.top, viewportHeight));
    const right = Math.max(0, Math.min(rect.right, viewportWidth));
    const bottom = Math.max(0, Math.min(rect.bottom, viewportHeight));

    box.style.display = "block";
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${Math.max(0, right - left)}px`;
    box.style.height = `${Math.max(0, bottom - top)}px`;

    return { left, top };
  }

  // Two independent layers: a persistent "selection" box (solid) and a
  // transient "hover" box (dashed). Hovering a different node never disturbs
  // the current selection — they no longer fight over a single overlay.
  function renderOverlays() {
    ensureOverlay();

    if (selectionEl && selectionEl.isConnected) {
      positionBox(selectionBox, selectionEl);
    } else {
      selectionBox.style.display = "none";
    }

    if (hoverEl && hoverEl.isConnected && hoverEl !== selectionEl) {
      const pos = positionBox(overlayBox, hoverEl);
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      overlayLabel.textContent = getElementLabel(hoverEl);
      overlayLabel.style.display = "block";
      overlayLabel.style.left = `${Math.min(pos.left, viewportWidth - 16)}px`;
      overlayLabel.style.top = `${Math.max(8, pos.top - 28)}px`;
    } else {
      overlayBox.style.display = "none";
      overlayLabel.style.display = "none";
    }
  }

  function setHoverElement(target) {
    hoverEl = target && target !== selectionEl ? target : null;
    renderOverlays();
  }

  function setSelectionElement(target) {
    selectionEl = target || null;
    if (hoverEl === selectionEl) hoverEl = null;
    renderOverlays();
  }

  function clearHoverOverlay() {
    hoverEl = null;
    renderOverlays();
  }

  function clearAllOverlays() {
    hoverEl = null;
    selectionEl = null;
    renderOverlays();
  }

  function scheduleOverlayReposition() {
    if (!hoverEl && !selectionEl) return;
    if (overlayRaf) return;
    overlayRaf = requestAnimationFrame(() => {
      overlayRaf = 0;
      renderOverlays();
    });
  }

  function showToast(message, kind) {
    const host = ensureToastHost();
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.className = `toast ${kind || "info"}`;
    host.append(toast);

    setTimeout(() => {
      toast.remove();
    }, kind === "error" ? 5200 : 2800);
  }

  function ensureToastHost() {
    if (toastHost?.isConnected) {
      return toastHost.shadowRoot.querySelector(".wrap");
    }

    toastHost = document.createElement("div");
    toastHost.setAttribute("data-element-to-pdf-toast", "true");
    toastHost.style.all = "initial";

    const shadow = toastHost.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .wrap {
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483647;
          display: grid;
          gap: 8px;
          max-width: min(360px, calc(100vw - 32px));
          pointer-events: none;
        }

        .toast {
          padding: 9px 11px;
          border-radius: 5px;
          background: #101828;
          color: white;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
          font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .toast.success {
          background: #05603a;
        }

        .toast.error {
          background: #b42318;
        }
      </style>
      <div class="wrap"></div>
    `;

    document.documentElement.append(toastHost);
    return shadow.querySelector(".wrap");
  }

  function getElementFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const target = path.find((node) => node instanceof Element) || event.target;
    return target instanceof Element ? target : null;
  }

  function isExtensionOverlayNode(node) {
    return Boolean(
      node?.closest?.("[data-element-to-pdf-overlay], [data-element-to-pdf-toast]")
    );
  }

  function getElementLabel(element) {
    const id = element.id ? `#${element.id}` : "";
    const classes = Array.from(element.classList || [])
      .slice(0, 3)
      .map((className) => `.${className}`)
      .join("");
    const rect = element.getBoundingClientRect();
    return `${element.tagName.toLowerCase()}${id}${classes} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
  }

  function getReadableSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return "";

    const segments = [];
    let node = element;

    while (node && node.nodeType === Node.ELEMENT_NODE && segments.length < 5) {
      let segment = node.tagName.toLowerCase();

      if (node.id) {
        segment += `#${node.id}`;
        segments.unshift(segment);
        break;
      }

      const classes = Array.from(node.classList || []).slice(0, 2);
      if (classes.length) {
        segment += classes.map((className) => `.${className}`).join("");
      }

      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) {
          segment += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }

      segments.unshift(segment);
      node = parent;
    }

    return segments.join(" > ");
  }

  function clampDimension(value, max) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.ceil(Math.min(value, max));
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) {
      return CSS.escape(value);
    }

    return String(value).replace(/"/g, "\\\"");
  }

  function getErrorMessage(error) {
    if (!error) return "Unknown error.";
    if (typeof error === "string") return error;
    return error.message || String(error);
  }

  function sendRuntimeMessage(message) {
    if (!globalThis.chrome?.runtime?.sendMessage) {
      return Promise.reject(
        new Error("Extension context is stale. Reload this page, then try again.")
      );
    }

    return chrome.runtime.sendMessage(message);
  }

  function waitForNextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }
})();
