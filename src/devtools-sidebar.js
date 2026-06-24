const exportButton = document.getElementById("export");
const selectionNode = document.getElementById("selection");
const statusNode = document.getElementById("status");

exportButton.addEventListener("click", exportSelectedElement);
chrome.devtools.panels.elements.onSelectionChanged.addListener(updateSelectionSummary);
updateSelectionSummary();

function updateSelectionSummary() {
  chrome.devtools.inspectedWindow.eval(
    `(() => {
      const el = $0;
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        className: String(el.className || "").trim().replace(/\\s+/g, "."),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    })()`,
    (result, exceptionInfo) => {
      if (exceptionInfo?.isException || !result) {
        exportButton.disabled = true;
        selectionNode.textContent = "No element selected.";
        return;
      }

      exportButton.disabled = false;
      const id = result.id ? `#${result.id}` : "";
      const className = result.className ? `.${result.className}` : "";
      selectionNode.textContent = `${result.tag}${id}${className} ${result.width}x${result.height}`;
    }
  );
}

async function exportSelectedElement() {
  setStatus("Preparing selected element...", false);
  exportButton.disabled = true;

  try {
    await sendRuntimeMessage({
      type: "ELEMENT_PDF_INJECT_ALL_FRAMES",
      tabId: chrome.devtools.inspectedWindow.tabId
    });

    const token = crypto.randomUUID();
    const expression = `(() => {
      const el = $0;
      if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        return { ok: false, error: "No element is selected in Elements." };
      }

      const handled = !el.dispatchEvent(new CustomEvent("${"__ELEMENT_PDF_DEVTOOLS_EXPORT__"}", {
        bubbles: true,
        composed: true,
        cancelable: true,
        detail: { token: "${token}" }
      }));

      return handled
        ? { ok: true }
        : { ok: false, error: "The page frame did not receive the export request." };
    })()`;

    chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
      exportButton.disabled = false;

      if (exceptionInfo?.isException) {
        setStatus(exceptionInfo.value || "DevTools evaluation failed.", true);
        return;
      }

      if (!result?.ok) {
        setStatus(result?.error || "No selected element.", true);
        return;
      }

      setStatus("Export request sent.", false);
    });
  } catch (error) {
    exportButton.disabled = false;
    setStatus(error?.message || String(error), true);
  }
}

function setStatus(message, isError) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", Boolean(isError));
}

function sendRuntimeMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error("Extension runtime is not available. Reload the extension and DevTools."));
  }

  return chrome.runtime.sendMessage(message);
}
