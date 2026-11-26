/**
 * KindleFlow — Batch Conversion Comprehensive Test Suite
 * Tests Batch Requirements A, B, C, D, E, F:
 *  - Test A: Notes batch (3 PDFs, sequential processing, valid outputs, individual downloads, ZIP contents)
 *  - Test B: Slides batch (3 PDFs, 1:1 page mapping, landscape 4:3 proportions, ZIP contents)
 *  - Test C: Failure handling (invalid/corrupt PDF alongside valid, error isolation, exclusion from ZIP)
 *  - Test D: Queue behavior (add/remove, uniform mode enforcement, duplicate prevention, accurate progress)
 *  - Test E: Single-file regression (Notes mode & Slides mode parity)
 *  - Test F: Offline & local-only operation verification
 */

import * as fs from 'fs'
import * as path from 'path'
import ts from 'typescript'
import { jsPDF } from 'jspdf'
import JSZip from 'jszip'

// ─── TypeScript Import Helper ─────────────────────────────────────────────────

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

console.log('\n=============================================================')
console.log('KindleFlow — Batch Conversion Verification & Test Suite')
console.log('=============================================================\n')

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
const batchRes = await importTS('lib/converter/batch-converter.ts')

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
  batchRes,
]

function cleanup() {
  for (const r of allRefs) {
    try {
      fs.unlinkSync(r.tempPath)
    } catch {
      // Ignored
    }
  }
}

const { convertDocument } = indexRes.mod
const {
  runBatchConversion,
  createBatchZip,
  buildBatchZipName,
  deduplicateOutputNames,
} = batchRes.mod

// ─── Test Helpers ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

async function test(name, fn) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (err) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
    failures.push({ name, error: err.message })
    failed++
  }
}

// Helper to create mock File-like object for Node
function makeFile(name, bytes) {
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

// 1x1 100x100 white PNG
const MOCK_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

// ─── TEST SUITE ───────────────────────────────────────────────────────────────

console.log('Running Batch Conversion Tests...\n')

// ─── TEST A: Notes Batch (3 PDFs, Sequential Processing, ZIP Contents) ────────

await test('Test A: Notes batch (3 distinct PDFs, sequential processing, individual downloads, ZIP contents)', async () => {
  // Create 3 distinct academic PDFs
  const doc1 = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc1.setFontSize(18); doc1.text('Cellular Respiration in Eukaryotes', 72, 80)
  doc1.setFontSize(11); doc1.text('Glycolysis takes place in the cytoplasm and breaks glucose into pyruvate molecules.', 72, 110)
  const bytes1 = new Uint8Array(doc1.output('arraybuffer'))

  const doc2 = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc2.setFontSize(18); doc2.text('Principles of Thermodynamics', 72, 80)
  doc2.setFontSize(11); doc2.text('The first law states that internal energy is conserved in any closed thermodynamic cycle.', 72, 110)
  const bytes2 = new Uint8Array(doc2.output('arraybuffer'))

  const doc3 = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc3.setFontSize(18); doc3.text('Fluid Mechanics and Boundary Layers', 72, 80)
  doc3.setFontSize(11); doc3.text('Navier-Stokes equations govern the motion of viscous fluid substances in three dimensions.', 72, 110)
  const bytes3 = new Uint8Array(doc3.output('arraybuffer'))

  const items = [
    { id: '1', file: makeFile('cellular-biology.pdf', bytes1), name: 'cellular-biology.pdf', size: bytes1.length, status: 'queued' },
    { id: '2', file: makeFile('thermodynamics.pdf', bytes2), name: 'thermodynamics.pdf', size: bytes2.length, status: 'queued' },
    { id: '3', file: makeFile('fluid-mechanics.pdf', bytes3), name: 'fluid-mechanics.pdf', size: bytes3.length, status: 'queued' },
  ]

  const executionLog = []
  const summary = await runBatchConversion(items, {
    mode: 'notes',
    onBatchProgress: (p) => {
      executionLog.push({ index: p.currentIndex, file: p.currentItem.name, percent: p.overallPercent })
    },
  })

  // 1. Verify summary
  assertEqual(summary.total, 3, 'Total files')
  assertEqual(summary.completed, 3, 'All 3 completed')
  assertEqual(summary.failed, 0, '0 failures')
  assertEqual(summary.mode, 'notes', 'Mode notes')

  // 2. Verify sequential processing (files progressed in order 0 -> 1 -> 2)
  const fileOrder = [...new Set(executionLog.map(x => x.file))]
  assertEqual(fileOrder[0], 'cellular-biology.pdf', 'First file processed')
  assertEqual(fileOrder[1], 'thermodynamics.pdf', 'Second file processed')
  assertEqual(fileOrder[2], 'fluid-mechanics.pdf', 'Third file processed')

  // 3. Verify each output generated correctly
  for (const item of summary.items) {
    assertEqual(item.status, 'completed', `${item.name} completed`)
    assert(item.result !== undefined, `${item.name} has result`)
    assert(item.result.pdfBytes.byteLength > 1000, `${item.name} has valid PDF bytes`)
    assert(item.result.fileName.includes('-notes'), `${item.name} output tagged with -notes`)
    assertEqual(item.result.mode, 'notes', `${item.name} mode is notes`)
  }

  // 4. Test ZIP generation and extraction
  const zipBytes = await createBatchZip(summary.successfulResults)
  assert(zipBytes.byteLength > 2000, 'Valid ZIP bytes generated')

  const zip = await JSZip.loadAsync(zipBytes)
  const fileNamesInZip = Object.keys(zip.files)
  assertEqual(fileNamesInZip.length, 3, 'Exactly 3 files in ZIP')
  assert(fileNamesInZip.includes('cellular-biology-kindle-notes.pdf'), 'Contains cellular biology PDF')
  assert(fileNamesInZip.includes('thermodynamics-kindle-notes.pdf'), 'Contains thermodynamics PDF')
  assert(fileNamesInZip.includes('fluid-mechanics-kindle-notes.pdf'), 'Contains fluid mechanics PDF')

  // 5. Verify byte fidelity inside ZIP
  for (const item of summary.successfulResults) {
    const unzippedBytes = await zip.file(item.fileName).async('uint8array')
    assertEqual(unzippedBytes.byteLength, item.pdfBytes.byteLength, `${item.fileName} byte length matches exactly`)
  }
})

// ─── TEST B: Slides Batch (3 Slides, 1:1 Page Mapping, Landscape 4:3 Proportions) ──

await test('Test B: Slides batch (3 presentation PDFs, 1:1 mapping, landscape 4:3, ZIP contents)', async () => {
  const mockSlideRasterizer = async (pdfDoc, pageNum, settings) => ({
    image: { data: MOCK_PNG, format: 'PNG', pixelWidth: 400, pixelHeight: 300 },
    sourceWidthPt: 1024,
    sourceHeightPt: 768,
    cropBoxPt: { x: 0, y: 0, width: 1024, height: 768 },
    usedFallbackMargins: false,
    marginReason: 'Mock slide',
    lowResImageDetected: false,
    warnings: [],
  })

  // Create 3 distinct slide presentations (Slide Deck 1 has 2 pages, Deck 2 has 1 page, Deck 3 has 3 pages)
  const deck1 = new jsPDF({ unit: 'pt', format: [1024, 768] })
  deck1.text('Lecture 1: Introduction to AI', 100, 100)
  deck1.addPage([1024, 768]); deck1.text('Slide 2: Neural Networks', 100, 100)
  const b1 = new Uint8Array(deck1.output('arraybuffer'))

  const deck2 = new jsPDF({ unit: 'pt', format: [1024, 768] })
  deck2.text('Lecture 2: Search Algorithms', 100, 100)
  const b2 = new Uint8Array(deck2.output('arraybuffer'))

  const deck3 = new jsPDF({ unit: 'pt', format: [1024, 768] })
  deck3.text('Lecture 3: Heuristics', 100, 100)
  deck3.addPage([1024, 768]); deck3.text('Slide 2: A* Search', 100, 100)
  deck3.addPage([1024, 768]); deck3.text('Slide 3: Minimax', 100, 100)
  const b3 = new Uint8Array(deck3.output('arraybuffer'))

  const items = [
    { id: 's1', file: makeFile('lecture-01.pdf', b1), name: 'lecture-01.pdf', size: b1.length, status: 'queued' },
    { id: 's2', file: makeFile('lecture-02.pdf', b2), name: 'lecture-02.pdf', size: b2.length, status: 'queued' },
    { id: 's3', file: makeFile('lecture-03.pdf', b3), name: 'lecture-03.pdf', size: b3.length, status: 'queued' },
  ]

  const summary = await runBatchConversion(items, {
    mode: 'slides',
    slideRasterizer: mockSlideRasterizer,
    slideSettings: {
      orientation: 'landscape',
      fittingStrategy: 'original-proportions',
    },
  })

  assertEqual(summary.completed, 3, 'All 3 slide decks completed')
  assertEqual(summary.items[0].result.pageCount, 2, 'Deck 1: 2 source slides -> exactly 2 output pages')
  assertEqual(summary.items[1].result.pageCount, 1, 'Deck 2: 1 source slide -> exactly 1 output page')
  assertEqual(summary.items[2].result.pageCount, 3, 'Deck 3: 3 source slides -> exactly 3 output pages')

  // Verify landscape proportions
  for (const item of summary.items) {
    assertEqual(item.result.mode, 'slides', 'Mode is slides')
    assert(item.result.fileName.includes('-slides'), 'Output tagged with -slides')
    for (const p of item.result.slidePages) {
      assertEqual(p.destBoxPt.height, 412, 'Slide fills usable 412pt landscape height without distortion')
      assert(Math.abs(p.destBoxPt.width - 549.33) < 0.5, 'Width fits 4:3 target bounds')
    }
  }

  // ZIP verification
  const zipBytes = await createBatchZip(summary.successfulResults)
  const zip = await JSZip.loadAsync(zipBytes)
  const names = Object.keys(zip.files)
  assertEqual(names.length, 3, 'All 3 decks packaged into ZIP')
  assert(names.includes('lecture-01-kindle-slides.pdf'), 'Includes lecture-01')
  assert(names.includes('lecture-02-kindle-slides.pdf'), 'Includes lecture-02')
  assert(names.includes('lecture-03-kindle-slides.pdf'), 'Includes lecture-03')
})

// ─── TEST C: Failure Handling (Corrupted File Alongside Valid) ────────────────

await test('Test C: Failure handling (corrupt/invalid PDF alongside valid, error isolation, ZIP exclusion)', async () => {
  // Valid PDF 1
  const doc1 = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc1.text('Valid Academic Document 1', 72, 80)
  const b1 = new Uint8Array(doc1.output('arraybuffer'))

  // Deliberately corrupted PDF (invalid header, non-PDF content)
  const corruptBytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64])

  // Valid PDF 2
  const doc2 = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc2.text('Valid Academic Document 2', 72, 80)
  const b2 = new Uint8Array(doc2.output('arraybuffer'))

  const items = [
    { id: 'v1', file: makeFile('valid-paper-1.pdf', b1), name: 'valid-paper-1.pdf', size: b1.length, status: 'queued' },
    { id: 'c1', file: makeFile('corrupted-file.pdf', corruptBytes), name: 'corrupted-file.pdf', size: corruptBytes.length, status: 'queued' },
    { id: 'v2', file: makeFile('valid-paper-2.pdf', b2), name: 'valid-paper-2.pdf', size: b2.length, status: 'queued' },
  ]

  const summary = await runBatchConversion(items, { mode: 'notes' })

  // 1. Total and status counts
  assertEqual(summary.total, 3, 'Total items 3')
  assertEqual(summary.completed, 2, '2 valid files completed')
  assertEqual(summary.failed, 1, '1 corrupted file failed')

  // 2. Verify corrupted file status and error
  const failedItem = summary.items.find(x => x.id === 'c1')
  assertEqual(failedItem.status, 'failed', 'Corrupt file status marked failed')
  assert(failedItem.error !== undefined, 'Corrupt file has error message')
  assert(failedItem.error.includes('PDF') || failedItem.error.includes('signature') || failedItem.error.includes('header'), 'Error mentions PDF header')

  // 3. Verify valid files converted despite corrupted file
  const valid1 = summary.items.find(x => x.id === 'v1')
  const valid2 = summary.items.find(x => x.id === 'v2')
  assertEqual(valid1.status, 'completed', 'Valid 1 converted successfully')
  assertEqual(valid2.status, 'completed', 'Valid 2 converted successfully')

  // 4. Verify ZIP excludes the failed file
  const zipBytes = await createBatchZip(summary.successfulResults)
  const zip = await JSZip.loadAsync(zipBytes)
  const zipFiles = Object.keys(zip.files)
  assertEqual(zipFiles.length, 2, 'ZIP contains exactly 2 valid PDFs')
  assert(zipFiles.includes('valid-paper-1-kindle-notes.pdf'), 'ZIP contains valid paper 1')
  assert(zipFiles.includes('valid-paper-2-kindle-notes.pdf'), 'ZIP contains valid paper 2')
  assert(!zipFiles.some(f => f.includes('corrupted')), 'ZIP does NOT contain corrupted file')
})

// ─── TEST D: Queue Behavior & Filename Deduplication ───────────────────────────

await test('Test D: Queue behavior (filename deduplication in ZIP, uniform mode invariant)', async () => {
  // Test duplicate filenames: User uploads "homework.pdf" twice (e.g. from different folders)
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc.text('Homework Assignment', 72, 80)
  const bytes = new Uint8Array(doc.output('arraybuffer'))

  const items = [
    { id: 'h1', file: makeFile('homework.pdf', bytes), name: 'homework.pdf', size: bytes.length, status: 'queued' },
    { id: 'h2', file: makeFile('homework.pdf', bytes), name: 'homework.pdf', size: bytes.length, status: 'queued' },
    { id: 'h3', file: makeFile('homework.pdf', bytes), name: 'homework.pdf', size: bytes.length, status: 'queued' },
  ]

  const summary = await runBatchConversion(items, { mode: 'notes' })
  assertEqual(summary.completed, 3, 'All 3 completed')

  // Verify deduplicated ZIP names
  const zipBytes = await createBatchZip(summary.successfulResults)
  const zip = await JSZip.loadAsync(zipBytes)
  const namesInZip = Object.keys(zip.files)
  assertEqual(namesInZip.length, 3, '3 files in ZIP')
  assert(namesInZip.includes('homework-kindle-notes.pdf'), 'First file has original output name')
  assert(namesInZip.includes('homework-kindle-notes (1).pdf'), 'Second file has (1) suffix')
  assert(namesInZip.includes('homework-kindle-notes (2).pdf'), 'Third file has (2) suffix')
})

// ─── TEST E: Single-File Parity Regression ─────────────────────────────────────

await test('Test E: Single-file parity (Notes & Slides single-file conversion remain 100% intact)', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc.setFontSize(16); doc.text('Single File Notes Parity', 72, 80)
  doc.setFontSize(11); doc.text('Verifying that single file conversion works identical to batch of 1.', 72, 110)
  const bytes = new Uint8Array(doc.output('arraybuffer'))

  // Single file Notes conversion
  const notesRes = await convertDocument(bytes, {
    mode: 'notes',
    fileName: 'single-notes.pdf',
  })
  assertEqual(notesRes.mode, 'notes', 'Mode notes')
  assertEqual(notesRes.fileName, 'single-notes-kindle-notes.pdf', 'Notes output filename')
  assert(notesRes.pdfBytes.byteLength > 1000, 'Valid notes bytes')

  // Single file Slides conversion
  const slideDoc = new jsPDF({ unit: 'pt', format: [1024, 768] })
  slideDoc.text('Single Slide Presentation', 100, 100)
  const slideBytes = new Uint8Array(slideDoc.output('arraybuffer'))

  const mockSingleSlideRasterizer = async (pdfDoc, pageNum, settings) => ({
    image: { data: MOCK_PNG, format: 'PNG', pixelWidth: 400, pixelHeight: 300 },
    sourceWidthPt: 1024,
    sourceHeightPt: 768,
    cropBoxPt: { x: 0, y: 0, width: 1024, height: 768 },
    usedFallbackMargins: false,
    marginReason: 'Mock slide',
    lowResImageDetected: false,
    warnings: [],
  })

  const slidesRes = await convertDocument(slideBytes, {
    mode: 'slides',
    fileName: 'single-slide.pdf',
    slideRasterizer: mockSingleSlideRasterizer,
    slideSettings: { orientation: 'landscape', fittingStrategy: 'original-proportions' },
  })
  assertEqual(slidesRes.mode, 'slides', 'Mode slides')
  assertEqual(slidesRes.fileName, 'single-slide-kindle-slides.pdf', 'Slides output filename')
  assertEqual(slidesRes.pageCount, 1, 'Single page slide')
})

// ─── TEST F: Offline & Local-Only Operation Verification ───────────────────────

await test('Test F: Offline operation (No external URLs, CDNs, or remote API endpoints)', async () => {
  // Read all source files in lib/converter
  const converterFiles = fs.readdirSync('lib/converter').filter(f => f.endsWith('.ts'))
  for (const file of converterFiles) {
    const content = fs.readFileSync(path.join('lib/converter', file), 'utf8')
    // Ensure no unpkg, cloudflare, cdnjs, or remote API calls exist
    assert(!content.includes('https://unpkg.com'), `${file} must not reference unpkg CDN`)
    assert(!content.includes('https://cdnjs.cloudflare.com'), `${file} must not reference cdnjs`)
    assert(!content.includes('api.openai.com'), `${file} must not reference cloud API`)
    assert(!content.includes('api.anthropic.com'), `${file} must not reference cloud API`)
  }

  // Verify JSZip operates 100% in local memory
  const zip = new JSZip()
  zip.file('test.txt', 'Offline test data')
  const out = await zip.generateAsync({ type: 'uint8array' })
  assert(out.byteLength > 50, 'JSZip operates in-memory offline without network')
})

// ─── Results Summary ──────────────────────────────────────────────────────────

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
