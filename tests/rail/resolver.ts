// tests/rail/resolver.ts
// ----------------------------------------------------------------------------
// NIK-RAIL-004 · the one piece of plumbing the self-test needs.
//
// tsc does not rewrite path aliases when it emits. lib/rail/webhook-handler.ts
// imports '@/lib/referral-engine' (the alias the Next.js build resolves), so the
// compiled file still requires '@/lib/referral-engine', which node reads as a bare
// package name and cannot find. The published fix for that is a resolver package;
// this ticket adds no packages, so here is the four-line version of it, using only
// node's own module API.
//
// Imported for its side effect as the FIRST statement of the test file, so the
// hook is installed before any '@/...' require runs. CommonJS emit keeps the order
// of import statements, which is why the test file must keep this one at the top.
// ----------------------------------------------------------------------------
// require(), not an import, and both of the alternatives were MEASURED:
//   · `import Module = require('node:module')` is TS1202 under the ROOT tsconfig,
//     which type-checks this file too (include **/*.ts) with module esnext;
//   · `import * as Module from 'node:module'` compiles but fails at run time with
//     "Cannot set property _resolveFilename of #<Object> which has only a getter",
//     because esModuleInterop hands back a frozen namespace copy, not the live
//     module object.
// require() returns the live object and type-checks under both configs.
const nodeModule: any = require('node:module');
const nodePath: any = require('node:path');

/** .rail-test-dist — this file lands at <dist>/tests/rail/resolver.js (rootDir is pinned). */
const DIST_ROOT: string = nodePath.resolve(__dirname, '..', '..');

const original = nodeModule._resolveFilename;
nodeModule._resolveFilename = function (this: unknown, request: string, ...rest: any[]) {
  const mapped = request.startsWith('@/') ? nodePath.join(DIST_ROOT, request.slice(2)) : request;
  return original.call(this, mapped, ...rest);
};

export const distRoot = DIST_ROOT;
