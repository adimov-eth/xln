#!/usr/bin/env node

// TS Vector Runner with JSON Schema validation.
// Validates inputs and outputs against xln-reference/schema and executes the
// same semantics as the adapter (for now). Later, swap to the real TS engine.

import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { runVector as runAdapter } from './ts-reference-adapter.mjs';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

function createAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function loadSchemas(ajv) {
  const base = path.resolve(process.cwd(), 'xln-reference', 'schema');
  const stateSchema = readJson(path.join(base, 'state.schema.json'));
  const inputSchema = readJson(path.join(base, 'input.schema.json'));
  const outputSchema = readJson(path.join(base, 'output.schema.json'));
  return {
    validateState: ajv.compile(stateSchema),
    validateInput: ajv.compile(inputSchema),
    validateOutput: ajv.compile(outputSchema),
  };
}

function validateVector(vec, validators) {
  const errors = [];
  // initial state (optional)
  if (vec.initial && !validators.validateState(vec.initial)) {
    errors.push({ where: 'initial', errors: validators.validateState.errors });
  }
  // each input
  for (let i = 0; i < (vec.inputs || []).length; i++) {
    const input = vec.inputs[i];
    if (!validators.validateInput(input)) {
      errors.push({ where: `inputs[${i}]`, errors: validators.validateInput.errors });
    }
  }
  return errors;
}

function main() {
  const fp = process.argv[2];
  if (!fp) {
    console.error('Usage: node scripts/ts-vector-runner.mjs <vector.json>');
    process.exit(2);
  }
  const vec = readJson(path.resolve(process.cwd(), fp));

  const ajv = createAjv();
  const validators = loadSchemas(ajv);

  const inputErrors = validateVector(vec, validators);
  if (inputErrors.length) {
    console.error('Input/schema validation failed:', JSON.stringify(inputErrors, null, 2));
    process.exit(1);
  }

  const res = runAdapter(vec);
  const toValidate = { 'next-state': res.state, outbox: res.out };
  if (!validators.validateOutput(toValidate)) {
    console.error('Output/schema validation failed:', JSON.stringify(validators.validateOutput.errors, null, 2));
    process.exit(1);
  }

  // Print in the shape expected by the Clojure differential test
  console.log(JSON.stringify({ state: res.state, out: res.out }));
}

main();

