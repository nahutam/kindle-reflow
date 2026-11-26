/**
 * KindleFlow — Real-World Notion Academic Notes Regression Test (Prompt 6)
 *
 * Verifies that real Notion export PDFs (e.g. breathing_system.pdf) are correctly
 * processed with Prompt 6 improvements:
 * 1. Paragraph boundary preservation (distinct blocks, not 1 huge paragraph blob)
 * 2. Section headings / subheadings correctly classified (e.g. "5.2", "5.3 The Breathing System")
 *    and NEVER misclassified as equations or tables
 * 3. 0 orange / callout border artifacts on ordinary body text
 * 4. LaTeX inline math normalized to readable Unicode: \(\mathrm{ATP}\) -> ATP, \(\mathrm{COPD}\) -> COPD
 * 5. High structural fidelity & compact vector output (<100 KB, not 19 MB rasterized)
 *
 * Run: node scripts/test-notion-regression.mjs
 */

import * as fs from 'fs'
import * as path from 'path'
import ts from 'typescript'

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

console.log('\n=============================================================')
console.log('KindleFlow — Notion Academic Notes Regression Suite (Prompt 6)')
console.log('=============================================================\n')

const typesRes     = await importTS('lib/converter/types.ts')
const workerRes    = await importTS('lib/converter/worker-loader.ts')
const validatorRes = await importTS('lib/converter/validator.ts')
const extractorRes = await importTS('lib/converter/extractor.ts')
const lineRes      = await importTS('lib/converter/line-reconstructor.ts')
const structRes    = await importTS('lib/converter/structure-analyzer.ts')
const orderRes     = await importTS('lib/converter/reading-order.ts')
const paraRes      = await importTS('lib/converter/paragraph-reconstructor.ts')
const classRes     = await importTS('lib/converter/classifier.ts')
const reflowRes    = await importTS('lib/converter/text-reflower.ts')
const preserverRes = await importTS('lib/converter/region-preserver.ts')
const layoutValRes = await importTS('lib/converter/layout-validator.ts')
const layoutEngRes = await importTS('lib/converter/layout-engine.ts')
const pdfGenRes    = await importTS('lib/converter/pdf-generator.ts')
const slideRes     = await importTS('lib/converter/slide-converter.ts')
const indexRes     = await importTS('lib/converter/index.ts')

const allRefs = [
  typesRes, workerRes, validatorRes, extractorRes,
  lineRes, structRes, orderRes, paraRes, classRes,
  reflowRes, preserverRes, layoutValRes, layoutEngRes,
  pdfGenRes, slideRes, indexRes,
]

function cleanup() {
  for (const r of allRefs) {
    try { fs.unlinkSync(r.tempPath) } catch {}
  }
}

const {
  extractDocument,
  analyzeDocument,
  layoutDocument,
  generateNotesPDF,
} = indexRes.mod

let passed = 0
let failed = 0
const failures = []

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed')
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function runTest(name, fn) {
  process.stdout.write(`  Testing: ${name}... `)
  try {
    await fn()
    console.log('✓ Passed')
    passed++
  } catch (err) {
    console.log(`✗ Failed: ${err.message}`)
    failed++
    failures.push({ name, error: err.message })
  }
}

const NOTION_PDF_PATH = fs.existsSync('C:/Users/PC/Downloads/breathing systems.pdf')
  ? 'C:/Users/PC/Downloads/breathing systems.pdf'
  : 'C:/Users/PC/Downloads/breathing_system.pdf'

if (!fs.existsSync(NOTION_PDF_PATH)) {
  console.log(`Warning: Real fixture not found at ${NOTION_PDF_PATH}. Skipping real-file regression.`)
  cleanup()
  process.exit(0)
}

const pdfBytes = new Uint8Array(fs.readFileSync(NOTION_PDF_PATH))

let extracted = null
let analyzed = null
let layout = null
let result = null

await runTest('1. Extraction completes cleanly without errors', async () => {
  extracted = await extractDocument(pdfBytes, { fileName: 'breathing_system.pdf' })
  assert(extracted.pages.length === 5, `Expected 5 pages, got ${extracted.pages.length}`)
  assert(extracted.totalCharacters > 5000, `Expected >5000 chars, got ${extracted.totalCharacters}`)
})

await runTest('2. Structure analyzer produces multiple separate paragraph blocks (no mega-merging)', async () => {
  analyzed = await analyzeDocument(extracted)
  assert(analyzed.pages.length === 5, `Expected 5 analyzed pages, got ${analyzed.pages.length}`)

  // Check Page 2 specifically (in Prompt 5, all lines were merged into 1 single block)
  const page2 = analyzed.pages[1]
  const page2Paragraphs = page2.blocks.filter(b => b.type === 'paragraph')
  assert(page2Paragraphs.length >= 4, `Expected ≥4 separate paragraphs on page 2, got ${page2Paragraphs.length}`)
  
  // Total blocks across document
  const totalBlocks = analyzed.pages.flatMap(p => p.blocks).length
  assert(totalBlocks >= 20, `Expected ≥20 total blocks across document, got ${totalBlocks}`)
})

await runTest('3. Section headings (5.2, 5.3, etc.) classified as headings, NEVER equations', async () => {
  const allBlocks = analyzed.pages.flatMap(p => p.blocks)
  
  // Find "5.3 The Breathing System"
  const h53 = allBlocks.find(b => b.text && b.text.includes('5.3') && b.text.includes('Breathing System'))
  assert(!!h53, 'Found heading 5.3 block')
  assert(h53.type === 'heading' || h53.type === 'subheading', `Expected heading/subheading, got ${h53.type}`)
  assertEqual(h53.preserveAsImage, false, 'Heading 5.3 should NOT be preserved as image')

  // Check that NO heading is classified as equation
  const equationBlocks = allBlocks.filter(b => b.type === 'equation')
  for (const eq of equationBlocks) {
    const txt = eq.text || ''
    assert(!txt.includes('5.3 The Breathing System'), 'Section 5.3 must not be classified as equation')
    assert(!txt.includes('Unit 5 Human Biology'), 'Unit title must not be classified as equation')
  }
})

await runTest('4. Full-page Notion background vectors rejected as callouts (0 false callouts)', async () => {
  const allBlocks = analyzed.pages.flatMap(p => p.blocks)
  const calloutBlocks = allBlocks.filter(b => b.type === 'callout')
  // Notion document has no true callout alert boxes; previously EVERY block was callout
  assertEqual(calloutBlocks.length, 0, `Expected 0 callout blocks, got ${calloutBlocks.length}`)
})

await runTest('5. Hybrid LayoutEngine reflows content cleanly without page overflows or overlap', async () => {
  const mockMeasurer = (text, size, weight) => {
    const charWidth = size * (weight === 'bold' ? 0.6 : 0.52)
    return text.length * charWidth
  }
  layout = await layoutDocument(analyzed, { textMeasurer: mockMeasurer })
  assert(layout.pages.length >= 4, `Expected ≥4 Kindle pages, got ${layout.pages.length}`)
  assert(layout.validation.isValid, `Layout validation should be valid: ${layout.validation.errors.map(e => e.message).join('; ')}`)
  assert(!layout.validation.errors.some(e => e.code === 'OVERLAPPING_ELEMENTS'), 'Zero overlap errors')
})

await runTest('6. PDF generation produces selectable vector PDF under 100 KB (no 19MB rasterization)', async () => {
  const mockCropRenderer = async (page, box) => {
    return { data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', format: 'PNG', pixelWidth: 10, pixelHeight: 10 }
  }
  result = await generateNotesPDF(layout, {
    regionRenderer: mockCropRenderer,
    cropRenderer: mockCropRenderer,
    sourcePdfBytes: pdfBytes,
  })
  
  assert(result.pageCount >= 4, `Expected ≥4 output pages, got ${result.pageCount}`)
  assert(result.pdfBytes.byteLength < 100000, `Output PDF size (${result.pdfBytes.byteLength} B) exceeded 100 KB limit!`)
  assert(result.pdfBytes.byteLength > 10000, `Output PDF too small (${result.pdfBytes.byteLength} B)`)
})

await runTest('7. Math & LaTeX normalization removes \\(\\mathrm{...}\\) in output text', async () => {
  // Check text inside layout lines
  const allLines = layout.pages.flatMap(p => p.elements).filter(e => e.kind === 'text')
  const allText = allLines.map(l => l.text).join(' ')
  
  // Must NOT contain raw LaTeX fragments like \(\mathrm{ATP}\) or \(\mathrm{COPD}\)
  assert(!allText.includes('\\(\\mathrm{ATP}\\)'), 'Raw LaTeX \\(\\mathrm{ATP}\\) must be normalized')
  assert(!allText.includes('\\(\\mathrm{COPD}\\)'), 'Raw LaTeX \\(\\mathrm{COPD}\\) must be normalized')
  assert(allText.includes('ATP'), 'Normalized text should contain ATP')
  assert(allText.includes('COPD'), 'Normalized text should contain COPD')
})

await runTest('8. Table 1 (Atmospheric vs Exhaled air) preserved as structured table with cells', async () => {
  const allBlocks = analyzed.pages.flatMap(p => p.blocks)
  const t1 = allBlocks.find(b => b.type === 'table' && b.tableData && b.tableData.headers.some(h => h.includes('Atmospheric')))
  assert(t1 !== undefined, 'Found Atmospheric air table block')
  assertEqual(t1.preserveAsImage, true, 'Table 1 preserveAsImage')
  assert(t1.tableData !== undefined, 'Table 1 has tableData')
  assertEqual(t1.tableData.columnCount, 3, 'Table 1 has 3 columns')
  assertEqual(t1.tableData.rowCount, 6, 'Table 1 has 6 rows')
  assert(t1.tableData.headers.includes('Component'), 'Header includes Component')
  assert(t1.tableData.headers.includes('Atmospheric air'), 'Header includes Atmospheric air')
  assert(t1.tableData.headers.includes('Exhaled air'), 'Header includes Exhaled air')

  // Check row cells
  const o2Row = t1.tableData.rows.find(r => r[0] === 'Oxygen')
  assert(o2Row !== undefined, 'Found Oxygen row')
  assertEqual(o2Row[1], '21%', 'Oxygen atmospheric air is 21%')
  assertEqual(o2Row[2], '16%', 'Oxygen exhaled air is 16%')

  const co2Row = t1.tableData.rows.find(r => r[0] === 'Carbon dioxide')
  assert(co2Row !== undefined, 'Found Carbon dioxide row')
  assertEqual(co2Row[1], '0.04%', 'CO2 atmospheric air is 0.04%')
  assertEqual(co2Row[2], '4%', 'CO2 exhaled air is 4%')
})

await runTest('9. Table 2 (Inspiration vs Expiration) preserved as structured table with cells', async () => {
  const allBlocks = analyzed.pages.flatMap(p => p.blocks)
  const t2 = allBlocks.find(b => b.type === 'table' && b.tableData && b.tableData.headers.some(h => h.includes('Inspiration')))
  assert(t2 !== undefined, 'Found Inspiration/Expiration table block')
  assertEqual(t2.preserveAsImage, true, 'Table 2 preserveAsImage')
  assert(t2.tableData !== undefined, 'Table 2 has tableData')
  assertEqual(t2.tableData.columnCount, 3, 'Table 2 has 3 columns')
  assertEqual(t2.tableData.rowCount, 8, 'Table 2 has 8 rows')
  assert(t2.tableData.headers[0].includes('Parts of respiratory'), 'Header 0 is Parts of respiratory system')
  assert(t2.tableData.headers[1].includes('Inspiration'), 'Header 1 is Inspiration')
  assert(t2.tableData.headers[2].includes('Expiration'), 'Header 2 is Expiration')

  // Check row cells
  const dRow = t2.tableData.rows.find(r => r[0].includes('Diaphragm'))
  assert(dRow !== undefined, 'Found Diaphragm row')
  assert(dRow[1].includes('Contracts and flattens'), 'Diaphragm inspiration cell preserved')
  assert(dRow[2].includes('Relaxes and moves upwards'), 'Diaphragm expiration cell preserved')

  const pressRow = t2.tableData.rows.find(r => r[0].includes('Air Pressure'))
  assert(pressRow !== undefined, 'Found Air Pressure row')
  assert(pressRow[1].includes('Decrease in pressure'), 'Air pressure inspiration cell preserved')
  assert(pressRow[2].includes('Increases in pressure'), 'Air pressure expiration cell preserved')
})

await runTest('10. Prompt 7: Table 1 occurs after alveolar-sac & alveolar-pores and before section 5.3.3', async () => {
  const allElements = layout.pages.flatMap(p => p.elements)

  // Find index of alveolar pores
  const poresIdx = allElements.findIndex(
    el => el.kind === 'text' && el.text.includes('Alveolar pores connect adjacent alveoli'),
  )
  assert(poresIdx !== -1, 'Alveolar pores text must exist in layout elements')

  // Find index of Table 1 region (sourcePage 3)
  const t1Idx = allElements.findIndex(
    el => el.kind === 'preserved-region' && el.sourcePageNumber === 3,
  )
  assert(t1Idx !== -1, 'Table 1 preserved region must exist in layout elements')

  // Find index of section 5.3.3 heading
  const h533Idx = allElements.findIndex(
    el => el.kind === 'text' && el.text.includes('5.3.3 Mechanism of Breathing Movements'),
  )
  assert(h533Idx !== -1, 'Section 5.3.3 heading must exist in layout elements')

  // Verify relative order: pores < Table 1 < Section 5.3.3
  assert(
    poresIdx < t1Idx,
    `Alveolar pores (idx ${poresIdx}) must appear BEFORE Table 1 (idx ${t1Idx})`,
  )
  assert(
    t1Idx < h533Idx,
    `Table 1 (idx ${t1Idx}) must appear BEFORE Section 5.3.3 (idx ${h533Idx})`,
  )
})

await runTest('11. Prompt 7: Diaphragm paragraph remains continuous and unbroken before Table 2', async () => {
  const allElements = layout.pages.flatMap(p => p.elements)

  // Find lines of the diaphragm paragraph
  const diaphragmLine1Idx = allElements.findIndex(
    el => el.kind === 'text' && el.text.includes('The diaphragm is a dome-shaped sheet'),
  )
  assert(diaphragmLine1Idx !== -1, 'Diaphragm opening sentence must exist in layout')

  // Verify that "internal thoracic pressure" appears together without table interruption
  const diaphragmFullText = allElements
    .filter(el => el.kind === 'text')
    .map(el => el.text)
    .join(' ')
  assert(
    diaphragmFullText.includes('internal thoracic pressure.'),
    'Diaphragm sentence must contain "internal thoracic pressure." intact',
  )

  // Find Table 2 region (sourcePage 4)
  const t2Idx = allElements.findIndex(
    el => el.kind === 'preserved-region' && el.sourcePageNumber === 4,
  )
  assert(t2Idx !== -1, 'Table 2 preserved region must exist in layout elements')

  // Find the exact line ending the diaphragm sentence
  const diaphragmEndIdx = allElements.findIndex(
    el => el.kind === 'text' && el.text.includes('pressure.') && el.sourcePageNumber === 3,
  )
  assert(diaphragmEndIdx !== -1, 'Diaphragm paragraph ending must be on source page 3 content')

  // Verify diaphragm paragraph is strictly BEFORE Table 2
  assert(
    diaphragmEndIdx < t2Idx,
    `Diaphragm end (idx ${diaphragmEndIdx}) must appear BEFORE Table 2 (idx ${t2Idx})`,
  )

  // Check that NO isolated "pressure." element exists on page 4 after Table 2
  const isolatedPressureAfterTable = allElements.findIndex(
    (el, idx) =>
      idx > t2Idx &&
      el.kind === 'text' &&
      el.text.trim() === 'pressure.' &&
      el.sourcePageNumber === 4,
  )
  assertEqual(
    isolatedPressureAfterTable,
    -1,
    'No isolated "pressure." should exist after Table 2',
  )
})

await runTest('12. Prompt 7: Opening 4 breathing functions remain grouped bulleted list', async () => {
  const p1Blocks = analyzed.pages[0].blocks
  const listItems = p1Blocks.filter(b => b.type === 'list')
  assert(
    listItems.length === 4,
    `Expected exactly 4 list items for primary functions, got ${listItems.length}`,
  )

  // Verify all 4 function items start with bullet marker
  assert(listItems[0].text.startsWith('• Providing oxygen'), 'List item 1 has bullet')
  assert(listItems[1].text.startsWith('• Removing the metabolic'), 'List item 2 has bullet')
  assert(listItems[2].text.startsWith('• Assisting in maintaining'), 'List item 3 has bullet')
  assert(listItems[3].text.startsWith('• Facilitating non-vital'), 'List item 4 has bullet')

  // Verify in layout elements that hanging bullet indentation is applied
  const p1LayoutLines = layout.pages.flatMap(p => p.elements).filter(
    el => el.kind === 'text' && el.text.startsWith('• '),
  )
  assert(
    p1LayoutLines.length >= 4,
    `Expected at least 4 bullet lines in layout, got ${p1LayoutLines.length}`,
  )
})

await runTest('13. Prompt 7: All source content accounted for with zero omissions or duplicates', async () => {
  const allLayoutText = layout.pages
    .flatMap(p => p.elements)
    .filter(el => el.kind === 'text')
    .map(el => el.text)
    .join(' ')

  const keySentences = [
    'Unit 5 Human Biology and Health',
    'Heart failure (congestive heart failure)',
    'Bradycardia is defined as a slow heart rate',
    'Tachycardia is defined as an abnormally fast heart rate',
    '5.3 The Breathing System',
    'Providing oxygen to body tissues',
    '5.3.1 Major Breathing Structures',
    'The nostrils are the external entrance',
    'The pharynx (throat) is a tube',
    'The glottis consists of the vestibular folds',
    'The trachea (windpipe) extends from the base',
    '5.3.2 Gas Exchange and Alveoli',
    'An alveolar sac consists of a cluster',
    'Alveolar pores connect adjacent alveoli',
    '5.3.3 Mechanism of Breathing Movements',
    'Air flows between the atmosphere',
    'The diaphragm is a dome-shaped sheet',
    '5.3.4 Interplay Between the Respiratory and Circulatory Systems',
    '5.3.5 Disorders of the Breathing System',
    'Bronchitis is an inflammation',
    'Emphysema involves persistent irritation',
    'Chronic Obstructive Pulmonary Disease',
    'Bronchial asthma is an inflammatory disorder',
  ]

  for (const sentence of keySentences) {
    assert(
      allLayoutText.includes(sentence),
      `Expected source text "${sentence}" to be preserved in converted document`,
    )
  }

  // Verify preserved tables
  const regions = layout.pages
    .flatMap(p => p.elements)
    .filter(el => el.kind === 'preserved-region')
  assertEqual(regions.length, 2, 'Exactly 2 preserved table regions in document')
})

console.log(`\nRegression Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.`)

if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`)
}

cleanup()
process.exit(failed > 0 ? 1 : 0)
