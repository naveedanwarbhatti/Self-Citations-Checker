"use strict";
// content.ts
// --- UI Injection and Updates ---
function injectUI() {
    const container = document.getElementById('gsc_prf_in');
    if (container && !document.getElementById('self-citation-analyzer')) {
        const uiElement = document.createElement('div');
        uiElement.id = 'self-citation-analyzer';
        uiElement.style.padding = '10px';
        uiElement.style.marginTop = '10px';
        uiElement.style.border = '1px solid #ccc';
        uiElement.style.borderRadius = '5px';
        uiElement.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px;">DBLP Self-Citation</div>
      <div id="sca-status">Calculating... <span id="sca-spinner"></span></div>
      <button id="sca-refresh" style="display:none; cursor: pointer; margin-top: 5px; font-size: 12px; padding: 2px 8px;">Refresh</button>
    `;
        const style = document.createElement('style');
        style.innerHTML = `
      @keyframes sca-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      #sca-spinner {
          display: inline-block; border: 2px solid #f3f3f3; border-top: 2px solid #3498db;
          border-radius: 50%; width: 12px; height: 12px; animation: sca-spin 1s linear infinite;
      }`;
        document.head.appendChild(style);
        container.insertAdjacentElement('afterend', uiElement);
        document.getElementById('sca-refresh')?.addEventListener('click', () => {
            const scholarId = new URL(window.location.href).searchParams.get("user");
            if (scholarId) {
                chrome.storage.local.remove(scholarId, () => {
                    console.log("Cache cleared. Reloading for fresh data...");
                    window.location.reload();
                });
            }
        });
    }
}
function updateUI(response) {
    const statusDiv = document.getElementById('sca-status');
    if (!statusDiv)
        return;
    document.getElementById('sca-spinner').style.display = 'none';
    document.getElementById('sca-refresh').style.display = 'block';
    if (response.status === 'success') {
        const { selfCitations, totalCitations, percentage } = response;
        statusDiv.innerHTML = `
      <strong style="font-size: 1.2em;" title="Self-Citation Percentage">${percentage.toFixed(1)}%</strong>
      <div title="Raw numbers: ${selfCitations} self-citations / ${totalCitations} total citations (from DBLP)">
        (${selfCitations} / ${totalCitations})
      </div>`;
    }
    else {
        statusDiv.innerHTML = `<span style="color: red;">Error:</span> ${response.message}`;
    }
}
// --- Main Analysis Function ---
async function runAnalysis() {
    injectUI();
    const scholarId = new URL(window.location.href).searchParams.get("user");
    if (!scholarId) {
        updateUI({ status: 'error', message: 'Could not get Google Scholar user ID.' });
        return;
    }
    const cache = await chrome.storage.local.get(scholarId);
    const cachedData = cache[scholarId];
    const isCacheValid = cachedData && (Date.now() - cachedData.timestamp < 24 * 60 * 60 * 1000);
    if (isCacheValid) {
        console.log("DBLP Analyzer: Loading from valid cache.");
        updateUI(cachedData.data);
        return;
    }
    const authorName = document.getElementById('gsc_prf_in')?.innerText.trim();
    if (!authorName) {
        updateUI({ status: 'error', message: 'Could not extract author name from page.' });
        return;
    }
    // The verification logic is now handled entirely in the background script
    const publicationTitles = Array.from(document.querySelectorAll('.gsc_a_at'))
        .slice(0, 20)
        .map(el => el.innerText);
    chrome.runtime.sendMessage({ action: "processAuthor", authorName, publicationTitles }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Message passing error:", chrome.runtime.lastError.message);
            updateUI({ status: 'error', message: 'Internal extension communication error.' });
            return;
        }
        updateUI(response);
        if (response.status === 'success') {
            const cacheEntry = { data: response, timestamp: Date.now() };
            chrome.storage.local.set({ [scholarId]: cacheEntry });
        }
    });
}
window.addEventListener('load', runAnalysis);
