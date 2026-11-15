// Импортируем внутренний модуль: корневой index.js у pdf-parse@1 при require без
// родителя запускает отладочный код и читает тестовый PDF с диска.
declare module 'pdf-parse/lib/pdf-parse.js' {
  import pdf = require('pdf-parse');
  export = pdf;
}
