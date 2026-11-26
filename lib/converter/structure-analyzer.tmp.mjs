/**
 * KindleFlow — Structure Analyzer
 * Prompt 3: Detect page column layout and running headers/footers.
 *
 * Uses spatial projection of text item positions to identify:
 *  - Single-column vs. multi-column pages
 *  - Running headers and footers (cross-page consistent text)
 *  - Page margins
 */
// ─── Constants ────────────────────────────────────────────────────────────────
/** Fraction of page height treated as header zone */
const HEADER_ZONE_FRACTION = 0.08;
/** Fraction of page height treated as footer zone */
const FOOTER_ZONE_FRACTION = 0.08;
/** Minimum gutter width (pt) to be considered a column separator */
const MIN_GUTTER_PT = 15;
/** Minimum fraction of page height a gap must span to be a column separator */
const MIN_GAP_HEIGHT_FRACTION = 0.35;
/** An item spanning more than this fraction of page width is full-width */
const FULL_WIDTH_FRACTION = 0.70;
/** Pages must have at least this many text items to attempt column detection */
const MIN_ITEMS_FOR_COLUMN_DETECTION = 6;
/** Minimum occurrences (fraction of pages) for running header/footer detection */
const RUNNING_TEXT_MIN_FRACTION = 0.5;
// ─── Margin detection ─────────────────────────────────────────────────────────
/**
 * Estimate page margins from the distribution of text item positions.
 * Ignores the top/bottom 8% zones (header/footer) for body margin estimation.
 */
function estimateMargins(items, pageWidth, pageHeight) {
    const headerLimit = pageHeight * HEADER_ZONE_FRACTION;
    const footerLimit = pageHeight * (1 - FOOTER_ZONE_FRACTION);
    const bodyItems = items.filter(it => it.box.y >= headerLimit && it.box.y + it.box.height <= footerLimit && it.str.trim().length > 0);
    if (bodyItems.length === 0) {
        return { top: 36, bottom: 36, left: 36, right: pageWidth - 36 };
    }
    const leftXs = bodyItems.map(it => it.box.x).sort((a, b) => a - b);
    const rightXs = bodyItems.map(it => it.box.x + it.box.width).sort((a, b) => a - b);
    // 5th percentile left, 95th percentile right to ignore outliers
    const p5 = Math.floor(leftXs.length * 0.05);
    const p95 = Math.floor(rightXs.length * 0.95);
    const marginLeft = leftXs[p5] ?? leftXs[0];
    const marginRight = rightXs[p95] ?? rightXs[rightXs.length - 1];
    const topYs = items.map(it => it.box.y).sort((a, b) => a - b);
    const bottomYs = items.map(it => it.box.y + it.box.height).sort((a, b) => a - b);
    return {
        top: topYs[0] ?? 36,
        bottom: bottomYs[bottomYs.length - 1] ?? pageHeight - 36,
        left: marginLeft,
        right: marginRight,
    };
}
// ─── Column detection ─────────────────────────────────────────────────────────
/**
 * Detect column layout using a horizontal X-projection histogram.
 *
 * Strategy:
 * 1. Build a histogram of text item X occupancy (1pt resolution).
 * 2. Find contiguous empty stretches (gaps) wider than MIN_GUTTER_PT.
 * 3. A gap qualifies as a column separator if it spans at least
 *    MIN_GAP_HEIGHT_FRACTION of body content height.
 * 4. Full-width items are excluded from gap analysis.
 */
export function detectColumnLayout(items, pageWidth, pageHeight) {
    const headerLimit = pageHeight * HEADER_ZONE_FRACTION;
    const footerLimit = pageHeight * (1 - FOOTER_ZONE_FRACTION);
    const pageBodyHeight = footerLimit - headerLimit;
    // Only consider body text items (not headers/footers)
    const bodyItems = items.filter(it => it.box.y >= headerLimit &&
        it.box.y + it.box.height <= footerLimit &&
        it.str.trim().length > 0);
    if (bodyItems.length < MIN_ITEMS_FOR_COLUMN_DETECTION) {
        return singleColumnLayout(pageWidth, 'low', 'Too few items for column detection');
    }
    // Identify full-width items (headings, captions that span the whole page)
    const fullWidthThreshold = pageWidth * FULL_WIDTH_FRACTION;
    const columnCandidates = bodyItems.filter(it => it.box.width < fullWidthThreshold);
    if (columnCandidates.length < MIN_ITEMS_FOR_COLUMN_DETECTION) {
        return singleColumnLayout(pageWidth, 'medium', 'All items appear full-width');
    }
    // Determine the horizontal extent of candidate body text so page margins are excluded
    const bodyLeft = columnCandidates
        .map(it => it.box.x)
        .reduce((a, b) => Math.min(a, b), pageWidth);
    const bodyRight = columnCandidates
        .map(it => it.box.x + it.box.width)
        .reduce((a, b) => Math.max(a, b), 0);
    // Build a horizontal coverage map (X -> total Y height covered by text at X)
    const W = Math.ceil(pageWidth);
    const xHeightCoverage = new Float32Array(W);
    for (const item of columnCandidates) {
        const x0 = Math.max(0, Math.floor(item.box.x));
        const x1 = Math.min(W - 1, Math.ceil(item.box.x + item.box.width));
        const h = item.box.height;
        for (let x = x0; x <= x1; x++) {
            xHeightCoverage[x] += h;
        }
    }
    // Scan strictly between bodyLeft and bodyRight so outer margins are never counted as gutters
    const scanStart = Math.max(0, Math.ceil(bodyLeft));
    const scanEnd = Math.min(W - 1, Math.floor(bodyRight));
    const MIN_GAP_COVERAGE = pageBodyHeight * 0.01;
    const gaps = [];
    let gapStart = -1;
    for (let x = scanStart; x <= scanEnd; x++) {
        if (xHeightCoverage[x] <= MIN_GAP_COVERAGE) {
            if (gapStart < 0)
                gapStart = x;
        }
        else {
            if (gapStart >= 0) {
                const width = x - gapStart;
                if (width >= MIN_GUTTER_PT) {
                    gaps.push({ start: gapStart, end: x - 1, width });
                }
                gapStart = -1;
            }
        }
    }
    if (gaps.length === 0) {
        return singleColumnLayout(pageWidth, 'high', 'No internal horizontal gap found');
    }
    // Validate each gap: must separate substantial text blocks on BOTH left and right sides
    const minItemsPerSide = Math.max(2, Math.floor(MIN_ITEMS_FOR_COLUMN_DETECTION / 2));
    const qualifyingGaps = gaps.filter(g => {
        const leftCount = columnCandidates.filter(it => it.box.x + it.box.width <= g.start + 4).length;
        const rightCount = columnCandidates.filter(it => it.box.x >= g.end - 4).length;
        if (leftCount < minItemsPerSide || rightCount < minItemsPerSide)
            return false;
        let gapCoverage = 0;
        for (let x = g.start; x <= g.end; x++) {
            gapCoverage += xHeightCoverage[x];
        }
        const avgCoverage = gapCoverage / g.width;
        return avgCoverage < pageBodyHeight * MIN_GAP_HEIGHT_FRACTION;
    });
    if (qualifyingGaps.length === 0) {
        return singleColumnLayout(pageWidth, 'medium', 'Internal gaps found but without multi-column balance');
    }
    // Use the widest qualifying gap as the primary column separator
    const primaryGap = qualifyingGaps.sort((a, b) => b.width - a.width)[0];
    const col0Right = primaryGap.start;
    const col1Left = primaryGap.end + 1;
    if (qualifyingGaps.length >= 2) {
        // Possibly 3-column layout — check for a second gap with substantial text in the middle column
        const secondGap = qualifyingGaps.filter(g => g !== primaryGap)[0];
        const leftGap = primaryGap.start < secondGap.start ? primaryGap : secondGap;
        const rightGap = primaryGap.start < secondGap.start ? secondGap : primaryGap;
        const midCount = columnCandidates.filter(it => it.box.x >= leftGap.end - 4 && it.box.x + it.box.width <= rightGap.start + 4).length;
        if (midCount >= minItemsPerSide && rightGap.start - (leftGap.end + 1) > MIN_GUTTER_PT) {
            return {
                columnCount: 3,
                columns: [
                    { left: bodyLeft, right: leftGap.start },
                    { left: leftGap.end + 1, right: rightGap.start },
                    { left: rightGap.end + 1, right: bodyRight },
                ],
                gutterWidth: (leftGap.width + rightGap.width) / 2,
                confidence: 'medium',
                evidence: `Two qualifying gaps at X=${leftGap.start} and X=${rightGap.start}`,
            };
        }
    }
    return {
        columnCount: 2,
        columns: [
            { left: bodyLeft, right: col0Right },
            { left: col1Left, right: bodyRight },
        ],
        gutterWidth: primaryGap.width,
        confidence: 'medium',
        evidence: `Gap at X=${primaryGap.start}–${primaryGap.end} (${primaryGap.width.toFixed(1)}pt)`,
    };
}
function singleColumnLayout(pageWidth, confidence, evidence) {
    return {
        columnCount: 1,
        columns: [{ left: 0, right: pageWidth }],
        gutterWidth: undefined,
        confidence,
        evidence,
    };
}
// ─── Header / footer zone split ───────────────────────────────────────────────
/**
 * Split page text items into header zone, body, and footer zone.
 */
export function splitPageZones(items, pageHeight) {
    const headerLimit = pageHeight * HEADER_ZONE_FRACTION;
    const footerLimit = pageHeight * (1 - FOOTER_ZONE_FRACTION);
    return {
        headerItems: items.filter(it => it.box.y + it.box.height <= headerLimit),
        bodyItems: items.filter(it => it.box.y >= headerLimit && it.box.y + it.box.height <= footerLimit),
        footerItems: items.filter(it => it.box.y >= footerLimit),
    };
}
// ─── Full page structure analysis ────────────────────────────────────────────
/**
 * Analyze column layout and zone split for a single page.
 */
export function analyzePageStructure(page) {
    const { textItems, metadata } = page;
    const { width: pageWidth, height: pageHeight } = metadata;
    const margins = estimateMargins(textItems, pageWidth, pageHeight);
    const columnLayout = detectColumnLayout(textItems, pageWidth, pageHeight);
    const { headerItems, bodyItems, footerItems } = splitPageZones(textItems, pageHeight);
    return { margins, columnLayout, headerItems, footerItems, bodyItems };
}
/**
 * Detect consistent text appearing in the header or footer zone across pages.
 *
 * A text string is classified as a running element if it appears (normalized)
 * on at least RUNNING_TEXT_MIN_FRACTION of all pages.
 */
export function detectRunningElements(extraction) {
    const totalPages = extraction.pages.length;
    if (totalPages < 2) {
        return {
            runningHeader: undefined,
            runningFooter: undefined,
            headerPageNumbers: new Set(),
            footerPageNumbers: new Set(),
        };
    }
    const headerTextCounts = new Map();
    const footerTextCounts = new Map();
    const headerPageNumbers = new Set();
    const footerPageNumbers = new Set();
    for (const page of extraction.pages) {
        const pageHeight = page.metadata.height;
        const { headerItems, footerItems } = splitPageZones(page.textItems, pageHeight);
        const headerText = headerItems.map(it => it.str.trim()).join(' ').trim();
        const footerText = footerItems.map(it => it.str.trim()).join(' ').trim();
        if (headerText.length > 0) {
            const normalized = normalizeRunningText(headerText);
            headerTextCounts.set(normalized, (headerTextCounts.get(normalized) ?? 0) + 1);
        }
        if (footerText.length > 0) {
            const normalized = normalizeRunningText(footerText);
            footerTextCounts.set(normalized, (footerTextCounts.get(normalized) ?? 0) + 1);
        }
        // Detect page numbers in both zones
        const pageNumPattern = /^\d+$|^Page\s+\d+$/i;
        if (headerItems.some(it => pageNumPattern.test(it.str.trim()))) {
            headerPageNumbers.add(page.pageNumber);
        }
        if (footerItems.some(it => pageNumPattern.test(it.str.trim()))) {
            footerPageNumbers.add(page.pageNumber);
        }
    }
    const minCount = Math.max(2, Math.ceil(totalPages * RUNNING_TEXT_MIN_FRACTION));
    let runningHeader;
    let runningFooter;
    for (const [text, count] of headerTextCounts) {
        if (count >= minCount) {
            runningHeader = text;
            break;
        }
    }
    for (const [text, count] of footerTextCounts) {
        if (count >= minCount) {
            runningFooter = text;
            break;
        }
    }
    return { runningHeader, runningFooter, headerPageNumbers, footerPageNumbers };
}
/** Strip page numbers from a running text string for normalization. */
function normalizeRunningText(text) {
    // Remove trailing/leading page numbers
    return text.replace(/^\d+\s*/, '').replace(/\s*\d+$/, '').trim();
}
