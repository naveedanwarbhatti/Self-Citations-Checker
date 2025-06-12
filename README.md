
# Scholar Self-Citation Analyzer

![Version 1.6](https://img.shields.io/badge/version-1.6-blue.svg)
![License MIT](https://img.shields.io/badge/license-MIT-green.svg)

A browser extension that automatically calculates and displays an author’s self-citation rate directly on their Google Scholar profile page.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/cdikdlblibjpejgihfghambmclimmgaa?utm_source=item-share-cb">
    <img src="https://developer.chrome.com/static/docs/webstore/branding/image/UV4C4ybeBTsZt43U4xis.png" alt="Available in the Chrome Web Store">
  </a>
</p>

<p align="center">
  <img src="https://github.com/naveedanwarbhatti/Self-Citations-Checker/blob/main/images/Screenshot.png" alt="Scholar Self-Citation Analyzer in action" width="750">
</p>
<p align="center"><em>(Replace this sample GIF with a screen recording of your actual extension.)</em></p>

---

## The Problem 🤔

Google Scholar is an invaluable tool for academics, but its headline metrics do not distinguish between **external citations** and **self-citations**. A high citation count can therefore be misleading if a large fraction comes from the author’s own work.  
This extension adds that missing dimension at a glance, promoting a more transparent and nuanced understanding of scholarly impact.

## Key Features 🚀

- **Seamless Integration** – injects a **Self-Citation Rate** panel directly into the statistics table on Google Scholar author pages.  
- **At-a-Glance Percentage** – displays a clear, colour-coded self-citation percentage.  
- **Detailed Tooltip** – hover over the **?** icon to see the definition of a self-citation, data sources and a disclaimer.  
- **Smart Author Matching** – heuristic algorithm (Jaro-Winkler similarity + publication overlap) finds the correct DBLP profile even with name variations.  
- **Robust Error Handling** – if DBLP is rate-limited, shows a friendly “Too many requests – try again” message instead of failing silently.  
- **On-Demand Refresh** – one-click **Refresh** button recalculates the metric.

## How It Works ⚙️

The extension is split into two main components:

1. **UI Injection (`content.ts`)**  
   - When you open a Google Scholar author page, the content script grabs the author’s name **and the first 10 publication titles**.  
   - It immediately injects a *“Calculating …”* status panel into the statistics area so the user knows something is happening.

2. **Data Processing (`background.ts`)**  
   - The scraped data are forwarded to the background script.  
   - The script **sanitises the name** (removing “Dr.”, “Ph.D.”, etc.).  
   - It queries the **DBLP Search API** to fetch candidate author profiles.  
   - Each candidate receives a **score** based on  
     - *Jaro-Winkler similarity* between names, and  
     - the count of **overlapping publication titles**.  
   - If a candidate’s score exceeds a safety threshold, its **DBLP profile ID (pid)** is selected.

3. **Citation Analysis (`background.ts`)**  
   - Using that pid, the script fires **two SPARQL queries** against the DBLP SPARQL endpoint (which incorporates **OpenCitations** links):  
     1. **Total Citing Papers** – how many papers cite any work by the author.  
     2. **Self-Citing Papers** – of those, how many also list the same author as a co-author (i.e., genuine self-citations).

4. **Displaying Results (`content.ts`)**  
   - The background script returns **total citations, self-citations, and percentage**.  
   - The content script replaces the “Calculating …” panel with the final, colour-coded percentage, plus a tooltip explanation and a **Refresh** button for manual re-calculation.


---

## Installation 📦

### 1. Chrome Web Store (Recommended)

[**Install from Chrome Web Store →**](https://chromewebstore.google.com/detail/cdikdlblibjpejgihfghambmclimmgaa?utm_source=item-share-cb)

### 2. From Source (Developers)

```bash
# 1. Clone the repo
git clone https://github.com/your-repo/scholar-self-citation-analyzer.git
cd scholar-self-citation-analyzer

# 2. Open Chrome → chrome://extensions
# 3. Enable “Developer mode” (top-right)
# 4. Click “Load unpacked” and select the folder containing manifest.json
````

Navigate to any Google Scholar author profile to see the extension in action.

---

## Technology Stack 🛠️

| Layer              | Details                                                      |
| ------------------ | ------------------------------------------------------------ |
| **Language**       | TypeScript (modern syntax & type safety)                     |
| **Platform**       | Chrome Extension APIs (`chrome.runtime`, `chrome.storage` …) |
| **Data Sources**   | DBLP Search API • DBLP SPARQL Endpoint • OpenCitations       |
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

* The citation data is sourced from the DBLP-OpenCitations integration. This data is open and invaluable, but its **coverage may not be 100% complete** or perfectly up-to-date.
* The author-matching heuristic is designed to be accurate but may occasionally fail to find the correct profile or select an incorrect one for authors with common names.
* This tool is intended for informational purposes and should be used as a supplementary metric, not as a definitive measure of scholarly integrity or impact.

---

## License 📄

This project is licensed under the **MIT License**.




