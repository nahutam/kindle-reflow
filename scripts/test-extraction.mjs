/**
 * KindleFlow — Test Suite for Prompt 2
 * Offline PDF Processing, Validation & Geometric Extraction
 *
 * Tests 9 distinct scenarios:
 * 1. Normal text-based PDF
 * 2. Multi-page PDF
 * 3. PDF with mathematical equations and notation
 * 4. PDF with tables and vector gridlines
 * 5. PDF with embedded images and diagrams
 * 6. Mixed text and image-only pages
 * 7. Invalid non-PDF file
 * 8. Empty file (0 bytes)
 * 9. Password-protected / encrypted PDF
 */

import { jsPDF } from 'jspdf'
import * as fs from 'fs'
import * as path from 'path'
import ts from 'typescript'

// Helper: transpile and import a local TypeScript module in Node
async function importTS(tsFilePath) {
  const code = fs.readFileSync(tsFilePath, 'utf8')
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  // Write temporary mjs to avoid import issues
  const tempPath = tsFilePath.replace(/\.ts$/, '.tmp.mjs')
  // Rewrite local relative imports from .ts or extensionless to .tmp.mjs
  const rewritten = transpiled.replace(/from\s+['"]\.\/([^'"]+)['"]/g, "from './$1.tmp.mjs'")
  fs.writeFileSync(tempPath, rewritten, 'utf8')

  try {
    const mod = await import('file://' + path.resolve(tempPath).replace(/\\/g, '/'))
    return { mod, tempPath }
  } catch (err) {
    fs.unlinkSync(tempPath)
    throw err
  }
}

// Transparent 1x1 PNG data URL for image test fixtures
const TINY_PNG_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

async function runAllTests() {
  console.log('====================================================')
  console.log('KindleFlow — Prompt 2 Test Suite: Extraction & Validation')
  console.log('====================================================\n')

  // Transpile modules in dependency order (including Prompt 3, 4 & 5 modules required by index.ts)
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

  const { validatePDF } = validatorRes.mod
  const { extractDocument } = indexRes.mod

  const cleanupTemp = () => {
    ;[
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
    ].forEach((r) => {
      try {
        fs.unlinkSync(r.tempPath)
      } catch {}
    })
  }

  let passedTests = 0
  let failedTests = 0

  function assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`)
    }
  }

  // --- Scenario 1: Normal text-based PDF ---
  try {
    console.log('Test 1: Normal Text-Based Academic PDF...')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFont('times', 'bold')
    doc.setFontSize(18)
    doc.text('Attention Is All You Need: Architecture & Methods', 54, 72)

    doc.setFont('times', 'normal')
    doc.setFontSize(11)
    const bodyParagraph =
      'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks ' +
      'that include an encoder and a decoder. The best performing models also connect the encoder and decoder through ' +
      'an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.'
    doc.text(doc.splitTextToSize(bodyParagraph, 500), 54, 110)

    const bytes = new Uint8Array(doc.output('arraybuffer'))
    const result = await extractDocument(bytes, { fileName: 'attention.pdf' })

    assert(result.pageCount === 1, `Expected 1 page, got ${result.pageCount}`)
    assert(result.pages[0].textItems.length > 0, 'No text items extracted')
    assert(result.totalCharacters > 200, `Expected > 200 characters, got ${result.totalCharacters}`)
    assert(result.pages[0].metadata.classification === 'text-rich', `Expected text-rich, got ${result.pages[0].metadata.classification}`)

    // Check sensible coordinate bounds (origin at top-left)
    const firstItem = result.pages[0].textItems[0]
    assert(firstItem.box.x >= 50 && firstItem.box.x <= 60, `X coordinate unexpected: ${firstItem.box.x}`)
    assert(firstItem.box.y >= 50 && firstItem.box.y <= 90, `Y coordinate unexpected: ${firstItem.box.y}`)
    assert(firstItem.box.width > 10, 'Width too small')
    assert(firstItem.box.height > 10, 'Height too small')
    assert(firstItem.font.size >= 17 && firstItem.font.size <= 19, `Derived font size unexpected: ${firstItem.font.size}`)

    console.log(`  ✓ Passed: ${result.totalCharacters} chars extracted, classification: ${result.pages[0].metadata.classification}`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 1:', err.message)
    failedTests += 1
  }

  // --- Scenario 2: Multi-Page PDF ---
  try {
    console.log('Test 2: Multi-Page PDF (4 Pages)...')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    for (let p = 1; p <= 4; p += 1) {
      if (p > 1) doc.addPage('letter')
      doc.setFontSize(14)
      doc.text(`Chapter ${p}: Fundamental Theorems and Proofs`, 54, 72)
      doc.setFontSize(10)
      doc.text(`Content for chapter ${p} demonstrating page flow in academic literature. Page index: ${p}.`, 54, 100)
    }

    const bytes = new Uint8Array(doc.output('arraybuffer'))
    const result = await extractDocument(bytes, { fileName: 'multipage.pdf' })

    assert(result.pageCount === 4, `Expected 4 pages, got ${result.pageCount}`)
    assert(result.pages.length === 4, `Expected 4 extracted pages, got ${result.pages.length}`)
    result.pages.forEach((page, idx) => {
      assert(page.pageNumber === idx + 1, `Page number mismatch: ${page.pageNumber}`)
      assert(page.metadata.hasExtractableText, `Page ${idx + 1} hasExtractableText is false`)
      assert(page.metadata.width === 612, `Expected 612 pt width, got ${page.metadata.width}`)
      assert(page.metadata.height === 792, `Expected 792 pt height, got ${page.metadata.height}`)
    })

    console.log(`  ✓ Passed: 4 pages extracted sequentially with exact dimensions [612, 792] pt`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 2:', err.message)
    failedTests += 1
  }

  // --- Scenario 3: Equations and Mathematical Notation ---
  try {
    console.log('Test 3: Mathematical Equations & Vector Fraction Bars...')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFontSize(12)
    doc.text('Consider the relativistic energy equation:', 54, 72)

    // Formula
    doc.setFontSize(14)
    doc.text('E = mc^2', 200, 110)

    // Fraction simulation: numerator, horizontal bar, denominator
    doc.text('df(x)', 200, 140)
    doc.setLineWidth(1)
    doc.line(195, 145, 235, 145) // Fraction bar line
    doc.text('dx', 205, 160)

    const bytes = new Uint8Array(doc.output('arraybuffer'))
    const result = await extractDocument(bytes, { fileName: 'equations.pdf' })

    assert(result.pages[0].textItems.some((t) => t.str.includes('E = mc^2')), 'Equation text missing')
    assert(result.pages[0].paths.some((p) => p.type === 'line'), 'Vector line (fraction bar) missing from paths')

    const fractionLine = result.pages[0].paths.find((p) => p.type === 'line')
    assert(fractionLine.box.y >= 130 && fractionLine.box.y <= 160, `Fraction bar Y coordinate unexpected: ${fractionLine.box.y}`)

    console.log(`  ✓ Passed: Math text extracted and vector divider line captured in paths (${result.pages[0].paths.length} vector paths)`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 3:', err.message)
    failedTests += 1
  }

  // --- Scenario 4: Tables with Gridlines ---
  try {
    console.log('Test 4: Tables and Tabular Gridlines...')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFontSize(12)
    doc.text('Table 1: Benchmark Accuracy across Architectures', 54, 72)

    // Draw table border lines
    doc.setLineWidth(1)
    doc.line(54, 90, 500, 90) // top border
    doc.line(54, 115, 500, 115) // header divider
    doc.line(54, 180, 500, 180) // bottom border

    // Headers
    doc.text('Model', 60, 107)
    doc.text('Parameters', 220, 107)
    doc.text('Top-1 Acc (%)', 380, 107)

    // Row 1
    doc.text('Transformer-Base', 60, 135)
    doc.text('65M', 220, 135)
    doc.text('84.2%', 380, 135)

    // Row 2
    doc.text('Transformer-Large', 60, 160)
    doc.text('213M', 220, 160)
    doc.text('87.6%', 380, 160)

    const bytes = new Uint8Array(doc.output('arraybuffer'))
    const result = await extractDocument(bytes, { fileName: 'table.pdf' })

    const lines = result.pages[0].paths.filter((p) => p.type === 'line')
    assert(lines.length >= 3, `Expected at least 3 horizontal lines, found ${lines.length}`)
    assert(result.pages[0].textItems.some((t) => t.str.includes('Transformer-Large')), 'Table cell text missing')

    console.log(`  ✓ Passed: Detected ${lines.length} table border lines and extracted all cell text`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 4:', err.message)
    failedTests += 1
  }

  // --- Scenario 5: Embedded Images and Diagrams ---
  try {
    console.log('Test 5: Embedded Raster Images & Diagrams...')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    doc.setFontSize(12)
    doc.text('Figure 1: Training Loss Curve over Epochs', 54, 72)

    // Embed an image at [54, 100], width: 300, height: 180
    doc.addImage(TINY_PNG_DATA, 'PNG', 54, 100, 300, 180)

    const bytes = new Uint8Array(doc.output('arraybuffer'))
    const result = await extractDocument(bytes, { fileName: 'figure.pdf' })

    assert(result.pages[0].images.length > 0, 'Image evidence not captured')
    const img = result.pages[0].images[0]
    assert(Math.abs(img.box.x - 54) < 5, `Image X coordinate mismatch: ${img.box.x}`)
    assert(Math.abs(img.box.y - 100) < 5, `Image Y coordinate mismatch: ${img.box.y}`)
    assert(Math.abs(img.box.width - 300) < 5, `Image width mismatch: ${img.box.width}`)
    assert(Math.abs(img.box.height - 180) < 5, `Image height mismatch: ${img.box.height}`)
    assert(result.pages[0].graphicsSummary.hasImages === true, 'hasImages flag is false')

    console.log(`  ✓ Passed: Captured image evidence at box [${img.box.x}, ${img.box.y}, ${img.box.width}, ${img.box.height}]`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 5:', err.message)
    failedTests += 1
  }

  // --- Scenario 6: Mixed Text and Image-Only (Scanned) Pages ---
  try {
    console.log('Test 6: Mixed Text & Image-Only Pages...')
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })

    // Page 1: Rich Text
    doc.setFontSize(12)
    const richText =
      'This is standard digital body text on page 1 of the report. Academic papers typically have multiple ' +
      'sentences introducing the core methodology, background motivation, and problem statement in detailed prose.'
    doc.text(doc.splitTextToSize(richText, 500), 54, 72)

    // Page 2: Only an image (simulating a scanned page)
    doc.addPage('letter')
    doc.addImage(TINY_PNG_DATA, 'PNG', 0, 0, 612, 792)

    const bytes = new Uint8Array(doc.output('arraybuffer'))
    const result = await extractDocument(bytes, { fileName: 'mixed-pages.pdf' })

    assert(result.pageCount === 2, `Expected 2 pages, got ${result.pageCount}`)
    const p1 = result.pages[0]
    const p2 = result.pages[1]

    assert(p1.metadata.classification === 'text-rich' || p1.metadata.classification === 'mixed', `Page 1 classification unexpected: ${p1.metadata.classification}`)
    assert(p2.metadata.classification === 'potentially-scanned', `Page 2 classification unexpected: ${p2.metadata.classification}`)
    assert(result.validation.isScannedOnly === false, 'Document should not be flagged as scanned-only when page 1 has text')
    assert(result.warnings.some((w) => w.includes('1 of 2 pages contain no extractable text')), 'Expected mixed document warning')

    console.log(`  ✓ Passed: Page 1 = ${p1.metadata.classification}, Page 2 = ${p2.metadata.classification}, handled gracefully`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 6:', err.message)
    failedTests += 1
  }

  // --- Scenario 7: Invalid Non-PDF File ---
  try {
    console.log('Test 7: Invalid Non-PDF File (Magic Byte Verification)...')
    const invalidBytes = new TextEncoder().encode('<html><body>Not a PDF document</body></html>')
    const validation = await validatePDF(invalidBytes, 'invalid.html')

    assert(validation.isValid === false, 'Invalid file marked as valid')
    assert(validation.errors.some((e) => e.code === 'INVALID_HEADER'), 'INVALID_HEADER error code missing')

    console.log(`  ✓ Passed: Rejected with error code: ${validation.errors[0].code} (${validation.errors[0].message})`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 7:', err.message)
    failedTests += 1
  }

  // --- Scenario 8: Empty File (0 Bytes) ---
  try {
    console.log('Test 8: Empty File (0 Bytes)...')
    const emptyBytes = new Uint8Array(0)
    const validation = await validatePDF(emptyBytes, 'empty.pdf')

    assert(validation.isValid === false, 'Empty file marked as valid')
    assert(validation.errors.some((e) => e.code === 'FILE_EMPTY'), 'FILE_EMPTY error code missing')

    console.log(`  ✓ Passed: Rejected with error code: ${validation.errors[0].code}`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 8:', err.message)
    failedTests += 1
  }

  // --- Scenario 9: Encrypted / Password-Protected PDF ---
  try {
    console.log('Test 9: Password-Protected / Encrypted PDF...')
    const doc = new jsPDF({
      encryption: {
        userPassword: 'secretpassword',
        ownerPassword: 'ownerpassword',
        userPermissions: ['print'],
      },
    })
    doc.text('Confidential Academic Preprint', 54, 72)
    const bytes = new Uint8Array(doc.output('arraybuffer'))

    const validation = await validatePDF(bytes, 'encrypted.pdf')

    assert(validation.isValid === false, 'Encrypted file marked as valid')
    assert(validation.isEncrypted === true, 'isEncrypted flag is false')
    assert(validation.errors.some((e) => e.code === 'PASSWORD_PROTECTED'), 'PASSWORD_PROTECTED error code missing')

    console.log(`  ✓ Passed: Handled encryption cleanly with code: ${validation.errors[0].code}`)
    passedTests += 1
  } catch (err) {
    console.error('  ✗ Failed Test 9:', err.message)
    failedTests += 1
  }

  cleanupTemp()

  console.log('\n====================================================')
  console.log(`Test Results: ${passedTests} passed, ${failedTests} failed out of 9 total scenarios.`)
  console.log('====================================================')

  if (failedTests > 0) {
    process.exit(1)
  }
}

runAllTests().catch((err) => {
  console.error('Unhandled test suite error:', err)
  process.exit(1)
})
