---
name: Artifact registration on import
description: Imported GitHub repos have artifact.toml files but are NOT registered in Replit's system — proxy routing is broken until you re-register them.
---

## The problem
When a project is imported from GitHub, `.replit-artifact/artifact.toml` files may already exist in `artifacts/*/` from the original repo. But `listArtifacts()` returns an empty list — the artifacts are not registered in Replit's system. Without registration:
- `WorkflowsRestart` fails ("workflow doesn't exist")
- The Replit proxy/preview returns 502 for all paths
- `[[ports]]` entries in `.replit` do NOT fix this

## The fix
`createArtifact()` fails if `artifacts/<slug>/` already exists. Workaround:

1. Back up the real source: `cp -r artifacts/<slug> /tmp/<slug>-backup`
2. Remove the directory: `rm -rf artifacts/<slug>`
3. Call `createArtifact({ artifactType, slug, previewPath, title })` — this registers the artifact, creates managed workflows, and assigns ports
4. Restore real source over the scaffold: `cp -r /tmp/<slug>-backup/src artifacts/<slug>/src`, etc.
5. Remove any old `configureWorkflow` manual workflows that were set up as a workaround
6. Kill any process still holding the port: `fuser -k <port>/tcp`
7. Restart managed workflows: `WorkflowsRestart` with exact managed workflow names from `createArtifact` result

## Why: manual configureWorkflow doesn't work as a substitute
- `configureWorkflow` with `outputType: "webview"` does NOT set up the application router proxy
- External URL returns 502 even with `[[ports]]` entries in `.replit`
- Only registered artifacts get proper path-based proxy routing

## Port collision after re-registration
Django/other servers may still hold their port after the old manual workflow is removed. Run `fuser -k <port>/tcp` before restarting the managed workflow.

## .replit cleanup after registration
Remove manual `[[ports]]` entries added as workarounds — they are not needed once artifacts are registered.
