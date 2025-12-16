
# Scholar Self-Citation Analyzer

![Version 2.5](https://img.shields.io/badge/version-2.5-blue.svg)
![License MIT](https://img.shields.io/badge/license-MIT-green.svg)

A browser extension that automatically calculates and displays an author’s self-citation rate directly on their Google Scholar profile page, using a **canonical citation graph** built from OpenAlex metadata and OpenCitations DOI evidence.

<p align="left">
  <a href="https://chromewebstore.google.com/detail/cdikdlblibjpejgihfghambmclimmgaa?utm_source=item-share-cb">
    <img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Available in the Chrome Web Store">
  </a>
</p>

<p align="center">
  <img src="https://github.com/naveedanwarbhatti/Self-Citations-Checker/blob/main/images/Screenshot.png" alt="Scholar Self-Citation Analyzer in action">
</p>
<p align="center"><em>The UI computes a single, consistent self-citation rate from merged evidence sources.</em></p>

---

## The Problem 🤔

Google Scholar is an invaluable tool for academics, but its headline metrics do not distinguish between **external citations** and **self-citations**. A high citation count can therefore be misleading if a large fraction comes from the author’s own work.
This extension adds that missing dimension at a glance, promoting a more transparent and nuanced understanding of scholarly impact.

## Key Features 🚀

- **Merged Evidence Sources** – Resolves works via OpenAlex, and enriches citation edges with both **OpenAlex** and **OpenCitations** when a DOI is present.
- **Seamless Integration** – Injects a **Self-Citation Rate** panel directly into the statistics table on Google Scholar author pages.
- **Dynamic & Detailed Tooltip** – Hover over the **?** icon to see the definition, merged data sources, and a brief coverage note.
- **Smart Author Matching** – A robust heuristic algorithm (Jaro-Winkler similarity + publication overlap) resolves the correct works in OpenAlex.
- **On-Demand Refresh** – A one-click **Refresh** button clears the cache and recalculates the metric.
- **30-Day Caching** – Results are cached locally for 30 days to provide instant results and minimize API calls.

## How It Works ⚙️

1.  **UI Injection (`content.ts`)**
    - When you open a Google Scholar author page, the content script grabs the author’s name and their first 10 publication titles.
    - It immediately injects a *"Calculating..."* status panel into the statistics area.

2.  **Resolve Works (`background.ts`)**
    - Each Scholar title is matched against OpenAlex using fuzzy title similarity and author-name overlap.
    - Works are normalized to canonical IDs that prefer DOIs, with OpenAlex IDs as a fallback.

3.  **Collect Citation Evidence (`background.ts`)**
    - For every resolved work, incoming citation edges are fetched from OpenAlex.
    - If a DOI is available, additional citation edges are fetched from OpenCitations and enriched with OpenAlex metadata.

4.  **Merge & Deduplicate (`background.ts`)**
    - All citation edges are normalized to canonical IDs and de-duplicated so each unique `citing → cited` pair is counted once, regardless of provider overlap.
    - Self-citations are determined by shared authors between the citing and cited works.

5.  **Display Results (`content.ts`)**
    - The background script returns the unique-edge counts and the percentage of self-citations.
    - The tooltip text describes the unified data sources and the consistent citation model.

---

## Installation 📦

### 1. Chrome Web Store (Recommended)

[**Install from Chrome Web Store →**](https://chromewebstore.google.com/detail/cdikdlblibjpejgihfghambmclimmgaa?utm_source=item-share-cb)

### 2. From Source (Developers)

```bash
# 1. Clone the repo
git clone https://github.com/naveedanwarbhatti/Self-Citations-Checker.git
cd Self-Citations-Checker

# 2. Build the project
npm install
npm run build

# 3. Open Chrome → chrome://extensions
# 4. Enable “Developer mode” (top-right)
# 5. Click “Load unpacked” and select the `dist` folder.
````

Navigate to any Google Scholar author profile to see the extension in action.

---

## Technology Stack 🛠️

| Layer              | Details                                                      |
| ------------------ | ------------------------------------------------------------ |
| **Language**       | TypeScript (modern syntax & type safety)                     |
| **Platform**       | Chrome Extension APIs (`chrome.runtime`, `chrome.storage` …) |
| **Data Sources**   | OpenAlex API (metadata + citations) • OpenCitations (DOI-based citation evidence) |
| **Algorithms**     | DOM manipulation • async/await • Jaro-Winkler similarity     |
| **Error Handling** | Graceful error states and UI messaging                       |

### File Structure

```text
.
├── background.ts   # Core logic: API communication & citation analysis
├── content.ts      # Front-end logic: DOM injection & messaging
├── types.ts        # Shared TypeScript interfaces
├── manifest.json   # Chrome extension manifest
└── README.md       # (this file)
```

---

## Contributing 🤝

Pull requests are welcome!

1. **Open an Issue** – describe the bug or feature request.
2. **Fork → Commit → PR** – submit your improvements with a clear description.

---

## Disclaimer 📝

* The citation data is sourced from OpenAlex and OpenCitations. These datasets are invaluable, but their **coverage may not be 100% complete or perfectly up-to-date**.
* The author-matching heuristic is designed to be accurate but may occasionally fail to find the correct profile or select an incorrect one for authors with common names.
* This tool is intended for informational purposes and should be used as a supplementary metric, not as a definitive measure of scholarly integrity or impact.

---

## License 📄

This project is licensed under the **MIT License**.




