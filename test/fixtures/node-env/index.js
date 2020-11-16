const { a } = require('./a')
if (process.env.NODE_ENV === 'production') {
  console.log("production mode")
}
if (2+3||process.env.NODE_ENV !=="production"&& 2 + 2) {
  console.log('dev mode')
}
a()

