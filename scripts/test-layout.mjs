/**
 * KindleFlow — Hybrid Reflow & Kindle Layout Tests (Prompt 4)
 *
 * Verifies:
 *  1. Short paragraph fits on one page
 *  2. Long paragraph wraps correctly within target width
 *  3. Paragraph continues onto another page when space runs out
 *  4. Multiple paragraphs retain their exact reading order
 *  5. Headings receive distinct larger/bold formatting
 *  6. Headings are not stranded alone at the bottom of a page
 *  7. Lists retain their structure, markers, and indentation
 *  8. Two-column source text becomes single-column destination layout in reading order
 *  9. Spatial equations remain coherent preserved regions (while simple linear equations can stay text)
 * 10. Tables remain coherent preserved regions and are not arbitrarily split
 * 11. Figures remain associated with their captions on the same page
 * 12. Oversized regions produce dedicated pages and/or legibility warnings without unreadable shrinking
 * 13. No destination elements overlap unintentionally
 * 14. No elements exceed page or contentArea boundaries
 * 15. Different page dimensions and margins produce valid layouts
 * 16. Layout validator catches deliberate errors (overlaps, out-of-bounds, negative dims, empty text, missing source refs)
 * 17. End-to-end: jsPDF fixture -> extractDocument -> analyzeDocument -> layoutDocument -> validation
 *
 * Run: node scripts/test-layout.mjs
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
  const rewritten = transpiled.replace(
    /from\s+['"]\.\/([^'"]+)['"]/g,
    (_, p) => {
      if (p.endsWith('.tmp.mjs')) return `from './${p}'`
      if (p.endsWith('.ts')) return `from './${p.replace(/\.ts$/, '.tmp.mjs')}'`
      return `from './${p}.tmp.mjs'`
    },
  )
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

console.log('\nKindleFlow — Hybrid Reflow & Kindle Layout Tests (Prompt 4)\n')
console.log('Loading modules...')

const typesRes      = await importTS('lib/converter/types.ts')
const workerRes     = await importTS('lib/converter/worker-loader.ts')
const validatorRes  = await importTS('lib/converter/validator.ts')
const extractorRes  = await importTS('lib/converter/extractor.ts')
const lineRes       = await importTS('lib/converter/line-reconstructor.ts')
const structRes     = await importTS('lib/converter/structure-analyzer.ts')
const orderRes      = await importTS('lib/converter/reading-order.ts')
const paraRes       = await importTS('lib/converter/paragraph-reconstructor.ts')
const classRes      = await importTS('lib/converter/classifier.ts')
const reflowRes     = await importTS('lib/converter/text-reflower.ts')
const preserverRes  = await importTS('lib/converter/region-preserver.ts')
const layoutValRes  = await importTS('lib/converter/layout-validator.ts')
const layoutEngRes  = await importTS('lib/converter/layout-engine.ts')
const pdfGenRes     = await importTS('lib/converter/pdf-generator.ts')
const slideRes      = await importTS('lib/converter/slide-converter.ts')
const indexRes      = await importTS('lib/converter/index.ts')

const allRefs = [
  typesRes, workerRes, validatorRes, extractorRes,
  lineRes, structRes, orderRes, paraRes, classRes,
  reflowRes, preserverRes, layoutValRes, layoutEngRes,
  pdfGenRes, slideRes, indexRes,
]

function cleanup() {
  for (const r of allRefs) {
    try { fs.unlinkSync(r.tempPath) } catch { /* ignore */ }
  }
}

const {
  extractDocument,
  analyzeDocument,
  layoutDocument,
  validateLayoutPages,
  DEFAULT_LAYOUT_SETTINGS,
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

// ─── Synthetic AnalyzedDocument Fixture Helpers ───────────────────────────────

let _blockSeq = 0
function makeDocBlock(pageNumber, type, text, box, opts = {}) {
  _blockSeq++
  const fontSize = opts.fontSize ?? (type === 'heading' ? 18 : type === 'subheading' ? 14 : 11)
  return {
    id: opts.id ?? `doc_p${pageNumber}_b${_blockSeq}`,
    pageNumber,
    type,
    box,
    text,
    lines: opts.lines ?? [
      {
        items: [],
        text,
        box,
        baselineY: box.y,
        dominantFont: {
          name: 'Helvetica',
          family: opts.isMonospace ? 'mono' : 'sans-serif',
          size: fontSize,
          isBold: type === 'heading' || type === 'subheading',
          isItalic: false,
          isMonospace: opts.isMonospace ?? false,
        },
        endsWithSoftHyphen: false,
        readingOrder: opts.readingOrder ?? _blockSeq,
        columnIndex: opts.columnIndex ?? 0,
      },
    ],
    textItemIds: [],
    associatedPaths: opts.associatedPaths ?? [],
    associatedImages: opts.associatedImages ?? [],
    readingOrder: opts.readingOrder ?? _blockSeq,
    confidence: opts.confidence ?? 'high',
    preserveAsImage: opts.preserveAsImage ?? false,
    warnings: [],
  }
}

function makeAnalyzedDoc(pagesBlocks, fileName = 'fixture.pdf') {
  const pages = pagesBlocks.map((blocks, idx) => ({
    pageNumber: idx + 1,
    metadata: {
      pageNumber: idx + 1,
      width: 612,
      height: 792,
      rotation: 0,
      textItemCount: blocks.length,
      characterCount: blocks.reduce((s, b) => s + b.text.length, 0),
      textDensity: 0.3,
      classification: 'text-rich',
      hasExtractableText: true,
    },
    columnLayout: {
      columnCount: 1,
      columns: [{ left: 54, right: 558 }],
      confidence: 'high',
      evidence: 'synthetic fixture',
    },
    blocks: blocks.map((b, ord) => ({ ...b, readingOrder: b.readingOrder ?? ord })),
    warnings: [],
    isFallback: false,
  }))

  return {
    fileName,
    pageCount: pages.length,
    pages,
    bodyFontSize: 11,
    warnings: [],
    analyzedAt: new Date().toISOString(),
  }
}

function verifyLayoutInvariants(layout) {
  assert(layout.validation.isValid, `Validation errors: ${layout.validation.errors.map(e => e.message).join('; ')}`)
  for (const page of layout.pages) {
    assert(page.elements.length > 0, `Page ${page.pageNumber} should not be empty`)
    // Verify monotonic vertical order (top-to-bottom single column)
    for (let i = 1; i < page.elements.length; i++) {
      const prev = page.elements[i - 1]
      const cur = page.elements[i]
      assert(
        cur.box.y >= prev.box.y + prev.box.height - 0.01,
        `Page ${page.pageNumber}: element ${cur.id} (y=${cur.box.y}) overlaps/precedes ${prev.id} (bottom=${prev.box.y + prev.box.height})`,
      )
    }
    // Verify strictly inside contentArea
    for (const el of page.elements) {
      assert(el.box.x >= page.contentArea.x - 0.5, `${el.id} x=${el.box.x} < margin left ${page.contentArea.x}`)
      assert(el.box.y >= page.contentArea.y - 0.5, `${el.id} y=${el.box.y} < margin top ${page.contentArea.y}`)
      assert(
        el.box.x + el.box.width <= page.contentArea.x + page.contentArea.width + 0.5,
        `${el.id} right=${el.box.x + el.box.width} > content right ${page.contentArea.x + page.contentArea.width}`,
      )
      assert(
        el.box.y + el.box.height <= page.contentArea.y + page.contentArea.height + 0.5,
        `${el.id} bottom=${el.box.y + el.box.height} > content bottom ${page.contentArea.y + page.contentArea.height}`,
      )
    }
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

await test('1. Short paragraph fits on one page with expected dimensions', async () => {
  const analyzed = makeAnalyzedDoc([
    [
      makeDocBlock(
        1,
        'paragraph',
        'KindleFlow converts academic documents into clean single-column pages for small e-readers.',
        { x: 72, y: 100, width: 468, height: 28 },
      ),
    ],
  ])
  const layout = await layoutDocument(analyzed)
  assertEqual(layout.pageCount, 1, 'pageCount')
  assert(layout.pages[0].elements.length >= 1, 'at least 1 line element')
  assertEqual(layout.pages[0].width, DEFAULT_LAYOUT_SETTINGS.pageWidth, 'default page width 432')
  assertEqual(layout.pages[0].height, DEFAULT_LAYOUT_SETTINGS.pageHeight, 'default page height 576')
  verifyLayoutInvariants(layout)
})

await test('2. Long paragraph wraps cleanly onto multiple lines within content width', async () => {
  const longSentence = Array.from({ length: 40 }, (_, i) => `academicword${i}`).join(' ')
  const analyzed = makeAnalyzedDoc([
    [makeDocBlock(1, 'paragraph', longSentence, { x: 72, y: 100, width: 468, height: 100 })],
  ])
  const layout = await layoutDocument(analyzed)
  assertEqual(layout.pageCount, 1, 'long paragraph fits on 1 page')
  assert(layout.pages[0].elements.length >= 6, `expected wrapped lines >= 6, got ${layout.pages[0].elements.length}`)
  for (const el of layout.pages[0].elements) {
    assert(el.box.width <= layout.pages[0].contentArea.width + 0.5, 'line width fits content area')
  }
  verifyLayoutInvariants(layout)
})

await test('3. Very long paragraph continues cleanly onto a second page', async () => {
  const hugeParagraph = Array.from({ length: 420 }, (_, i) => `word${i}`).join(' ')
  const analyzed = makeAnalyzedDoc([
    [makeDocBlock(1, 'paragraph', hugeParagraph, { x: 72, y: 100, width: 468, height: 600 })],
  ])
  const layout = await layoutDocument(analyzed)
  assert(layout.pageCount >= 2, `expected continuation across >= 2 pages, got ${layout.pageCount}`)
  const reassembled = layout.pages.flatMap(p => p.elements).map(e => e.text).join(' ')
  assert(reassembled.includes('word0') && reassembled.includes('word419'), 'all words preserved across pages')
  verifyLayoutInvariants(layout)
})

await test('4. Multiple paragraphs retain original reading order', async () => {
  const analyzed = makeAnalyzedDoc([
    [
      makeDocBlock(1, 'paragraph', 'Alpha paragraph comes first in reading order.', { x: 72, y: 100, width: 400, height: 20 }, { readingOrder: 0 }),
      makeDocBlock(1, 'paragraph', 'Beta paragraph comes second in reading order.', { x: 72, y: 140, width: 400, height: 20 }, { readingOrder: 1 }),
      makeDocBlock(1, 'paragraph', 'Gamma paragraph comes third in reading order.', { x: 72, y: 180, width: 400, height: 20 }, { readingOrder: 2 }),
    ],
  ])
  const layout = await layoutDocument(analyzed)
  const combined = layout.pages.flatMap(p => p.elements).map(e => e.text).join(' ')
  const idxA = combined.indexOf('Alpha')
  const idxB = combined.indexOf('Beta')
  const idxG = combined.indexOf('Gamma')
  assert(idxA >= 0 && idxA < idxB && idxB < idxG, `Order broken: A=${idxA}, B=${idxB}, G=${idxG}`)
  verifyLayoutInvariants(layout)
})

await test('5. Headings receive distinct larger bold font and subheading scaling', async () => {
  const analyzed = makeAnalyzedDoc([
    [
      makeDocBlock(1, 'heading', 'Section 1: Overview', { x: 72, y: 80, width: 300, height: 24 }),
      makeDocBlock(1, 'subheading', '1.1 Background', { x: 72, y: 120, width: 250, height: 18 }),
      makeDocBlock(1, 'paragraph', 'Regular body prose follows the headings.', { x: 72, y: 150, width: 400, height: 20 }),
    ],
  ])
  const layout = await layoutDocument(analyzed)
  const els = layout.pages[0].elements
  const h = els.find(e => e.role === 'heading')
  const sh = els.find(e => e.role === 'subheading')
  const p = els.find(e => e.role === 'paragraph')
  assert(h && sh && p, 'Expected heading, subheading, and paragraph elements')
  assertEqual(h.font.weight, 'bold', 'heading weight')
  assert(h.font.size > sh.font.size && sh.font.size > p.font.size, `Font hierarchy: ${h.font.size} > ${sh.font.size} > ${p.font.size}`)
  verifyLayoutInvariants(layout)
})

await test('6. Heading is NOT stranded alone at the bottom of a page', async () => {
  // Fill ~94% of page 1 contentArea so a heading fits vertically at bottom,
  // but heading + first 2 lines of the following paragraph do NOT fit.
  const lineFiller = Array.from({ length: 18 }, (_, i) => `Filler line sentence number ${i + 1} taking space carefully on page one.`).join(' ')
  const blocks = []
  for (let i = 0; i < 6; i++) {
    blocks.push(makeDocBlock(1, 'paragraph', lineFiller.slice(0, 210), { x: 72, y: 80 + i * 70, width: 450, height: 50 }, { readingOrder: i }))
  }
  blocks.push(makeDocBlock(1, 'heading', '2. Important Next Section', { x: 72, y: 520, width: 320, height: 24 }, { readingOrder: 6 }))
  blocks.push(makeDocBlock(1, 'paragraph', 'First sentence under the heading must stay on the same page as the heading itself to prevent an orphan heading.', { x: 72, y: 555, width: 450, height: 40 }, { readingOrder: 7 }))

  // Tune paragraph spacing/body font slightly or loop filler until heading lands near bottom threshold
  const layout = await layoutDocument(makeAnalyzedDoc([blocks]), {
    settings: { pageWidth: 432, pageHeight: 576 },
  })

  // Find which page the heading landed on
  const headingEl = layout.pages.flatMap(p => p.elements).find(e => e.role === 'heading')
  assert(headingEl !== undefined, 'Heading must exist')
  const headingPage = layout.pages.find(p => p.pageNumber === headingEl.pageNumber)
  const headingIdx = headingPage.elements.findIndex(e => e.id === headingEl.id)
  assert(
    headingIdx < headingPage.elements.length - 1,
    `Heading stranded as last element on page ${headingPage.pageNumber}! Total elements on page: ${headingPage.elements.length}`,
  )
  const nextEl = headingPage.elements[headingIdx + 1]
  assert(nextEl.role === 'paragraph', 'Following paragraph must start on the same page as the heading')
  verifyLayoutInvariants(layout)
})

await test('7. Lists retain structure, bullet/numbered markers, and indentation', async () => {
  const analyzed = makeAnalyzedDoc([
    [
      makeDocBlock(1, 'list', '1. First long list item that wraps across multiple lines inside the Kindle layout column cleanly.', { x: 72, y: 100, width: 450, height: 30 }, { readingOrder: 0 }),
      makeDocBlock(1, 'list', '• Second bullet item with marker.', { x: 72, y: 145, width: 400, height: 18 }, { readingOrder: 1 }),
    ],
  ])
  const layout = await layoutDocument(analyzed)
  const listEls = layout.pages[0].elements.filter(e => e.role === 'list-item')
  assert(listEls.length >= 2, 'Should produce list-item elements')
  assert(listEls[0].indent === DEFAULT_LAYOUT_SETTINGS.listIndent, `First list line indent ${listEls[0].indent}`)
  assert(listEls[0].box.x > layout.pages[0].contentArea.x, 'List items indented from left content edge')
  assert(listEls[0].text.startsWith('1.'), 'Numbered marker preserved')
  assert(listEls.some(e => e.text.startsWith('•')), 'Bullet marker preserved')
  verifyLayoutInvariants(layout)
})

await test('8. Two-column source text becomes single-column destination layout in reading order', async () => {
  // Simulate Prompt 3 output on a 2-column page: readingOrder 0,1 = left col; 2,3 = right col
  const twoColAnalyzed = {
    fileName: 'two-col.pdf',
    pageCount: 1,
    bodyFontSize: 11,
    warnings: [],
    analyzedAt: new Date().toISOString(),
    pages: [
      {
        pageNumber: 1,
        metadata: { pageNumber: 1, width: 612, height: 792, rotation: 0, textItemCount: 4, characterCount: 120, textDensity: 0.3, classification: 'text-rich', hasExtractableText: true },
        columnLayout: { columnCount: 2, columns: [{ left: 50, right: 290 }, { left: 320, right: 560 }], gutterWidth: 30, confidence: 'high', evidence: '2 cols' },
        blocks: [
          makeDocBlock(1, 'paragraph', 'LEFT_COL_TOP appears first.', { x: 50, y: 100, width: 220, height: 18 }, { readingOrder: 0, columnIndex: 0 }),
          makeDocBlock(1, 'paragraph', 'LEFT_COL_BOTTOM appears second.', { x: 50, y: 140, width: 220, height: 18 }, { readingOrder: 1, columnIndex: 0 }),
          makeDocBlock(1, 'paragraph', 'RIGHT_COL_TOP appears third.', { x: 320, y: 100, width: 220, height: 18 }, { readingOrder: 2, columnIndex: 1 }),
          makeDocBlock(1, 'paragraph', 'RIGHT_COL_BOTTOM appears fourth.', { x: 320, y: 140, width: 220, height: 18 }, { readingOrder: 3, columnIndex: 1 }),
        ],
        warnings: [],
        isFallback: false,
      },
    ],
  }

  const layout = await layoutDocument(twoColAnalyzed)
  const els = layout.pages[0].elements
  const allX = new Set(els.map(e => Math.round(e.box.x)))
  assertEqual(allX.size, 1, 'All paragraphs share single-column left X coordinate')
  const texts = els.map(e => e.text).join(' ')
  assert(
    texts.indexOf('LEFT_COL_TOP') < texts.indexOf('LEFT_COL_BOTTOM') &&
      texts.indexOf('LEFT_COL_BOTTOM') < texts.indexOf('RIGHT_COL_TOP') &&
      texts.indexOf('RIGHT_COL_TOP') < texts.indexOf('RIGHT_COL_BOTTOM'),
    'Two-column source linearized strictly into left-then-right reading order',
  )
  verifyLayoutInvariants(layout)
})

await test('9. Spatial equations remain coherent preserved regions while simple linear equations can stay text', async () => {
  const spatialEq = makeDocBlock(
    1,
    'equation',
    'E = ∑_{i=1}^n x_i / (a + b) (1)',
    { x: 180, y: 200, width: 250, height: 42 },
    {
      preserveAsImage: true,
      associatedPaths: [{ type: 'line', box: { x: 240, y: 220, width: 80, height: 1 }, segmentCount: 2 }],
    },
  )
  const simpleEq = makeDocBlock(
    1,
    'equation',
    'y = mx + b',
    { x: 220, y: 280, width: 100, height: 14 },
    { preserveAsImage: true, fontSize: 11.5 },
  )

  const layout = await layoutDocument(makeAnalyzedDoc([[spatialEq, simpleEq]]))
  const els = layout.pages[0].elements
  const preservedEq = els.find(e => e.kind === 'preserved-region' && e.regionType === 'equation')
  const textEq = els.find(e => e.kind === 'text' && e.role === 'equation-text')

  assert(preservedEq !== undefined, 'Spatial equation with fraction bar & sum must be preserved as coherent region')
  assertEqual(preservedEq.preservationReason, 'equation-spatial', 'preservation reason')
  assert(preservedEq.sourcePageNumber === 1 && preservedEq.sourceBox.width === 250, 'source geometry retained')
  assert(textEq !== undefined && textEq.align === 'center', 'Simple linear equation preserved cleanly as centered text')
  verifyLayoutInvariants(layout)
})

await test('10. Tables remain coherent preserved regions and are not split across pages', async () => {
  // Place text filling half the page, then a table that doesn't fit in remaining half.
  // Table must move intact to page 2 without splitting.
  const fillerBlocks = Array.from({ length: 6 }, (_, i) =>
    makeDocBlock(1, 'paragraph', 'Paragraph text preceding the empirical evaluation table to occupy vertical space cleanly.', { x: 72, y: 60 + i * 50, width: 450, height: 30 }, { readingOrder: i }),
  )
  const tallTable = makeDocBlock(
    1,
    'table',
    'Metric ModelA ModelB ModelC ...',
    { x: 60, y: 380, width: 480, height: 280 },
    {
      preserveAsImage: true,
      readingOrder: 6,
      associatedPaths: [
        { type: 'line', box: { x: 60, y: 380, width: 480, height: 1 }, segmentCount: 2 },
        { type: 'line', box: { x: 60, y: 420, width: 480, height: 1 }, segmentCount: 2 },
      ],
    },
  )

  const layout = await layoutDocument(makeAnalyzedDoc([[...fillerBlocks, tallTable]]))
  const tables = layout.pages.flatMap(p => p.elements).filter(e => e.kind === 'preserved-region' && e.regionType === 'table')
  assertEqual(tables.length, 1, 'Table must appear as 1 coherent region (never split)')
  assert(tables[0].scaleFactor <= 1 && tables[0].box.width <= layout.pages[0].contentArea.width + 0.5, 'Table scaled proportionally to fit width')
  const ratioDiff = Math.abs(tables[0].box.width / tables[0].box.height - 480 / 280)
  assert(ratioDiff < 0.01, `Table aspect ratio altered: diff=${ratioDiff}`)
  verifyLayoutInvariants(layout)
})

await test('11. Figures remain associated with their captions on the same destination page', async () => {
  // Occupy ~55% of page 1 so figure+caption combined don't fit on page 1 -> BOTH move together to page 2
  const filler = Array.from({ length: 8 }, (_, i) =>
    makeDocBlock(1, 'paragraph', 'Introductory text before the system architecture figure to push it near a page boundary.', { x: 72, y: 60 + i * 40, width: 450, height: 28 }, { readingOrder: i }),
  )
  const fig = makeDocBlock(
    1,
    'figure',
    '',
    { x: 72, y: 400, width: 360, height: 220 },
    { preserveAsImage: true, readingOrder: 8, associatedImages: [{ id: 'img1', box: { x: 72, y: 400, width: 360, height: 220 }, isInline: false }] },
  )
  const cap = makeDocBlock(
    1,
    'caption',
    'Figure 1: Hybrid reflow architecture showing text and complex regions.',
    { x: 72, y: 630, width: 360, height: 18 },
    { readingOrder: 9, fontSize: 9.5 },
  )

  const layout = await layoutDocument(makeAnalyzedDoc([[...filler, fig, cap]]))
  const allEls = layout.pages.flatMap(p => p.elements)
  const figEl = allEls.find(e => e.kind === 'preserved-region' && e.regionType === 'figure')
  const capEl = allEls.find(e => e.kind === 'text' && e.role === 'caption')

  assert(figEl && capEl, 'Both figure and caption must be placed')
  assertEqual(figEl.pageNumber, capEl.pageNumber, 'Figure and its caption must stay on the same page')
  assert(figEl.groupId !== undefined && figEl.groupId === capEl.groupId, 'Figure and caption share explicit groupId')
  assert(capEl.box.y >= figEl.box.y + figEl.box.height, 'Caption positioned cleanly below figure')
  verifyLayoutInvariants(layout)
})

await test('12. Oversized regions allocate dedicated pages and emit legibility warnings', async () => {
  // Huge 1200×400 wide table: scaling to 380pt width -> scaleFactor = 380/1200 ≈ 0.317 < minScaleRatio (0.45)
  const lead = makeDocBlock(1, 'paragraph', 'Preceding analysis summary before wide benchmark table.', { x: 72, y: 80, width: 400, height: 20 }, { readingOrder: 0 })
  const hugeTable = makeDocBlock(
    1,
    'table',
    'Very wide multi-column experimental matrix',
    { x: 20, y: 150, width: 1200, height: 400 },
    { preserveAsImage: true, readingOrder: 1 },
  )
  const tail = makeDocBlock(1, 'paragraph', 'Discussion following the wide benchmark table.', { x: 72, y: 600, width: 400, height: 20 }, { readingOrder: 2 })

  const layout = await layoutDocument(makeAnalyzedDoc([[lead, hugeTable, tail]]))
  const region = layout.pages.flatMap(p => p.elements).find(e => e.kind === 'preserved-region')
  assert(region !== undefined, 'Oversized table must not be discarded')
  assertEqual(region.isOversized, true, 'isOversized flagged')
  assertEqual(region.needsDedicatedPage, true, 'needsDedicatedPage flagged')
  assert(typeof region.legibilityWarning === 'string' && region.legibilityWarning.length > 0, 'legibilityWarning populated')

  const dedicatedPage = layout.pages.find(p => p.pageNumber === region.pageNumber)
  assertEqual(dedicatedPage.isDedicatedPage, true, 'Dedicated page flag set')
  assertEqual(dedicatedPage.elements.length, 1, 'Oversized region isolated cleanly on its dedicated page')
  assert(layout.warnings.some(w => w.code === 'REGION_BELOW_MIN_LEGIBLE_SCALE'), 'Warning emitted in layout.warnings')
  verifyLayoutInvariants(layout)
})

await test('13. No destination elements overlap across multi-element pages', async () => {
  const blocks = [
    makeDocBlock(1, 'heading', '1. Introduction', { x: 72, y: 60, width: 200, height: 22 }, { readingOrder: 0 }),
    makeDocBlock(1, 'paragraph', 'First paragraph text spanning multiple lines on Kindle.', { x: 72, y: 95, width: 450, height: 30 }, { readingOrder: 1 }),
    makeDocBlock(1, 'callout', 'Note: Pay close attention to complex boundary conditions in Notion exports.', { x: 72, y: 140, width: 450, height: 30 }, { readingOrder: 2 }),
    makeDocBlock(1, 'code-block', 'const x = 42;\nreturn x * 2;', { x: 72, y: 185, width: 300, height: 30 }, { readingOrder: 3, isMonospace: true }),
    makeDocBlock(1, 'equation', '∫_0^1 f(x) dx = F(1) - F(0)', { x: 160, y: 240, width: 240, height: 36 }, { readingOrder: 4, preserveAsImage: true }),
  ]
  const layout = await layoutDocument(makeAnalyzedDoc([blocks]))
  assert(layout.validation.isValid, 'Layout validation must pass with zero overlap errors')
  assert(!layout.validation.errors.some(e => e.code === 'OVERLAPPING_ELEMENTS'), 'Zero overlap errors')
  verifyLayoutInvariants(layout)
})

await test('14. No elements exceed page boundaries or margins', async () => {
  const unbreakableToken = 'https://example.com/' + 'verylongpathsegment'.repeat(8)
  const blocks = [
    makeDocBlock(1, 'paragraph', `Reference URL: ${unbreakableToken} end.`, { x: 72, y: 100, width: 450, height: 30 }),
  ]
  const layout = await layoutDocument(makeAnalyzedDoc([blocks]))
  assert(layout.validation.isValid, 'Unbreakable long token wrapped safely within margins')
  assert(!layout.validation.errors.some(e => e.code === 'ELEMENT_OUTSIDE_PAGE_BOUNDS' || e.code === 'ELEMENT_EXCEEDS_CONTENT_AREA'), 'Zero boundary errors')
  verifyLayoutInvariants(layout)
})

await test('15. Different page dimensions and custom margins produce valid layouts', async () => {
  const sampleText = Array.from({ length: 80 }, (_, i) => `token${i}`).join(' ')
  const analyzed = makeAnalyzedDoc([
    [makeDocBlock(1, 'paragraph', sampleText, { x: 72, y: 100, width: 450, height: 120 })],
  ])

  const narrowLayout = await layoutDocument(analyzed, {
    settings: {
      pageWidth: 320,
      pageHeight: 460,
      margins: { top: 20, right: 18, bottom: 24, left: 18 },
      bodyFontSize: 10.5,
    },
  })
  const wideLayout = await layoutDocument(analyzed, {
    settings: {
      pageWidth: 500,
      pageHeight: 700,
      margins: { top: 40, right: 40, bottom: 40, left: 40 },
      bodyFontSize: 13,
    },
  })

  assertEqual(narrowLayout.pages[0].width, 320, 'narrow page width')
  assertEqual(wideLayout.pages[0].width, 500, 'wide page width')
  assert(narrowLayout.pageCount > wideLayout.pageCount || narrowLayout.stats.reflowedTextElements > wideLayout.stats.reflowedTextElements, 'narrower page wraps into more lines/pages')
  verifyLayoutInvariants(narrowLayout)
  verifyLayoutInvariants(wideLayout)
})

await test('16. Layout validator explicitly reports errors and warnings without hiding them', async () => {
  const brokenPages = [
    {
      pageNumber: 1,
      width: 432,
      height: 576,
      contentArea: { x: 26, y: 28, width: 380, height: 516 },
      usedHeight: 600, // exceeds 516
      remainingHeight: 0,
      isDedicatedPage: false,
      sourcePages: [1],
      elements: [
        // Overlapping pair
        {
          id: 'bad_1', kind: 'text', pageNumber: 1,
          box: { x: 26, y: 30, width: 200, height: 20 },
          readingOrder: 0, sourceBlockId: 'b1', sourcePageNumber: 1,
          role: 'paragraph', text: 'Line one', font: { family: 'sans', size: 11, weight: 'normal', style: 'normal' },
          align: 'left', lineHeight: 16, indent: 0,
        },
        {
          id: 'bad_2', kind: 'text', pageNumber: 1,
          box: { x: 26, y: 40, width: 200, height: 20 }, // overlaps bad_1 by 10pt vertically
          readingOrder: 1, sourceBlockId: 'b2', sourcePageNumber: 1,
          role: 'paragraph', text: '   ', // empty text!
          font: { family: 'sans', size: 11, weight: 'normal', style: 'normal' },
          align: 'left', lineHeight: 16, indent: 0,
        },
        // Outside page bounds + missing sourceBox + tiny region
        {
          id: 'bad_3', kind: 'preserved-region', pageNumber: 1,
          box: { x: 425, y: 100, width: 20, height: 8 }, // extends beyond 432 and height < 12
          readingOrder: 2, sourceBlockId: '', sourcePageNumber: 0,
          sourceBox: { x: 0, y: 0, width: 0, height: 0 },
          regionType: 'figure', preservationReason: 'figure-image', confidence: 'low',
          scaleFactor: 1, needsScaling: false, needsDedicatedPage: false, isOversized: false,
        },
      ],
    },
    {
      pageNumber: 2,
      width: 432,
      height: 576,
      contentArea: { x: 26, y: 28, width: 380, height: 516 },
      usedHeight: 0,
      remainingHeight: 516,
      isDedicatedPage: false,
      sourcePages: [],
      elements: [], // empty page warning
    },
  ]

  const report = validateLayoutPages(brokenPages)
  assertEqual(report.isValid, false, 'broken layout must fail validation')
  const errorCodes = new Set(report.errors.map(e => e.code))
  const warnCodes = new Set(report.warnings.map(w => w.code))
  assert(errorCodes.has('PAGE_SPACE_EXCEEDED'), 'must detect PAGE_SPACE_EXCEEDED')
  assert(errorCodes.has('OVERLAPPING_ELEMENTS'), 'must detect OVERLAPPING_ELEMENTS')
  assert(errorCodes.has('EMPTY_TEXT_ELEMENT'), 'must detect EMPTY_TEXT_ELEMENT')
  assert(errorCodes.has('ELEMENT_OUTSIDE_PAGE_BOUNDS'), 'must detect ELEMENT_OUTSIDE_PAGE_BOUNDS')
  assert(errorCodes.has('MISSING_SOURCE_REFERENCE'), 'must detect MISSING_SOURCE_REFERENCE')
  assert(warnCodes.has('EMPTY_LAYOUT_PAGE'), 'must warn EMPTY_LAYOUT_PAGE')
  assert(warnCodes.has('SUSPICIOUSLY_SMALL_REGION'), 'must warn SUSPICIOUSLY_SMALL_REGION')
})

await test('17. End-to-end: jsPDF fixture -> extractDocument -> analyzeDocument -> layoutDocument', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  // Running header + heading + prose + list + two-column page
  doc.setFontSize(9)
  doc.text('KindleFlow Synthetic Paper', 72, 28)

  doc.setFontSize(20)
  doc.text('1. Hybrid Academic Reflow', 72, 90)

  doc.setFontSize(11)
  doc.text(
    'Academic papers exported from Notion frequently combine multi-paragraph prose, numbered checklists, and structured display formulas.',
    72,
    130,
    { maxWidth: 468 },
  )
  doc.text('1. Preserve complex equations cleanly.', 72, 195)
  doc.text('2. Reflow ordinary text for 6-inch screens.', 72, 225)

  doc.addPage()
  doc.setFontSize(9)
  doc.text('KindleFlow Synthetic Paper', 72, 28)
  doc.setFontSize(11)
  for (let i = 0; i < 16; i++) {
    doc.text(`Left column entry ${i + 1}.`, 60, 110 + i * 24)
    doc.text(`Right column entry ${i + 1}.`, 330, 110 + i * 24)
  }

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const extracted = await extractDocument(pdfBytes, { fileName: 'e2e-layout-fixture.pdf' })
  const analyzed = await analyzeDocument(extracted)

  const layoutPhases = []
  const layout = await layoutDocument(analyzed, {
    onProgress: (p) => layoutPhases.push(p.phase),
  })

  assert(layoutPhases.includes('layout'), 'layout progress reported')
  assert(layout.pageCount >= 1, 'at least 1 layout page produced')
  assert(layout.stats.reflowedTextElements >= 5, 'reflowed text elements generated')

  const flatEls = layout.pages.flatMap(p => p.elements)
  assert(flatEls.some(e => e.role === 'heading'), 'heading preserved in layout')
  assert(flatEls.some(e => e.role === 'list-item'), 'list items preserved in layout')

  // Verify running header was suppressed by default
  const allText = flatEls.map(e => e.text ?? '').join(' ')
  assert(!allText.includes('KindleFlow Synthetic Paper'), 'running header suppressed by default')

  // Verify two-column source page linearized cleanly in reading order
  const idxL1 = allText.indexOf('Left column entry 1.')
  const idxL16 = allText.indexOf('Left column entry 16.')
  const idxR1 = allText.indexOf('Right column entry 1.')
  assert(idxL1 >= 0 && idxL1 < idxL16 && idxL16 < idxR1, `Expected left column before right column: L1=${idxL1}, L16=${idxL16}, R1=${idxR1}`)

  verifyLayoutInvariants(layout)
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
