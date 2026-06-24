const params = new URLSearchParams(location.search);
const jobId = params.get("job");
const manualPrint = params.get("manual") === "1";
const fallbackReason = params.get("reason") || "";
const captureRoot = document.getElementById("capture-root");
const sourceBase = document.getElementById("source-base");
const statusNode = document.getElementById("print-status");

loadJob();

async function loadJob() {
  try {
    if (!jobId) {
      throw new Error("Missing print job id.");
    }

    const response = await sendRuntimeMessage({
      type: "ELEMENT_PDF_GET_JOB",
      jobId
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not load print job.");
    }

    const job = response.job;
    document.title = `${job.title || "Selected element"} - PDF`;

    if (job.sourceUrl) {
      sourceBase.href = job.sourceUrl;
    }

    if (job.captureKind === "visual") {
      await renderVisualCapture(job);
    } else {
      renderDomCapture(job);
    }

    await waitForRender();
    const dimensions = measureCapture();
    applyPrintSize(dimensions);

    if (manualPrint) {
      setStatus(
        fallbackReason
          ? `Automatic PDF failed: ${fallbackReason}. Opening Chrome print dialog...`
          : "Opening Chrome print dialog...",
        Boolean(fallbackReason)
      );

      setTimeout(() => {
        window.focus();
        window.print();
      }, 250);
      return;
    }

    setStatus("Generating PDF automatically...");
    const printResponse = await sendRuntimeMessage({
      type: "ELEMENT_PDF_PRINT_READY",
      jobId,
      dimensions
    });

    if (!printResponse?.ok) {
      throw new Error(printResponse?.error || "PDF generation failed.");
    }

    if (printResponse.mode === "manual-print") {
      setStatus("Automatic PDF failed. Opening Chrome print dialog...", true);
    } else {
      setStatus("PDF download started.");
    }
  } catch (error) {
    showError(error);
  }
}

function renderDomCapture(job) {
  if (job.pseudoCss) {
    const style = document.createElement("style");
    style.textContent = job.pseudoCss;
    document.head.append(style);
  }

  captureRoot.innerHTML = job.fragment;
}

async function renderVisualCapture(job) {
  if ((!job.screenshotDataUrl && !job.screenshotChunks?.length) || !job.screenshotCrop) {
    throw new Error("Visual screenshot capture is missing.");
  }

  const crop = job.screenshotCrop;
  const image = document.createElement("img");
  image.className = "visual-capture";
  image.src = job.screenshotChunks?.length
    ? await stitchVisualChunks(job)
    : job.screenshotDataUrl;
  image.alt = job.title || "Selected element";
  image.style.width = `${Math.ceil(job.width || crop.width)}px`;
  image.style.height = `${Math.ceil(job.height || crop.height)}px`;

  captureRoot.innerHTML = "";
  captureRoot.append(image);
}

async function stitchVisualChunks(job) {
  const width = Math.max(1, Math.ceil(job.width || job.screenshotCrop.width));
  const height = Math.max(1, Math.ceil(job.height || job.screenshotCrop.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not stitch visual screenshot chunks.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  for (const chunk of job.screenshotChunks) {
    const image = await loadImage(chunk.dataUrl);
    const drawWidth = Math.max(1, Math.ceil(chunk.width || width));
    const drawHeight = Math.max(1, Math.ceil(chunk.sourceHeight || chunk.height || image.naturalHeight));
    context.drawImage(
      image,
      0,
      0,
      image.naturalWidth,
      image.naturalHeight,
      Math.ceil(chunk.x || 0),
      Math.ceil(chunk.y || 0),
      drawWidth,
      drawHeight
    );
  }

  return canvas.toDataURL("image/png");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load screenshot chunk."));
    image.src = src;
  });
}

async function waitForRender() {
  if (document.fonts?.ready) {
    await document.fonts.ready.catch(() => undefined);
  }

  await Promise.allSettled(
    Array.from(document.images)
      .filter((image) => !image.complete)
      .map((image) =>
        new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        })
      )
  );

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function measureCapture() {
  const firstElement = captureRoot.firstElementChild || captureRoot;
  const rect = firstElement.getBoundingClientRect();
  const width = Math.ceil(Math.max(rect.width, firstElement.scrollWidth, captureRoot.scrollWidth, 1));
  const height = Math.ceil(Math.max(rect.height, firstElement.scrollHeight, captureRoot.scrollHeight, 1));

  return {
    width,
    height
  };
}

function applyPrintSize(dimensions) {
  document.documentElement.style.width = `${dimensions.width}px`;
  document.documentElement.style.height = `${dimensions.height}px`;
  document.body.style.width = `${dimensions.width}px`;
  document.body.style.height = `${dimensions.height}px`;
}

function showError(error) {
  setStatus("PDF export failed.", true);
  captureRoot.innerHTML = "";

  const panel = document.createElement("section");
  panel.className = "element-pdf-error";

  const heading = document.createElement("h1");
  heading.textContent = "Element PDF export failed";

  const details = document.createElement("p");
  details.textContent = error?.message || String(error || "Unknown error.");

  panel.append(heading, details);
  captureRoot.append(panel);
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", Boolean(isError));
}

function sendRuntimeMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return Promise.reject(new Error("Extension runtime is not available. Reload the extension and try again."));
  }

  return chrome.runtime.sendMessage(message);
}
