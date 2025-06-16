
# Scholar Self-Citation Analyzer

![Version 2.2](https://img.shields.io/badge/version-2.2-blue.svg)
![License MIT](https://img.shields.io/badge/license-MIT-green.svg)

A browser extension that automatically calculates and displays an author’s self-citation rate directly on their Google Scholar profile page, **now with a hybrid DBLP + OpenAlex backend to support all academic disciplines.**

<p align="left">
  <a href="https://chromewebstore.google.com/detail/cdikdlblibjpejgihfghambmclimmgaa?utm_source=item-share-cb">
    <img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Available in the Chrome Web Store">
  </a>
</p>

<p align="center">
  <img src="https://github.com/naveedanwarbhatti/Self-Citations-Checker/blob/main/images/Screenshot.png" alt="Scholar Self-Citation Analyzer in action">
</p>
<p align="center"><em>The UI dynamically displays the data source (DBLP or OpenAlex).</em></p>

---

## The Problem 🤔

Google Scholar is an invaluable tool for academics, but its headline metrics do not distinguish between **external citations** and **self-citations**. A high citation count can therefore be misleading if a large fraction comes from the author’s own work.
This extension adds that missing dimension at a glance, promoting a more transparent and nuanced understanding of scholarly impact.

## Key Features 🚀

- **Hybrid Data Sources** – Prioritizes the high-quality **DBLP** dataset for Computer Science, and automatically **falls back to the comprehensive OpenAlex database** for all other disciplines.
- **Seamless Integration** – Injects a **Self-Citation Rate** panel directly into the statistics table on Google Scholar author pages.
- **Dynamic & Detailed Tooltip** – Hover over the **?** icon to see the definition of a self-citation, a disclaimer, and the **specific data source (DBLP or OpenAlex) used for the calculation**.
- **Smart Author Matching** – A robust heuristic algorithm (Jaro-Winkler similarity + publication overlap) finds the correct author profile on both DBLP and OpenAlex.
- **On-Demand Refresh** – A one-click **Refresh** button clears the cache and recalculates the metric.
- **30-Day Caching** – Results are cached locally for 30 days to provide instant results and minimize API calls.

## How It Works ⚙️

The extension uses a tiered, fallback data strategy:

1.  **UI Injection (`content.ts`)**
    - When you open a Google Scholar author page, the content script grabs the author’s name and their first 10 publication titles.
    - It immediately injects a *"Calculating..."* status panel into the statistics area.

2.  **Tier 1: DBLP Search (`background.ts`)**
    - The script first attempts to find a matching author profile on DBLP using the smart author-matching heuristic.
    - If a confident match is found, it proceeds to analyze citations using the **DBLP + OpenCitations SPARQL endpoint**.
    - **Citation Model:** DBLP results are based on **unique citing articles** (the standard academic definition).

3.  **Tier 2: OpenAlex Fallback (`background.ts`)**
    - If no confident match is found on DBLP (common for non-CS/EE fields), the extension **automatically and seamlessly switches to OpenAlex**.
    - It runs the same smart author-matching heuristic against the OpenAlex API.
    - If a match is found, it proceeds with a detailed citation analysis.
    - **Citation Model:** OpenAlex results are based on **total citation mentions** (non-unique, a paper citing 3 works counts as 3 citations). This method is used to accommodate API limitations for anonymous users.

4.  **Displaying Results (`content.ts`)**
    - The background script returns the calculated data, regardless of the source.
    - The content script replaces the "Calculating..." panel with the final percentage.
    - The tooltip text is **dynamically updated** to reflect whether the data came from DBLP or OpenAlex and to explain the relevant citation model used.

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
| **Data Sources**   | DBLP Search API • DBLP SPARQL Endpoint • OpenCitations <br>Fallback: OpenAlex API      |
| **Algorithms**     | DOM manipulation • async/await • Jaro-Winkler similarity     |
| **Error Handling** | Custom `DblpRateLimitError` for graceful user feedback       |

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

* The citation data is sourced from DBLP-OpenCitations and OpenAlex. These datasets are invaluable, but their **coverage may not be 100% complete or perfectly up-to-date**.
* The author-matching heuristic is designed to be accurate but may occasionally fail to find the correct profile or select an incorrect one for authors with common names.
* This tool is intended for informational purposes and should be used as a supplementary metric, not as a definitive measure of scholarly integrity or impact.

---

## License 📄

This project is licensed under the **MIT License**.




