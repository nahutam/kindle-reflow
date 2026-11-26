/**
 * KindleFlow — Line Reconstructor
 * Prompt 3: Group raw PDF.js text items into logical text lines.
 *
 * PDF.js returns text as individual glyphs, word fragments, or larger runs.
 * This module assembles them into human-readable lines preserving word spacing.
 */
// ─── Constants ────────────────────────────────────────────────────────────────
/** Minimum font-relative tolerance for baseline grouping (pt) */
const MIN_BASELINE_TOLERANCE_PT = 2;
/** Fraction of font size used for baseline grouping tolerance */
const BASELINE_TOLERANCE_FACTOR = 0.35;
/** Fraction of font size below which no space is inserted between items */
const SPACE_THRESHOLD_FACTOR = 0.15;
/** X-gap wider than this (pt) is considered a column separator, not a word gap */
const COLUMN_GAP_MIN_PT = 40;
// ─── Helpers ─────────────────────────────────────────────────────────────────
function unionBox(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
}
function dominantFontOf(items) {
    // Pick the font of the item with the most characters
    let best = items[0].font;
    let bestChars = items[0].str.length;
    for (let i = 1; i < items.length; i++) {
        if (items[i].str.length > bestChars) {
            bestChars = items[i].str.length;
            best = items[i].font;
        }
    }
    return best;
}
function baselineTolerance(item) {
    return Math.max(MIN_BASELINE_TOLERANCE_PT, item.font.size * BASELINE_TOLERANCE_FACTOR);
}
/** True if the item text ends with a hyphen-like character (soft line-break). */
function endsWithHyphen(text) {
    return text.endsWith('-') || text.endsWith('\u2010') || text.endsWith('\u2011');
}
/** True if joining the two halves across the hyphen looks like a real compound/word. */
function shouldJoinHyphen(before, after) {
    // Don't join if either side contains digits or math symbols
    const mathChars = /[\d+\-*/=<>()[\]{}\^_|\\]/;
    if (mathChars.test(before.slice(-4)) || mathChars.test(after.slice(0, 4)))
        return false;
    return true;
}
/**
 * Determine whether a genuine word boundary exists between two text items.
 *
 * Rules:
 * 1. Never insert space if previous text already ends with whitespace or next item starts with whitespace.
 * 2. Never insert space before closing punctuation/brackets (e.g. "word," -> never "word ,").
 * 3. Never insert space after opening delimiters (e.g. "(word" -> never "( word").
 * 4. Never break compound words ending with a connecting hyphen.
 * 5. Protect chemical and mathematical subscripts/superscripts (e.g. CO2, H2O, Ca2+).
 * 6. Use an evidence-based word gap threshold (~0.22 * fontSize, min 2.0pt) to distinguish
 *    real word spaces from intra-word character tracking, kerning, and fragmented glyphs.
 */
export function shouldInsertSpace(prev, cur, currentText) {
    // 1. Whitespace already exists
    if (/\s$/.test(currentText) || /^\s/.test(cur.str)) {
        return false;
    }
    // 2. Attached closing punctuation: do not insert space before it
    if (/^[,\.:;!\?%\)\]\}’'"”\u2018\u2019]/.test(cur.str)) {
        return false;
    }
    // 3. Attached opening punctuation: do not insert space after it
    if (/[(\[{‘'"“\u2018\u2019]$/.test(prev.str)) {
        return false;
    }
    // 4. Connecting hyphen: do not insert space after a trailing hyphen in compound words
    if (prev.str.endsWith('-') || prev.str.endsWith('\u2010')) {
        return false;
    }
    const gap = cur.box.x - (prev.box.x + prev.box.width);
    // 5. Negative or near-zero gap indicates character overlap or tight kerning: no space
    if (gap < 0.5) {
        return false;
    }
    // 6. Subscript / Superscript detection:
    // If there is a vertical baseline shift (e.g. chemical subscript H + 2 or charge +)
    // and horizontal gap is narrow, do not separate
    const dy = Math.abs(cur.box.y - prev.box.y);
    const isBaselineShifted = dy > 1.2;
    const minFontSize = Math.min(prev.font.size, cur.font.size);
    if (isBaselineShifted && gap < minFontSize * 0.35) {
        return false;
    }
    // 7. Chemical formula / math identifier protection:
    // e.g. Uppercase/alphanumeric letters or symbols followed by subscript number (CO2, H2O, CaCO3, Na2SO4)
    if (/[A-Za-z\u2018\u2019]$/.test(prev.str.trim()) && /^\d+$/.test(cur.str.trim()) && gap < minFontSize * 0.6) {
        return false;
    }
    // 8. Explicit end-of-line marker from PDF.js
    if (prev.hasEOL) {
        return true;
    }
    // 9. Standard inter-word spacing threshold:
    // Standard inter-word space is ~0.25 to 0.33 * fontSize.
    // Kerning/tracking between letters within a word is typically -0.05 to +0.12 * fontSize.
    // 0.22 * fontSize (minimum 2.0 pt) reliably separates genuine words while avoiding
    // splitting individual letters or character fragments of the same word.
    const wordSpaceThreshold = Math.max(2.0, minFontSize * 0.22);
    return gap >= wordSpaceThreshold;
}
function draftToTextLine(draft, readingOrder, columnIndex) {
    // Assemble text with proper spacing
    const items = draft.items;
    let text = '';
    for (let i = 0; i < items.length; i++) {
        const cur = items[i];
        if (i === 0) {
            text += cur.str;
            continue;
        }
        const prev = items[i - 1];
        if (shouldInsertSpace(prev, cur, text)) {
            if (!text.endsWith(' '))
                text += ' ';
        }
        text += cur.str;
    }
    text = text.trimEnd();
    const rawHyphen = endsWithHyphen(text);
    return {
        items,
        text,
        box: draft.box,
        baselineY: draft.baselineY,
        dominantFont: dominantFontOf(items),
        endsWithSoftHyphen: rawHyphen,
        readingOrder,
        columnIndex,
    };
}
/**
 * Reconstruct logical text lines from raw PDF.js text items.
 *
 * Items are grouped by:
 *  1. Baseline proximity (within font-relative tolerance)
 *  2. Horizontal proximity (gap < COLUMN_GAP_MIN_PT)
 *  3. Column membership (when column boundaries are provided)
 *
 * Returns lines in top-to-bottom, left-to-right order within each column.
 */
export function reconstructLines(items, options = {}) {
    if (items.length === 0)
        return [];
    // Filter out whitespace-only items
    const usable = items.filter(it => it.str.trim().length > 0);
    if (usable.length === 0)
        return [];
    // Sort by baseline (top-left Y ascending = top of page first), then X
    const sorted = [...usable].sort((a, b) => {
        const dy = a.box.y - b.box.y;
        if (Math.abs(dy) > baselineTolerance(a))
            return dy;
        return a.box.x - b.box.x;
    });
    const drafts = [];
    for (const item of sorted) {
        const tol = baselineTolerance(item);
        const itemCenterY = item.box.y + item.box.height / 2;
        // Determine column index for this item
        const columnIndex = resolveColumnIndex(item.box.x, item.box.x + item.box.width, options.columns);
        // Find the best matching line draft
        let matched = -1;
        let bestDist = Infinity;
        for (let d = drafts.length - 1; d >= 0; d--) {
            const draft = drafts[d];
            // Must be in the same column
            const draftColumnIndex = resolveColumnIndex(draft.box.x, draft.box.x + draft.box.width, options.columns);
            if (draftColumnIndex !== columnIndex)
                continue;
            // Check vertical relationship:
            // 1. Direct vertical overlap of bounding boxes
            const top = Math.max(item.box.y, draft.box.y);
            const bottom = Math.min(item.box.y + item.box.height, draft.box.y + draft.box.height);
            const overlapY = bottom - top;
            const minH = Math.min(item.box.height, draft.box.height);
            const isVerticalOverlap = overlapY >= minH * 0.35;
            // 2. Baseline proximity within tolerance (including subscript/superscript baseline shift)
            const baselineDist = Math.abs(item.box.y - draft.baselineY);
            const maxBaselineDist = Math.max(tol, Math.max(item.box.height, draft.box.height) * 0.75);
            const isBaselineClose = baselineDist <= maxBaselineDist;
            if (!isVerticalOverlap && !isBaselineClose)
                continue;
            // X gap must not be a column-level gap
            const gap = item.box.x - draft.rightEdge;
            if (gap > COLUMN_GAP_MIN_PT)
                continue;
            const scoreDist = isVerticalOverlap ? baselineDist * 0.5 : baselineDist;
            if (scoreDist < bestDist) {
                bestDist = scoreDist;
                matched = d;
            }
        }
        if (matched >= 0) {
            const draft = drafts[matched];
            draft.items.push(item);
            draft.box = unionBox(draft.box, item.box);
            draft.rightEdge = Math.max(draft.rightEdge, item.box.x + item.box.width);
        }
        else {
            drafts.push({
                items: [item],
                baselineY: item.box.y,
                box: { ...item.box },
                rightEdge: item.box.x + item.box.width,
            });
        }
    }
    // Sort each draft's items by X position
    for (const draft of drafts) {
        draft.items.sort((a, b) => a.box.x - b.box.x);
    }
    // Sort drafts by Y (top to bottom), then X (left to right)
    drafts.sort((a, b) => {
        const dy = a.box.y - b.box.y;
        if (Math.abs(dy) > 2)
            return dy;
        return a.box.x - b.box.x;
    });
    return drafts.map((draft, i) => {
        const columnIndex = resolveColumnIndex(draft.box.x, draft.box.x + draft.box.width, options.columns);
        return draftToTextLine(draft, i, columnIndex);
    });
}
// ─── Column resolution ───────────────────────────────────────────────────────
/**
 * Determine which column index a horizontal span [left, right] belongs to.
 * Returns 0 if no columns defined (single-column layout).
 * Returns the index of the column whose center is closest.
 */
function resolveColumnIndex(left, right, columns) {
    if (!columns || columns.length <= 1)
        return 0;
    const centerX = (left + right) / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const colCenter = (col.left + col.right) / 2;
        const dist = Math.abs(centerX - colCenter);
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}
// ─── Hyphenation utilities (used by paragraph-reconstructor) ─────────────────
/**
 * Join two text strings across a soft hyphen.
 * Removes the hyphen and concatenates directly if shouldJoinHyphen passes,
 * otherwise preserves the hyphen.
 */
export function resolveHyphenation(prevText, nextText) {
    const stripped = prevText.endsWith('-')
        ? prevText.slice(0, -1)
        : prevText.endsWith('\u2010') || prevText.endsWith('\u2011')
            ? prevText.slice(0, -1)
            : prevText;
    const nextWord = nextText.split(' ')[0];
    if (shouldJoinHyphen(stripped, nextWord)) {
        return stripped + nextText;
    }
    return prevText + ' ' + nextText;
}
