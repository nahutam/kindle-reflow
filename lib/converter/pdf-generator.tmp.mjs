/**
 * KindleFlow — Notes Mode PDF Generator
 * Prompt 5: Render a validated LayoutDocument into a selectable-text Kindle PDF.
 *
 * Uses jsPDF for vector text typesetting and renders ONLY the complex regions
 * explicitly marked as LayoutPreservedRegion by cropping their original source
 * bounding boxes at high DPI. Never rasterizes entire source pages.
 */
import { jsPDF } from 'jspdf';
import { getLocalPDFJS } from './worker-loader.tmp.mjs';
// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_CANVAS_DIMENSION_PX = 4096;
// ─── jsPDF Font Mapping & Live TextMeasurer ───────────────────────────────────
function mapFontFamily(family) {
    switch (family) {
        case 'serif':
            return 'times';
        case 'mono':
            return 'courier';
        default:
            return 'helvetica';
    }
}
function mapFontStyle(weight, style) {
    if (weight === 'bold' && style === 'italic')
        return 'bolditalic';
    if (weight === 'bold')
        return 'bold';
    if (style === 'italic')
        return 'italic';
    return 'normal';
}
/**
 * Create a TextMeasurer backed by jsPDF's actual font metrics.
 * Injecting this into layoutDocument() ensures line wrapping matches PDF output.
 */
export function createJsPDFTextMeasurer(existingDoc) {
    const scratch = existingDoc ?? new jsPDF({ unit: 'pt', format: [432, 576] });
    return {
        measureWidth(text, font) {
            if (!text)
                return 0;
            scratch.setFont(mapFontFamily(font.family), mapFontStyle(font.weight, font.style));
            scratch.setFontSize(font.size);
            return scratch.getTextWidth(text);
        },
        measureLineHeight(font, lineSpacing) {
            return font.size * lineSpacing;
        },
    };
}
// ─── Browser High-DPI Region Cropper ──────────────────────────────────────────
/**
 * Render a single source PDF page onto an offscreen canvas at `targetDpi`
 * (clamped safely to MAX_CANVAS_DIMENSION_PX), then crop each requested box.
 */
async function renderAndCropPageRegionsBrowser(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
pdfDocument, sourcePageNumber, regions, targetDpi) {
    if (typeof document === 'undefined') {
        throw new Error('HTMLCanvasElement is unavailable in this environment; pass a custom regionRenderer for non-browser cropping.');
    }
    const page = await pdfDocument.getPage(sourcePageNumber);
    const results = new Map();
    const baseViewport = page.getViewport({ scale: 1.0 });
    const desiredScale = Math.max(1.0, targetDpi / 72);
    const maxAllowedScale = MAX_CANVAS_DIMENSION_PX / Math.max(1, baseViewport.width, baseViewport.height);
    const renderScale = Math.min(desiredScale, maxAllowedScale);
    const viewport = page.getViewport({ scale: renderScale });
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = Math.max(1, Math.ceil(viewport.width));
    pageCanvas.height = Math.max(1, Math.ceil(viewport.height));
    const pageCtx = pageCanvas.getContext('2d');
    if (!pageCtx) {
        page.cleanup();
        throw new Error(`Failed to acquire 2D canvas context for source page ${sourcePageNumber}.`);
    }
    // White background for clean e-ink rendering of transparent PDFs
    pageCtx.fillStyle = '#ffffff';
    pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    try {
        await page.render({ canvasContext: pageCtx, viewport }).promise;
        for (const region of regions) {
            const box = clampSourceBox(region.sourceBox, baseViewport.width, baseViewport.height);
            const sx = Math.max(0, Math.floor(box.x * renderScale));
            const sy = Math.max(0, Math.floor(box.y * renderScale));
            const sw = Math.max(1, Math.min(pageCanvas.width - sx, Math.ceil(box.width * renderScale)));
            const sh = Math.max(1, Math.min(pageCanvas.height - sy, Math.ceil(box.height * renderScale)));
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = sw;
            cropCanvas.height = sh;
            const cropCtx = cropCanvas.getContext('2d');
            if (!cropCtx) {
                throw new Error(`Failed to create crop canvas for region ${region.id}.`);
            }
            cropCtx.fillStyle = '#ffffff';
            cropCtx.fillRect(0, 0, sw, sh);
            cropCtx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
            const dataUrl = cropCanvas.toDataURL('image/png');
            results.set(region.id, {
                data: dataUrl,
                format: 'PNG',
                pixelWidth: sw,
                pixelHeight: sh,
            });
            cropCanvas.width = 0;
            cropCanvas.height = 0;
        }
    }
    finally {
        pageCanvas.width = 0;
        pageCanvas.height = 0;
        page.cleanup();
    }
    return results;
}
function clampSourceBox(box, pageWidth, pageHeight) {
    const x = Math.max(0, Math.min(pageWidth - 1, box.x));
    const y = Math.max(0, Math.min(pageHeight - 1, box.y));
    const width = Math.max(1, Math.min(pageWidth - x, box.width));
    const height = Math.max(1, Math.min(pageHeight - y, box.height));
    return { x, y, width, height };
}
/**
 * Generate a selectable-text Kindle PDF from a LayoutDocument.
 */
export async function generateNotesPDF(layout, options = {}) {
    const { sourcePdfBytes, targetDpi = 300, regionRenderer, onProgress, abortSignal, compress = false } = options;
    const warnings = layout.warnings
        .filter(w => w.severity === 'warning')
        .map(w => w.message);
    const errors = layout.validation.errors.map(e => e.message);
    if (layout.pages.length === 0) {
        throw new Error('Cannot generate Notes PDF: LayoutDocument has zero pages.');
    }
    onProgress?.({
        phase: 'rendering',
        currentPage: 0,
        totalPages: layout.pageCount,
        message: 'Preparing Notes PDF generator...',
        percent: 10,
    });
    // Collect all preserved regions grouped by source page
    const regionsBySourcePage = new Map();
    for (const page of layout.pages) {
        for (const el of page.elements) {
            if (el.kind === 'preserved-region') {
                const arr = regionsBySourcePage.get(el.sourcePageNumber) ?? [];
                arr.push(el);
                regionsBySourcePage.set(el.sourcePageNumber, arr);
            }
        }
    }
    const croppedImages = new Map();
    // Crop preserved regions if any exist
    if (regionsBySourcePage.size > 0) {
        if (!sourcePdfBytes && !regionRenderer) {
            throw new Error('Cannot render preserved regions: sourcePdfBytes is required when LayoutDocument contains preserved regions.');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pdfDocument = null;
        try {
            if (sourcePdfBytes) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const pdfjs = await getLocalPDFJS();
                const loadingTask = pdfjs.getDocument({
                    data: sourcePdfBytes.slice(),
                    isEvalSupported: false,
                    useSystemFonts: true,
                });
                pdfDocument = await loadingTask.promise;
            }
            const sourcePages = Array.from(regionsBySourcePage.keys()).sort((a, b) => a - b);
            for (let idx = 0; idx < sourcePages.length; idx++) {
                if (abortSignal?.aborted) {
                    throw new Error('Notes PDF generation cancelled by user.');
                }
                const srcPageNum = sourcePages[idx];
                const regions = regionsBySourcePage.get(srcPageNum) ?? [];
                onProgress?.({
                    phase: 'rendering',
                    currentPage: idx + 1,
                    totalPages: sourcePages.length,
                    message: `Cropping preserved regions from source page ${srcPageNum}...`,
                    percent: Math.round(15 + ((idx + 1) / sourcePages.length) * 45),
                });
                if (regionRenderer) {
                    for (const region of regions) {
                        const payload = await regionRenderer(pdfDocument, srcPageNum, region.sourceBox, targetDpi);
                        croppedImages.set(region.id, payload);
                    }
                }
                else {
                    const pageCrops = await renderAndCropPageRegionsBrowser(pdfDocument, srcPageNum, regions, targetDpi);
                    for (const [id, payload] of pageCrops) {
                        croppedImages.set(id, payload);
                    }
                }
            }
        }
        finally {
            if (pdfDocument) {
                try {
                    await pdfDocument.destroy();
                }
                catch {
                    // Ignore cleanup errors
                }
            }
        }
    }
    // Construct jsPDF document matching layout pages
    const firstPage = layout.pages[0];
    const doc = new jsPDF({
        orientation: firstPage.width > firstPage.height ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [firstPage.width, firstPage.height],
        compress: Boolean(compress),
    });
    for (let pIdx = 0; pIdx < layout.pages.length; pIdx++) {
        if (abortSignal?.aborted) {
            throw new Error('Notes PDF generation cancelled by user.');
        }
        const page = layout.pages[pIdx];
        if (pIdx > 0) {
            doc.addPage([page.width, page.height], page.width > page.height ? 'landscape' : 'portrait');
        }
        onProgress?.({
            phase: 'exporting',
            currentPage: page.pageNumber,
            totalPages: layout.pageCount,
            message: `Writing Kindle page ${page.pageNumber} of ${layout.pageCount}...`,
            percent: Math.round(60 + ((pIdx + 1) / layout.pageCount) * 35),
        });
        for (const el of page.elements) {
            if (el.kind === 'text') {
                renderTextElement(doc, el);
            }
            else {
                const crop = croppedImages.get(el.id);
                if (!crop) {
                    const errMsg = `Missing cropped image for preserved region ${el.id} (source page ${el.sourcePageNumber}).`;
                    errors.push(errMsg);
                    throw new Error(errMsg);
                }
                doc.addImage(crop.data, crop.format, el.box.x, el.box.y, el.box.width, el.box.height, el.id, 'FAST');
            }
        }
    }
    const outputBuffer = doc.output('arraybuffer');
    const pdfBytes = new Uint8Array(outputBuffer);
    onProgress?.({
        phase: 'completed',
        currentPage: layout.pageCount,
        totalPages: layout.pageCount,
        message: `Notes PDF ready (${layout.pageCount} pages).`,
        percent: 100,
    });
    return {
        mode: 'notes',
        fileName: buildOutputFileName(layout.fileName, 'notes'),
        pdfBytes,
        pageCount: layout.pageCount,
        warnings,
        errors,
        layoutDocument: layout,
        createdAt: new Date().toISOString(),
    };
}
function applyTextColor(doc, role) {
    if (role === 'caption') {
        doc.setTextColor(75, 85, 99);
    }
    else if (role === 'code-line') {
        doc.setTextColor(30, 41, 59);
    }
    else {
        doc.setTextColor(17, 24, 39);
    }
}
const SUB_TO_ASCII = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
};
const SUP_TO_ASCII = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
};
/**
 * Ensure plain text string does not contain non-WinAnsi characters that jsPDF built-in fonts
 * truncate or drop silently into control characters or question marks.
 */
export function sanitizeTextForJsPDF(text) {
    return text
        .replace(/[\u2080-\u208E]/g, c => SUB_TO_ASCII[c] ?? c)
        .replace(/[\u2070-\u207E\u00B2\u00B3\u00B9]/g, c => SUP_TO_ASCII[c] ?? c)
        .replace(/\u2192/g, '->')
        .replace(/\u2190/g, '<-')
        .replace(/\u21CC/g, '<=>')
        .replace(/\u2212/g, '-') // mathematical minus (U+2212) -> ASCII hyphen-minus
        .replace(/\u00A0/g, ' ') // non-breaking space -> regular space
        .replace(/[\u2018\u2019]/g, "'") // curly single quotes
        .replace(/[\u201C\u201D]/g, '"') // curly double quotes
        .replace(/\u2013/g, '-') // en dash
        .replace(/\u2014/g, '--') // em dash
        .replace(/\u200b/g, ''); // zero-width space
}
function renderTextElement(doc, el) {
    if (el.calloutBorder) {
        // Neutral E-Ink friendly border (Slate-500) rather than harsh colored decorative line
        doc.setDrawColor(100, 116, 139);
        doc.setLineWidth(1.5);
        const barX = Math.max(4, el.box.x - 6);
        doc.line(barX, el.box.y, barX, el.box.y + el.box.height);
    }
    // Mixed emphasis support: if element has distinct styled spans (e.g. bold label + normal body)
    if (el.spans && el.spans.length > 0) {
        let curX = el.box.x;
        for (const span of el.spans) {
            const family = mapFontFamily(span.font.family);
            const style = mapFontStyle(span.font.weight, span.font.style);
            doc.setFont(family, style);
            doc.setFontSize(span.font.size);
            applyTextColor(doc, el.role);
            const safeText = sanitizeTextForJsPDF(span.text);
            doc.text(safeText, curX, el.box.y, { baseline: 'top' });
            curX += doc.getTextWidth(safeText);
        }
        return;
    }
    // Single-font line rendering
    const family = mapFontFamily(el.font.family);
    const style = mapFontStyle(el.font.weight, el.font.style);
    doc.setFont(family, style);
    doc.setFontSize(el.font.size);
    applyTextColor(doc, el.role);
    const safeText = sanitizeTextForJsPDF(el.text);
    doc.text(safeText, el.box.x, el.box.y, { baseline: 'top' });
}
export function buildOutputFileName(originalName, mode) {
    const base = originalName.replace(/\.pdf$/i, '') || 'document';
    return `${base}-kindle-${mode}.pdf`;
}
