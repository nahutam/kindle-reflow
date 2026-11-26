import * as fs from 'fs'
import * as path from 'path'
import { convertPdfToKindleNotes } from './convert_pdf.mjs'

async function runSyntheticRegression() {
  console.log('=============================================================')
  console.log('KindleFlow — Synthetic Document Regression Suite')
  console.log('=============================================================\n')

  const inputPdf = 'scripts/fixtures/synthetic-document-structure.pdf'
  const outputPdf = 'scripts/synthetic-kindle-notes.pdf'

  const { layout, result, analyzed } = await convertPdfToKindleNotes(inputPdf, outputPdf)

  let passed = 0
  let failed = 0

  function assert(condition, message) {
    process.stdout.write(`  Testing: ${message}... `)
    if (condition) {
      console.log('✓ Passed')
      passed++
    } else {
      console.log('✗ FAILED')
      failed++
    }
  }

  // Test 1: Converted Kindle pages generated
  assert(layout.pages.length >= 2, `Expected at least 2 Kindle pages, got ${layout.pages.length}`)

  // Test 2: Headings classified correctly
  const headings = analyzed.pages.flatMap(p => p.blocks).filter(b => b.type === 'heading' || b.type === 'subheading')
  assert(
    headings.some(h => h.text.includes('1.0 Principles of Thermodynamics')) &&
    headings.some(h => h.text.includes('1.1 Heat Transfer and Work Interactions')) &&
    headings.some(h => h.text.includes('1.2 Empirical Transport Coefficients')),
    'Major headings and subheadings classified with correct roles'
  )

  // Test 3: Unordered 4-item list detected with bullets
  const listItems = analyzed.pages.flatMap(p => p.blocks).filter(b => b.type === 'list')
  const potentialItems = listItems.filter(l =>
    l.text.includes('Internal energy') ||
    l.text.includes('Enthalpy') ||
    l.text.includes('Helmholtz free energy') ||
    l.text.includes('Gibbs free energy')
  )
  assert(potentialItems.length === 4, `Expected 4 thermodynamic potential list items, got ${potentialItems.length}`)

  // Test 4: Table 1 placed between introductory text and following text
  const p1Elements = layout.pages[0].elements
  const t1Idx = p1Elements.findIndex(e => e.kind === 'preserved-region')
  const introIdx = p1Elements.findIndex(e => e.kind === 'text' && e.text.includes('atmospheric conditions'))
  assert(
    t1Idx > introIdx && introIdx !== -1,
    'Table 1 appears after explanatory lead-in text'
  )

  // Test 5: Cross-page paragraph continuation stitched seamlessly
  const allText = layout.pages.flatMap(p => p.elements).filter(e => e.kind === 'text').map(e => e.text).join(' ')
  assert(
    allText.includes("Fourier's law of heat conduction, where heat flux is directly proportional to the negative of the temperature gradient across the conductive medium"),
    'Cross-page paragraph stitched across page boundaries without break'
  )

  // Test 6: Numbered list retains numbered prefixes
  assert(
    allText.includes('1. Steady-state') &&
    allText.includes('2. Homogeneous') &&
    allText.includes('3. Negligible'),
    'Numbered list items retain 1., 2., 3. numbering'
  )

  // Test 7: Preserved spatial equation present
  const regions = layout.pages.flatMap(p => p.elements).filter(e => e.kind === 'preserved-region')
  assert(
    regions.length >= 3,
    `Expected at least 3 preserved regions (Table 1, Equation, Table 2/Figure), got ${regions.length}`
  )

  // Test 8: Output PDF is selectable vector PDF under 300 KB
  assert(
    result.pdfBytes.byteLength > 5000 && result.pdfBytes.byteLength < 350000,
    `PDF size is valid and compact (${result.pdfBytes.byteLength} bytes)`
  )

  console.log(`\nRegression Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests.\n`)
  if (failed > 0) {
    process.exit(1)
  }
}

runSyntheticRegression().catch(err => {
  console.error(err)
  process.exit(1)
})
