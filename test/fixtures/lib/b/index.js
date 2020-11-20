function b () {
  console.log('cjs b')
  if (process.env.NODE_ENV === "production") {
  }
}

module.exports={b}
