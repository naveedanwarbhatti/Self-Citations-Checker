
# Scholar Self-Citation Analyzer

![Version 1.6](https://img.shields.io/badge/version-1.6-blue.svg)
![License MIT](https://img.shields.io/badge/license-MIT-green.svg)

A browser extension that automatically calculates and displays an author’s self-citation rate directly on their Google Scholar profile page.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/cdikdlblibjpejgihfghambmclimmgaa?utm_source=item-share-cb">
    <img src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/iNEddTyWiMfLSwFD6qGq.png" alt="Available in the Chrome Web Store">
  </a>
</p>

<p align="center">
  <img src="https://i.imgur.com/example.gif" alt="Scholar Self-Citation Analyzer in action" width="750">
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

1. **UI Injection** (`content.ts`)  
   - Scrapes the author’s name + first 10 publication titles.  
   - Adds a temporary “Calculating…” panel to the UI.

2. **Data Processing** (`background.ts`)  
   - Sanitises the name (`Dr.`, `Ph.D.` etc. removed).  
   - Calls the **DBLP Search API** for candidate author profiles.  
   - Scores candidates by Jaro-Winkler similarity and publication overlap to pick the best match.  
   - Extracts the author’s DBLP *pid*.

3. **Citation Analysis** (`background.ts`)  
   - Runs two SPARQL queries against the **DBLP SPARQL endpoint**  
     1. Total citing papers.  
     2. Citing papers also listing the target author → self-citations.

4. **Displaying Results** (`content.ts`)  
   - Receives the statistics (total citations, self-citations & %) from the background script.  
   - Replaces the temporary panel with the final, colour-coded percentage, tooltip and **Refresh** button.

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
| **Data Sources**   | DBLP Search API • DBLP SPARQL Endpoint                       |
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

* Citation data comes from DBLP (and its OpenCitations integration) and may be incomplete or out-of-date.
* The author-matching heuristic is highly accurate but not infallible, especially for common names.
* Treat the self-citation percentage as **supplementary context**, not a definitive measure of impact or integrity.

---

## License 📄

This project is licensed under the **MIT License**.
See the [LICENSE](LICENSE) file for full details.

```
```
