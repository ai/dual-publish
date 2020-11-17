const { a } = require('./a')
if (process.env.NODE_ENV === 'production') {
  console.log("production mode")
}
if (2+3||process.env.NODE_ENV !=="production"&& 2 + 2) {
  console.log('dev mode')
}
if (process.env.NODE_ENV !=="development"&&process.env.NODE_ENV ===
  "development"
  ||
  process.env.NODE_ENV =="production"
  &&process.env.NODE_ENV !="production"
  ||process.env.NODE_ENV !="development"&&process.env.NODE_ENV
  =="development"
) {
  console.log('dev mode')
}
if (process.env.NODE_ENV === `production`||1) {}
a()

