/**
 * KindleFlow — Text Reflower
 * Prompt 4: Wrap and structure reflowable DocumentBlocks to fit target Kindle width.
 *
 * Uses an injectable TextMeasurer interface with a deterministic fallback measurer
 * so automated tests run identically in Node while PDF generation can plug in
 * exact jsPDF / canvas font metrics later.
 */
// ─── Deterministic Fallback Measurer ──────────────────────────────────────────
const NARROW_CHARS = new Set([
    'i', 'l', 'j', 't', 'f', 'r', 'I', '.', ',', ':', ';', '!', '\'', '|', '(', ')', '[', ']',
]);
const WIDE_CHARS = new Set(['m', 'w', 'M', 'W', '@', '%', '∑', '∫', '∞', '∂', '∇', '⊕', '⊗']);
/**
 * Deterministic character-class text width estimator (in PDF points).
 * Used when no live PDF/Canvas font metric context is injected.
 */
export function createFallbackTextMeasurer() {
    return {
        measureWidth(text, font) {
            if (!text)
                return 0;
            const { size, family, weight } = font;
            const weightFactor = weight === 'bold' ? 1.07 : 1.0;
            if (family === 'mono') {
                return text.length * size * 0.60 * weightFactor;
            }
            let width = 0;
            for (let i = 0; i < text.length; i++) {
                const ch = text[i];
                if (ch === ' ') {
                    width += size * 0.28;
                }
                else if (NARROW_CHARS.has(ch)) {
                    width += size * 0.34;
                }
                else if (WIDE_CHARS.has(ch)) {
                    width += size * 0.82;
                }
                else if (ch >= 'A' && ch <= 'Z') {
                    width += size * 0.66;
                }
                else if (ch >= '0' && ch <= '9') {
                    width += size * 0.55;
                }
                else {
                    width += size * 0.52;
                }
            }
            return width * weightFactor;
        },
        measureLineHeight(font, lineSpacing) {
            return font.size * lineSpacing;
        },
    };
}
// ─── Font Selection ───────────────────────────────────────────────────────────
function selectFontSpec(block, settings) {
    const firstFont = block.lines[0]?.dominantFont;
    const baseFamily = firstFont?.isMonospace
        ? 'mono'
        : firstFont?.isSerif
            ? 'serif'
            : 'sans';
    switch (block.type) {
        case 'heading':
            return {
                family: baseFamily === 'mono' ? 'sans' : baseFamily,
                size: settings.headingFontSize,
                weight: 'bold',
                style: 'normal',
            };
        case 'subheading':
            return {
                family: baseFamily === 'mono' ? 'sans' : baseFamily,
                size: settings.subheadingFontSize,
                weight: 'bold',
                style: 'normal',
            };
        case 'code-block':
            return {
                family: 'mono',
                size: settings.codeFontSize,
                weight: 'normal',
                style: 'normal',
            };
        default: {
            // For paragraphs, list items, captions, callouts:
            // Base weight should only be bold if >= 70% of characters across ALL lines in the block are bold.
            // A leading bold label or term (e.g. "Defn: Oxides are...") must never turn the entire paragraph bold.
            let totalChars = 0;
            let boldChars = 0;
            let italicChars = 0;
            for (const line of block.lines) {
                for (const it of line.items) {
                    const len = it.str.trim().length;
                    totalChars += len;
                    if (it.font.isBold)
                        boldChars += len;
                    if (it.font.isItalic)
                        italicChars += len;
                }
            }
            const isBlockBold = totalChars > 0 && boldChars / totalChars >= 0.70;
            const isBlockItalic = totalChars > 0 && italicChars / totalChars >= 0.70;
            const fontSize = block.type === 'caption' ? settings.captionFontSize : settings.bodyFontSize;
            return {
                family: baseFamily,
                size: fontSize,
                weight: isBlockBold ? 'bold' : 'normal',
                style: isBlockItalic ? 'italic' : 'normal',
            };
        }
    }
}
function resolveLineHeight(font, lineSpacing, measurer) {
    if (measurer.measureLineHeight) {
        return measurer.measureLineHeight(font, lineSpacing);
    }
    return font.size * lineSpacing;
}
// ─── Tokenization & Line Wrapping ─────────────────────────────────────────────
/**
 * Split an oversized single token that cannot fit on an empty line
 * so it wraps safely without clipping past the right margin.
 */
function breakOversizedToken(token, maxWidth, font, measurer) {
    const chunks = [];
    let current = '';
    for (let i = 0; i < token.length; i++) {
        const candidate = current + token[i];
        if (current.length > 0 && measurer.measureWidth(candidate, font) > maxWidth) {
            chunks.push(current);
            current = token[i];
        }
        else {
            current = candidate;
        }
    }
    if (current.length > 0)
        chunks.push(current);
    return chunks;
}
/**
 * Tokenize prose while preserving spaces around math operators cleanly
 * and allowing breaks after meaningful hyphens when a hyphenated compound exceeds line width.
 */
function tokenizeForWrap(text) {
    const rawTokens = text.trim().split(/\s+/).filter(Boolean);
    return rawTokens;
}
/**
 * Wrap a single paragraph string to fit within `firstLineWidth` and `contLineWidth`.
 */
export function wrapTextToWidth(text, firstLineWidth, contLineWidth, font, measurer) {
    const tokens = tokenizeForWrap(text);
    if (tokens.length === 0)
        return [];
    const lines = [];
    let currentLine = '';
    const activeMaxWidth = () => (lines.length === 0 ? firstLineWidth : contLineWidth);
    for (const token of tokens) {
        const maxW = Math.max(font.size * 2, activeMaxWidth());
        if (currentLine.length === 0) {
            if (measurer.measureWidth(token, font) <= maxW) {
                currentLine = token;
            }
            else {
                // Try splitting at internal hyphen first before character split
                const hyphenIdx = token.indexOf('-', 1);
                if (hyphenIdx > 0 && hyphenIdx < token.length - 1) {
                    const parts = splitOnHyphens(token);
                    for (const part of parts) {
                        const pMax = Math.max(font.size * 2, activeMaxWidth());
                        if (currentLine.length === 0) {
                            if (measurer.measureWidth(part, font) <= pMax) {
                                currentLine = part;
                            }
                            else {
                                const broken = breakOversizedToken(part, pMax, font, measurer);
                                for (let b = 0; b < broken.length - 1; b++)
                                    lines.push(broken[b]);
                                currentLine = broken[broken.length - 1] ?? '';
                            }
                        }
                        else if (measurer.measureWidth(currentLine + part, font) <= pMax) {
                            currentLine += part;
                        }
                        else {
                            lines.push(currentLine);
                            currentLine = part;
                        }
                    }
                }
                else {
                    const broken = breakOversizedToken(token, maxW, font, measurer);
                    for (let b = 0; b < broken.length - 1; b++)
                        lines.push(broken[b]);
                    currentLine = broken[broken.length - 1] ?? '';
                }
            }
            continue;
        }
        const candidate = `${currentLine} ${token}`;
        if (measurer.measureWidth(candidate, font) <= maxW) {
            currentLine = candidate;
        }
        else {
            lines.push(currentLine);
            const nextMaxW = Math.max(font.size * 2, contLineWidth);
            if (measurer.measureWidth(token, font) <= nextMaxW) {
                currentLine = token;
            }
            else {
                const broken = breakOversizedToken(token, nextMaxW, font, measurer);
                for (let b = 0; b < broken.length - 1; b++)
                    lines.push(broken[b]);
                currentLine = broken[broken.length - 1] ?? '';
            }
        }
    }
    if (currentLine.trim().length > 0) {
        lines.push(currentLine);
    }
    return lines;
}
function splitOnHyphens(token) {
    const parts = [];
    let start = 0;
    for (let i = 0; i < token.length; i++) {
        if (token[i] === '-' && i > start && i < token.length - 1) {
            parts.push(token.slice(start, i + 1));
            start = i + 1;
        }
    }
    if (start < token.length)
        parts.push(token.slice(start));
    return parts;
}
// ─── List Marker Helpers ──────────────────────────────────────────────────────
const LIST_PREFIX_REGEX = /^(([•\-\*\u2022\u2023\u25CF\u25E6\u2043])|(\d+[.)])|([a-zA-Z][.)]))\s+/;
function extractListMarker(text) {
    const match = text.trimStart().match(LIST_PREFIX_REGEX);
    if (!match)
        return null;
    const fullPrefix = match[0];
    return {
        marker: fullPrefix.trim(),
        body: text.trimStart().slice(fullPrefix.length),
    };
}
// ─── Math & Typography Normalization ──────────────────────────────────────────
/**
 * Normalizes inline LaTeX markup, chemical/mathematical subscripts and superscripts into clean Unicode.
 */
export function cleanMathAndTypography(text) {
    if (!text)
        return '';
    let cleaned = text;
    // 0. Strip zero-width spaces (\u200b)
    cleaned = cleaned.replace(/\u200b/g, '');
    // 0b. Strip Notion/KaTeX formula quotation delimiters: ‘...’ or ‘...‘ or ’...’
    cleaned = cleaned.replace(/[\u2018\u2019]([^\u2018\u2019]+?)[\u2018\u2019]/g, '$1');
    // Strip any remaining lone Notion quotation marks immediately adjacent to formulas/symbols
    cleaned = cleaned.replace(/[\u2018\u2019](?=[A-Za-z0-9_\^\+\-\→⇌\(\)])/g, '');
    cleaned = cleaned.replace(/([A-Za-z0-9_\^\+\-\→⇌\)])[\u2018\u2019]/g, '$1');
    // 1. Strip Notion inline math wrappers: \(\mathrm{...}\), \(\text{...}\), \(\mathbf{...}\), \(...\)
    cleaned = cleaned.replace(/\\\(\s*\\(?:mathrm|text|mathbf|mathit)\{([^}]+)\}\s*\\\)/g, '$1');
    cleaned = cleaned.replace(/\\(?:mathrm|text|mathbf|mathit)\{([^}]+)\}/g, '$1');
    cleaned = cleaned.replace(/\\\(\s*([A-Za-z0-9_\^\+\-\s]+?)\s*\\\)/g, '$1');
    // 2. Map common subscripts (e.g. CO_2 -> CO₂, H_2O -> H₂O, q_0 -> q₀)
    const SUB_MAP = {
        '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
        '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
        '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
        'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ',
        'n': 'ₙ', 'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ', 'v': 'ᵥ', 'x': 'ₓ',
    };
    const SUP_MAP = {
        '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
        '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
        '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
        'n': 'ⁿ', 'i': 'ⁱ', 'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ',
        'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ',
        'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ',
        'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ',
    };
    // Convert standard LaTeX math macros to clean Unicode
    cleaned = cleaned.replace(/\\(?:to|rightarrow)\b/g, '→');
    cleaned = cleaned.replace(/\\leftarrow\b/g, '←');
    cleaned = cleaned.replace(/\\rightleftharpoons\b/g, '⇌');
    cleaned = cleaned.replace(/\\leftrightarrow\b/g, '↔');
    cleaned = cleaned.replace(/\\times\b/g, '×');
    cleaned = cleaned.replace(/\\div\b/g, '÷');
    cleaned = cleaned.replace(/\\pm\b/g, '±');
    cleaned = cleaned.replace(/\\mp\b/g, '∓');
    cleaned = cleaned.replace(/\\leq\b/g, '≤');
    cleaned = cleaned.replace(/\\geq\b/g, '≥');
    cleaned = cleaned.replace(/\\neq\b/g, '≠');
    cleaned = cleaned.replace(/\\approx\b/g, '≈');
    cleaned = cleaned.replace(/\\equiv\b/g, '≡');
    cleaned = cleaned.replace(/\\cdot\b/g, '·');
    cleaned = cleaned.replace(/\\alpha\b/g, 'α');
    cleaned = cleaned.replace(/\\beta\b/g, 'β');
    cleaned = cleaned.replace(/\\gamma\b/g, 'γ');
    cleaned = cleaned.replace(/\\delta\b/g, 'δ');
    cleaned = cleaned.replace(/\\Delta\b/g, 'Δ');
    cleaned = cleaned.replace(/\\theta\b/g, 'θ');
    cleaned = cleaned.replace(/\\lambda\b/g, 'λ');
    cleaned = cleaned.replace(/\\pi\b/g, 'π');
    cleaned = cleaned.replace(/\\sigma\b/g, 'σ');
    cleaned = cleaned.replace(/\\omega\b/g, 'ω');
    cleaned = cleaned.replace(/\\infty\b/g, '∞');
    // Convert simple chemical subscripts with digits: ([A-Za-z])_([0-9\+\-])(?![0-9])
    cleaned = cleaned.replace(/([A-Za-z])_([0-9\+\-])(?![0-9])/g, (_, base, sub) => {
        return base + (SUB_MAP[sub] ?? `_${sub}`);
    });
    // Convert simple variable subscripts with single letter: ([A-Za-z])_([a-z])(?![a-zA-Z0-9_])
    cleaned = cleaned.replace(/([A-Za-z])_([a-z])(?![a-zA-Z0-9_])/g, (_, base, sub) => {
        return base + (SUB_MAP[sub] ?? `_${sub}`);
    });
    cleaned = cleaned.replace(/([A-Za-z])_\{([0-9a-z\+\-]+)\}/g, (_, base, sub) => {
        const converted = sub.split('').map((c) => SUB_MAP[c] ?? c).join('');
        return base + converted;
    });
    // Convert simple superscripts: ([A-Za-z0-9])\^([0-9n\+\-])
    cleaned = cleaned.replace(/([A-Za-z0-9])\^([0-9n\+\-])(?![0-9a-zA-Z\^])/g, (_, base, sup) => {
        return base + (SUP_MAP[sup] ?? `^${sup}`);
    });
    // Braced superscripts must use SUP_MAP (fixing earlier defect where SUB_MAP was used)
    cleaned = cleaned.replace(/([A-Za-z0-9])\^\{([0-9a-zA-Z\+\-]+)\}/g, (_, base, sup) => {
        const converted = sup.split('').map((c) => SUP_MAP[c] ?? c).join('');
        return base + converted;
    });
    // Convert un-underscored chemical formula subscripts: e.g. CO2 -> CO₂, H2O -> H₂O, CaCO3 -> CaCO₃
    cleaned = cleaned.replace(/([A-Za-z\)])(\d+)(?=[A-Za-z\(\)\[\]\+\-→⇌\s,\.:;!\?‘'\"”]|$)/g, (match, prefix, digits, offset, full) => {
        if (/[a-z]/.test(prefix) && !/(?:[A-Z][a-z]|[a-z]\))/.test(full.slice(Math.max(0, offset - 2), offset + 1))) {
            return match;
        }
        const sub = digits.split('').map((d) => SUB_MAP[d] ?? d).join('');
        return prefix + sub;
    });
    // Ensure standard comma spacing: comma followed immediately by alphanumeric receives a space
    cleaned = cleaned.replace(/,([A-Za-z0-9])/g, ', $1');
    return cleaned;
}
/**
 * Convert a single reflowable DocumentBlock into a ReflowedBlockPlan containing
 * wrapped line specs sized to `availableWidth`.
 */
export function reflowTextBlock(block, options) {
    const { availableWidth, settings, roleOverride } = options;
    const measurer = options.measurer ?? createFallbackTextMeasurer();
    const warnings = [];
    const role = roleOverride ?? mapBlockTypeToRole(block.type);
    const font = selectFontSpec(block, settings);
    const lineHeight = resolveLineHeight(font, settings.lineSpacing, measurer);
    const align = role === 'equation-text' ? 'center' : 'left';
    const rawText = cleanMathAndTypography(block.text.trim());
    if (rawText.length === 0) {
        return {
            sourceBlockId: block.id,
            sourcePageNumber: block.pageNumber,
            sourceBox: block.box,
            role,
            lines: [],
            spacingBefore: 0,
            spacingAfter: 0,
            keepTogether: false,
            keepWithNext: false,
            warnings,
        };
    }
    // Conservative warning if low-confidence block is reflowed as text
    if (block.confidence === 'low' && role !== 'fallback-text') {
        warnings.push({
            code: 'LOW_CONFIDENCE_TEXT_REFLOW',
            severity: 'warning',
            message: `Block ${block.id} classified as "${block.type}" with low confidence; reflowed conservatively.`,
            sourcePageNumber: block.pageNumber,
            sourceBlockId: block.id,
        });
    }
    // --- Code blocks: preserve original lines and leading spaces ---
    if (role === 'code-line') {
        const indent = settings.calloutIndent;
        const maxLineW = Math.max(font.size * 4, availableWidth - indent);
        const sourceLines = block.lines.length > 0 ? block.lines.map(l => l.text) : rawText.split('\n');
        const linePlans = [];
        for (const srcLine of sourceLines) {
            if (srcLine.trim().length === 0)
                continue;
            const leadingSpaces = srcLine.match(/^(\s*)/)?.[1] ?? '';
            if (measurer.measureWidth(srcLine, font) <= maxLineW) {
                linePlans.push({
                    text: srcLine,
                    role: 'code-line',
                    font,
                    align: 'left',
                    lineHeight,
                    indent,
                    measuredWidth: measurer.measureWidth(srcLine, font),
                    preserveWhitespace: true,
                });
            }
            else {
                const wrapped = wrapTextToWidth(srcLine.trimStart(), maxLineW, maxLineW, font, measurer);
                wrapped.forEach((lineText, idx) => {
                    const textWithIndent = idx === 0 ? `${leadingSpaces}${lineText}` : `  ${lineText}`;
                    linePlans.push({
                        text: textWithIndent,
                        role: 'code-line',
                        font,
                        align: 'left',
                        lineHeight,
                        indent,
                        measuredWidth: measurer.measureWidth(textWithIndent, font),
                        preserveWhitespace: true,
                    });
                });
            }
        }
        return {
            sourceBlockId: block.id,
            sourcePageNumber: block.pageNumber,
            sourceBox: block.box,
            role,
            lines: linePlans,
            spacingBefore: settings.paragraphSpacing,
            spacingAfter: settings.paragraphSpacing,
            keepTogether: linePlans.length <= 6,
            keepWithNext: false,
            warnings,
        };
    }
    function buildLineSpans(lineText, styledWordQueue, baseFont) {
        if (styledWordQueue.length === 0)
            return undefined;
        const words = lineText.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0)
            return undefined;
        const spans = [];
        let curChunk = '';
        let curWeight = null;
        let curStyle = null;
        let hasVariation = false;
        for (const w of words) {
            const styled = styledWordQueue.length > 0
                ? styledWordQueue.shift()
                : { word: w, weight: baseFont.weight, style: baseFont.style };
            const weight = styled.weight;
            const style = styled.style;
            if (weight !== baseFont.weight || style !== baseFont.style) {
                hasVariation = true;
            }
            if (curWeight === null) {
                curWeight = weight;
                curStyle = style;
                curChunk = w;
            }
            else if (curWeight === weight && curStyle === style) {
                curChunk += ' ' + w;
            }
            else {
                spans.push({
                    text: curChunk + ' ',
                    font: { ...baseFont, weight: curWeight ?? baseFont.weight, style: curStyle ?? baseFont.style },
                });
                curWeight = weight;
                curStyle = style;
                curChunk = w;
            }
        }
        if (curChunk.length > 0 && curWeight !== null && curStyle !== null) {
            spans.push({
                text: curChunk,
                font: { ...baseFont, weight: curWeight, style: curStyle },
            });
        }
        return hasVariation ? spans : undefined;
    }
    // --- Low-confidence multi-line preservation or standard prose wrap ---
    let firstIndent = 0;
    let contIndent = 0;
    let calloutBorder = false;
    let textToWrap = rawText;
    if (role === 'list-item') {
        firstIndent = settings.listIndent;
        const parsed = extractListMarker(rawText);
        if (parsed) {
            const markerAdvance = measurer.measureWidth(`${parsed.marker} `, font);
            // Cap hanging indent so narrow screens retain plenty of text width
            contIndent = firstIndent + Math.min(20, markerAdvance);
            textToWrap = `${parsed.marker} ${parsed.body}`;
        }
        else {
            contIndent = firstIndent;
        }
    }
    else if (role === 'callout') {
        firstIndent = settings.calloutIndent;
        contIndent = settings.calloutIndent;
        calloutBorder = true;
    }
    const firstMaxW = Math.max(font.size * 4, availableWidth - firstIndent);
    const contMaxW = Math.max(font.size * 4, availableWidth - contIndent);
    // Track styled words if the block has mixed emphasis (e.g. bold label in normal body paragraph)
    const styledWordQueue = [];
    let hasMixedEmphasis = false;
    const firstItem = block.lines[0]?.items[0];
    const defaultWeight = firstItem?.font.isBold ? 'bold' : 'normal';
    const defaultStyle = firstItem?.font.isItalic ? 'italic' : 'normal';
    for (const l of block.lines) {
        for (const it of l.items) {
            const itWeight = it.font.isBold ? 'bold' : 'normal';
            const itStyle = it.font.isItalic ? 'italic' : 'normal';
            if (itWeight !== defaultWeight || itStyle !== defaultStyle) {
                hasMixedEmphasis = true;
            }
            const words = it.str.trim().split(/\s+/).filter(Boolean);
            for (const w of words) {
                styledWordQueue.push({ word: w, weight: itWeight, style: itStyle });
            }
        }
    }
    // For low-confidence blocks with distinct manual lines, preserve line breaks conservatively
    const wrappedStrings = block.confidence === 'low' && block.lines.length > 1 && role === 'fallback-text'
        ? block.lines.flatMap(l => l.text.trim().length > 0 ? wrapTextToWidth(l.text, firstMaxW, contMaxW, font, measurer) : [])
        : wrapTextToWidth(textToWrap, firstMaxW, contMaxW, font, measurer);
    const linePlans = wrappedStrings.map((lineText, idx) => {
        const spans = hasMixedEmphasis ? buildLineSpans(lineText, styledWordQueue, font) : undefined;
        return {
            text: lineText,
            role,
            font,
            align,
            lineHeight,
            indent: idx === 0 ? firstIndent : contIndent,
            measuredWidth: measurer.measureWidth(lineText, font),
            calloutBorder: calloutBorder || undefined,
            spans,
        };
    });
    const isHeading = role === 'heading' || role === 'subheading';
    const spacingBefore = role === 'heading'
        ? settings.headingSpacingBefore
        : role === 'subheading'
            ? Math.max(6, Math.round(settings.headingSpacingBefore * 0.70))
            : role === 'caption'
                ? 4
                : 0;
    const spacingAfter = role === 'heading'
        ? settings.headingSpacingAfter
        : role === 'subheading'
            ? Math.max(3, Math.round(settings.headingSpacingAfter * 0.75))
            : role === 'list-item'
                ? Math.max(2, Math.round(settings.paragraphSpacing * 0.35))
                : settings.paragraphSpacing;
    return {
        sourceBlockId: block.id,
        sourcePageNumber: block.pageNumber,
        sourceBox: block.box,
        role,
        lines: linePlans,
        spacingBefore,
        spacingAfter,
        keepTogether: isHeading || role === 'caption' || (role === 'list-item' && linePlans.length <= 3),
        keepWithNext: isHeading,
        warnings,
    };
}
function mapBlockTypeToRole(blockType) {
    switch (blockType) {
        case 'heading':
            return 'heading';
        case 'subheading':
            return 'subheading';
        case 'list':
            return 'list-item';
        case 'caption':
            return 'caption';
        case 'callout':
            return 'callout';
        case 'code-block':
            return 'code-line';
        case 'equation':
            return 'equation-text';
        case 'unknown-complex':
            return 'fallback-text';
        default:
            return 'paragraph';
    }
}
