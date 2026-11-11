// Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu.
// Run with: node scripts/test-api-errors.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../artifacts/erp-ui/src/lib/api-errors.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { apiErrorFromResponse, formatApiError, parseFormErrors } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const htmlError = await apiErrorFromResponse(new Response("<!doctype html><html>Internal Server Error</html>", { status: 500 }), "The workflow action could not be completed.");
assert.equal(htmlError.status, 500);
assert.equal(formatApiError(htmlError), "The server could not complete this request. Please try again.");
assert.equal(formatApiError(await apiErrorFromResponse(new Response("", { status: 502 }), "Try again later.")), "Try again later.");
const validation = await apiErrorFromResponse(new Response(JSON.stringify({ errors: { comment: ["This field is required."] } }), { status: 400 }));
assert.equal(formatApiError(validation), "Comment is required.");
assert.deepEqual(parseFormErrors(validation).fields, { comment: ["Comment is required."] });
const forbidden = await apiErrorFromResponse(new Response(JSON.stringify({ detail: "This approval is not assigned to your user or role." }), { status: 403 }));
assert.equal(formatApiError(forbidden), "This approval is not assigned to your user or role.");
assert.equal(formatApiError({}, "Please try again."), "Please try again.");
assert.equal(formatApiError(new Error("Failed to fetch")), "We could not reach the server. Check your connection and try again.");
console.log("API error regression checks passed.");
