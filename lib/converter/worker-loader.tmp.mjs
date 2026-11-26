/**
 * KindleFlow Converter — Local Worker Loader
 * Stage: Prompt 2 (Offline PDF Processing, Validation & Geometric Extraction)
 *
 * Configures Mozilla PDF.js to load exclusively from the local /public/pdf.worker.min.mjs
 * asset, completely eliminating any external CDN dependencies (unpkg/jsdelivr).
 * Safe for Next.js SSR / Turbopack client hydration.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedPdfjs = null;
let initPromise = null;
/**
 * Initializes and retrieves the local PDF.js instance.
 * Ensures the worker configuration is set exactly once and runs only in browser/client contexts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLocalPDFJS() {
    if (cachedPdfjs) {
        return cachedPdfjs;
    }
    if (initPromise) {
        return initPromise;
    }
    initPromise = (async () => {
        try {
            // Use standard pdfjs-dist in browser; legacy build in Node/test environments
            const isNode = typeof window === 'undefined';
            const pdfjs = isNode
                ? await import('pdfjs-dist/legacy/build/pdf.mjs')
                : await import('pdfjs-dist');
            if (!isNode) {
                // In browser, enforce strictly local worker path relative to root
                // Matches the version copied to public/pdf.worker.min.mjs
                pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
            }
            cachedPdfjs = pdfjs;
            return pdfjs;
        }
        catch (error) {
            initPromise = null;
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to initialize local PDF.js worker: ${msg}`);
        }
    })();
    return initPromise;
}
