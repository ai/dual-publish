let { join, sep } = require('path')
let { promisify } = require('util')
let globby = require('globby')
let fs = require('fs')

let writeFile = promisify(fs.writeFile)
let readFile = promisify(fs.readFile)

function error (msg) {
  let err = new Error(msg)
  err.own = true
  return err
}

function getPath (file, statement) {
  let path = statement.match(/require\(([^)]+)\)/)[1]
  if (/\/index["']/.test(path)) {
    throw error('Replace `index` in require() to `index.js` at ' + file)
  }
  if (/^["']..?(["']$|\/)/.test(path)) {
    if (/\/index\.js(["'])$/.test(path)) {
      path = path.replace(/\/index\.js(["'])$/, '/index.mjs$1')
    } else if (/\/["']$/.test(path)) {
      path = path.replace(/["']$/, 'index.mjs$&')
    } else {
      path = path.replace(/["']$/, '/index.mjs$&')
    }
  }
  return path
}

module.exports = async function (dir) {
  let files = await globby('**/*.js', { cwd: dir })

  for (let file of files) {
    if (!file.endsWith(sep + 'index.js') && file !== 'index.js') {
      let fixed = file.replace(/\.js$/, sep + 'index.js')
      throw error(`Rename ${ file } to ${ fixed }`)
    }
  }

  await Promise.all(files.map(async file => {
    let cjs = await readFile(join(dir, file))
    let esm = cjs
      .toString()
      .replace(/module.exports\s*=\s*/, 'export default ')
      .replace(/(let|const)\s+(\S+)\s+=\s+require\(([^)]+)\)/g, statement => {
        let name = statement.match(/(let|const)\s+(\S+)\s+=/)[2]
        let path = getPath(file, statement)
        return `import ${ name } from ${ path }`
      })
      .replace(/require\(([^)]+)\)/g, statement => {
        let path = getPath(file, statement)
        return `import ${ path }`
      })
    await writeFile(join(dir, file.replace(/\.js$/, '.mjs')), esm)
  }))
}
