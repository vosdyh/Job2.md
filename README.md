# Job Details to Markdown Extractor

A robust Firefox Manifest V3 WebExtension designed to parse complex, heavily obfuscated job board DOMs and extract job descriptions into clean, standardized Markdown files. 

## Core Architecture & Methodology

Job boards frequently employ server-driven UI, atomic CSS, and anti-scraping DOM structures. This extension bypasses traditional static scraping methods using the following strategies:

* **Visual Hierarchy Extraction:** Rather than relying on unpredictable DOM order or obfuscated class names, the scraper computes visual rendering attributes (e.g., `window.getComputedStyle().fontSize`) to identify key elements like job titles based on how a human visually parses the page.
* **Shadow DOM Piercing:** Utilizes custom traversal helpers (`deepQuerySelectorAll`) to extract text deeply embedded in shadow roots.
* **Surgical Artifact Stripping:** Clones nodes to safely strip visual badges (SVGs, `aria-label="Verified"`, `img`) and UI noise without accidentally destroying valid link text or standard HTML formatting (like `<ul>` or `<strong>`).
* **Strict Guardrails:** Enforces character length limits and explicit string matching to prevent the scraper from bleeding into navigation bars, feed headers, or sidebar metadata.
* **Local Markdown Conversion:** Relies on a locally bundled library (`turndown.js`) to convert sanitized HTML into native Markdown formats directly within the browser, requiring no external build tools or Node modules.

## Supported Platforms

### LinkedIn
Successfully parses both dedicated single-page job views and dynamic multi-pane search feeds.
* **Sibling-Based Root Isolation:** Bypasses aggressive global page wrappers by targeting the `lazy-column` sibling, effectively isolating the details pane and preventing the scraper from reading left-pane list headers (e.g., "99+ results").
* **Font-Size Title Detection:** Evaluates the computed font size of candidates to accurately distinguish the true job title from preceding company names or standard DOM artifacts.
* **Dynamic UI Filtering:** Explicitly filters out dynamically injected feed headers such as "Jobs based on your preferences," "Top job picks," and "Suggested searches."

### ZipRecruiter
*🚧 Under Construction 🚧*

### Indeed
*🚧 Under Construction 🚧*
