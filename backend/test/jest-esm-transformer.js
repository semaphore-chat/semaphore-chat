'use strict';
/**
 * Jest transform for the ESM-only packages in node_modules that
 * `transformIgnorePatterns` lets through (uuid, @nestjs/config). Jest 29
 * can't load ESM in a CommonJS test run, so this compiles them to CommonJS.
 *
 * It sets `esModuleInterop`, which ts-jest can't do here: our tsconfig doesn't
 * set it, and ts-jest caches one compiler config per Jest project, shared by
 * every `transform` entry that uses it. Without it, an ESM default import of a
 * CommonJS module (`import get from 'es-toolkit/compat/get'` in
 * @nestjs/config 12) compiles to `require(...).default`, which is undefined.
 * Node's require(esm) outside Jest binds it to `module.exports`, and so does
 * this.
 */
const crypto = require('crypto');
const fs = require('fs');
const ts = require('typescript');

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2023,
  allowJs: true,
  esModuleInterop: true,
};

// Changes to this file or to TypeScript invalidate Jest's transform cache.
const configDigest = crypto
  .createHash('sha256')
  .update(ts.version)
  .update(fs.readFileSync(__filename))
  .digest('hex');

module.exports = {
  process(sourceText, sourcePath) {
    const { outputText } = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions,
    });
    return { code: outputText };
  },
  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash('sha256')
      .update(configDigest)
      .update('\0')
      .update(sourcePath)
      .update('\0')
      .update(sourceText)
      .digest('hex');
  },
};
