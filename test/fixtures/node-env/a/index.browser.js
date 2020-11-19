function a () {
  console.log('cjs browser a')
  if (process.env.NODE_ENV !=="production") {
    console.log('cjs browser a dev')
  }
}

module.exports = { a, toShare }
