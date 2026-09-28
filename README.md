# jobTOmd Extractor

A robust, cross-platform Manifest V3 WebExtension (Chrome & Firefox) designed to parse complex, heavily obfuscated job board DOMs and extract job descriptions into clean, standardized Markdown files.

## Core Architecture & Methodology

Job boards frequently employ server-driven UI, atomic CSS, and anti-scraping DOM structures. This extension bypasses traditional static scraping methods using the following strategies:

* **Visual Hierarchy Extraction:** Rather than relying on unpredictable DOM order or obfuscated class names, the scraper computes visual rendering attributes (e.g., `window.getComputedStyle().fontSize`) to identify key elements like job titles based on how a human visually parses the page.
* **Shadow DOM Piercing:** Utilizes custom traversal helpers (`deepQuerySelectorAll`) to extract text deeply embedded in shadow roots.
* **Surgical Artifact Stripping:** Clones nodes to safely strip visual badges (SVGs, `aria-label="Verified"`, `img`) and UI noise without accidentally destroying valid link text or standard HTML formatting (like `<ul>` or `<strong>`).
* **Strict Guardrails:** Enforces character length limits and explicit string matching to prevent the scraper from bleeding into navigation bars, feed headers, or sidebar metadata.
* **Local Markdown Conversion:** Relies on a locally bundled library (`turndown.js`) to convert sanitized HTML into native Markdown formats directly within the browser, requiring no external build tools or Node modules.
* **Asynchronous Polling & SPA Hydration:** Implements a resilient async retry helper (`pollWithRetry`) with a timed polling loop (250ms interval, 3000ms timeout) to gracefully wait for late-hydrating dynamic content and single-page application (SPA) DOM nodes across multiple browsers.

## Supported Platforms

### LinkedIn
Successfully parses both dedicated single-page job views and dynamic multi-pane search feeds.
* **Sibling-Based Root Isolation:** Bypasses aggressive global page wrappers by targeting the `lazy-column` sibling, effectively isolating the details pane and preventing the scraper from reading left-pane list headers (e.g., "99+ results").
* **Font-Size Title Detection:** Evaluates the computed font size of candidates to accurately distinguish the true job title from preceding company names or standard DOM artifacts.
* **Dynamic UI Filtering:** Explicitly filters out dynamically injected feed headers such as "Jobs based on your preferences," "Top job picks," and "Suggested searches."
* **Expanded Fallback Arrays:** Prioritizes robust primary containers like `#job-details` and `.jobs-description__content` at the top of extraction arrays to eliminate rendering misses across dynamic single-pane views.

### ZipRecruiter
Successfully parses both dedicated single-page job views and dynamic multi-pane search feeds.
* **Utility Class Bypass & Test-ID Anchoring:** Circumvents the volatility of constantly shifting Tailwind CSS utility classes by anchoring primary metadata extraction (title, company) to stable parent containers utilizing explicit `data-testid` attributes (e.g., `serp-job-details-title`).
* **Formatting-Based Container Targeting:** Accurately isolates the main job description container by targeting reliable text-formatting utility classes (e.g., `.whitespace-pre-line`), bypassing the complete lack of semantic IDs on the raw text blocks.
* **UI De-fragmentation & Payload Reassembly:** Dynamically hunts down and extracts fragmented UI components—such as isolated job highlights and "Key responsibilities" blocks—that ZipRecruiter stores outside the main description body, stitching them back into a single cohesive HTML payload prior to conversion.
* **Nested Artifact Stripping:** Systematically strips nested `<p>` tags from within extracted HTML list items (`<li>`) before pushing to the local Turndown library, preventing the engine from erroneously rendering double-spaced bullet points in the final Markdown document.

### Indeed
Successfully parses both dedicated single-page job views and dynamic multi-pane search feeds.
* **Semantic Test-ID Targeting:** Bypasses Indeed's heavily obfuscated atomic CSS (e.g., `css-146c3p1`) by strictly anchoring extraction to reliable `data-testid` attributes like `viewjob-main-content` and `vj-job-title`.
* **React Native Web Compatibility:** Identifies and extracts description payloads wrapped in modern `.react-native-html-content` and `.simple-job-description-html` containers, eliminating reliance on deprecated static IDs.
* **Structural DOM-Walking:** Implements a fallback mechanism that walks the DOM tree relative to the company profile node to reliably extract adjacent location metadata (e.g., "Coventry, RI 02861") when explicit tags are absent.
* **Inline Artifact Stripping:** Clones text nodes to safely strip injected SVGs (such as external link icons adjacent to company profile links) before formatting, ensuring clean Markdown output.
* **Single-Pane & Multi-Pane Support:** Incorporates multi-selector fallback arrays (`#jobDescriptionText`, `.jobsearch-JobComponent-description`, `#vjs-desc`) to ensure seamless extraction on both standard search feeds and standalone `/viewjob` pages.
