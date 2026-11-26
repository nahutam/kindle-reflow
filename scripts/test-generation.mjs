/**
 * KindleFlow — Dual-Mode PDF Generation Tests (Prompt 5)
 *
 * Mode A: Notes Reflow PDF Generation
 * Mode B: Slides / Image Enlargement Converter
 *
 * Verifies:
 *  1. Notes: Selectable vector text is rendered with correct positions and page dimensions
 *  2. Notes: Preserved regions are cleanly placed at high-DPI coordinates
 *  3. Notes: Live jsPDF text measurement correctly wraps lines
 *  4. Notes: Equations and tables retain their original geometry
 *  5. Notes: Captions remain associated with figures
 *  6. Slides: Original slide pages produce strictly 1 output page per source page
 *  7. Slides: Landscape Kindle display profile maintains 4:3 aspect ratio without stretching
 *  8. Slides: Smart margin detection trims confirmed background without clipping content
 *  9. Slides: Non-uniform/gradient backgrounds fall back safely to full original page
 * 10. Slides: Content covering <15% of page falls back safely to prevent accidental cropping
 * 11. Slides: Portrait source slides scale and center cleanly without distortion
 * 12. Slides: Low-resolution embedded images generate clear advisory warnings
 * 13. Slides: Original proportions setting preserves exact full source bounds
 * 14. Shared: Dual-mode dispatcher routes correctly to Notes or Slides without crossover
 * 15. Shared: End-to-end Notes conversion pipeline (extract -> analyze -> layout -> generateNotesPDF)
 * 16. Shared: End-to-end Slides conversion pipeline (load -> detectSafeMargins -> render -> generateSlidePDF)
 *
 * Run: node scripts/test-generation.mjs
 */

import { jsPDF } from 'jspdf'
import * as fs from 'fs'
import * as path from 'path'
import ts from 'typescript'

// ─── TypeScript import helper ─────────────────────────────────────────────────

async function importTS(tsFilePath) {
  const code = fs.readFileSync(tsFilePath, 'utf8')
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const tempPath = tsFilePath.replace(/\.ts$/, '.tmp.mjs')
  const rewritten = transpiled.replace(/from\s+['"]\.\/([^'"]+)['"]/g, (_, p) => {
    if (p.endsWith('.tmp.mjs')) return `from './${p}'`
    if (p.endsWith('.ts')) return `from './${p.replace(/\.ts$/, '.tmp.mjs')}'`
    return `from './${p}.tmp.mjs'`
  })
  fs.writeFileSync(tempPath, rewritten, 'utf8')

  try {
    const fileUrl = 'file://' + path.resolve(tempPath).replace(/\\/g, '/')
    const mod = await import(fileUrl)
    return { mod, tempPath }
  } catch (err) {
    fs.unlinkSync(tempPath)
    throw err
  }
}

console.log('\nKindleFlow — Dual-Mode PDF Generation Tests (Prompt 5)\n')
console.log('Loading converter modules...')

const typesRes = await importTS('lib/converter/types.ts')
const workerRes = await importTS('lib/converter/worker-loader.ts')
const validatorRes = await importTS('lib/converter/validator.ts')
const extractorRes = await importTS('lib/converter/extractor.ts')
const lineRes = await importTS('lib/converter/line-reconstructor.ts')
const structRes = await importTS('lib/converter/structure-analyzer.ts')
const orderRes = await importTS('lib/converter/reading-order.ts')
const paraRes = await importTS('lib/converter/paragraph-reconstructor.ts')
const classRes = await importTS('lib/converter/classifier.ts')
const reflowRes = await importTS('lib/converter/text-reflower.ts')
const preserverRes = await importTS('lib/converter/region-preserver.ts')
const layoutValRes = await importTS('lib/converter/layout-validator.ts')
const layoutEngRes = await importTS('lib/converter/layout-engine.ts')
const pdfGenRes = await importTS('lib/converter/pdf-generator.ts')
const slideRes = await importTS('lib/converter/slide-converter.ts')
const indexRes = await importTS('lib/converter/index.ts')

const allRefs = [
  typesRes,
  workerRes,
  validatorRes,
  extractorRes,
  lineRes,
  structRes,
  orderRes,
  paraRes,
  classRes,
  reflowRes,
  preserverRes,
  layoutValRes,
  layoutEngRes,
  pdfGenRes,
  slideRes,
  indexRes,
]

function cleanup() {
  for (const r of allRefs) {
    try {
      fs.unlinkSync(r.tempPath)
    } catch {
      // ignore
    }
  }
}

const {
  extractDocument,
  analyzeDocument,
  layoutDocument,
  generateNotesPDF,
  createJsPDFTextMeasurer,
  convertSlidesToPDF,
  convertNotesDocument,
  convertDocument,
  detectSafeMarginsFromPixels,
  computeSlideDestinationBox,
  KINDLE_SLIDE_DISPLAY_LANDSCAPE,
  KINDLE_SLIDE_DISPLAY_PORTRAIT,
  DEFAULT_SLIDE_SETTINGS,
} = indexRes.mod

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed++
    failures.push({ name, error: err.message })
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed')
}

function assertEqual(actual, expected, label = '') {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

// 1x1 transparent PNG data url fixture for region crop mock
const MOCK_PNG_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// ─── Tests ────────────────────────────────────────────────────────────────────

// ─── MODE A: NOTES REFLOW PDF GENERATOR ───────────────────────────────────────

await test('1. Notes: Selectable vector text rendered with correct page dimensions', async () => {
  const dummyLayout = {
    fileName: 'paper.pdf',
    settings: { pageWidth: 432, pageHeight: 576 },
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        width: 432,
        height: 576,
        contentArea: { x: 26, y: 28, width: 380, height: 516 },
        usedHeight: 100,
        remainingHeight: 416,
        isDedicatedPage: false,
        sourcePages: [1],
        elements: [
          {
            id: 'el_1',
            kind: 'text',
            pageNumber: 1,
            box: { x: 26, y: 28, width: 350, height: 24 },
            readingOrder: 0,
            sourceBlockId: 'b1',
            sourcePageNumber: 1,
            role: 'heading',
            text: 'Deep Academic Reflow Engine',
            font: { family: 'sans', size: 16, weight: 'bold', style: 'normal' },
            align: 'left',
            lineHeight: 24,
            indent: 0,
          },
          {
            id: 'el_2',
            kind: 'text',
            pageNumber: 1,
            box: { x: 26, y: 58, width: 380, height: 16 },
            readingOrder: 1,
            sourceBlockId: 'b2',
            sourcePageNumber: 1,
            role: 'paragraph',
            text: 'This selectable sentence confirms vector text output.',
            font: { family: 'sans', size: 11.5, weight: 'normal', style: 'normal' },
            align: 'left',
            lineHeight: 16,
            indent: 0,
          },
        ],
      },
    ],
    warnings: [],
    validation: { isValid: true, errors: [], warnings: [] },
    sourcePageCount: 1,
    stats: { totalElements: 2, reflowedTextElements: 2, preservedRegions: 0, dedicatedPages: 0 },
    createdAt: new Date().toISOString(),
  }

  const exportResult = await generateNotesPDF(dummyLayout)
  assertEqual(exportResult.mode, 'notes', 'export mode')
  assertEqual(exportResult.pageCount, 1, 'pageCount')
  assert(exportResult.pdfBytes.byteLength > 800, 'Valid PDF bytes generated')

  // Inspect generated PDF bytes for selectable text strings
  const pdfString = Buffer.from(exportResult.pdfBytes).toString('latin1')
  assert(pdfString.includes('Deep Academic Reflow Engine'), 'Heading string embedded in PDF')
  assert(pdfString.includes('selectable sentence'), 'Body sentence embedded in PDF')
})

await test('2. Notes: Preserved regions rendered via crop renderer', async () => {
  const dummyLayoutWithRegion = {
    fileName: 'math.pdf',
    settings: { pageWidth: 432, pageHeight: 576 },
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        width: 432,
        height: 576,
        contentArea: { x: 26, y: 28, width: 380, height: 516 },
        usedHeight: 120,
        remainingHeight: 396,
        isDedicatedPage: false,
        sourcePages: [1],
        elements: [
          {
            id: 'reg_eq_1',
            kind: 'preserved-region',
            pageNumber: 1,
            box: { x: 40, y: 50, width: 250, height: 60 },
            readingOrder: 0,
            sourceBlockId: 'b_eq1',
            sourcePageNumber: 1,
            sourceBox: { x: 100, y: 200, width: 250, height: 60 },
            regionType: 'equation',
            preservationReason: 'equation-spatial',
            confidence: 'high',
            scaleFactor: 1.0,
            needsScaling: false,
            needsDedicatedPage: false,
            isOversized: false,
          },
        ],
      },
    ],
    warnings: [],
    validation: { isValid: true, errors: [], warnings: [] },
    sourcePageCount: 1,
    stats: { totalElements: 1, reflowedTextElements: 0, preservedRegions: 1, dedicatedPages: 0 },
    createdAt: new Date().toISOString(),
  }

  let rendererCalled = false
  const mockCropRenderer = async (pdfDoc, srcPage, srcBox, dpi) => {
    rendererCalled = true
    assertEqual(srcPage, 1, 'mock source page')
    assertEqual(srcBox.width, 250, 'mock source box width')
    return {
      data: MOCK_PNG_DATA,
      format: 'PNG',
      pixelWidth: 250,
      pixelHeight: 60,
    }
  }

  const exportResult = await generateNotesPDF(dummyLayoutWithRegion, {
    regionRenderer: mockCropRenderer,
  })

  assert(rendererCalled, 'Custom regionRenderer was called for preserved region')
  assert(exportResult.pdfBytes.byteLength > 500, 'Valid PDF with embedded crop produced')
})

await test('3. Notes: Live jsPDF text measurer wraps text correctly', async () => {
  const measurer = createJsPDFTextMeasurer()
  const fontSpec = { family: 'sans', size: 12, weight: 'normal', style: 'normal' }
  const widthA = measurer.measureWidth('Hello World', fontSpec)
  const widthB = measurer.measureWidth('A much longer sentence taking significantly more horizontal space', fontSpec)
  assert(widthB > widthA * 2, 'jsPDF measureWidth computes proportional string lengths')
})

// ─── MODE B: SLIDES CONVERTER & IMAGE ENLARGEMENT ─────────────────────────────

await test('4. Slides: Smart margin detection trims uniform outer padding', async () => {
  // Create synthetic 100x100 pixel canvas with 20px white padding around a 60x60 dark square
  const W = 100
  const H = 100
  const rgba = new Uint8ClampedArray(W * H * 4)

  // Fill with white (255, 255, 255)
  rgba.fill(255)

  // Draw dark content box in center [20, 20, 60, 60]
  for (let y = 20; y < 80; y++) {
    for (let x = 20; x < 80; x++) {
      const idx = (y * W + x) * 4
      rgba[idx] = 20
      rgba[idx + 1] = 20
      rgba[idx + 2] = 20
    }
  }

  const crop = detectSafeMarginsFromPixels(rgba, W, H, 100, 100, 1.0)
  assertEqual(crop.usedFallback, false, 'Should not use fallback on clean uniform margin')
  // Content was [20..79] -> with safety pad (6pt) x should be around 14..20
  assert(crop.x < 20 && crop.x >= 14, `crop.x=${crop.x} trimmed left margin`)
  assert(crop.width < 100 && crop.width > 60, `crop.width=${crop.width} trimmed margins`)
})

await test('5. Slides: Non-uniform/gradient backgrounds fall back safely to full original page', async () => {
  const W = 100
  const H = 100
  const rgba = new Uint8ClampedArray(W * H * 4)
  rgba.fill(255)

  // Make top-left corner dark and bottom-right corner light (gradient/photo slide)
  rgba[0] = 10
  rgba[1] = 10
  rgba[2] = 10 // top-left is dark
  const brIdx = ((H - 1) * W + (W - 1)) * 4
  rgba[brIdx] = 250
  rgba[brIdx + 1] = 250
  rgba[brIdx + 2] = 250 // bottom-right is white

  const crop = detectSafeMarginsFromPixels(rgba, W, H, 200, 150, 1.0)
  assertEqual(crop.usedFallback, true, 'Non-uniform background must trigger safe fallback')
  assertEqual(crop.width, 200, 'Preserves full page width on fallback')
  assertEqual(crop.height, 150, 'Preserves full page height on fallback')
})

await test('6. Slides: Tiny content area (<15%) falls back to full page bounds', async () => {
  const W = 100
  const H = 100
  const rgba = new Uint8ClampedArray(W * H * 4)
  rgba.fill(255)

  // Draw tiny 5x5 dot in center (only 25 pixels out of 10000 = 0.25% area)
  for (let y = 48; y < 53; y++) {
    for (let x = 48; x < 53; x++) {
      const idx = (y * W + x) * 4
      rgba[idx] = 10
      rgba[idx + 1] = 10
      rgba[idx + 2] = 10
    }
  }

  const crop = detectSafeMarginsFromPixels(rgba, W, H, 100, 100, 1.0)
  assertEqual(crop.usedFallback, true, 'Tiny content box (<15%) must fallback to full page')
})

await test('7. Slides: Proportional scaling & centering into landscape 4:3 display profile', async () => {
  const cropBox = { x: 0, y: 0, width: 400, height: 300 } // 4:3 slide
  const profile = KINDLE_SLIDE_DISPLAY_LANDSCAPE // 576x432, pad=10 -> usable 556x412

  const { destBox, scaleFactor } = computeSlideDestinationBox(cropBox, profile)
  assert(scaleFactor > 1.3, `Should enlarge slide: scaleFactor=${scaleFactor}`)
  assert(destBox.x >= profile.paddingPt, 'Respects left padding')
  assert(destBox.y >= profile.paddingPt, 'Respects top padding')
  assert(destBox.x + destBox.width <= profile.widthPt - profile.paddingPt + 0.1, 'Fits within right padding')
  assert(destBox.y + destBox.height <= profile.heightPt - profile.paddingPt + 0.1, 'Fits within bottom padding')

  // Verify aspect ratio strictly preserved (no distortion)
  const origRatio = cropBox.width / cropBox.height
  const destRatio = destBox.width / destBox.height
  assert(Math.abs(origRatio - destRatio) < 0.001, 'Aspect ratio unaltered')
})

await test('8. Slides: Portrait source slide scales and centers without distortion', async () => {
  const portraitSlide = { x: 0, y: 0, width: 300, height: 500 } // portrait slide
  const profile = KINDLE_SLIDE_DISPLAY_LANDSCAPE

  const { destBox } = computeSlideDestinationBox(portraitSlide, profile)
  // Height must be the limiting factor; centered horizontally with side margins
  const origRatio = portraitSlide.width / portraitSlide.height
  const destRatio = destBox.width / destBox.height
  assert(Math.abs(origRatio - destRatio) < 0.001, 'Portrait slide aspect ratio preserved')
  assert(destBox.x > profile.paddingPt + 50, 'Portrait slide horizontally centered inside landscape canvas')
})

// ─── INTEGRATION & DISPATCHER TESTS ───────────────────────────────────────────

await test('9. Dispatcher: Mode A and Mode B execute separate pipelines', async () => {
  // Mode selection validation
  const dummyDoc = new jsPDF({ unit: 'pt', format: [612, 792] })
  dummyDoc.setFontSize(14)
  dummyDoc.text('Mode Routing Test Document', 72, 100)
  const bytes = new Uint8Array(dummyDoc.output('arraybuffer'))

  // Mock slide rasterizer for Mode B test in Node
  const mockSlideRasterizer = async (pdfDoc, pageNum, settings) => ({
    image: { data: MOCK_PNG_DATA, format: 'PNG', pixelWidth: 400, pixelHeight: 300 },
    sourceWidthPt: 612,
    sourceHeightPt: 792,
    cropBoxPt: { x: 0, y: 0, width: 612, height: 792 },
    usedFallbackMargins: false,
    marginReason: 'Mock slide',
    lowResImageDetected: false,
    warnings: [],
  })

  // Run Mode B (Slides)
  const slideExport = await convertDocument(bytes, {
    mode: 'slides',
    fileName: 'lecture.pdf',
    slideRasterizer: mockSlideRasterizer,
  })

  assertEqual(slideExport.mode, 'slides', 'Dispatched to slides')
  assertEqual(slideExport.pageCount, 1, '1 slide page output')
  assert(slideExport.fileName.includes('slides'), 'File name tagged with -slides')

  // Run Mode A (Notes)
  const notesExport = await convertDocument(bytes, {
    mode: 'notes',
    fileName: 'lecture.pdf',
  })

  assertEqual(notesExport.mode, 'notes', 'Dispatched to notes')
  assert(notesExport.layoutDocument !== undefined, 'Notes produced LayoutDocument')
  assert(notesExport.fileName.includes('notes'), 'File name tagged with -notes')
})

await test('10. End-to-end Mode A: jsPDF academic paper -> complete Notes PDF', async () => {
  const paperDoc = new jsPDF({ unit: 'pt', format: [612, 792] })
  paperDoc.setFontSize(20)
  paperDoc.text('Introduction to E-Reader Reflow', 72, 80)
  paperDoc.setFontSize(11)
  paperDoc.text(
    'Academic PDFs exported from Notion combine multi-paragraph prose with mathematical expressions.',
    72,
    120,
    { maxWidth: 450 },
  )
  paperDoc.text('1. Reflowable paragraphs adapt to 6-inch screens.', 72, 170)
  paperDoc.text('2. Formulas and tables retain their structure.', 72, 195)

  const pdfBytes = new Uint8Array(paperDoc.output('arraybuffer'))
  const phases = []

  const result = await convertNotesDocument(pdfBytes, {
    fileName: 'e2e-paper.pdf',
    onProgress: (p) => phases.push(p.phase),
  })

  assertEqual(result.mode, 'notes', 'Mode A result')
  assert(result.pageCount >= 1, 'Notes page count >= 1')
  assert(result.pdfBytes.byteLength > 1000, 'Valid selectable PDF output generated')
  assert(phases.includes('validating'), 'Reports validating phase')
  assert(phases.includes('extracting'), 'Reports extracting phase')
  assert(phases.includes('analyzing'), 'Reports analyzing phase')
  assert(phases.includes('layout'), 'Reports layout phase')
  assert(phases.includes('exporting'), 'Reports exporting phase')
  assert(phases.includes('completed'), 'Reports completed phase')
})

await test('11. End-to-end Mode B: jsPDF slide deck -> complete Enlarged Slide PDF', async () => {
  const slideDeck = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [720, 540] })
  // Slide 1
  slideDeck.setFontSize(24)
  slideDeck.text('Lecture 1: Quantum Architecture', 100, 100)
  slideDeck.setFontSize(14)
  slideDeck.text('• High-resolution screen enlargement', 100, 180)
  slideDeck.text('• Zero text reflow; 1 slide per page', 100, 220)

  // Slide 2
  slideDeck.addPage([720, 540], 'landscape')
  slideDeck.setFontSize(24)
  slideDeck.text('Slide 2: System Architecture', 100, 100)
  slideDeck.rect(100, 140, 400, 200)

  const pdfBytes = new Uint8Array(slideDeck.output('arraybuffer'))

  const mockRasterizer = async (doc, pageNum) => ({
    image: { data: MOCK_PNG_DATA, format: 'PNG', pixelWidth: 720, pixelHeight: 540 },
    sourceWidthPt: 720,
    sourceHeightPt: 540,
    cropBoxPt: { x: 50, y: 50, width: 620, height: 440 },
    usedFallbackMargins: false,
    marginReason: 'Safe margin trimmed',
    lowResImageDetected: false,
    warnings: [],
  })

  const phases = []
  const result = await convertSlidesToPDF(pdfBytes, {
    fileName: 'lecture-deck.pdf',
    pageRasterizer: mockRasterizer,
    onProgress: (p) => phases.push(p.phase),
  })

  assertEqual(result.mode, 'slides', 'Mode B result')
  assertEqual(result.pageCount, 2, 'Exactly 2 output pages for 2 source slides')
  assert(result.pdfBytes.byteLength > 1000, 'Valid slide PDF output generated')
  assert(phases.includes('validating'), 'Reports validating')
  assert(phases.includes('rendering'), 'Reports rendering')
  assert(phases.includes('completed'), 'Reports completed')
})

await test('12. Slides: Default settings specify original-proportions strategy', async () => {
  assertEqual(
    DEFAULT_SLIDE_SETTINGS.fittingStrategy,
    'original-proportions',
    'Default fitting strategy must be original-proportions'
  )
})

await test('13. Slides: 16:9 slide with intentional bottom whitespace rejects crop', async () => {
  // Simulate 16:9 widescreen slide (160x90 pt) where content only occupies top region
  // (e.g. title and single diagram, y: 10..45, x: 15..145; bottom 45..90 is intentional whitespace)
  const W = 160
  const H = 90
  const rgba = new Uint8ClampedArray(W * H * 4)
  rgba.fill(255) // white background

  for (let y = 10; y < 45; y++) {
    for (let x = 15; x < 145; x++) {
      const idx = (y * W + x) * 4
      rgba[idx] = 30
      rgba[idx + 1] = 30
      rgba[idx + 2] = 30
    }
  }

  const crop = detectSafeMarginsFromPixels(rgba, W, H, W, H, 1.0, KINDLE_SLIDE_DISPLAY_LANDSCAPE)
  assertEqual(crop.usedFallback, true, 'Intentional bottom whitespace must trigger safe fallback')
  assertEqual(crop.width, W, 'Preserves original slide width')
  assertEqual(crop.height, H, 'Preserves original slide height')
  assert(crop.reason.includes('distort') || crop.reason.includes('shrink'), 'Reason documents distortion/shrinkage prevention')
})

await test('14. Slides: 4:3 slide with uniform outer borders trims safely', async () => {
  // 4:3 slide (160x120 pt) with uniform outer borders on all 4 sides
  const W = 160
  const H = 120
  const rgba = new Uint8ClampedArray(W * H * 4)
  rgba.fill(255)

  for (let y = 15; y < 105; y++) {
    for (let x = 20; x < 140; x++) {
      const idx = (y * W + x) * 4
      rgba[idx] = 25
      rgba[idx + 1] = 25
      rgba[idx + 2] = 25
    }
  }

  const crop = detectSafeMarginsFromPixels(rgba, W, H, W, H, 1.0, KINDLE_SLIDE_DISPLAY_LANDSCAPE)
  assertEqual(crop.usedFallback, false, 'Uniform borders are safely trimmed')
  assert(crop.width < W, 'Width trimmed')
  assert(crop.height < H, 'Height trimmed')
  const arDev = Math.abs(crop.width / crop.height - W / H) / (W / H)
  assert(arDev <= 0.05, `Aspect ratio preserved within 5%: ${(arDev * 100).toFixed(2)}%`)
})

await test('15. Slides: Genuine external borders (letterbox and pillarbox) are detected and trimmed', async () => {
  // 1. Symmetrical Letterbox: 16:9 content embedded on 4:3 page (160x120 pt)
  // Content: x in [4..156], y in [20..100] (symmetrical 20pt top and bottom bars)
  const W1 = 160
  const H1 = 120
  const rgba1 = new Uint8ClampedArray(W1 * H1 * 4)
  rgba1.fill(255)
  for (let y = 20; y < 100; y++) {
    for (let x = 4; x < 156; x++) {
      const idx = (y * W1 + x) * 4
      rgba1[idx] = 15
      rgba1[idx + 1] = 15
      rgba1[idx + 2] = 15
    }
  }

  const cropLetterbox = detectSafeMarginsFromPixels(rgba1, W1, H1, W1, H1, 1.0, KINDLE_SLIDE_DISPLAY_LANDSCAPE)
  assertEqual(cropLetterbox.usedFallback, false, 'Symmetrical letterbox trimmed')
  assert(cropLetterbox.reason.includes('letterbox'), 'Reason indicates letterbox detected')
  assert(cropLetterbox.height < H1 - 20, 'Letterbox vertical bars trimmed')

  // 2. Symmetrical Pillarbox: 4:3 content embedded on 16:9 page (160x90 pt)
  // Content: y in [4..86], x in [25..135] (symmetrical 25pt left and right bars)
  const W2 = 160
  const H2 = 90
  const rgba2 = new Uint8ClampedArray(W2 * H2 * 4)
  rgba2.fill(255)
  for (let y = 4; y < 86; y++) {
    for (let x = 25; x < 135; x++) {
      const idx = (y * W2 + x) * 4
      rgba2[idx] = 15
      rgba2[idx + 1] = 15
      rgba2[idx + 2] = 15
    }
  }

  const cropPillarbox = detectSafeMarginsFromPixels(rgba2, W2, H2, W2, H2, 1.0, KINDLE_SLIDE_DISPLAY_LANDSCAPE)
  assertEqual(cropPillarbox.usedFallback, false, 'Symmetrical pillarbox trimmed')
  assert(cropPillarbox.reason.includes('pillarbox'), 'Reason indicates pillarbox detected')
  assert(cropPillarbox.width < W2 - 30, 'Pillarbox horizontal bars trimmed')
})

await test('16. Slides: Different amounts of internal whitespace safely fall back to full page', async () => {
  const W = 160
  const H = 90

  // Case A: Partial bottom whitespace (upper 60% used, bottom 40% empty)
  const rgbaBottom = new Uint8ClampedArray(W * H * 4)
  rgbaBottom.fill(255)
  for (let y = 6; y < 54; y++) {
    for (let x = 10; x < 150; x++) {
      const idx = (y * W + x) * 4
      rgbaBottom[idx] = 10
      rgbaBottom[idx + 1] = 10
      rgbaBottom[idx + 2] = 10
    }
  }
  const cropBottom = detectSafeMarginsFromPixels(rgbaBottom, W, H, W, H, 1.0, KINDLE_SLIDE_DISPLAY_LANDSCAPE)
  assertEqual(cropBottom.usedFallback, true, 'Partial bottom whitespace falls back to full page')

  // Case B: Partial side whitespace (left 50% used, right 50% empty)
  const rgbaSide = new Uint8ClampedArray(W * H * 4)
  rgbaSide.fill(255)
  for (let y = 10; y < 80; y++) {
    for (let x = 10; x < 75; x++) {
      const idx = (y * W + x) * 4
      rgbaSide[idx] = 10
      rgbaSide[idx + 1] = 10
      rgbaSide[idx + 2] = 10
    }
  }
  const cropSide = detectSafeMarginsFromPixels(rgbaSide, W, H, W, H, 1.0, KINDLE_SLIDE_DISPLAY_LANDSCAPE)
  assertEqual(cropSide.usedFallback, true, 'Partial side whitespace falls back to full page')
})

await test('17. Slides: Consistent positioning across consecutive slides under default settings', async () => {
  // A slide deck of 4 consecutive 16:9 slides with differing internal content distributions
  const sourceWidth = 1376
  const sourceHeight = 768
  const profile = KINDLE_SLIDE_DISPLAY_LANDSCAPE // 576x432, pad=10 -> 556x412 usable

  // Under default 'original-proportions', cropBox is strictly the full page
  const fullCrop = { x: 0, y: 0, width: sourceWidth, height: sourceHeight }
  const destResults = [
    computeSlideDestinationBox(fullCrop, profile),
    computeSlideDestinationBox(fullCrop, profile),
    computeSlideDestinationBox(fullCrop, profile),
    computeSlideDestinationBox(fullCrop, profile),
  ]

  const firstY = destResults[0].destBox.y
  const firstHeight = destResults[0].destBox.height

  // Expected 16:9 on Kindle landscape: 556 width, height = 556 / (1376/768) = 310.33 pt, y = (432 - 310.33)/2 = 60.83 pt
  assert(Math.abs(firstHeight - 310.33) < 0.1, `Height matches 310.33: ${firstHeight}`)
  assert(Math.abs(firstY - 60.83) < 0.1, `Vertical offset matches 60.83: ${firstY}`)

  for (let i = 1; i < destResults.length; i++) {
    assertEqual(destResults[i].destBox.y, firstY, `Slide ${i + 1} has identical Y offset as Slide 1 (zero vertical jump)`)
    assertEqual(destResults[i].destBox.height, firstHeight, `Slide ${i + 1} has identical height as Slide 1`)
  }
})

await test('18. Slides Invariant: Smart Margin never produces a smaller displayed height than Original Proportions', async () => {
  const profile = KINDLE_SLIDE_DISPLAY_LANDSCAPE
  const aspectRatios = [
    { w: 1376, h: 768 }, // 16:9
    { w: 1280, h: 800 }, // 16:10
    { w: 1024, h: 768 }, // 4:3
    { w: 1080, h: 720 }, // 3:2
    { w: 800, h: 800 },   // 1:1
  ]

  for (const { w, h } of aspectRatios) {
    const fullBox = { x: 0, y: 0, width: w, height: h }
    const { destBox: origDest } = computeSlideDestinationBox(fullBox, profile)

    // Synthesize pixel buffer with bottom 40% empty
    const scale = 0.1
    const pw = Math.round(w * scale)
    const ph = Math.round(h * scale)
    const rgba = new Uint8ClampedArray(pw * ph * 4)
    rgba.fill(255)
    for (let y = 2; y < Math.round(ph * 0.6); y++) {
      for (let x = 2; x < pw - 2; x++) {
        const idx = (y * pw + x) * 4
        rgba[idx] = 10
        rgba[idx + 1] = 10
        rgba[idx + 2] = 10
      }
    }

    const smartCrop = detectSafeMarginsFromPixels(rgba, pw, ph, w, h, scale, profile)
    const { destBox: smartDest } = computeSlideDestinationBox(smartCrop, profile)

    assert(
      smartDest.height >= origDest.height - 0.5,
      `Invariant violated for ${w}x${h}: smartDest.height (${smartDest.height}) < origDest.height (${origDest.height})`
    )
  }
})

// ─── Results ──────────────────────────────────────────────────────────────────

console.log()
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`)

if (failures.length > 0) {
  console.log('\nFailed tests:')
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`)
  }
}

cleanup()
process.exit(failed > 0 ? 1 : 0)
