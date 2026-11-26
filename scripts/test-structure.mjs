/**
 * KindleFlow — Structure Analysis Tests (Prompt 3)
 * 15 test scenarios for document structure analysis.
 *
 * Run: node scripts/test-structure.mjs
 */

import { jsPDF } from 'jspdf'
import * as fs from 'fs'
import * as path from 'path'
import ts from 'typescript'

// ─── TypeScript import helper (same pattern as test-extraction.mjs) ───────────

async function importTS(tsFilePath) {
  const code = fs.readFileSync(tsFilePath, 'utf8')
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const tempPath = tsFilePath.replace(/\.ts$/, '.tmp.mjs')
  const rewritten = transpiled.replace(/from\s+['"]\.\//g, "from './").replace(
    /from\s+'\.\/([^'"]+)'/g,
    (_, p) => {
      if (p.endsWith('.tmp.mjs')) return `from './${p}'`
      if (p.endsWith('.ts')) return `from './${p.replace(/\.ts$/, '.tmp.mjs')}'`
      return `from './${p}.tmp.mjs'`
    }
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

// ─── Load modules ─────────────────────────────────────────────────────────────

console.log('\nKindleFlow — Structure Analysis Tests (Prompt 3)\n')
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
  typesRes, workerRes, validatorRes, extractorRes, lineRes, structRes, orderRes,
  paraRes, classRes, reflowRes, preserverRes, layoutValRes, layoutEngRes,
  pdfGenRes, slideRes, indexRes,
]

function cleanup() {
  for (const r of allRefs) {
    try { fs.unlinkSync(r.tempPath) } catch { /* ignore */ }
  }
}

const { reconstructLines }         = lineRes.mod
const { detectColumnLayout, analyzePageStructure, detectRunningElements } = structRes.mod
const { determineReadingOrder }    = orderRes.mod
const { reconstructParagraphs, estimateBodyFontSize } = paraRes.mod
const { classifyBlocks }           = classRes.mod
const { extractDocument, analyzeDocument } = indexRes.mod

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failed++
    failures.push({ name, error: err.message })
  }
}

async function testAsync(name, fn) {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _idCounter = 0
function makeItem(str, x, y, w, h, fontSize = 12, opts = {}) {
  _idCounter++
  return {
    id: `item_${_idCounter}`,
    pageNumber: opts.pageNumber ?? 1,
    str,
    dir: 'ltr',
    box: { x, y, width: w, height: h },
    font: {
      name: opts.fontName ?? 'Helvetica',
      family: opts.fontFamily ?? 'sans-serif',
      size: fontSize,
      isBold: opts.isBold ?? false,
      isItalic: opts.isItalic ?? false,
      isSerif: opts.isSerif ?? false,
      isMonospace: opts.isMonospace ?? false,
    },
    transform: [1, 0, 0, 1, x, y],
    hasEOL: false,
    baselineY: y,
  }
}

function makeLine(text, x, y, w, h, fontSize = 12, opts = {}) {
  return {
    items: [makeItem(text, x, y, w, h, fontSize, opts)],
    text,
    box: { x, y, width: w, height: h },
    baselineY: y,
    dominantFont: {
      name: opts.fontName ?? 'Helvetica',
      family: 'sans-serif',
      size: fontSize,
      isBold: opts.isBold ?? false,
      isItalic: opts.isItalic ?? false,
      isSerif: false,
      isMonospace: opts.isMonospace ?? false,
    },
    endsWithSoftHyphen: opts.softHyphen ?? false,
    readingOrder: opts.readingOrder ?? 0,
    columnIndex: opts.columnIndex ?? 0,
  }
}

function makeVectorLine(x, y, width, height = 1) {
  return { type: 'line', box: { x, y, width, height }, lineWidth: 1, segmentCount: 2 }
}

function makeVectorRect(x, y, w, h) {
  return { type: 'rect', box: { x, y, width: w, height: h }, lineWidth: 1, segmentCount: 4 }
}

function makeImage(id, x, y, w, h) {
  return { id, box: { x, y, width: w, height: h }, isInline: false }
}

function makeTextBlock(id, text, linesArr, blockType = 'paragraph', fontSize = 12, opts = {}) {
  const box = linesArr.reduce((b, l) => {
    if (!b) return { ...l.box }
    return {
      x: Math.min(b.x, l.box.x),
      y: Math.min(b.y, l.box.y),
      width: Math.max(b.x + b.width, l.box.x + l.box.width) - Math.min(b.x, l.box.x),
      height: Math.max(b.y + b.height, l.box.y + l.box.height) - Math.min(b.y, l.box.y),
    }
  }, null)
  return {
    id,
    text,
    lines: linesArr,
    box,
    dominantFont: linesArr[0].dominantFont,
    avgLineHeight: linesArr.reduce((s, l) => s + l.box.height, 0) / linesArr.length,
    spacingBefore: 0,
    blockType,
    readingOrder: opts.readingOrder ?? 0,
    columnIndex: opts.columnIndex ?? 0,
    confidence: 'medium',
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// ── 1: Single-column reading order ───────────────────────────────────────────
test('1. Single-column: reading order is strictly top-to-bottom', () => {
  const items = [
    makeItem('Third line', 72, 200, 150, 14),
    makeItem('First line', 72, 100, 150, 14),
    makeItem('Second line', 72, 150, 150, 14),
  ]
  const layout = { columnCount: 1, columns: [{ left: 0, right: 612 }], confidence: 'high', evidence: 'test' }
  const lines = reconstructLines(items)
  const ordered = determineReadingOrder(lines, layout)
  assertEqual(ordered[0].text, 'First line', 'first line')
  assertEqual(ordered[1].text, 'Second line', 'second line')
  assertEqual(ordered[2].text, 'Third line', 'third line')
  for (let i = 0; i < ordered.length; i++) {
    assertEqual(ordered[i].readingOrder, i, `readingOrder[${i}]`)
  }
})

// ── 2: Two-column layout ──────────────────────────────────────────────────────
test('2. Two-column: left column fully before right column', () => {
  const cols = [{ left: 50, right: 290 }, { left: 310, right: 540 }]
  const layout = { columnCount: 2, columns: cols, confidence: 'high', evidence: 'test' }
  const leftItems = [
    makeItem('L-line-1', 72, 100, 180, 14),
    makeItem('L-line-2', 72, 120, 180, 14),
    makeItem('L-line-3', 72, 140, 180, 14),
  ]
  const rightItems = [
    makeItem('R-line-1', 320, 100, 180, 14),
    makeItem('R-line-2', 320, 120, 180, 14),
    makeItem('R-line-3', 320, 140, 180, 14),
  ]
  const lines = reconstructLines([...leftItems, ...rightItems], { columns: cols })
  const ordered = determineReadingOrder(lines, layout)
  const leftOrdered = ordered.filter(l => l.columnIndex === 0)
  const rightOrdered = ordered.filter(l => l.columnIndex === 1)
  const maxLeft = Math.max(...leftOrdered.map(l => l.readingOrder))
  const minRight = Math.min(...rightOrdered.map(l => l.readingOrder))
  assert(maxLeft < minRight, `Left max(${maxLeft}) must be before right min(${minRight})`)
  assertEqual(leftOrdered.length, 3, 'left col count')
  assertEqual(rightOrdered.length, 3, 'right col count')
})

// ── 3: Full-width heading above two columns ───────────────────────────────────
test('3. Full-width heading comes before two-column body content', () => {
  const cols = [{ left: 50, right: 290 }, { left: 310, right: 540 }]
  const layout = { columnCount: 2, columns: cols, confidence: 'high', evidence: 'test' }
  const items = [
    makeItem('Chapter Title', 50, 50, 490, 20, 18),
    makeItem('Left content', 72, 100, 200, 14),
    makeItem('Right content', 320, 100, 200, 14),
  ]
  const lines = reconstructLines(items, { columns: cols })
  const ordered = determineReadingOrder(lines, layout)
  assertEqual(ordered[0].text, 'Chapter Title', 'heading first')
  assert(ordered[0].readingOrder === 0, 'heading readingOrder = 0')
})

// ── 4: Different font sizes → heading detected ────────────────────────────────
test('4. Large font → heading, normal font → paragraph', () => {
  const lines = [
    makeLine('Big Heading', 72, 50, 300, 24, 20, { isBold: true, readingOrder: 0 }),
    makeLine('Body text line one', 72, 90, 400, 14, 12, { readingOrder: 1 }),
    makeLine('Body text line two', 72, 108, 400, 14, 12, { readingOrder: 2 }),
  ]
  const blocks = reconstructParagraphs(lines, { bodyFontSize: 12, pageNumber: 1, bodyLeft: 72 })
  const headingBlock = blocks.find(b => b.blockType === 'heading')
  const paraBlock = blocks.find(b => b.blockType === 'paragraph')
  assert(headingBlock !== undefined, 'Should detect a heading block')
  assert(paraBlock !== undefined, 'Should detect a paragraph block')
  assert(headingBlock.text.includes('Big Heading'), `Heading text: "${headingBlock.text}"`)
})

// ── 5: Multi-line paragraphs grouped ─────────────────────────────────────────
test('5. Multi-line paragraph: 5 close lines → one block', () => {
  const lines = Array.from({ length: 5 }, (_, i) =>
    makeLine(`Line number ${i + 1} of paragraph`, 72, 100 + i * 16, 400, 14, 12, { readingOrder: i })
  )
  const blocks = reconstructParagraphs(lines, { bodyFontSize: 12, pageNumber: 1, bodyLeft: 72 })
  assertEqual(blocks.length, 1, 'All lines in one block')
  assertEqual(blocks[0].lines.length, 5, 'Block has 5 lines')
  assertEqual(blocks[0].blockType, 'paragraph', 'Block type paragraph')
})

// ── 6: Soft hyphen joining ────────────────────────────────────────────────────
test('6. Soft hyphen: hyphenated line joined into one block', () => {
  const lines = [
    makeLine('This is a hyph-', 72, 100, 200, 14, 12, { softHyphen: true, readingOrder: 0 }),
    makeLine('enated word here', 72, 116, 200, 14, 12, { readingOrder: 1 }),
  ]
  const blocks = reconstructParagraphs(lines, { bodyFontSize: 12, pageNumber: 1, bodyLeft: 72 })
  assertEqual(blocks.length, 1, 'Lines in one block')
  assertEqual(blocks[0].text, 'This is a hyphenated word here', 'Hyphenated word joined cleanly')
})

// ── 7: Numbered and bulleted list items ───────────────────────────────────────
test('7. List items: numbered and bullet → list-item blockType', () => {
  const lines = [
    makeLine('1. First item', 72, 100, 200, 14, 12, { readingOrder: 0 }),
    makeLine('2. Second item', 72, 150, 200, 14, 12, { readingOrder: 1 }),
    makeLine('• Bullet point', 72, 200, 200, 14, 12, { readingOrder: 2 }),
  ]
  const blocks = reconstructParagraphs(lines, { bodyFontSize: 12, pageNumber: 1, bodyLeft: 72 })
  const listBlocks = blocks.filter(b => b.blockType === 'list-item')
  assert(listBlocks.length >= 2, `Expected ≥2 list-item blocks, got ${listBlocks.length}`)
})

// ── 8: Running header cross-page detection ────────────────────────────────────
test('8. Running header detected when consistent across 3 pages', () => {
  const makeExtrPage = (pageNum) => ({
    pageNumber: pageNum,
    metadata: { pageNumber: pageNum, width: 612, height: 792, rotation: 0, textItemCount: 20, characterCount: 200, textDensity: 0.3, classification: 'text-rich', hasExtractableText: true },
    textItems: [
      { id: `h_${pageNum}`, pageNumber: pageNum, str: 'Chapter 2: Methods', dir: 'ltr', box: { x: 72, y: 10, width: 300, height: 10 }, font: { name: 'H', family: 'sans', size: 9, isBold: false, isItalic: false }, transform: [1,0,0,1,72,10], hasEOL: false, baselineY: 10 },
      makeItem('Body text goes here lorem ipsum dolor sit amet.', 72, 100, 300, 14),
    ],
    paths: [],
    images: [],
    graphicsSummary: { pathOperationsCount: 0, lineCount: 0, rectCount: 0, imageCount: 0, hasVectorGraphics: false, hasImages: false, limitations: [] },
    warnings: [],
  })
  const extraction = {
    fileName: 'test.pdf', fileSize: 1000, pageCount: 3,
    validation: { isValid: true, fileSize: 1000, fileName: 'test.pdf', pageCount: 3, isEncrypted: false, isScannedOnly: false, errors: [], warnings: [], pageClassifications: [] },
    pages: [makeExtrPage(1), makeExtrPage(2), makeExtrPage(3)],
    totalTextItems: 60, totalCharacters: 600, warnings: [], extractedAt: new Date().toISOString(),
  }
  const result = detectRunningElements(extraction)
  assert(result.runningHeader !== undefined, 'Running header must be detected')
  assert(
    result.runningHeader.includes('Methods') || result.runningHeader.includes('Chapter'),
    `Running header "${result.runningHeader}" should contain expected text`
  )
})

// ── 9: Equation with math symbols ─────────────────────────────────────────────
test('9. Block with ∑ symbol → equation type, preserveAsImage', () => {
  const linesArr = [makeLine('E = ∑_{i=1}^{n} x_i (1)', 200, 300, 200, 14, 12, { readingOrder: 0 })]
  const tb = makeTextBlock('b1', 'E = ∑_{i=1}^{n} x_i (1)', linesArr, 'paragraph')
  const blocks = classifyBlocks([tb], {
    bodyFontSize: 12, pageNumber: 1, pageWidth: 612, pageHeight: 792,
    paths: [], images: [],
  })
  const eq = blocks.find(b => b.type === 'equation')
  assert(eq !== undefined, `Block with ∑ should be equation, got types: ${blocks.map(b=>b.type)}`)
  assert(eq.preserveAsImage === true, 'Equation should be preserveAsImage')
})

// ── 10: Equation with fraction bar ────────────────────────────────────────────
test('10. Short centered block + nearby fraction bar → equation type', () => {
  const eqBox = { x: 180, y: 300, width: 200, height: 30 }
  const linesArr = [{ items: [], text: 'f(x) = a over b', box: eqBox, baselineY: 300, dominantFont: { name: 'H', family: 'sans', size: 12, isBold: false, isItalic: false }, endsWithSoftHyphen: false, readingOrder: 0, columnIndex: 0 }]
  const tb = makeTextBlock('b_eq', 'f(x) = a over b', linesArr, 'paragraph')
  const fractionBar = makeVectorLine(185, 315, 150, 1)
  const blocks = classifyBlocks([tb], {
    bodyFontSize: 12, pageNumber: 1, pageWidth: 612, pageHeight: 792,
    paths: [fractionBar], images: [],
  })
  const eq = blocks.find(b => b.type === 'equation')
  // With fraction bar + centered short block, should detect as equation
  assert(eq !== undefined, `Expected equation block. Got: ${blocks.map(b => b.type + '(' + b.confidence + ')').join(', ')}`)
})

// ── 11: Table with visible borders ────────────────────────────────────────────
test('11. Table with ≥2 horizontal lines → table type, medium+ confidence', () => {
  const linesArr = [
    { items: [makeItem('Col A', 80, 210, 100, 14), makeItem('Col B', 220, 210, 100, 14), makeItem('Col C', 360, 210, 100, 14)], text: 'Col A Col B Col C', box: { x: 72, y: 210, width: 400, height: 14 }, baselineY: 210, dominantFont: { name: 'H', family: 'sans', size: 12, isBold: false, isItalic: false }, endsWithSoftHyphen: false, readingOrder: 0, columnIndex: 0 },
    { items: [makeItem('1', 80, 240, 100, 14), makeItem('2', 220, 240, 100, 14), makeItem('3', 360, 240, 100, 14)], text: '1 2 3', box: { x: 72, y: 240, width: 400, height: 14 }, baselineY: 240, dominantFont: { name: 'H', family: 'sans', size: 12, isBold: false, isItalic: false }, endsWithSoftHyphen: false, readingOrder: 1, columnIndex: 0 },
    { items: [makeItem('A', 80, 265, 100, 14), makeItem('B', 220, 265, 100, 14), makeItem('C', 360, 265, 100, 14)], text: 'A B C', box: { x: 72, y: 265, width: 400, height: 14 }, baselineY: 265, dominantFont: { name: 'H', family: 'sans', size: 12, isBold: false, isItalic: false }, endsWithSoftHyphen: false, readingOrder: 2, columnIndex: 0 },
  ]
  const tb = makeTextBlock('b_tbl', 'Col A Col B Col C 1 2 3 A B C', linesArr, 'paragraph')
  const hLines = [
    makeVectorLine(72, 200, 400),
    makeVectorLine(72, 228, 400),
    makeVectorLine(72, 256, 400),
    makeVectorLine(72, 300, 400),
  ]
  const blocks = classifyBlocks([tb], {
    bodyFontSize: 12, pageNumber: 1, pageWidth: 612, pageHeight: 792,
    paths: hLines, images: [],
  })
  const table = blocks.find(b => b.type === 'table')
  assert(table !== undefined, `Expected table block, got: ${blocks.map(b=>b.type).join(', ')}`)
  assert(['medium', 'high'].includes(table.confidence), `Table confidence must be medium/high, got ${table.confidence}`)
  assert(table.preserveAsImage === true, 'Table should be preserveAsImage')
})

// ── 12: Borderless table (no crash) ───────────────────────────────────────────
test('12. Borderless aligned-column layout: no crash, produces blocks', () => {
  const rows = [
    [makeItem('Name', 72, 200, 100, 14), makeItem('Age', 200, 200, 60, 14), makeItem('Score', 300, 200, 80, 14)],
    [makeItem('Alice', 72, 220, 100, 14), makeItem('30', 200, 220, 60, 14), makeItem('95', 300, 220, 80, 14)],
    [makeItem('Bob', 72, 240, 100, 14), makeItem('25', 200, 240, 60, 14), makeItem('87', 300, 240, 80, 14)],
    [makeItem('Carol', 72, 260, 100, 14), makeItem('28', 200, 260, 60, 14), makeItem('91', 300, 260, 80, 14)],
  ]
  const linesArr = rows.map((row, i) => ({
    items: row,
    text: row.map(it => it.str).join('   '),
    box: { x: 72, y: 200 + i * 20, width: 308, height: 14 },
    baselineY: 200 + i * 20,
    dominantFont: { name: 'H', family: 'sans', size: 12, isBold: false, isItalic: false },
    endsWithSoftHyphen: false,
    readingOrder: i,
    columnIndex: 0,
  }))
  const tb = makeTextBlock('b_notbl', 'Name Age Score...', linesArr, 'paragraph')
  let blocks
  try {
    blocks = classifyBlocks([tb], {
      bodyFontSize: 12, pageNumber: 1, pageWidth: 612, pageHeight: 792,
      paths: [], images: [],
    })
  } catch (e) {
    throw new Error(`Borderless table threw: ${e.message}`)
  }
  assert(blocks.length > 0, 'Should produce at least one block')
  const table = blocks.find(b => b.type === 'table')
  if (table) {
    assertEqual(table.confidence, 'low', `Borderless table confidence must be low, got ${table.confidence}`)
  }
})

// ── 13: Figure with image ─────────────────────────────────────────────────────
test('13. Large image (>10% page area) → figure block created', () => {
  const image = makeImage('img1', 72, 200, 400, 300) // 400×300 on 612×792 page = 19.6%
  const blocks = classifyBlocks([], {
    bodyFontSize: 12, pageNumber: 1, pageWidth: 612, pageHeight: 792,
    paths: [], images: [image],
  })
  const fig = blocks.find(b => b.type === 'figure')
  assert(fig !== undefined, 'Large image should produce a figure block')
  assert(fig.preserveAsImage === true, 'Figure must be preserveAsImage')
  assert(fig.associatedImages.length > 0, 'Figure should have associatedImages')
})

// ── 14: Mixed content — no crashes ────────────────────────────────────────────
test('14. Mixed content page (heading + equation + figure): no crash, ≥3 blocks', () => {
  const headLine = makeLine('Chapter 3: Results', 72, 50, 300, 24, 20, { isBold: true, readingOrder: 0 })
  const eqLine = makeLine('x = ∫f(t)dt (5)', 180, 150, 250, 14, 12, { readingOrder: 1 })
  const capLine = makeLine('Figure 1. Results chart', 72, 520, 200, 12, 10, { readingOrder: 2 })
  const textBlocks = [
    makeTextBlock('b1', headLine.text, [headLine], 'heading', 20, { readingOrder: 0 }),
    makeTextBlock('b2', eqLine.text, [eqLine], 'paragraph', 12, { readingOrder: 1 }),
    makeTextBlock('b3', capLine.text, [capLine], 'paragraph', 10, { readingOrder: 2 }),
  ]
  const image = makeImage('img_mixed', 72, 300, 400, 200)
  const blocks = classifyBlocks(textBlocks, {
    bodyFontSize: 12, pageNumber: 1, pageWidth: 612, pageHeight: 792,
    paths: [], images: [image],
  })
  assert(blocks.length >= 3, `Expected ≥3 blocks, got ${blocks.length}: ${blocks.map(b=>b.type).join(', ')}`)
  assert(blocks.some(b => b.type === 'heading'), 'Should have heading')
  assert(blocks.some(b => b.type === 'figure' || b.type === 'paragraph'), 'Should have figure or paragraph')
})

// ── 15: Empty/unusual page — graceful fallback ────────────────────────────────
test('15. Empty/unusual inputs: no crashes, empty outputs', () => {
  const emptyLines = reconstructLines([])
  assertEqual(emptyLines.length, 0, 'Empty items → 0 lines')

  const emptyOrdered = determineReadingOrder([], { columnCount: 1, columns: [{ left: 0, right: 612 }], confidence: 'low', evidence: 'empty' })
  assertEqual(emptyOrdered.length, 0, 'Empty lines → 0 ordered')

  const emptyBlocks = reconstructParagraphs([], { bodyFontSize: 12, pageNumber: 1, bodyLeft: 72 })
  assertEqual(emptyBlocks.length, 0, 'Empty lines → 0 blocks')

  const emptyDocBlocks = classifyBlocks([], {
    bodyFontSize: 12, pageNumber: 1, pageWidth: 612, pageHeight: 792,
    paths: [], images: [],
  })
  assertEqual(emptyDocBlocks.length, 0, 'Empty text blocks → 0 doc blocks')

  // Whitespace-only items produce no lines
  const wsItems = [makeItem('   ', 72, 100, 10, 14), makeItem('\t', 100, 100, 10, 14)]
  const wsLines = reconstructLines(wsItems)
  assertEqual(wsLines.length, 0, 'Whitespace-only items → 0 lines')

  // Small image (< 4% page area) → no figure block
  const tinyImg = makeImage('tiny', 72, 100, 10, 10)
  const noFig = classifyBlocks([], {
    bodyFontSize: 12, pageNumber: 1, pageWidth: 612, pageHeight: 792,
    paths: [], images: [tinyImg],
  })
  assertEqual(noFig.length, 0, 'Tiny image produces no figure block')
})

// ── 16: End-to-end real PDF extraction -> analyzeDocument ─────────────────────
await testAsync('16. End-to-end jsPDF -> extractDocument -> analyzeDocument', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  // Page 1: Running header, title heading, body paragraphs, equation-like text
  doc.setFontSize(9)
  doc.text('Journal of Academic Reflow', 72, 30)
  doc.setFontSize(20)
  doc.text('Introduction to KindleFlow', 72, 90)
  doc.setFontSize(11)
  doc.text('This paper presents a hybrid conversion engine for academic PDFs.', 72, 130)
  doc.text('It preserves mathematical equations and tables without overlapping text.', 72, 146)
  doc.text('1. First design principle for e-ink readability.', 72, 185)
  doc.text('2. Second principle regarding column reading order.', 72, 220)

  // Page 2: Same running header, two-column layout
  doc.addPage()
  doc.setFontSize(9)
  doc.text('Journal of Academic Reflow', 72, 30)
  doc.setFontSize(11)
  for (let i = 0; i < 18; i++) {
    doc.text(`Left column line ${i + 1} prose.`, 60, 110 + i * 24)
    doc.text(`Right column line ${i + 1} prose.`, 330, 110 + i * 24)
  }

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const extraction = await extractDocument(pdfBytes, { fileName: 'synthetic-academic.pdf' })
  const phases = []
  const analyzed = await analyzeDocument(extraction, {
    onProgress: (p) => phases.push(p.phase),
  })

  assertEqual(analyzed.pageCount, 2, 'Analyzed pageCount')
  assertEqual(analyzed.pages.length, 2, 'Analyzed pages length')
  assert(phases.includes('analyzing'), 'Progress reported analyzing phase')
  assert(analyzed.runningHeader !== undefined, 'Running header detected across 2 pages')
  assertEqual(analyzed.pages[0].columnLayout.columnCount, 1, 'Page 1 single-column layout detected')
  assert(analyzed.pages[0].blocks.some(b => b.type === 'heading'), 'Page 1 heading detected')
  assert(analyzed.pages[0].blocks.some(b => b.type === 'list'), 'Page 1 list item detected')
  assertEqual(analyzed.pages[1].columnLayout.columnCount, 2, 'Page 2 two-column layout detected')
  const p2Blocks = analyzed.pages[1].blocks.filter(b => b.type !== 'header' && b.type !== 'footer')
  assert(p2Blocks.length >= 2, 'Page 2 produced blocks')
})

// ── 17: Synthetic multi-column table with distinct cells and grid lines ────────
await testAsync('17. Synthetic 4x3 table with grid lines: extracts structured TableData', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc.setFontSize(14)
  doc.text('Table 2: Experimental Evaluation Across Metrics', 72, 80)

  // Draw 5 horizontal lines and 4 vertical lines (4 rows x 3 columns)
  doc.setLineWidth(1)
  doc.line(72, 100, 480, 100)
  doc.line(72, 125, 480, 125)
  doc.line(72, 150, 480, 150)
  doc.line(72, 175, 480, 175)
  doc.line(72, 200, 480, 200)

  doc.line(72, 100, 72, 200)
  doc.line(200, 100, 200, 200)
  doc.line(340, 100, 340, 200)
  doc.line(480, 100, 480, 200)

  // Header row
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Benchmark', 80, 117)
  doc.setFont('helvetica', 'normal')
  doc.text('Baseline Metric', 210, 117)
  doc.setFont('helvetica', 'bold')
  doc.text('KindleFlow Metric', 350, 117)

  // Row 1
  doc.setFont('helvetica', 'normal')
  doc.text('Notion Academic', 80, 142)
  doc.setFont('helvetica', 'bold')
  doc.text('19.2 MB', 210, 142)
  doc.setFont('helvetica', 'normal')
  doc.text('25.5 KB', 350, 142)

  // Row 2
  doc.setFont('helvetica', 'bold')
  doc.text('Multi-Column Paper', 80, 167)
  doc.setFont('helvetica', 'normal')
  doc.text('Mangled Order', 210, 167)
  doc.setFont('helvetica', 'bold')
  doc.text('Single Column', 350, 167)

  // Row 3
  doc.setFont('helvetica', 'normal')
  doc.text('Complex Formulas', 80, 192)
  doc.setFont('helvetica', 'bold')
  doc.text('Overlapping', 210, 192)
  doc.setFont('helvetica', 'normal')
  doc.text('Preserved Crop', 350, 192)

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const extraction = await extractDocument(pdfBytes, { fileName: 'synthetic-table.pdf' })
  const analyzed = await analyzeDocument(extraction)

  const tableBlock = analyzed.pages[0].blocks.find(b => b.type === 'table')
  assert(tableBlock !== undefined, 'Table block detected on page 1')
  assertEqual(tableBlock.preserveAsImage, true, 'Table preserveAsImage is true')
  assert(tableBlock.tableData !== undefined, 'Structured tableData is populated')
  assertEqual(tableBlock.tableData.columnCount, 3, 'Table has 3 columns')
  assertEqual(tableBlock.tableData.rowCount, 4, 'Table has 4 rows (1 header + 3 data)')
  assertEqual(tableBlock.tableData.headers[0], 'Benchmark', 'Header 0 is Benchmark')
  assertEqual(tableBlock.tableData.headers[1], 'Baseline Metric', 'Header 1 is Baseline Metric')
  assertEqual(tableBlock.tableData.headers[2], 'KindleFlow Metric', 'Header 2 is KindleFlow Metric')
  assertEqual(tableBlock.tableData.rows[0][0], 'Notion Academic', 'Row 0 Col 0 is Notion Academic')
  assertEqual(tableBlock.tableData.rows[0][1], '19.2 MB', 'Row 0 Col 1 is 19.2 MB')
  assertEqual(tableBlock.tableData.rows[0][2], '25.5 KB', 'Row 0 Col 2 is 25.5 KB')
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
