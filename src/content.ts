// content.ts

// Make sure to import the types from 'types.ts' in your actual project setup
// For this example, the interface is redefined here for completeness.
interface ApiResponse {
  status: 'success' | 'error' | 'rate_limit_error';
  percentage?: number;
  message?: string;
}

/**
 * Modifies the "Cited by" table to include a column for self-citation analysis.
 */
function injectUI(): void {
  const statsTable = document.getElementById('gsc_rsb_st');
  // Exit if the table isn't found or if our UI has already been injected.
  if (!statsTable || document.getElementById('sca-cell-content')) {
    return;
  }

  // 1. Inject the CSS for the new UI elements.
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .sca-loading-container { display: flex; align-items: center; justify-content: center; gap: 8px; }
    .sca-spinner { border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; width: 16px; height: 16px; animation: spin 1s linear infinite; }
    .sca-container { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; height: 100%; }
    .sca-percentage { font-size: 28px; font-weight: 400; color: #d93025; }
    .sca-controls { display: flex; align-items: center; justify-content: center; gap: 8px; }
    .sca-tooltip-icon { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; font-size: 14px; font-weight: bold; cursor: help; color: #777; border: 1px solid #ccc; background-color: #f9f9f9; }
    .sca-refresh-button { cursor: pointer; font-size: 12px; padding: 2px 8px; border-radius: 100px; border: none; background-color: #e8f5e9; color: #0f9d58; font-weight: 500; }
    #sca-cell-content { vertical-align: middle; text-align: center; }
  `;
  document.head.appendChild(style);

  // 2. Add the new "Self-Citation Rate" header to the table.
  const headerRow = statsTable.querySelector('thead tr');
  if (headerRow) {
    const newHeader = document.createElement('th');
    newHeader.className = 'gsc_rsb_sth';
    newHeader.innerText = 'Self-Citation Rate';
    headerRow.appendChild(newHeader);
  }

  // 3. Add the new cell to the first data row, spanning all three rows.
  const firstDataRow = statsTable.querySelector('tbody tr:first-child');
  if (firstDataRow) {
    const newCell = document.createElement('td');
    newCell.id = 'sca-cell-content';
    newCell.rowSpan = 3;
    newCell.innerHTML = `<div class="sca-loading-container"><div class="sca-spinner"></div><span>Calculating...</span></div>`;
    firstDataRow.appendChild(newCell);
  }
}

/**
 * NEW: Renders a specific UI panel when a DBLP rate-limit error occurs.
 */
function displayDblpRateLimitError(message: string): void {
    const contentCell = document.getElementById('sca-cell-content');
    if (!contentCell) return;

    contentCell.innerHTML = `
      <div class="sca-container" style="text-align: center; padding: 5px;">
        <div style="font-weight: 500; margin-bottom: 8px; color: #d93025;">DBLP Service Busy</div>
        <div style="font-size: 13px; color: #555; margin-bottom: 12px;">
          ${message}
        </div>
        <button id="sca-try-again" class="sca-refresh-button">Try Again</button>
      </div>
    `;

    document.getElementById('sca-try-again')?.addEventListener('click', () => {
        window.location.reload();
    });
}

/**
 * UPDATED: The main UI function now handles the 'rate_limit_error' status.
 */
function updateUI(response: ApiResponse): void {
  const contentCell = document.getElementById('sca-cell-content');
  if (!contentCell) return;

  // NEW: Check for the rate limit status first.
  if (response.status === 'rate_limit_error' && response.message) {
      displayDblpRateLimitError(response.message);
      return;
  }

  const disclaimer = `Definition: A 'self-citation' is when the citing paper and the cited paper share at least one author.\n\nData Sources: Author data is from DBLP. Citation data is from the DBLP-OpenCitations integration.\n\nDisclaimer: The citation coverage from these sources is not 100% complete.`;

  if (response.status === 'success' && response.percentage !== undefined) {
    const selfCitePercent = response.percentage;
    
    contentCell.innerHTML = `
      <div class="sca-container">
        <div class="sca-percentage">${selfCitePercent.toFixed(1)}%</div>
        <div class="sca-controls">
          <span class="sca-tooltip-icon" title="${disclaimer}">?</span>
          <button id="sca-refresh" class="sca-refresh-button">Refresh</button>
        </div>
      </div>
    `;
    
    document.getElementById('sca-refresh')?.addEventListener('click', () => {
        const scholarId = new URL(window.location.href).searchParams.get("user");
        if (scholarId) {
            chrome.storage.local.remove(`selfcite_${scholarId}`);
        }
        window.location.reload();
    });

  } else {
    contentCell.innerHTML = `<span style="color: red;">Error:</span> ${response.message || 'Unknown error'}`;
  }
}

/**
 * The main analysis function.
 */
async function runAnalysis(): Promise<void> {
  injectUI();
  
  const authorNameElement = document.getElementById('gsc_prf_in');
  const authorName = authorNameElement ? (authorNameElement as HTMLElement).innerText.trim() : null;
  if (!authorName) {
    updateUI({ status: 'error', message: 'Could not find author name.' });
    return;
  }
  
  const publicationTitles = Array.from(document.querySelectorAll('.gsc_a_at'))
    .slice(0, 10)
    .map(el => (el as HTMLElement).innerText);

  chrome.runtime.sendMessage(
    { action: "processAuthor", authorName, publicationTitles },
    (response: ApiResponse) => {
      if (chrome.runtime.lastError) {
        updateUI({ status: 'error', message: 'Internal communication error with the extension.' });
        console.error(chrome.runtime.lastError);
        return;
      }
      updateUI(response);
    }
  );
}

// Run the analysis once the page has fully loaded.
window.addEventListener('load', runAnalysis);