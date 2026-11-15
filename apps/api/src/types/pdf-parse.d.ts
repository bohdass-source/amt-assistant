// Import the inner module: the root index.js of pdf-parse@1, when required without
// a parent module, runs debug code that reads a test PDF from disk.
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdf = require('pdf-parse');
  export = pdf;
}
