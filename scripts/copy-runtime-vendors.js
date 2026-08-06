const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'node_modules', 'jsonc-parser', 'lib', 'umd')
const target = path.join(root, 'out', 'vendor', 'jsonc-parser')

if (!fs.existsSync(source)) {
  throw new Error(`jsonc-parser runtime is missing: ${source}`)
}

fs.rmSync(target, { recursive: true, force: true })
fs.mkdirSync(path.dirname(target), { recursive: true })
fs.cpSync(source, target, {
  recursive: true,
  filter(sourcePath) {
    return fs.statSync(sourcePath).isDirectory() || path.extname(sourcePath) === '.js'
  }
})
