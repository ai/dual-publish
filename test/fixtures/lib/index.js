let path = require('path')

let a = require('./a')
let b = require('./b/index.js')
let c = require('./c/')
require('../lib/d')

a(path.join('a', 'b'))
b()
c()

console.log('cjs lib')
