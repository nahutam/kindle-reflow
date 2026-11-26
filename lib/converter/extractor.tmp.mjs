/**
 * KindleFlow Converter — Geometric & Text Extraction Engine
 * Stage: Prompt 2 (Offline PDF Processing, Validation & Geometric Extraction)
 *
 * Extracts text items with accurate coordinates, font metadata, and transformation matrices.
 * Normalizes all bounding boxes to a top-left origin coordinate system.
 * Traverses PDF.js operator lists to capture vector paths, lines, and raster image evidence.
 */
import { getLocalPDFJS } from './worker-loader.tmp.mjs';
/**
 * Multiplies two 2D affine transformation matrices in PDF spec order:
 * When a new transformation `cm` is applied to `currentCTM`:
 * CTM_new = cm x CTM_old
 * where point transformation is p' = p x CTM
 */
function multiplyMatrices(cm, ctm) {
    return [
        cm[0] * ctm[0] + cm[1] * ctm[2],
        cm[0] * ctm[1] + cm[1] * ctm[3],
        cm[2] * ctm[0] + cm[3] * ctm[2],
        cm[2] * ctm[1] + cm[3] * ctm[3],
        cm[4] * ctm[0] + cm[5] * ctm[2] + ctm[4],
        cm[4] * ctm[1] + cm[5] * ctm[3] + ctm[5],
    ];
}
/**
 * Transforms a 2D point [x, y] using an affine matrix
 */
function transformPoint(p, m) {
    return [
        m[0] * p[0] + m[2] * p[1] + m[4],
        m[1] * p[0] + m[3] * p[1] + m[5],
    ];
}
/**
 * Derives normalized font metadata and styling flags from font name and transform matrix.
 */
export function deriveFontInfo(fontName, transform, itemHeight) {
    // Compute font scale from matrix norm
    const normA = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]);
    const normC = Math.sqrt(transform[2] * transform[2] + transform[3] * transform[3]);
    let size = normA > 0 ? normA : normC;
    if (size <= 0 && itemHeight && itemHeight > 0) {
        size = itemHeight;
    }
    size = Math.round(size * 100) / 100;
    // Strip standard subset prefix (e.g., "ABCDEF+TimesNewRoman" -> "TimesNewRoman")
    const family = fontName.replace(/^[A-Z]{6}\+/, '');
    // Accurate font weight classification:
    // - Distinguish Regular and Medium (500) from true Bold (700+) / Black / Heavy / Semibold.
    // - Note: 'medium' is normal body weight in many fonts and must NEVER be classified as bold.
    // - Note: 'bf' alone must not match arbitrary font names containing 'bf' (e.g. AbstractFallback).
    const isBold = /(?:^|[-_,\s])(?:bold|black|heavy|semi[_-]?bold|demi[_-]?bold|extra[_-]?bold|ultra[_-]?bold)(?:$|[-_,\s])|\b(?:cmbx\d*|cmbf\d*|cmb\d+)\b/i.test(family) ||
        /[-_]bold/i.test(family) ||
        /[-_]black/i.test(family) ||
        /[-_]heavy/i.test(family) ||
        /[-_]semibold/i.test(family);
    // Italic / Oblique classification:
    // - Note: Short 'ti' matched 'Times' in 'TimesNewRoman'! Must use specific patterns.
    const isItalic = /(?:italic|oblique|slanted|cmti\d*|cmi\d*|\bit\b)/i.test(family) ||
        /[-_]italic/i.test(family) ||
        /[-_]oblique/i.test(family) ||
        /[-_]it(?:$|[-_,\s])/i.test(family);
    const isMonospace = /(?:mono|courier|consolas|code|cmtt\d*|typewriter|menlo|sourcecodepro)/i.test(family);
    const isSans = /(?:arial|helvetica|sans|verdana|tahoma|trebuchet|calibri|roboto|opensans|lato)/i.test(family);
    const isSerif = !isMonospace && !isSans && /(?:times|georgia|roman|serif|cmr\d*|cambria|palatino|garamond|baskerville)/i.test(family);
    return {
        name: fontName,
        family,
        size,
        isBold,
        isItalic,
        isMonospace,
        isSerif,
    };
}
/**
 * Converts a bounding box from bottom-left PDF space to top-left normalized space.
 */
function normalizePDFBox(pdfX, pdfY, width, height, pageHeight) {
    const normX = Math.round(pdfX * 100) / 100;
    // In PDF space, pdfY is bottom edge. In top-left space, y is top edge:
    const normY = Math.round((pageHeight - pdfY - height) * 100) / 100;
    return {
        x: normX,
        y: normY,
        width: Math.round(Math.abs(width) * 100) / 100,
        height: Math.round(Math.abs(height) * 100) / 100,
    };
}
/**
 * Extracts all text items and graphical evidence from a single PDF.js page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function extractPageData(page, pageNumber) {
    const warnings = [];
    const viewport = page.getViewport({ scale: 1.0 });
    const pageHeight = viewport.height;
    const pageWidth = viewport.width;
    const rotation = page.rotate || 0;
    // 1. Text Extraction
    const textItems = [];
    let totalCharacters = 0;
    try {
        const textContent = await page.getTextContent({ includeMarkedContent: true });
        let itemIndex = 0;
        for (const rawItem of textContent.items) {
            if (!('str' in rawItem) || typeof rawItem.str !== 'string') {
                // Marked content or formatting token
                continue;
            }
            const str = rawItem.str;
            totalCharacters += str.trim().length;
            const transform = rawItem.transform;
            const font = deriveFontInfo(rawItem.fontName || 'UnknownFont', transform, rawItem.height);
            const itemWidth = rawItem.width > 0 ? rawItem.width : font.size * Math.max(1, str.length) * 0.5;
            const itemHeight = rawItem.height > 0 ? rawItem.height : font.size;
            // PDF transform[4] is baseline X, transform[5] is baseline Y
            const baselineX = transform[4];
            const baselineY = transform[5];
            // Baseline Y normalized from top:
            const normBaselineY = pageHeight - baselineY;
            // Top of bounding box is baseline minus height
            const normY = normBaselineY - itemHeight;
            const box = {
                x: Math.round(baselineX * 100) / 100,
                y: Math.round(normY * 100) / 100,
                width: Math.round(itemWidth * 100) / 100,
                height: Math.round(itemHeight * 100) / 100,
            };
            textItems.push({
                id: `p${pageNumber}_t${itemIndex}`,
                pageNumber,
                str,
                dir: rawItem.dir || 'ltr',
                box,
                font,
                transform,
                hasEOL: Boolean(rawItem.hasEOL),
            });
            itemIndex += 1;
        }
    }
    catch (err) {
        warnings.push(`Text extraction warning on page ${pageNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 2. Operator List Traversal (Graphics & Image Evidence)
    const paths = [];
    const images = [];
    const limitations = [];
    let pathOperationsCount = 0;
    let lineCount = 0;
    let rectCount = 0;
    let imageCount = 0;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfjs = await getLocalPDFJS();
        const ops = await page.getOperatorList();
        // Graphics State Machine
        let currentCTM = [1, 0, 0, 1, 0, 0];
        const ctmStack = [];
        let currentLineWidth = 1;
        for (let i = 0; i < ops.fnArray.length; i += 1) {
            const fn = ops.fnArray[i];
            const args = ops.argsArray[i];
            // State save
            if (fn === pdfjs.OPS.save) {
                ctmStack.push([...currentCTM]);
            }
            // State restore
            else if (fn === pdfjs.OPS.restore) {
                currentCTM = ctmStack.pop() || [1, 0, 0, 1, 0, 0];
            }
            // Matrix transformation (cm)
            else if (fn === pdfjs.OPS.transform) {
                if (Array.isArray(args) && args.length === 6) {
                    currentCTM = multiplyMatrices(args, currentCTM);
                }
            }
            // Line width
            else if (fn === pdfjs.OPS.setLineWidth) {
                if (Array.isArray(args) && typeof args[0] === 'number') {
                    currentLineWidth = args[0];
                }
            }
            // Images: paintImageXObject / paintInlineImageXObject
            else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
                imageCount += 1;
                const imgId = Array.isArray(args) && args[0] ? String(args[0]) : `img_p${pageNumber}_${imageCount}`;
                // In PDF spec, images are painted in unit square [0, 0, 1, 1] transformed by CTM
                const p0 = transformPoint([0, 0], currentCTM);
                const p1 = transformPoint([1, 0], currentCTM);
                const p2 = transformPoint([0, 1], currentCTM);
                const p3 = transformPoint([1, 1], currentCTM);
                // Convert corners to normalized top-left space
                const pts = [p0, p1, p2, p3].map(([px, py]) => [px, pageHeight - py]);
                const xs = pts.map(p => p[0]);
                const ys = pts.map(p => p[1]);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const box = {
                    x: Math.round(minX * 100) / 100,
                    y: Math.round(minY * 100) / 100,
                    width: Math.round((maxX - minX) * 100) / 100,
                    height: Math.round((maxY - minY) * 100) / 100,
                };
                images.push({
                    id: imgId,
                    box,
                    pixelWidth: Array.isArray(args) && typeof args[1] === 'number' ? args[1] : undefined,
                    pixelHeight: Array.isArray(args) && typeof args[2] === 'number' ? args[2] : undefined,
                    isInline: fn === pdfjs.OPS.paintInlineImageXObject,
                });
            }
            // Paths: constructPath
            else if (fn === pdfjs.OPS.constructPath) {
                pathOperationsCount += 1;
                // PDF.js constructPath stores precomputed bbox in args[2] = [minX, minY, maxX, maxY]
                const bboxData = Array.isArray(args) ? args[2] : null;
                if (bboxData && (Array.isArray(bboxData) || typeof bboxData === 'object')) {
                    const rawMinX = bboxData[0] !== undefined ? bboxData[0] : bboxData['0'];
                    const rawMinY = bboxData[1] !== undefined ? bboxData[1] : bboxData['1'];
                    const rawMaxX = bboxData[2] !== undefined ? bboxData[2] : bboxData['2'];
                    const rawMaxY = bboxData[3] !== undefined ? bboxData[3] : bboxData['3'];
                    if (typeof rawMinX === 'number' &&
                        typeof rawMinY === 'number' &&
                        typeof rawMaxX === 'number' &&
                        typeof rawMaxY === 'number') {
                        // Apply current CTM transform to bbox corners
                        const p0 = transformPoint([rawMinX, rawMinY], currentCTM);
                        const p1 = transformPoint([rawMaxX, rawMinY], currentCTM);
                        const p2 = transformPoint([rawMinX, rawMaxY], currentCTM);
                        const p3 = transformPoint([rawMaxX, rawMaxY], currentCTM);
                        // Convert to top-left coordinate system: y_top = pageHeight - y_pdf
                        const ys = [pageHeight - p0[1], pageHeight - p1[1], pageHeight - p2[1], pageHeight - p3[1]];
                        const xs = [p0[0], p1[0], p2[0], p3[0]];
                        const minX = Math.min(...xs);
                        const maxX = Math.max(...xs);
                        const minY = Math.min(...ys);
                        const maxY = Math.max(...ys);
                        const box = {
                            x: Math.round(minX * 100) / 100,
                            y: Math.round(minY * 100) / 100,
                            width: Math.round((maxX - minX) * 100) / 100,
                            height: Math.round((maxY - minY) * 100) / 100,
                        };
                        let shapeType = 'path';
                        if (box.height <= 2.5 && box.width > 4) {
                            shapeType = 'line';
                            lineCount += 1;
                        }
                        else if (box.width <= 2.5 && box.height > 4) {
                            shapeType = 'line';
                            lineCount += 1;
                        }
                        else if (box.width > 4 && box.height > 4) {
                            shapeType = 'rect';
                            rectCount += 1;
                        }
                        paths.push({
                            type: shapeType,
                            box,
                            lineWidth: currentLineWidth,
                            segmentCount: Array.isArray(args[1]) ? args[1].length : 1,
                        });
                    }
                }
                else {
                    limitations.push(`constructPath at index ${i} did not contain precomputed bounding coordinates`);
                }
            }
            // Vector rectangle operator
            else if (fn === pdfjs.OPS.rectangle) {
                rectCount += 1;
                if (Array.isArray(args) && args.length >= 4) {
                    const [rx, ry, rw, rh] = args;
                    const p0 = transformPoint([rx, ry], currentCTM);
                    const p1 = transformPoint([rx + rw, ry], currentCTM);
                    const p2 = transformPoint([rx, ry + rh], currentCTM);
                    const p3 = transformPoint([rx + rw, ry + rh], currentCTM);
                    const ys = [pageHeight - p0[1], pageHeight - p1[1], pageHeight - p2[1], pageHeight - p3[1]];
                    const xs = [p0[0], p1[0], p2[0], p3[0]];
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    const box = {
                        x: Math.round(minX * 100) / 100,
                        y: Math.round(minY * 100) / 100,
                        width: Math.round((maxX - minX) * 100) / 100,
                        height: Math.round((maxY - minY) * 100) / 100,
                    };
                    paths.push({
                        type: 'rect',
                        box,
                        lineWidth: currentLineWidth,
                        segmentCount: 4,
                    });
                }
            }
        }
    }
    catch (err) {
        warnings.push(`Graphics operator list traversal warning on page ${pageNumber}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 3. Compute Page Metadata and Classification
    const textItemCount = textItems.length;
    const pageArea = pageWidth * pageHeight;
    const areaUnits = Math.max(1, pageArea / 10000);
    const textDensity = Math.round((totalCharacters / areaUnits) * 10) / 10;
    const hasVectorGraphics = paths.length > 0;
    const hasImages = images.length > 0;
    let classification;
    if (totalCharacters === 0) {
        classification = hasImages ? 'potentially-scanned' : 'low-text';
    }
    else if (totalCharacters < 80) {
        classification = hasImages ? 'mixed' : 'low-text';
    }
    else if (hasImages || hasVectorGraphics) {
        classification = 'mixed';
    }
    else {
        classification = 'text-rich';
    }
    const metadata = {
        pageNumber,
        width: Math.round(pageWidth * 100) / 100,
        height: Math.round(pageHeight * 100) / 100,
        rotation,
        textItemCount,
        characterCount: totalCharacters,
        textDensity,
        classification,
        hasExtractableText: textItemCount > 0 && totalCharacters > 0,
    };
    const graphicsSummary = {
        pathOperationsCount,
        lineCount,
        rectCount,
        imageCount,
        hasVectorGraphics,
        hasImages,
        limitations,
    };
    return {
        pageNumber,
        metadata,
        textItems,
        paths,
        images,
        graphicsSummary,
        warnings,
    };
}
