/**
 * KindleFlow Converter — PDF Validation Module
 * Stage: Prompt 2 (Offline PDF Processing, Validation & Geometric Extraction)
 *
 * Implements thorough file-level and page-level validation for academic PDFs.
 * Detects encryption, corrupt data, scanned image-only pages, and invalid formats.
 */
import { getLocalPDFJS } from './worker-loader.tmp.mjs';
const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024; // 150 MB sanity limit
const PDF_HEADER_MAGIC = '%PDF-';
/**
 * Validates a PDF file or binary buffer.
 */
export async function validatePDF(input, fileName = 'document.pdf') {
    const errors = [];
    const warnings = [];
    const pageClassifications = [];
    let bytes;
    if (input instanceof Uint8Array) {
        bytes = input;
    }
    else if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input);
    }
    else if (typeof File !== 'undefined' && input instanceof File) {
        fileName = input.name || fileName;
        const buffer = await input.arrayBuffer();
        bytes = new Uint8Array(buffer);
    }
    else {
        // Blob or fallback
        const blob = input;
        const buffer = await blob.arrayBuffer();
        bytes = new Uint8Array(buffer);
    }
    const fileSize = bytes.byteLength;
    // 1. File-level check: Empty file
    if (fileSize === 0) {
        errors.push({
            code: 'FILE_EMPTY',
            message: 'The selected file is empty (0 bytes).',
        });
        return {
            isValid: false,
            fileSize,
            fileName,
            pageCount: 0,
            isEncrypted: false,
            isScannedOnly: false,
            errors,
            warnings,
            pageClassifications: [],
        };
    }
    // 2. File-level check: Excessive size
    if (fileSize > MAX_FILE_SIZE_BYTES) {
        errors.push({
            code: 'FILE_TOO_LARGE',
            message: `File exceeds the maximum supported size of 150 MB (size: ${(fileSize / (1024 * 1024)).toFixed(1)} MB).`,
        });
        return {
            isValid: false,
            fileSize,
            fileName,
            pageCount: 0,
            isEncrypted: false,
            isScannedOnly: false,
            errors,
            warnings,
            pageClassifications: [],
        };
    }
    // 3. File-level check: Magic Header %PDF-
    const headerSlice = bytes.subarray(0, Math.min(1024, bytes.byteLength));
    const headerStr = new TextDecoder('latin1').decode(headerSlice);
    if (!headerStr.includes(PDF_HEADER_MAGIC)) {
        errors.push({
            code: 'INVALID_HEADER',
            message: 'File does not contain a valid PDF signature (%PDF-). It may be corrupted or an unsupported file format.',
        });
        return {
            isValid: false,
            fileSize,
            fileName,
            pageCount: 0,
            isEncrypted: false,
            isScannedOnly: false,
            errors,
            warnings,
            pageClassifications: [],
        };
    }
    // 4. Open document via local PDF.js instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdfjs;
    try {
        pdfjs = await getLocalPDFJS();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({
            code: 'WORKER_INIT_ERROR',
            message: 'Failed to initialize local PDF engine.',
            details: msg,
        });
        return {
            isValid: false,
            fileSize,
            fileName,
            pageCount: 0,
            isEncrypted: false,
            isScannedOnly: false,
            errors,
            warnings,
            pageClassifications: [],
        };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdfDocument = null;
    let isEncrypted = false;
    try {
        const loadingTask = pdfjs.getDocument({
            data: bytes.slice(),
            isEvalSupported: false,
            useSystemFonts: true,
        });
        pdfDocument = await loadingTask.promise;
    }
    catch (err) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const errorObj = err;
        if (errorObj?.name === 'PasswordException' || isEncrypted) {
            return {
                isValid: false,
                fileSize,
                fileName,
                pageCount: 0,
                isEncrypted: true,
                isScannedOnly: false,
                errors: [
                    {
                        code: 'PASSWORD_PROTECTED',
                        message: 'This PDF document is password-protected or encrypted. KindleFlow cannot reflow password-protected files without decryption.',
                        details: errorObj?.message,
                    },
                ],
                warnings,
                pageClassifications: [],
            };
        }
        errors.push({
            code: 'CORRUPT_DOCUMENT',
            message: 'Unable to open PDF. The document structure may be damaged or truncated.',
            details: errorObj?.message || String(err),
        });
        return {
            isValid: false,
            fileSize,
            fileName,
            pageCount: 0,
            isEncrypted: false,
            isScannedOnly: false,
            errors,
            warnings,
            pageClassifications: [],
        };
    }
    const pageCount = pdfDocument.numPages;
    if (pageCount === 0) {
        errors.push({
            code: 'CORRUPT_DOCUMENT',
            message: 'The PDF report contains zero pages.',
        });
        await pdfDocument.destroy();
        return {
            isValid: false,
            fileSize,
            fileName,
            pageCount: 0,
            isEncrypted: false,
            isScannedOnly: false,
            errors,
            warnings,
            pageClassifications: [],
        };
    }
    // 5. Page-level inspection & classification
    let scannedPagesCount = 0;
    let lowTextPagesCount = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        try {
            const page = await pdfDocument.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.0 });
            const textContent = await page.getTextContent({ includeMarkedContent: false });
            let characterCount = 0;
            for (const item of textContent.items) {
                if ('str' in item && typeof item.str === 'string') {
                    characterCount += item.str.trim().length;
                }
            }
            const textItemCount = textContent.items.length;
            const pageArea = viewport.width * viewport.height;
            const areaUnits = Math.max(1, pageArea / 10000);
            const textDensity = Math.round((characterCount / areaUnits) * 10) / 10;
            // Quick graphics check via operator list
            let hasImage = false;
            let hasVector = false;
            try {
                const ops = await page.getOperatorList();
                for (let i = 0; i < ops.fnArray.length; i += 1) {
                    const fn = ops.fnArray[i];
                    if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
                        hasImage = true;
                    }
                    else if (fn === pdfjs.OPS.constructPath || fn === pdfjs.OPS.rectangle) {
                        hasVector = true;
                    }
                }
            }
            catch {
                // Non-fatal operator inspection error
            }
            // Classification heuristic
            let classification;
            if (characterCount === 0) {
                if (hasImage) {
                    classification = 'potentially-scanned';
                    scannedPagesCount += 1;
                }
                else {
                    classification = 'low-text';
                    lowTextPagesCount += 1;
                }
            }
            else if (characterCount < 80) {
                // Very low text (cover, equation-only page, appendix figure)
                classification = hasImage ? 'mixed' : 'low-text';
                lowTextPagesCount += 1;
            }
            else if (hasImage || hasVector) {
                classification = 'mixed';
            }
            else {
                classification = 'text-rich';
            }
            pageClassifications.push({
                pageNumber,
                classification,
            });
        }
        catch (pageErr) {
            warnings.push(`Page ${pageNumber} inspection warning: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`);
            pageClassifications.push({
                pageNumber,
                classification: 'low-text',
            });
        }
    }
    // Evaluate document-level scanned status
    const isScannedOnly = scannedPagesCount === pageCount || (scannedPagesCount + lowTextPagesCount === pageCount && scannedPagesCount > 0);
    if (isScannedOnly) {
        warnings.push('Document appears to be entirely scanned images or non-text graphics. KindleFlow reflow requires extractable text streams (OCR is not supported in this version).');
    }
    else if (scannedPagesCount > 0) {
        warnings.push(`${scannedPagesCount} of ${pageCount} pages contain no extractable text and will be preserved as fallback pages.`);
    }
    // Cleanup
    try {
        await pdfDocument.destroy();
    }
    catch {
        // Ignore destruction error
    }
    return {
        isValid: errors.length === 0,
        fileSize,
        fileName,
        pageCount,
        isEncrypted,
        isScannedOnly,
        errors,
        warnings,
        pageClassifications,
    };
}
