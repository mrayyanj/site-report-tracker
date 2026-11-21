import { createApi } from './app.js'

const port = 3001
const host = '127.0.0.1'
const server = createApi()

server.listen(port, host, () => {
  console.log(`API running at http://${host}:${port}/api/health`)
})