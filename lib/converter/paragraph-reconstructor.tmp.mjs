/**
 * KindleFlow — Paragraph Reconstructor
 * Prompt 3: Group TextLines into TextBlocks (paragraphs, headings, list items).
 *
 * Uses vertical gap analysis and font statistics to identify block boundaries.
 */
import { resolveHyphenation } from './line-reconstructor.tmp.mjs';
// ─── Constants ────────────────────────────────────────────────────────────────
/** Gap > avgLineHeight * this factor → new paragraph */
const PARAGRAPH_GAP_FACTOR = 2.0;
/** Gap > avgLineHeight * this factor → definitely new block */
const BLOCK_GAP_FACTOR = 1.6;
/** Font size change > this fraction → new block */
const FONT_SIZE_CHANGE_FRACTION = 0.12;
/** Indent > body font size * this factor → paragraph start */
const INDENT_FACTOR = 1.4;
/** Heading: font size >= body font size * this factor (and short block) */
const HEADING_SIZE_FACTOR = 1.35;
/** Subheading: font size >= body font size * this factor */
const SUBHEADING_SIZE_FACTOR = 1.12;
/** Max lines for a heading block */
const HEADING_MAX_LINES = 3;
// ─── List and Heading detection patterns ──────────────────────────────────────
const LIST_BULLET_PATTERN = /^[•\-\*\u2022\u2023\u25CF\u25E6\u2043]\s/;
const LIST_NUMBERED_PATTERN = /^(\d+[.)]\s|[a-z][.)]\s)/;
const MULTI_PART_SECTION_PATTERN = /^(\d+(\.\d+)+[.)]?\s+[A-Z]|(Chapter|Section|Unit|Part)\s+\d+)/i;
const NUMBERED_HEADING_PATTERN = /^\d+[.)]\s+[A-Z]/;
const DEFINITION_PATTERN = /^(Defn:|Definition:|Note:|Key Concept:|Theorem:|Lemma:|Corollary:|Proof:)/i;
// ─── Helpers ─────────────────────────────────────────────────────────────────
function unionBox(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
}
function fontSizeOf(line) {
    return line.dominantFont.size;
}
function avgLineHeight(lines) {
    if (lines.length === 0)
        return 12;
    return lines.reduce((s, l) => s + l.box.height, 0) / lines.length;
}
function verticalGap(upper, lower) {
    return lower.box.y - (upper.box.y + upper.box.height);
}
function dominantFontOf(lines) {
    // Pick font of the line with the most characters
    let best = lines[0].dominantFont;
    let bestChars = lines[0].text.length;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].text.length > bestChars) {
            bestChars = lines[i].text.length;
            best = lines[i].dominantFont;
        }
    }
    return best;
}
function classifyBlock(lines, bodyFontSize) {
    if (lines.length === 0)
        return 'unknown';
    const text = lines[0].text.trimStart();
    const fontSize = fontSizeOf(lines[0]);
    const isBold = lines[0].dominantFont.isBold;
    // Reaction arrows (→, ⇌) and chemical reaction formulas belong to equations, never headings
    if (/[→⇌]/.test(text)) {
        return 'paragraph';
    }
    // Bullet list items always classify as list-item
    if (LIST_BULLET_PATTERN.test(text)) {
        return 'list-item';
    }
    // Multi-part section headings (e.g. "5.2 Diseases...", "5.3.1 Major...", "Unit 5...") take precedence over lists
    if (MULTI_PART_SECTION_PATTERN.test(text) && lines.length <= HEADING_MAX_LINES) {
        if (fontSize >= bodyFontSize * HEADING_SIZE_FACTOR) {
            return 'heading';
        }
        return 'subheading';
    }
    // Large font headings
    if (fontSize >= bodyFontSize * HEADING_SIZE_FACTOR && lines.length <= HEADING_MAX_LINES) {
        return 'heading';
    }
    // Subheadings: slightly larger font or bold short title
    if (fontSize >= bodyFontSize * SUBHEADING_SIZE_FACTOR && lines.length <= HEADING_MAX_LINES) {
        return 'subheading';
    }
    if (isBold && lines.length <= 2 && text.length < 80 && !text.endsWith('.')) {
        return 'subheading';
    }
    // Single-number heading (e.g. "1. Introduction") ONLY if bold or distinctly larger than body
    if (NUMBERED_HEADING_PATTERN.test(text) && (isBold || fontSize >= bodyFontSize * 1.12) && lines.length <= 2) {
        return 'subheading';
    }
    // Numbered list detection for body font scale
    if (LIST_NUMBERED_PATTERN.test(text)) {
        return 'list-item';
    }
    return 'paragraph';
}
/**
 * Group TextLines (already in reading order) into TextBlocks.
 *
 * Lines must already be sorted by readingOrder.
 * Returns blocks in reading order.
 */
export function reconstructParagraphs(lines, options) {
    if (lines.length === 0)
        return [];
    const { bodyFontSize, pageNumber, bodyLeft = 0 } = options;
    const blocks = [];
    let blockLines = [lines[0]];
    let blockCounter = 0;
    // Compute median positive line gap across consecutive lines on this page
    const positiveGaps = [];
    for (let j = 1; j < lines.length; j++) {
        const g = verticalGap(lines[j - 1], lines[j]);
        if (g > 1 && g < 40 && lines[j].columnIndex === lines[j - 1].columnIndex) {
            positiveGaps.push(g);
        }
    }
    positiveGaps.sort((a, b) => a - b);
    const medianGap = positiveGaps.length > 0
        ? positiveGaps[Math.floor(positiveGaps.length / 2)]
        : Math.max(4, bodyFontSize * 0.35);
    const makeBlock = (accLines) => {
        const text = assembleBlockText(accLines);
        const box = accLines.reduce((b, l) => unionBox(b, l.box), accLines[0].box);
        const domFont = dominantFontOf(accLines);
        const lineHeights = accLines.map(l => l.box.height);
        const avgLH = lineHeights.reduce((s, h) => s + h, 0) / lineHeights.length;
        const blockType = classifyBlock(accLines, bodyFontSize);
        const readingOrder = accLines[0].readingOrder;
        const columnIndex = accLines[0].columnIndex;
        blockCounter++;
        return {
            id: `p${pageNumber}_b${blockCounter}`,
            text,
            lines: accLines,
            box,
            dominantFont: domFont,
            avgLineHeight: avgLH,
            spacingBefore: 0, // set after all blocks assembled
            blockType,
            readingOrder,
            columnIndex,
            confidence: 'medium',
        };
    };
    for (let i = 1; i < lines.length; i++) {
        const prev = blockLines[blockLines.length - 1];
        const cur = lines[i];
        // 1. Different column → always new block
        if (cur.columnIndex !== prev.columnIndex) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        const curText = cur.text.trimStart();
        const prevText = prev.text.trimStart();
        const gap = verticalGap(prev, cur);
        const lineH = avgLineHeight(blockLines);
        const prevFontSize = fontSizeOf(prev);
        const curFontSize = fontSizeOf(cur);
        const fontChange = Math.abs(curFontSize - prevFontSize) / Math.max(1, prevFontSize) > FONT_SIZE_CHANGE_FRACTION;
        // 2. Distinct list items (bullet points or numbered list items) must start a new block
        const curIsBullet = LIST_BULLET_PATTERN.test(curText);
        const curIsNumberedList = !MULTI_PART_SECTION_PATTERN.test(curText) && !NUMBERED_HEADING_PATTERN.test(curText) && LIST_NUMBERED_PATTERN.test(curText);
        if (curIsBullet || curIsNumberedList) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        // 3. Definitions or special key-term indicators (e.g., "Defn:", "Definition:") start a new block
        if (DEFINITION_PATTERN.test(curText) && blockLines.length > 0) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        // 4. Section headings or title headings start a new block
        const curIsMultiSection = MULTI_PART_SECTION_PATTERN.test(curText);
        const curIsSingleNumberedHeading = NUMBERED_HEADING_PATTERN.test(curText) && (cur.dominantFont.isBold || curFontSize >= bodyFontSize * 1.12);
        const curIsMajorHeading = curFontSize >= bodyFontSize * SUBHEADING_SIZE_FACTOR && cur.text.length < 120;
        if (curIsMultiSection || curIsSingleNumberedHeading || curIsMajorHeading) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        // 5. If previous line was a heading, the next line must start a new block
        const prevWasHeading = (prevFontSize >= bodyFontSize * SUBHEADING_SIZE_FACTOR ||
            MULTI_PART_SECTION_PATTERN.test(prevText) ||
            (NUMBERED_HEADING_PATTERN.test(prevText) && (prev.dominantFont.isBold || prevFontSize >= bodyFontSize * 1.12))) &&
            blockLines.length <= HEADING_MAX_LINES &&
            gap > 2;
        if (prevWasHeading) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        // 6. Proportional vertical gap detection:
        // A gap >= 1.45x median gap or >= 0.65x body font size indicates a genuine paragraph break
        const isParagraphGap = gap >= Math.max(7.5, bodyFontSize * 0.65) ||
            (medianGap > 0 && gap >= medianGap * 1.45 && gap >= 6.5) ||
            gap > lineH * 1.3;
        if (isParagraphGap) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        // 7. Font size change with a noticeable gap → new block
        if (fontChange && gap > 2) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        // 8. Bold / weight change between lines → new block (e.g. bold subtitle or run-in heading)
        if (prev.dominantFont.isBold !== cur.dominantFont.isBold && (gap > 2 || cur.text.length < 100 || prev.text.length < 100)) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        // 9. First-line paragraph indentation
        const isFirstLineIndent = blockLines.length >= 1 &&
            cur.box.x > bodyLeft + bodyFontSize * INDENT_FACTOR &&
            prev.box.x <= bodyLeft + bodyFontSize * 0.5 &&
            gap > 0;
        if (isFirstLineIndent) {
            blocks.push(makeBlock(blockLines));
            blockLines = [cur];
            continue;
        }
        // Same block
        blockLines.push(cur);
    }
    if (blockLines.length > 0) {
        blocks.push(makeBlock(blockLines));
    }
    // Set spacingBefore relative to the previous block
    for (let i = 1; i < blocks.length; i++) {
        const prevBlock = blocks[i - 1];
        const curBlock = blocks[i];
        if (prevBlock.columnIndex === curBlock.columnIndex) {
            curBlock.spacingBefore = curBlock.box.y - (prevBlock.box.y + prevBlock.box.height);
        }
    }
    return blocks;
}
// ─── Text assembly ────────────────────────────────────────────────────────────
/**
 * Assemble the full text of a block from its lines.
 * Lines ending with a soft hyphen are joined via resolveHyphenation.
 */
function assembleBlockText(lines) {
    if (lines.length === 0)
        return '';
    let text = lines[0].text;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i - 1].endsWithSoftHyphen) {
            text = resolveHyphenation(text, lines[i].text);
        }
        else {
            text += ' ' + lines[i].text;
        }
    }
    return text.replace(/\s+/g, ' ').trim();
}
// ─── Body font size estimator ─────────────────────────────────────────────────
/**
 * Estimate the dominant body font size from a set of text lines.
 * Returns the median font size, weighted by character count.
 */
export function estimateBodyFontSize(lines) {
    if (lines.length === 0)
        return 12;
    // Build a weighted sample of font sizes
    const weighted = [];
    for (const line of lines) {
        const size = line.dominantFont.size;
        const weight = Math.max(1, line.text.length);
        // Add size proportional to character count (floored to 10 entries max)
        const entries = Math.min(10, Math.ceil(weight / 5));
        for (let i = 0; i < entries; i++)
            weighted.push(size);
    }
    weighted.sort((a, b) => a - b);
    return weighted[Math.floor(weighted.length / 2)] ?? 12;
}
