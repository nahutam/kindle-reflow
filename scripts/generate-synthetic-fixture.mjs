import * as fs from 'fs'
import * as path from 'path'
import { jsPDF } from 'jspdf'

export function createSyntheticDocumentFixture(outputPath) {
  // Create standard Letter / A4 portrait PDF (612 x 792 pt)
  const doc = new jsPDF({
    unit: 'pt',
    format: [612, 792],
  })

  // ─── PAGE 1 ──────────────────────────────────────────────────────────────
  // Title & Major Heading
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('Advanced Physical Chemistry Notes', 54, 60)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('1.0 Principles of Thermodynamics', 54, 95)

  // Subheading 1.1
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('1.1 Heat Transfer and Work Interactions', 54, 125)

  // Paragraph 1
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  const p1 = 'Thermodynamics governs the principles of energy transformation and equilibrium in physical systems. The first law establishes conservation of energy, while the second law defines the spontaneous direction of physical and chemical processes through increasing entropy.'
  doc.text(doc.splitTextToSize(p1, 500), 54, 145)

  // Paragraph 2
  const p2 = 'Energy transfer across boundaries occurs either through heat flow or macroscopic mechanical work. System efficiency is strictly constrained by reversible Carnot limits.'
  doc.text(doc.splitTextToSize(p2, 500), 54, 185)

  // Unordered list lead-in & 4 bullet items
  doc.text('The four thermodynamic potentials essential for characterizing equilibrium states are:', 54, 220)
  
  const bullets = [
    'Internal energy (U), representing microscopic kinetic and potential energy states.',
    'Enthalpy (H), accounting for internal energy plus the pressure-volume product work.',
    'Helmholtz free energy (A), measuring extractable work at constant temperature and volume.',
    'Gibbs free energy (G), determining chemical reaction spontaneity at constant pressure.',
  ]
  let yBullet = 240
  for (const b of bullets) {
    // Draw vector bullet circle
    doc.setFillColor(30, 30, 30)
    doc.circle(60, yBullet - 3, 2, 'F')
    const lines = doc.splitTextToSize(b, 480)
    doc.text(lines, 70, yBullet)
    yBullet += lines.length * 14 + 4
  }

  // Paragraph leading into Table 1
  const pBeforeTable1 = 'The comparison of thermodynamic state variables under standard atmospheric conditions is summarized below:'
  doc.text(doc.splitTextToSize(pBeforeTable1, 500), 54, yBullet + 10)

  // Table 1 (3 columns x 4 rows) with explicit vector grid lines
  const t1Y = yBullet + 35
  const colWidths = [150, 175, 175]
  const rowHeight = 22
  const t1Rows = [
    ['State Variable', 'Symbol', 'SI Unit'],
    ['Temperature', 'T', 'Kelvin (K)'],
    ['Pressure', 'P', 'Pascal (Pa)'],
    ['Molar Volume', 'Vm', 'm^3 / mol'],
  ]

  // Draw table header background
  doc.setFillColor(240, 240, 240)
  doc.rect(54, t1Y, 500, rowHeight, 'F')

  // Draw borders
  doc.setDrawColor(180, 180, 180)
  doc.setLineWidth(0.8)
  for (let r = 0; r <= 4; r++) {
    doc.line(54, t1Y + r * rowHeight, 554, t1Y + r * rowHeight)
  }
  let currX = 54
  doc.line(currX, t1Y, currX, t1Y + 4 * rowHeight)
  for (const w of colWidths) {
    currX += w
    doc.line(currX, t1Y, currX, t1Y + 4 * rowHeight)
  }

  // Draw cell text
  for (let r = 0; r < t1Rows.length; r++) {
    if (r === 0) {
      doc.setFont('helvetica', 'bold')
    } else {
      doc.setFont('helvetica', 'normal')
    }
    let cellX = 54
    for (let c = 0; c < t1Rows[r].length; c++) {
      doc.text(t1Rows[r][c], cellX + 8, t1Y + r * rowHeight + 15)
      cellX += colWidths[c]
    }
  }

  // Paragraph after Table 1
  const pAfterTable1 = 'Standard state variables allow physical scientists to calculate precise reaction enthalpies and phase diagrams across variable operating conditions.'
  doc.setFont('helvetica', 'normal')
  doc.text(doc.splitTextToSize(pAfterTable1, 500), 54, t1Y + 4 * rowHeight + 20)

  // Cross-page continuation paragraph at bottom of Page 1:
  // Starts on page 1 without terminal punctuation
  const contPart1 = 'Thermal conductivity is governed by Fourier\'s law of heat conduction, where heat flux is directly proportional to the negative of the'
  doc.text(doc.splitTextToSize(contPart1, 500), 54, 735)

  // ─── PAGE 2 ──────────────────────────────────────────────────────────────
  doc.addPage([612, 792])

  // Cross-page continuation continued on Page 2 (starts with lowercase word)
  const contPart2 = 'temperature gradient across the conductive medium and is inversely proportional to thermal boundary resistance.'
  doc.text(doc.splitTextToSize(contPart2, 500), 54, 60)

  // Numbered list
  doc.text('Key assumptions of the ideal conduction model include:', 54, 95)
  const numList = [
    'Steady-state thermal distribution without local internal energy generation.',
    'Homogeneous and isotropic material properties throughout the spatial continuum.',
    'Negligible radiative and convective loss along transverse structural surfaces.',
  ]
  let yNum = 115
  for (let i = 0; i < numList.length; i++) {
    const prefix = `${i + 1}. `
    doc.text(prefix, 60, yNum)
    const lines = doc.splitTextToSize(numList[i], 470)
    doc.text(lines, 76, yNum)
    yNum += lines.length * 14 + 4
  }

  // Spatial Equation: Fourier Law with fraction bar vector
  const eqY = yNum + 20
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(11)
  doc.text('q  =  - k', 240, eqY + 12)
  doc.text('dT', 290, eqY + 6)
  doc.setLineWidth(1)
  doc.setDrawColor(0, 0, 0)
  doc.line(288, eqY + 10, 310, eqY + 10) // fraction bar
  doc.text('dx', 290, eqY + 22)

  // Subheading 1.2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('1.2 Empirical Transport Coefficients', 54, eqY + 45)

  // Section intro
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  const pLong = 'Empirical measurements across engineering alloys demonstrate substantial variation in thermal conductivity depending on microstructural grain boundaries, alloy impurities, and ambient temperature.'
  doc.text(doc.splitTextToSize(pLong, 500), 54, eqY + 65)

  // Table 2 (3 columns x 5 rows)
  const t2Y = eqY + 100
  const t2Rows = [
    ['Material', 'Conductivity (W/m·K)', 'Density (kg/m^3)'],
    ['Pure Copper', '401', '8960'],
    ['Aluminum Alloy 6061', '167', '2700'],
    ['Carbon Steel 1020', '52', '7850'],
    ['Titanium Grade 5', '6.7', '4430'],
  ]
  const t2ColWidths = [170, 165, 165]

  doc.setFillColor(240, 240, 240)
  doc.rect(54, t2Y, 500, rowHeight, 'F')
  doc.setDrawColor(180, 180, 180)
  doc.setLineWidth(0.8)
  for (let r = 0; r <= 5; r++) {
    doc.line(54, t2Y + r * rowHeight, 554, t2Y + r * rowHeight)
  }
  let cX = 54
  doc.line(cX, t2Y, cX, t2Y + 5 * rowHeight)
  for (const w of t2ColWidths) {
    cX += w
    doc.line(cX, t2Y, cX, t2Y + 5 * rowHeight)
  }

  for (let r = 0; r < t2Rows.length; r++) {
    if (r === 0) {
      doc.setFont('helvetica', 'bold')
    } else {
      doc.setFont('helvetica', 'normal')
    }
    let cellX = 54
    for (let c = 0; c < t2Rows[r].length; c++) {
      doc.text(t2Rows[r][c], cellX + 8, t2Y + r * rowHeight + 15)
      cellX += t2ColWidths[c]
    }
  }

  // Figure & Caption
  const figY = t2Y + 5 * rowHeight + 25
  const figImgBase64 = fs.readFileSync('scripts/fixtures/figure_diagram.png').toString('base64')
  doc.addImage(`data:image/png;base64,${figImgBase64}`, 'PNG', 150, figY, 312, 120)

  // Caption directly below figure
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9.5)
  doc.setTextColor(50, 50, 50)
  doc.text('Figure 1.1: Steady-state temperature profile and radial heat flux contours.', 150, figY + 138)

  // Concluding paragraph
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(0, 0, 0)
  const pConclusion = 'These thermal parameters provide the empirical boundary conditions required for finite element simulation in aerospace thermal protection systems.'
  doc.text(doc.splitTextToSize(pConclusion, 500), 54, figY + 160)

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, Buffer.from(doc.output('arraybuffer')))
  console.log(`Generated synthetic fixture PDF at ${outputPath}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/generate-synthetic-fixture.mjs')) {
  createSyntheticDocumentFixture('scripts/fixtures/synthetic-document-structure.pdf')
}
