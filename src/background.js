const MENU_PICK = "element-pdf:start-picker";
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const JOB_DB_NAME = "element-pdf-extractor";
const JOB_DB_VERSION = 1;
const JOB_STORE_NAME = "print-jobs";
const PRINT_READY_DELAY_MS = 350;
const DEBUGGER_ATTACH_TIMEOUT_MS = 5000;
const PDF_COMMAND_TIMEOUT_MS = 12000;
const SCREENSHOT_COMMAND_TIMEOUT_MS = 12000;
const DOWNLOAD_TIMEOUT_MS = 10000;
const MAX_PAPER_INCHES = 200;
const MIN_PAPER_INCHES = 1;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_PICK,
      title: "Pick element for PDF",
      contexts: ["all"]
    });
  });
});

// Clicking the toolbar icon opens the docked side panel (a DevTools-like tree
// that stays pinned) instead of a transient popup that closes on blur.
enableSidePanelOnActionClick();

function enableSidePanelOnActionClick() {
  chrome.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch((error) => console.warn("Element PDF: could not configure side panel", error));
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  const frameId = typeof info.frameId === "number" ? info.frameId : 0;

  if (info.menuItemId === MENU_PICK) {
    startPickerInFrame(tab.id, frameId);
    return;
  }

});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return false;
  }

  if (message.type === "ELEMENT_PDF_PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "ELEMENT_PDF_INJECT_ALL_FRAMES") {
    withAsyncResponse(sendResponse, async () => {
      if (!Number.isInteger(message.tabId)) {
        throw new Error("Missing tabId.");
      }

      await ensureContentScriptAllFrames(message.tabId);
      return { ok: true };
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_SNAPSHOT") {
    withAsyncResponse(sendResponse, async () => {
      return createPrintJob(message.payload, sender);
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_FETCH_ASSET") {
    withAsyncResponse(sendResponse, async () => {
      const dataUrl = await fetchAssetAsDataUrl(message.url);
      return { ok: true, dataUrl };
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_GET_JOB") {
    withAsyncResponse(sendResponse, async () => {
      const job = await getPrintJob(message.jobId);
      return { ok: true, job };
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_PRINT_READY") {
    withAsyncResponse(sendResponse, async () => {
      const tabId = sender.tab?.id;
      if (!Number.isInteger(tabId)) {
        throw new Error("Print page did not provide a tab id.");
      }

      return printTabToPdf(tabId, message.jobId, message.dimensions);
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_GET_DOM_TREE_FOR_TAB") {
    withAsyncResponse(sendResponse, async () => {
      const tabId = validateTabId(message.tabId);
      await ensureContentScript(tabId, 0);
      return sendMessageToFrame(tabId, 0, {
        type: "ELEMENT_PDF_GET_DOM_TREE"
      });
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_HIGHLIGHT_NODE_FOR_TAB") {
    withAsyncResponse(sendResponse, async () => {
      const tabId = validateTabId(message.tabId);
      await ensureContentScript(tabId, 0);
      return sendMessageToFrame(tabId, 0, {
        type: "ELEMENT_PDF_HIGHLIGHT_NODE",
        nodeId: message.nodeId,
        scrollIntoView: message.scrollIntoView === true
      });
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_EXPORT_NODE_FOR_TAB") {
    withAsyncResponse(sendResponse, async () => {
      const tabId = validateTabId(message.tabId);
      await ensureContentScript(tabId, 0);
      return sendMessageToFrame(tabId, 0, {
        type: "ELEMENT_PDF_EXPORT_NODE",
        nodeId: message.nodeId
      });
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_CLEAR_HIGHLIGHT_FOR_TAB") {
    withAsyncResponse(sendResponse, async () => {
      const tabId = validateTabId(message.tabId);
      await ensureContentScript(tabId, 0);
      return sendMessageToFrame(tabId, 0, {
        type: "ELEMENT_PDF_CLEAR_HIGHLIGHT"
      });
    });
    return true;
  }

  if (message.type === "ELEMENT_PDF_START_PICKER_FOR_TAB") {
    withAsyncResponse(sendResponse, async () => {
      const tabId = validateTabId(message.tabId);
      await startPickerInAllFrames(tabId);
      return { ok: true };
    });
    return true;
  }

  return false;
});

async function startPickerInFrame(tabId, frameId) {
  try {
    await ensureContentScript(tabId, frameId);
    await sendMessageToFrame(tabId, frameId, {
      type: "ELEMENT_PDF_START_PICKER"
    });
  } catch (error) {
    console.warn("Element PDF: could not start picker", error);
  }
}

async function startPickerInAllFrames(tabId) {
  try {
    const frameIds = await getInspectableFrameIds(tabId);
    await Promise.allSettled(frameIds.map((frameId) => ensureContentScript(tabId, frameId)));
    await Promise.allSettled(
      frameIds.map((frameId) =>
        sendMessageToFrame(tabId, frameId, {
          type: "ELEMENT_PDF_START_PICKER"
        })
      )
    );
  } catch (error) {
    console.warn("Element PDF: could not start picker in frames", error);
  }
}

async function createPrintJob(payload, sender) {
  validatePayload(payload);

  if (payload.captureKind === "source-print") {
    return printSourceElementToPdf(payload, sender);
  }

  const jobId = crypto.randomUUID();
  const visualCapture = await captureVisualPayload(payload, sender);
  const captureKind = visualCapture ? "visual" : "dom";
  const job = {
    id: jobId,
    createdAt: new Date().toISOString(),
    sourceTabId: sender.tab?.id ?? null,
    sourceFrameId: sender.frameId ?? null,
    title: payload.title || "Selected element",
    sourceUrl: payload.sourceUrl || "",
    captureKind,
    fragment: payload.fragment || "",
    pseudoCss: payload.pseudoCss || "",
    screenshotDataUrl: visualCapture?.dataUrl || "",
    screenshotChunks: visualCapture?.chunks || [],
    screenshotCrop: captureKind === "visual" ? payload.screenshotCrop : null,
    width: normalizeDimension(payload.width, 800),
    height: normalizeDimension(payload.height, 1100),
    selector: payload.selector || "",
    captureMode: payload.captureMode || "unknown"
  };

  await putPrintJob(job);

  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`print.html?job=${encodeURIComponent(jobId)}`),
    active: true
  });

  return {
    ok: true,
    jobId,
    printTabId: tab.id ?? null
  };
}

async function printSourceElementToPdf(payload, sender) {
  const tabId = sender.tab?.id;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;

  if (!Number.isInteger(tabId)) {
    throw new Error("Source tab is unavailable for PDF generation.");
  }

  const job = {
    id: payload.sourcePrintId || crypto.randomUUID(),
    sourceTabId: tabId,
    sourceFrameId: frameId,
    title: payload.title || "Selected element",
    sourceUrl: payload.sourceUrl || "",
    selector: payload.selector || "",
    width: normalizeDimension(payload.width, 800),
    height: normalizeDimension(payload.height, 1100)
  };
  const debuggee = { tabId };
  let attached = false;
  let prepared = false;

  try {
    await sendExportStatus(job, "Preparing source page for PDF...", "info");

    const prepareResponse = await sendMessageToFrame(tabId, frameId, {
      type: "ELEMENT_PDF_PREPARE_SOURCE_PRINT",
      sourcePrintId: payload.sourcePrintId
    });

    if (!prepareResponse?.ok) {
      throw new Error(prepareResponse?.error || "Could not prepare selected element for printing.");
    }

    prepared = true;

    const dimensions = prepareResponse.dimensions || {};
    const width = normalizeDimension(dimensions.width, job.width);
    const height = normalizeDimension(dimensions.height, job.height);
    const paperWidth = pxToPaperInches(width);
    const paperHeight = pxToPaperInches(height);

    await delay(PRINT_READY_DELAY_MS);

    await withTimeout(
      chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      "Timed out while attaching Chrome debugger to the source tab."
    );
    attached = true;

    await withTimeout(
      chrome.debugger.sendCommand(debuggee, "Page.enable"),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      "Timed out while enabling the source page."
    );

    const result = await withTimeout(
      chrome.debugger.sendCommand(debuggee, "Page.printToPDF", {
        landscape: false,
        displayHeaderFooter: false,
        printBackground: true,
        preferCSSPageSize: true,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        paperWidth,
        paperHeight,
        scale: 1,
        pageRanges: "1"
      }),
      PDF_COMMAND_TIMEOUT_MS,
      "Timed out while Chrome was creating the PDF."
    );

    if (!result?.data) {
      throw new Error("Chrome did not return PDF data.");
    }

    await withTimeout(
      chrome.downloads.download({
        url: `data:application/pdf;base64,${result.data}`,
        filename: makeFilename(job),
        saveAs: true
      }),
      DOWNLOAD_TIMEOUT_MS,
      "Timed out while starting the PDF download."
    );

    await sendExportStatus(job, "PDF download started.", "success");

    return {
      ok: true,
      mode: "source-print"
    };
  } catch (error) {
    await sendExportStatus(job, getErrorMessage(error), "error");
    throw error;
  } finally {
    if (attached) {
      await chrome.debugger.detach(debuggee).catch(() => undefined);
    }

    if (prepared) {
      await sendMessageToFrame(tabId, frameId, {
        type: "ELEMENT_PDF_RESTORE_SOURCE_PRINT",
        sourcePrintId: payload.sourcePrintId
      }).catch(() => undefined);
    }
  }
}

async function captureVisualPayload(payload, sender) {
  if (payload.captureKind !== "visual" || !payload.screenshotCrop) {
    return null;
  }

  const visualCapture = await captureElementVisual(sender, payload.screenshotCrop);
  if (visualCapture?.dataUrl || visualCapture?.chunks?.length) {
    return visualCapture;
  }

  throw new Error("Visual capture did not return image data.");
}

async function getPrintJob(jobId) {
  if (!jobId || typeof jobId !== "string") {
    throw new Error("Missing print job id.");
  }

  const job = await readPrintJob(jobId);

  if (!job) {
    throw new Error("Print job expired or was not found.");
  }

  return job;
}

async function printTabToPdf(tabId, jobId, dimensions) {
  const job = await getPrintJob(jobId);
  const width = normalizeDimension(dimensions?.width, job.width);
  const height = normalizeDimension(dimensions?.height, job.height);
  const paperWidth = pxToPaperInches(width);
  const paperHeight = pxToPaperInches(height);
  const debuggee = { tabId };
  let attached = false;

  await delay(PRINT_READY_DELAY_MS);

  try {
    await sendExportStatus(job, "Generating PDF...", "info");

    await withTimeout(
      chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      "Timed out while attaching Chrome debugger."
    );
    attached = true;
    await withTimeout(
      chrome.debugger.sendCommand(debuggee, "Page.enable"),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      "Timed out while enabling the print page."
    );

    const result = await withTimeout(
      chrome.debugger.sendCommand(debuggee, "Page.printToPDF", {
        landscape: paperWidth > paperHeight,
        displayHeaderFooter: false,
        printBackground: true,
        preferCSSPageSize: false,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        paperWidth,
        paperHeight,
        scale: 1
      }),
      PDF_COMMAND_TIMEOUT_MS,
      "Timed out while Chrome was creating the PDF."
    );

    if (!result?.data) {
      throw new Error("Chrome did not return PDF data.");
    }

    await withTimeout(
      chrome.downloads.download({
        url: `data:application/pdf;base64,${result.data}`,
        filename: makeFilename(job),
        saveAs: true
      }),
      DOWNLOAD_TIMEOUT_MS,
      "Timed out while starting the PDF download."
    );

    await cleanupPrintJob(jobId, tabId);
    await sendExportStatus(job, "PDF download started.", "success");
    return { ok: true, mode: "download" };
  } catch (error) {
    console.warn("Element PDF: automatic PDF generation failed; falling back to print dialog", error);
    await sendExportStatus(job, "Automatic PDF failed. Opening Chrome print dialog.", "error");
    return openManualPrintFallback(tabId, jobId, error);
  } finally {
    if (attached) {
      await chrome.debugger.detach(debuggee).catch(() => undefined);
    }
  }
}

async function openManualPrintFallback(tabId, jobId, error) {
  const url = chrome.runtime.getURL(
    `print.html?job=${encodeURIComponent(jobId)}&manual=1&reason=${encodeURIComponent(getErrorMessage(error))}`
  );

  await chrome.tabs.update(tabId, {
    url,
    active: true
  });

  return {
    ok: true,
    mode: "manual-print",
    error: getErrorMessage(error)
  };
}

async function cleanupPrintJob(jobId, tabId) {
  await deletePrintJob(jobId).catch(() => undefined);
  if (Number.isInteger(tabId)) {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

function openJobDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(JOB_DB_NAME, JOB_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(JOB_STORE_NAME)) {
        db.createObjectStore(JOB_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open print job database."));
  });
}

async function withJobStore(mode, operation) {
  const db = await openJobDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(JOB_STORE_NAME, mode);
    const store = transaction.objectStore(JOB_STORE_NAME);
    let operationResult;

    transaction.oncomplete = () => {
      db.close();
      resolve(operationResult);
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Print job database transaction failed."));
    };

    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("Print job database transaction aborted."));
    };

    try {
      const request = operation(store);

      if (request && "onsuccess" in request) {
        request.onsuccess = () => {
          operationResult = request.result;
        };
      } else {
        operationResult = request;
      }
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function putPrintJob(job) {
  return withJobStore("readwrite", (store) => store.put(job));
}

function readPrintJob(jobId) {
  return withJobStore("readonly", (store) => store.get(jobId));
}

function deletePrintJob(jobId) {
  return withJobStore("readwrite", (store) => store.delete(jobId));
}

async function fetchAssetAsDataUrl(url) {
  const normalizedUrl = normalizeFetchUrl(url);

  if (normalizedUrl.startsWith("data:")) {
    return normalizedUrl;
  }

  const response = await fetch(normalizedUrl, {
    credentials: "include",
    cache: "force-cache"
  });

  if (!response.ok) {
    throw new Error(`Could not fetch asset (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") || guessMimeType(normalizedUrl);
  const buffer = await response.arrayBuffer();
  return `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
}

function normalizeFetchUrl(url) {
  if (!url || typeof url !== "string") {
    throw new Error("Missing asset URL.");
  }

  const parsed = new URL(url);
  if (!["http:", "https:", "data:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported asset URL protocol: ${parsed.protocol}`);
  }

  return parsed.href;
}

function guessMimeType(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".avif")) return "image/avif";
  return "application/octet-stream";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

async function ensureContentScriptAllFrames(tabId) {
  const frameIds = await getInspectableFrameIds(tabId);
  await Promise.allSettled(frameIds.map((frameId) => ensureContentScript(tabId, frameId)));
}

async function ensureContentScript(tabId, frameId) {
  try {
    await sendMessageToFrame(tabId, frameId, { type: "ELEMENT_PDF_PING" });
    return;
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: [frameId]
      },
      files: ["src/content-script.js"]
    });
  }
}

async function getInspectableFrameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const frameIds = frames
      .map((frame) => frame.frameId)
      .filter((frameId) => Number.isInteger(frameId));

    return frameIds.length ? frameIds : [0];
  } catch (_error) {
    return [0];
  }
}

function sendMessageToFrame(tabId, frameId, message) {
  if (!chrome.tabs?.sendMessage) {
    return Promise.reject(new Error("chrome.tabs.sendMessage is not available in this context."));
  }

  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

function withAsyncResponse(sendResponse, task) {
  task()
    .then((result) => {
      sendResponse(result);
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: getErrorMessage(error)
      });
    });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Missing capture payload.");
  }

  const hasDomFragment = payload.fragment && typeof payload.fragment === "string";
  const hasVisualCrop = payload.captureKind === "visual" && payload.screenshotCrop;
  const hasSourcePrintTarget = payload.captureKind === "source-print" && payload.sourcePrintId;

  if (!hasDomFragment && !hasVisualCrop && !hasSourcePrintTarget) {
    throw new Error("Missing captured element HTML.");
  }
}

function validateTabId(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Missing tab id.");
  }

  return tabId;
}

async function captureElementVisual(sender, crop) {
  if (crop.scrollable && crop.captureId) {
    return captureScrollableElementVisual(sender, crop);
  }

  return {
    dataUrl: await captureElementScreenshot(sender, crop),
    chunks: []
  };
}

async function captureElementScreenshot(sender, crop) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    throw new Error("Source tab is unavailable for screenshot capture.");
  }

  const debuggee = { tabId };
  let attached = false;

  try {
    await withTimeout(
      chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      "Timed out while attaching Chrome debugger to the source tab."
    );
    attached = true;

    await withTimeout(
      chrome.debugger.sendCommand(debuggee, "Page.enable"),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      "Timed out while enabling screenshot capture."
    );

    const result = await withTimeout(
      captureScreenshotClip(debuggee, {
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height
      }),
      SCREENSHOT_COMMAND_TIMEOUT_MS,
      "Timed out while capturing the full element screenshot."
    );

    return result;
  } finally {
    if (attached) {
      await chrome.debugger.detach(debuggee).catch(() => undefined);
    }
  }
}

async function captureScrollableElementVisual(sender, crop) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    throw new Error("Source tab is unavailable for scroll capture.");
  }

  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  const debuggee = { tabId };
  const chunks = [];
  let attached = false;

  try {
    await withTimeout(
      chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      "Timed out while attaching Chrome debugger to the source tab."
    );
    attached = true;

    await withTimeout(
      chrome.debugger.sendCommand(debuggee, "Page.enable"),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      "Timed out while enabling scroll screenshot capture."
    );

    const initialMetrics = await sendMessageToFrame(tabId, frameId, {
      type: "ELEMENT_PDF_PREPARE_SCROLL_CAPTURE",
      captureId: crop.captureId
    });

    if (!initialMetrics?.ok) {
      throw new Error(initialMetrics?.error || "Could not prepare scroll capture.");
    }

    const clientHeight = Math.max(1, initialMetrics.clientHeight || crop.boxHeight || crop.height);
    const scrollHeight = Math.max(clientHeight, initialMetrics.scrollHeight || crop.scrollHeight || crop.height);
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const step = Math.max(1, clientHeight - 1);
    const scrollTops = [];

    for (let scrollTop = 0; scrollTop < maxScrollTop; scrollTop += step) {
      scrollTops.push(scrollTop);
    }
    scrollTops.push(maxScrollTop);

    const seen = new Set();
    for (const requestedScrollTop of scrollTops) {
      const metrics = await sendMessageToFrame(tabId, frameId, {
        type: "ELEMENT_PDF_SCROLL_CAPTURE_TO",
        captureId: crop.captureId,
        scrollTop: requestedScrollTop
      });

      if (!metrics?.ok) {
        throw new Error(metrics?.error || "Could not scroll selected element.");
      }

      const actualScrollTop = Math.round(metrics.scrollTop || 0);
      if (seen.has(actualScrollTop)) {
        continue;
      }
      seen.add(actualScrollTop);

      const box = metrics.box || initialMetrics.box;
      const visibleHeight = Math.min(clientHeight, scrollHeight - actualScrollTop);
      const dataUrl = await withTimeout(
        captureScreenshotClip(debuggee, {
          x: box.x,
          y: box.y,
          width: box.width,
          height: Math.min(box.height, clientHeight)
        }),
        SCREENSHOT_COMMAND_TIMEOUT_MS,
        "Timed out while capturing a scroll chunk."
      );

      chunks.push({
        dataUrl,
        x: 0,
        y: actualScrollTop,
        width: box.width,
        height: Math.max(1, visibleHeight),
        sourceHeight: Math.min(box.height, clientHeight)
      });
    }

    return {
      dataUrl: "",
      chunks
    };
  } finally {
    await sendMessageToFrame(tabId, frameId, {
      type: "ELEMENT_PDF_RESTORE_SCROLL_CAPTURE",
      captureId: crop.captureId
    }).catch(() => undefined);

    if (attached) {
      await chrome.debugger.detach(debuggee).catch(() => undefined);
    }
  }
}

async function captureScreenshotClip(debuggee, clip) {
  const result = await chrome.debugger.sendCommand(debuggee, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: {
      x: normalizeCoordinate(clip.x),
      y: normalizeCoordinate(clip.y),
      width: normalizeDimension(clip.width, 1),
      height: normalizeDimension(clip.height, 1),
      scale: 1
    }
  });

  if (!result?.data) {
    throw new Error("Chrome did not return screenshot data.");
  }

  return `data:image/png;base64,${result.data}`;
}

function normalizeDimension(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.ceil(Math.min(Math.max(number, 1), 19200));
}

function normalizeCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, number);
}

function pxToPaperInches(px) {
  const inches = px / 96;
  return Math.min(Math.max(inches, MIN_PAPER_INCHES), MAX_PAPER_INCHES);
}

function makeFilename(job) {
  const title = (job.title || "selected-element")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${title || "selected-element"}-${stamp}.pdf`;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function sendExportStatus(job, message, kind) {
  try {
    if (!Number.isInteger(job?.sourceTabId) || !chrome.tabs?.sendMessage) return;

    await chrome.tabs
      .sendMessage(
        job.sourceTabId,
        {
          type: "ELEMENT_PDF_EXPORT_STATUS",
          message,
          kind
        },
        Number.isInteger(job.sourceFrameId) ? { frameId: job.sourceFrameId } : undefined
      )
      .catch(() => undefined);
  } catch (_error) {
    // Status messages are best-effort and must not break PDF generation.
  }
}

function getErrorMessage(error) {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  return error.message || String(error);
}
