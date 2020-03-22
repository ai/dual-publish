let b = require('../b')
require('../c')

a = () => {
  b()
  console.log('native a')
}

module.exports = { a }
