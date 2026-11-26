import * as fs from 'fs'
import ts from 'typescript'
import path from 'path'

async function importTS(tsFilePath) {
  const code = fs.readFileSync(tsFilePath, 'utf8')
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const tempPath = tsFilePath.replace(/\.ts$/, '.tmp.mjs')
  const rewritten = transpiled.replace(/from\s+['"]\.\/([^'"]+)['"]/g, (_, p) => {
    if (p.endsWith('.tmp.mjs')) return `from './${p}'`
    if (p.endsWith('.ts')) return `from './${p.replace(/\.ts$/, '.tmp.mjs')}'`
    return `from './${p}.tmp.mjs'`
  })
  fs.writeFileSync(tempPath, rewritten, 'utf8')
  const mod = await import('file://' + path.resolve(tempPath).replace(/\\/g, '/'))
  return { mod, tempPath }
}

async function main() {
  const indexRes = await importTS('lib/converter/index.ts')
  const pdfBytes = new Uint8Array(fs.readFileSync('regression-data/unit_3.pdf'))
  const extracted = await indexRes.mod.extractDocument(pdfBytes, { fileName: 'unit_3.pdf' })
  const analyzed = await indexRes.mod.analyzeDocument(extracted)

  console.log(`Analyzed ${analyzed.pages.length} pages.`)
  for (let pIdx = 0; pIdx < Math.min(4, analyzed.pages.length); pIdx++) {
    const page = analyzed.pages[pIdx]
    console.log(`\n=================== ANALYZED PAGE ${page.pageNumber} ===================`)
    for (const b of page.blocks) {
      if (b.text.includes('→') || b.text.includes('Oxide') || b.text.includes('HCl') || b.text.includes('Al') || b.type === 'equation') {
        console.log(`Block [${b.id}] type=${b.type} conf=${b.confidence} preserveAsImage=${b.preserveAsImage}:`)
        console.log(`  text: ${JSON.stringify(b.text.slice(0, 100))}`)
        console.log(`  lines: ${b.lines.length}, paths: ${b.associatedPaths.length}, images: ${b.associatedImages.length}`)
      }
    }
  }
}

main().catch(console.error)
