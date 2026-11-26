/**
 * KindleFlow — Text Fidelity & Mathematical Accuracy Test Suite
 *
 * Validates:
 * 1. Font weight/style classification (Medium != Bold, Times != Italic, bare 'bf' safety)
 * 2. Word boundary detection, kerning protection, punctuation attachment & chemical formula preservation
 * 3. Paragraph mixed-emphasis & bold lead-in isolation (no accidental 100% bold paragraphs)
 * 4. Mathematical/chemical LaTeX normalization & Unicode symbol preservation
 * 5. jsPDF text sanitization (safe encoding, no dropped minus signs or control char corruption)
 * 6. High-DPI preservation decisions for complex non-WinAnsi equations and chemical reactions
 *
 * Run: node scripts/test-text-fidelity.mjs
 */

import * as fs from 'fs'
import * as path from 'path'
import ts from 'typescript'

// ─── TypeScript Dynamic Import Helper ─────────────────────────────────────────

const tempFiles = []

async function importTS(tsFilePath) {
  const code = fs.readFileSync(tsFilePath, 'utf8')
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const tempPath = tsFilePath.replace(/\.ts$/, `.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mjs`)
  const rewritten = transpiled.replace(/from\s+['"]\.\//g, "from './").replace(
    /from\s+'\.\/([^'"]+)'/g,
    (_, p) => {
      if (p.endsWith('.mjs')) return `from './${p}'`
      if (p.endsWith('.ts')) return `from './${p.replace(/\.ts$/, '.tmp.mjs')}'`
      return `from './${p}.tmp.mjs'`
    }
  )
  fs.writeFileSync(tempPath, rewritten, 'utf8')
  tempFiles.push(tempPath)

  try {
    const fileUrl = 'file://' + path.resolve(tempPath).replace(/\\/g, '/')
    const mod = await import(fileUrl)
    return mod
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    throw err
  }
}

// ─── Assertions & Test Runner ─────────────────────────────────────────────────

let totalTests = 0
let passedTests = 0
let failedTests = 0

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`)
  }
}

async function test(name, fn) {
  totalTests++
  process.stdout.write(`  Testing: ${name}... `)
  try {
    await fn()
    passedTests++
    console.log('✓ Passed')
  } catch (err) {
    failedTests++
    console.log('✗ FAILED')
    console.error(`    ${err.message}`)
  }
}

// ─── Load Modules ─────────────────────────────────────────────────────────────

console.log('\n=============================================================')
console.log('KindleFlow — Text Fidelity & Mathematical Accuracy Suite')
console.log('=============================================================\n')

const extractorMod = await importTS('lib/converter/extractor.ts')
const lineReconstructorMod = await importTS('lib/converter/line-reconstructor.ts')
const textReflowerMod = await importTS('lib/converter/text-reflower.ts')
const pdfGenMod = await importTS('lib/converter/pdf-generator.ts')
const regionPreserverMod = await importTS('lib/converter/region-preserver.ts')
const classifierMod = await importTS('lib/converter/classifier.ts')

const { deriveFontInfo } = extractorMod
const { shouldInsertSpace } = lineReconstructorMod
const { cleanMathAndTypography, reflowTextBlock, createFallbackTextMeasurer } = textReflowerMod
const { sanitizeTextForJsPDF } = pdfGenMod
const { planSingleBlock, computeRegionFit } = regionPreserverMod

const IDENTITY_TRANSFORM = [12, 0, 0, 12, 0, 0]

// ─── Suite 1: Font Weight & Style Classification ─────────────────────────────

console.log('--- Suite 1: Font Weight & Style Classification ---')

await test('1.1 Times New Roman regular is neither bold nor italic', () => {
  const font = deriveFontInfo('TimesNewRomanPSMT', IDENTITY_TRANSFORM, 12)
  assertEqual(font.isBold, false, 'TimesNewRomanPSMT should not be bold')
  assertEqual(font.isItalic, false, 'TimesNewRomanPSMT must NOT match italic (no false positive on "ti")')
  assertEqual(font.isSerif, true, 'TimesNewRomanPSMT should be serif')
})

await test('1.2 Times New Roman Italic is correctly classified as italic', () => {
  const font = deriveFontInfo('TimesNewRomanPS-ItalicMT', IDENTITY_TRANSFORM, 12)
  assertEqual(font.isBold, false, 'TimesNewRomanPS-ItalicMT should not be bold')
  assertEqual(font.isItalic, true, 'TimesNewRomanPS-ItalicMT should be italic')
  assertEqual(font.isSerif, true, 'TimesNewRomanPS-ItalicMT should be serif')
})

await test('1.3 Times New Roman Bold is correctly classified as bold', () => {
  const font = deriveFontInfo('TimesNewRomanPS-BoldMT', IDENTITY_TRANSFORM, 12)
  assertEqual(font.isBold, true, 'TimesNewRomanPS-BoldMT should be bold')
  assertEqual(font.isItalic, false, 'TimesNewRomanPS-BoldMT should not be italic')
})

await test('1.4 Arial Medium is NOT classified as bold', () => {
  const font = deriveFontInfo('Arial-Medium', IDENTITY_TRANSFORM, 12)
  assertEqual(font.isBold, false, 'Arial-Medium is weight 500 and must NOT be bold')
  assertEqual(font.isSerif, false, 'Arial-Medium should be sans-serif (isSerif: false)')
})

await test('1.5 Arial Bold is classified as bold', () => {
  const font = deriveFontInfo('Arial-BoldMT', IDENTITY_TRANSFORM, 12)
  assertEqual(font.isBold, true, 'Arial-BoldMT should be bold')
})

await test('1.6 Computer Modern Roman (CMR10) is regular body font', () => {
  const font = deriveFontInfo('CMR10', IDENTITY_TRANSFORM, 10)
  assertEqual(font.isBold, false, 'CMR10 should not be bold')
  assertEqual(font.isItalic, false, 'CMR10 should not be italic')
  assertEqual(font.isSerif, true, 'CMR10 should be serif')
})

await test('1.7 Computer Modern Bold Extended (CMBX10) is classified as bold', () => {
  const font = deriveFontInfo('CMBX10', IDENTITY_TRANSFORM, 10)
  assertEqual(font.isBold, true, 'CMBX10 should be bold')
  assertEqual(font.isItalic, false, 'CMBX10 should not be italic')
})

await test('1.8 AbstractFallback font name does not falsely trigger bold on "bf"', () => {
  const font = deriveFontInfo('AbstractFallback', IDENTITY_TRANSFORM, 12)
  assertEqual(font.isBold, false, 'AbstractFallback has "bf" substring but must not be bold')
})

// ─── Suite 2: Spacing & Punctuation & Chemical Formulas ──────────────────────

console.log('\n--- Suite 2: Spacing, Kerning & Chemical Formula Protection ---')

function makeItem(str, x, width, baselineY = 100, fontSize = 10) {
  return {
    str,
    box: { x, y: 100 - fontSize, width, height: fontSize },
    font: {
      name: 'TimesNewRoman',
      family: 'TimesNewRoman',
      size: fontSize,
      isBold: false,
      isItalic: false,
      isMonospace: false,
      isSerif: true,
    },
    baselineX: x,
    baselineY,
    rotation: 0,
    pageNumber: 1,
    itemIndex: 0,
  }
}

await test('2.1 Inter-word genuine gap receives a space', () => {
  const prev = makeItem('Inorganic', 10, 50)
  const cur = makeItem('compounds', 64, 55) // gap = 4.0pt > min threshold 2.2pt
  assert(shouldInsertSpace(prev, cur, 'Inorganic'), 'Real word boundary gap must receive space')
})

await test('2.2 Attached closing punctuation (comma, period) never receives leading space', () => {
  const prev = makeItem('compounds', 10, 50)
  const curComma = makeItem(',', 62, 5) // even if gap is 2pt
  assert(!shouldInsertSpace(prev, curComma, 'compounds'), 'Comma must attach directly to word without space')

  const curPeriod = makeItem('.', 62, 5)
  assert(!shouldInsertSpace(prev, curPeriod, 'compounds'), 'Period must attach directly to word without space')
})

await test('2.3 Attached opening delimiter (parenthesis, bracket) never inserts space after it', () => {
  const prevOpenParen = makeItem('(', 10, 5)
  const curBody = makeItem('aq', 18, 12)
  assert(!shouldInsertSpace(prevOpenParen, curBody, '('), 'Opening parenthesis must attach to inner content without space')
})

await test('2.4 Connecting hyphen in compound word is protected against extra space', () => {
  const prevHyphen = makeItem('acid-', 10, 25)
  const curBase = makeItem('base', 38, 22)
  assert(!shouldInsertSpace(prevHyphen, curBase, 'acid-'), 'Compound word hyphen must not get space after hyphen')
})

await test('2.5 Chemical formula subscripts are protected (CO2, H2O)', () => {
  // C + O + 2
  const itemC = makeItem('C', 10, 7)
  const itemO = makeItem('O', 17, 8)
  const item2 = makeItem('2', 25.5, 5, 98, 7.5) // subscript 2 slightly lowered, 7.5pt
  assert(!shouldInsertSpace(itemC, itemO, 'C'), 'C and O in CO2 must not be separated')
  assert(!shouldInsertSpace(itemO, item2, 'CO'), 'O and 2 in CO2 must not be separated')
})

await test('2.6 Fragmented characters with kerning under 2pt do not split words', () => {
  const prevFrag = makeItem('sub', 10, 18)
  const curFrag = makeItem('stance', 28.5, 30) // gap = 0.5pt (tight kerning)
  assert(!shouldInsertSpace(prevFrag, curFrag, 'sub'), 'Fragmented glyphs with kerning under 2pt must not insert space')
})

// ─── Suite 3: Paragraph Mixed Emphasis & Bold Lead-Ins ───────────────────────

console.log('\n--- Suite 3: Paragraph Mixed-Emphasis & Bold Lead-Ins ---')

await test('3.1 Leading bold definition label does not turn entire paragraph bold', () => {
  const boldFont = {
    name: 'Times-Bold',
    family: 'Times',
    size: 11,
    isBold: true,
    isItalic: false,
    isMonospace: false,
    isSerif: true,
  }
  const regularFont = {
    name: 'Times-Roman',
    family: 'Times',
    size: 11,
    isBold: false,
    isItalic: false,
    isMonospace: false,
    isSerif: true,
  }

  const block = {
    id: 'b1',
    pageNumber: 1,
    type: 'paragraph',
    text: 'Defn: Inorganic compounds are substances that typically lack carbon-hydrogen bonds and are studied in inorganic chemistry.',
    confidence: 'high',
    box: { x: 54, y: 100, width: 450, height: 40 },
    lines: [
      {
        text: 'Defn: Inorganic compounds are substances that typically lack carbon-hydrogen bonds and are studied in inorganic chemistry.',
        baselineY: 112,
        box: { x: 54, y: 100, width: 450, height: 40 },
        items: [
          { str: 'Defn:', box: { x: 54, y: 100, width: 30, height: 11 }, font: boldFont, baselineX: 54, baselineY: 112, rotation: 0, pageNumber: 1, itemIndex: 0 },
          { str: ' Inorganic compounds are substances that typically lack carbon-hydrogen bonds and are studied in inorganic chemistry.', box: { x: 86, y: 100, width: 418, height: 11 }, font: regularFont, baselineX: 86, baselineY: 112, rotation: 0, pageNumber: 1, itemIndex: 1 },
        ],
      },
    ],
    readingOrder: 0,
    associatedPaths: [],
    associatedImages: [],
    preserveAsImage: false,
  }

  const settings = {
    pageWidth: 432,
    pageHeight: 576,
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
    bodyFontSize: 11,
    headingFontSize: 16,
    subheadingFontSize: 13,
    captionFontSize: 9,
    codeFontSize: 9.5,
    lineSpacing: 1.25,
    paragraphSpacing: 8,
    headingSpacingBefore: 14,
    headingSpacingAfter: 6,
    listIndent: 16,
    preserveFigures: true,
    preserveTables: true,
    preserveEquations: true,
    minScaleRatio: 0.6,
    includeRunningHeaders: false,
  }

  const plan = reflowTextBlock(block, {
    availableWidth: 360,
    settings,
    measurer: createFallbackTextMeasurer(),
  })

  // Paragraph base font weight must remain normal
  assert(plan.lines.length > 0, 'Should have reflowed lines')
  assertEqual(plan.lines[0].font.weight, 'normal', 'Paragraph base font weight must be normal, not bold')

  // The first line must have spans preserving the bold label
  const firstLine = plan.lines[0]
  assert(firstLine.spans !== undefined && firstLine.spans.length >= 2, 'First line must have spans for mixed emphasis')
  assertEqual(firstLine.spans[0].text.trim(), 'Defn:', 'First span text should be Defn:')
  assertEqual(firstLine.spans[0].font.weight, 'bold', 'First span must be bold')
  assertEqual(firstLine.spans[1].font.weight, 'normal', 'Second span must be normal weight')
})

// ─── Suite 4: Mathematical Normalization & Unicode Preservation ───────────────

console.log('\n--- Suite 4: Mathematical Normalization & Unicode Preservation ---')

await test('4.1 LaTeX superscript {x^2} and {10^{-14}} converted accurately to Unicode superscripts', () => {
  const result1 = cleanMathAndTypography('x^{2} + y^{2} = z^{2}')
  assertEqual(result1, 'x² + y² = z²', 'x^{2} must convert to x²')

  const result2 = cleanMathAndTypography('K_w = 1.0 \\times 10^{-14}')
  assert(result2.includes('10⁻¹⁴'), '10^{-14} must convert to 10⁻¹⁴ (not subscript!)')
  assert(result2.includes('×'), '\\times must convert to ×')
})

await test('4.2 Chemical reactions with LaTeX arrows convert to proper Unicode arrows', () => {
  const rxn1 = cleanMathAndTypography('CO_2 + H_2O \\rightarrow H_2CO_3')
  assertEqual(rxn1, 'CO₂ + H₂O → H₂CO₃', '\\rightarrow and _2 must convert to → and ₂')

  const rxn2 = cleanMathAndTypography('CH_3COOH \\rightleftharpoons H^+ + CH_3COO^-')
  assertEqual(rxn2, 'CH₃COOH ⇌ H⁺ + CH₃COO⁻', '\\rightleftharpoons and signs must convert accurately')
})

await test('4.3 jsPDF text sanitizer safely preserves minus and dashes without control characters', () => {
  const input = 'Change in enthalpy: \u2212285.8 kJ/mol \u2014 exothermic.'
  const sanitized = sanitizeTextForJsPDF(input)
  assertEqual(sanitized, 'Change in enthalpy: -285.8 kJ/mol -- exothermic.', 'U+2212 and U+2014 must be sanitized to ASCII equivalents')
})

// ─── Suite 5: Complex Equation High-DPI Preservation Decision ─────────────────

console.log('\n--- Suite 5: Complex Equation High-DPI Preservation Decision ---')

await test('5.1 Multi-line or spatial equation with integral/sum is preserved as high-DPI region', () => {
  const block = {
    id: 'eq1',
    pageNumber: 1,
    type: 'equation',
    text: '∫_0^∞ e^{-x^2} dx = √π / 2',
    confidence: 'high',
    box: { x: 100, y: 200, width: 250, height: 35 },
    lines: [
      {
        text: '∫_0^∞ e^{-x^2} dx = √π / 2',
        baselineY: 220,
        box: { x: 100, y: 200, width: 250, height: 35 },
        items: [],
      },
    ],
    readingOrder: 1,
    associatedPaths: [],
    associatedImages: [],
    preserveAsImage: false,
  }

  const settings = {
    pageWidth: 432,
    pageHeight: 576,
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
    bodyFontSize: 11,
    headingFontSize: 16,
    subheadingFontSize: 13,
    captionFontSize: 9,
    codeFontSize: 9.5,
    lineSpacing: 1.25,
    paragraphSpacing: 8,
    headingSpacingBefore: 14,
    headingSpacingAfter: 6,
    listIndent: 16,
    preserveFigures: true,
    preserveTables: true,
    preserveEquations: true,
    minScaleRatio: 0.6,
    includeRunningHeaders: false,
  }

  const planned = planSingleBlock(block, 360, 504, settings, createFallbackTextMeasurer())
  assert(planned !== null, 'Plan should not be null')
  assertEqual(planned.kind, 'preserved-region', 'Complex spatial equation must be preserved as high-DPI region')
  if (planned.kind === 'preserved-region') {
    assertEqual(planned.plan.preservationReason, 'equation-spatial', 'Reason must be equation-spatial')
  }
})

await test('5.2 Chemical equilibrium reaction with non-WinAnsi equilibrium arrows is preserved as region', () => {
  const block = {
    id: 'eq2',
    pageNumber: 1,
    type: 'equation',
    text: '2NO2(g) ⇌ N2O4(g)',
    confidence: 'high',
    box: { x: 100, y: 300, width: 200, height: 25 },
    lines: [
      {
        text: '2NO2(g) ⇌ N2O4(g)',
        baselineY: 315,
        box: { x: 100, y: 300, width: 200, height: 25 },
        items: [],
      },
    ],
    readingOrder: 2,
    associatedPaths: [],
    associatedImages: [],
    preserveAsImage: false,
  }

  const settings = {
    pageWidth: 432,
    pageHeight: 576,
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
    bodyFontSize: 11,
    headingFontSize: 16,
    subheadingFontSize: 13,
    captionFontSize: 9,
    codeFontSize: 9.5,
    lineSpacing: 1.25,
    paragraphSpacing: 8,
    headingSpacingBefore: 14,
    headingSpacingAfter: 6,
    listIndent: 16,
    preserveFigures: true,
    preserveTables: true,
    preserveEquations: true,
    minScaleRatio: 0.6,
    includeRunningHeaders: false,
  }

  const planned = planSingleBlock(block, 360, 504, settings, createFallbackTextMeasurer())
  assert(planned !== null, 'Plan should not be null')
  assertEqual(planned.kind, 'preserved-region', 'Equilibrium arrow equation must be preserved as region to prevent symbol loss')
})

// ─── Cleanup ──────────────────────────────────────────────────────────────────

for (const f of tempFiles) {
  try {
    if (fs.existsSync(f)) fs.unlinkSync(f)
  } catch {}
}

console.log('\n=============================================================')
console.log(`Fidelity Results: ${passedTests} passed, ${failedTests} failed out of ${totalTests} tests.`)
console.log('=============================================================\n')

if (failedTests > 0) {
  process.exit(1)
}
