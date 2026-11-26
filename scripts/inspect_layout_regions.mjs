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
  const layout = await indexRes.mod.layoutDocument(analyzed)

  console.log(`Total layout pages: ${layout.pages.length}`)
  let regionCount = 0
  for (const page of layout.pages) {
    const regions = page.elements.filter(e => e.kind === 'preserved-region')
    regionCount += regions.length
    for (const r of regions) {
      console.log(`Kindle Page ${page.pageNumber}: [${r.id}] type=${r.regionType} reason=${r.preservationReason} box=[${r.sourceBox.x}, ${r.sourceBox.y}, ${r.sourceBox.width}x${r.sourceBox.height}] text=${JSON.stringify(r.fallbackText?.slice(0, 80))}`)
    }
  }
  console.log(`Total preserved regions in layout: ${regionCount}`)
}

main().catch(console.error)
