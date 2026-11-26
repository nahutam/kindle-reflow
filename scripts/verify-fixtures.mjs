/**
 * KindleFlow — Real-World Fixture Verification Suite
 * Audit Step 5: Verify output quality across 9 representative synthetic document types:
 *
 * 1. Normal academic notes page
 * 2. Page with equations and fractions
 * 3. Bordered table
 * 4. Two-column document
 * 5. Landscape lecture slide
 * 6. Portrait lecture slide
 * 7. Slide with large blank margins (smart margin trimming)
 * 8. Slide with non-uniform/gradient background (safe fallback)
 * 9. Slide with small text and diagrams
 *
 * Run: node scripts/verify-fixtures.mjs
 */

import { jsPDF } from 'jspdf'
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
console.log('KindleFlow — Real-World Fixtures & Visual Quality Audit')
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
  convertNotesDocument,
  convertSlidesToPDF,
  convertDocument,
  detectSafeMarginsFromPixels,
  computeSlideDestinationBox,
  KINDLE_SLIDE_DISPLAY_LANDSCAPE,
  KINDLE_SLIDE_DISPLAY_PORTRAIT,
} = indexRes.mod

// 1x1 PNG data URL for headless node testing
const MOCK_PNG_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let passed = 0
let failed = 0
const failures = []

async function verifyFixture(name, fn) {
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'Assertion failed')
}

function assertEqual(act, exp, lbl = '') {
  if (act !== exp) {
    throw new Error(`${lbl}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`)
  }
}

// ─── 1. Academic Notes Page ───────────────────────────────────────────────────
await verifyFixture('1. Normal Academic Notes Page (Selectable text & Heading spacing)', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc.setFontSize(22)
  doc.text('1. Introduction to Quantum Complexity', 72, 80)
  doc.setFontSize(11)
  doc.text(
    'Computational complexity theory provides a formal mathematical framework for classifying decision problems according to the resource requirements needed to solve them on quantum computers versus classical Turing machines.',
    72,
    120,
    { maxWidth: 450 },
  )
  doc.text(
    'In this survey we review the BQP complexity class, quantum query lower bounds, and phase estimation techniques for Hamiltonian simulation.',
    72,
    175,
    { maxWidth: 450 },
  )

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const res = await convertNotesDocument(pdfBytes, { fileName: 'academic-notes.pdf' })

  assertEqual(res.mode, 'notes', 'Mode must be notes')
  assert(res.pageCount >= 1, 'At least 1 page generated')
  assert(res.layoutDocument !== undefined, 'Layout document produced')

  // Inspect page dimensions and verify selectable text in byte stream
  const p1 = res.layoutDocument.pages[0]
  assertEqual(p1.width, 432, 'Page width 432 pt')
  assertEqual(p1.height, 576, 'Page height 576 pt')

  const pdfStr = Buffer.from(res.pdfBytes).toString('latin1')
  assert(pdfStr.includes('Introduction to Quantum Complexity'), 'Heading is selectable in output PDF')
  assert(pdfStr.includes('Turing machines'), 'Body text is selectable in output PDF')
})

// ─── 2. Page with Equations & Fractions ───────────────────────────────────────
await verifyFixture('2. Page with Equations and Fractions (Coherent region preservation)', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc.setFontSize(16)
  doc.text('Euler-Lagrange Equation of Motion', 72, 80)
  doc.setFontSize(11)
  doc.text('The action integral is minimized along the physical trajectory:', 72, 110)

  // Equation with math symbols and fraction bar
  doc.setFontSize(13)
  doc.text('S = ∫_a^b L(q, q_dot, t) dt', 200, 150)
  doc.line(200, 155, 380, 155) // fraction bar

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))

  // Use mock crop renderer to verify coordinate extraction
  let cropCalled = false
  let capturedBox = null
  const mockCrop = async (pdf, srcPage, srcBox) => {
    cropCalled = true
    capturedBox = srcBox
    return { data: MOCK_PNG_DATA, format: 'PNG', pixelWidth: 100, pixelHeight: 40 }
  }

  const res = await convertNotesDocument(pdfBytes, {
    fileName: 'equations.pdf',
    regionRenderer: mockCrop,
  })

  assert(res.pageCount >= 1, 'Equations page generated')
  const regions = res.layoutDocument.pages.flatMap(p => p.elements).filter(e => e.kind === 'preserved-region')
  assert(regions.length >= 1, 'Equation preserved as coherent region')
  assertEqual(regions[0].regionType, 'equation', 'Region type equation')
  assert(cropCalled, 'Region crop renderer called')
  assert(capturedBox.width > 0 && capturedBox.height > 0, 'Valid source bounding box passed to crop renderer')
})

// ─── 3. Bordered Table ────────────────────────────────────────────────────────
await verifyFixture('3. Bordered Table (Structure preserved, no arbitrary splitting)', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc.setFontSize(14)
  doc.text('Table 1: Benchmark Accuracies on ImageNet', 72, 80)
  // Draw 3 horizontal lines and columns
  doc.line(72, 100, 480, 100)
  doc.text('Model        Top-1 Acc    Top-5 Acc    Parameters', 75, 115)
  doc.line(72, 122, 480, 122)
  doc.text('ResNet-50    76.1%        92.9%        25.6M', 75, 137)
  doc.text('ViT-B/16     81.8%        95.8%        86.6M', 75, 155)
  doc.line(72, 165, 480, 165)

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const mockCrop = async () => ({ data: MOCK_PNG_DATA, format: 'PNG', pixelWidth: 400, pixelHeight: 80 })

  const res = await convertNotesDocument(pdfBytes, {
    fileName: 'table.pdf',
    regionRenderer: mockCrop,
  })

  const tables = res.layoutDocument.pages.flatMap(p => p.elements).filter(e => e.kind === 'preserved-region' && e.regionType === 'table')
  assert(tables.length >= 1, 'Bordered table preserved as intact region')
  assertEqual(tables[0].preservationReason, 'table-structure', 'Preservation reason')
})

// ─── 4. Two-Column Academic Document ──────────────────────────────────────────
await verifyFixture('4. Two-Column Document (Reflows into correct single-column reading order)', async () => {
  const doc = new jsPDF({ unit: 'pt', format: [612, 792] })
  doc.setFontSize(18)
  doc.text('Full-Width Title Above Columns', 72, 80)

  doc.setFontSize(10)
  // Left and right columns with sufficient vertical overlap
  for (let i = 0; i < 12; i++) {
    doc.text(`Left column paragraph item ${i + 1} content text here.`, 60, 120 + i * 20)
    doc.text(`Right column paragraph item ${i + 1} content text here.`, 330, 120 + i * 20)
  }

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const res = await convertNotesDocument(pdfBytes, { fileName: 'twocol.pdf' })

  const textElements = res.layoutDocument.pages
    .flatMap(p => p.elements)
    .filter(e => e.kind === 'text')
  const fullText = textElements.map(e => e.text).join('\n')

  const left1 = fullText.indexOf('Left column paragraph item 1 content')
  const leftLast = fullText.indexOf('Left column paragraph item 12 content')
  const right1 = fullText.indexOf('Right column paragraph item 1 content')
  const rightLast = fullText.indexOf('Right column paragraph item 12 content')

  assert(left1 >= 0 && leftLast >= 0 && right1 >= 0 && rightLast >= 0, 'All column text present in layout')
  assert(leftLast < right1, `Reading order preserved: Left column (${leftLast}) precedes Right column (${right1})`)

  const pdfStr = Buffer.from(res.pdfBytes).toString('latin1')
  assert(pdfStr.includes('Full-Width Title Above Columns'), 'Title in output PDF')
  assert(pdfStr.includes('Left column paragraph item 1'), 'Left column in output PDF')
  assert(pdfStr.includes('Right column paragraph item 1'), 'Right column in output PDF')
})

// ─── 5. Landscape Lecture Slide ───────────────────────────────────────────────
await verifyFixture('5. Landscape Lecture Slide (Maintains 4:3 Kindle aspect ratio, no reflow)', async () => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [720, 540] })
  doc.setFontSize(28)
  doc.text('Lecture 5: Neural Attention Mechanisms', 72, 100)
  doc.setFontSize(14)
  doc.text('• Self-attention computes soft alignment over sequence tokens.', 72, 160)
  doc.text('• Queries, keys, and values are linear projections.', 72, 200)

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const mockRasterizer = async () => ({
    image: { data: MOCK_PNG_DATA, format: 'PNG', pixelWidth: 720, pixelHeight: 540 },
    sourceWidthPt: 720,
    sourceHeightPt: 540,
    cropBoxPt: { x: 0, y: 0, width: 720, height: 540 },
    usedFallbackMargins: false,
    marginReason: 'Landscape slide',
    lowResImageDetected: false,
    warnings: [],
  })

  const res = await convertSlidesToPDF(pdfBytes, {
    fileName: 'lecture-slide.pdf',
    pageRasterizer: mockRasterizer,
  })

  assertEqual(res.mode, 'slides', 'Mode slides')
  assertEqual(res.pageCount, 1, 'Exactly 1 output page per source slide')
  // Usable area is 556 x 412 pt. Limiting dimension for 720x540 (4:3) is height: 412 * (720/540) = 549.33 pt
  assert(Math.abs(res.slidePages[0].destBoxPt.width - 549.33) < 0.5, 'Width fits 4:3 target bounds')
  assertEqual(res.slidePages[0].destBoxPt.height, 412, 'Height fills usable height')
  const destRatio = res.slidePages[0].destBoxPt.width / res.slidePages[0].destBoxPt.height
  const srcRatio = 720 / 540
  assert(Math.abs(destRatio - srcRatio) < 0.01, 'Aspect ratio unaltered (4:3)')
})

// ─── 6. Portrait Lecture Slide ────────────────────────────────────────────────
await verifyFixture('6. Portrait Lecture Slide (Scaled and centered without stretching)', async () => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [540, 720] })
  doc.setFontSize(24)
  doc.text('Portrait Infographic Slide', 50, 100)

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const mockRasterizer = async () => ({
    image: { data: MOCK_PNG_DATA, format: 'PNG', pixelWidth: 540, pixelHeight: 720 },
    sourceWidthPt: 540,
    sourceHeightPt: 720,
    cropBoxPt: { x: 0, y: 0, width: 540, height: 720 },
    usedFallbackMargins: false,
    marginReason: 'Portrait slide',
    lowResImageDetected: false,
    warnings: [],
  })

  const res = await convertSlidesToPDF(pdfBytes, {
    fileName: 'portrait-slide.pdf',
    pageRasterizer: mockRasterizer,
  })

  assertEqual(res.pageCount, 1, '1 output page')
  const dest = res.slidePages[0].destBoxPt
  assert(dest.x > KINDLE_SLIDE_DISPLAY_LANDSCAPE.paddingPt + 50, 'Horizontally centered with side space')
  const ratio = dest.width / dest.height
  assert(Math.abs(ratio - 540 / 720) < 0.01, 'Portrait aspect ratio preserved perfectly')
})

// ─── 7. Slide with Large Blank Margins ────────────────────────────────────────
await verifyFixture('7. Slide with Large Blank Margins (Smart margin adjustment trims safely)', async () => {
  const W = 200
  const H = 150
  const rgba = new Uint8ClampedArray(W * H * 4)
  rgba.fill(255) // White background

  // 40pt blank margin on all sides, content in [40, 30, 120, 90]
  for (let y = 30; y < 120; y++) {
    for (let x = 40; x < 160; x++) {
      const idx = (y * W + x) * 4
      rgba[idx] = 10
      rgba[idx + 1] = 10
      rgba[idx + 2] = 10
    }
  }

  const crop = detectSafeMarginsFromPixels(rgba, W, H, W, H, 1.0)
  assertEqual(crop.usedFallback, false, 'Smart margin trimmed confirmed padding')
  assert(crop.x < 40 && crop.x >= 34, `Safety padding kept: x=${crop.x}`)
  assert(crop.width < W && crop.width >= 120, `Trimmed width: ${crop.width}`)
})

// ─── 8. Slide with Non-Uniform / Gradient Background ──────────────────────────
await verifyFixture('8. Slide with Gradient Background (Safe fallback prevents content clipping)', async () => {
  const W = 100
  const H = 100
  const rgba = new Uint8ClampedArray(W * H * 4)
  // Simulate diagonal gradient
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4
      rgba[idx] = Math.round((x / W) * 255)
      rgba[idx + 1] = Math.round((y / H) * 255)
      rgba[idx + 2] = 200
    }
  }

  const crop = detectSafeMarginsFromPixels(rgba, W, H, 600, 450, 1.0)
  assertEqual(crop.usedFallback, true, 'Non-uniform background triggers fallback')
  assertEqual(crop.width, 600, 'Full original width preserved')
  assertEqual(crop.height, 450, 'Full original height preserved')
})

// ─── 9. Slide with Diagrams and Small Text ────────────────────────────────────
await verifyFixture('9. Slide with Diagrams and Small Text (Lossless PNG, 300 DPI scaling)', async () => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [720, 540] })
  doc.setFontSize(18)
  doc.text('Circuit Diagram & Timing Analysis', 50, 50)
  doc.rect(50, 70, 620, 420) // diagram border
  doc.setFontSize(8)
  doc.text('CLK_OUT = 125 MHz ± 10 ppm; t_setup = 1.2 ns; t_hold = 0.8 ns', 60, 470)

  const pdfBytes = new Uint8Array(doc.output('arraybuffer'))
  const mockRasterizer = async (pdf, pageNum, settings) => {
    assertEqual(settings.imageFormat, 'PNG', 'Uses lossless PNG format')
    assertEqual(settings.targetDpi, 300, 'Uses high-resolution 300 DPI')
    return {
      image: { data: MOCK_PNG_DATA, format: 'PNG', pixelWidth: 720, pixelHeight: 540 },
      sourceWidthPt: 720,
      sourceHeightPt: 540,
      cropBoxPt: { x: 50, y: 50, width: 620, height: 440 },
      usedFallbackMargins: false,
      marginReason: 'Diagram slide',
      lowResImageDetected: false,
      warnings: [],
    }
  }

  const res = await convertSlidesToPDF(pdfBytes, {
    fileName: 'timing-diagram.pdf',
    pageRasterizer: mockRasterizer,
  })

  assertEqual(res.pageCount, 1, '1 output page')
  assert(res.pdfBytes.byteLength > 1000, 'Valid PDF produced')
})

console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} fixtures.`)

if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.error}`)
}

cleanup()
process.exit(failed > 0 ? 1 : 0)
