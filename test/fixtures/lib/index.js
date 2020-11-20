let { promisify } = require('util')
let path = require('path')

const { a } = require('./a')
let {
  b
} = require('./b/index.js')
var { c: cname } = require('./c/')
require('./d')
if (process.env.NODE_ENV !== "production") {
}

function lib () {
  a(path.join('a', 'b'))
  b()
  cname()
  console.log('cjs lib')
}

module.exports = { lib }
