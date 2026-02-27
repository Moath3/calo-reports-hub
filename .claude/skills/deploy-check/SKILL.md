---
name: deploy-check
description: Run build verification and security checks before pushing to Render. Validates client build, checks for debug statements, verifies env vars, and ensures no sensitive files are staged.
disable-model-invocation: true
---

# Deploy Check — Pre-Push Validation

Before pushing to master (which auto-deploys to Render.com), verify all of the following:

## Steps

### 1. Windows Node.js PATH fix
```bash
export PATH="/c/Program Files/nodejs:$PATH"
```

### 2. Client Build
Run from project root:
```bash
npm run build
```
Must succeed with **zero errors**. Warnings about chunk size are acceptable.

### 3. Debug Statement Check
Search for leftover debugging code that shouldn't ship:
```bash
grep -rn "console.log\|debugger\|TODO\|FIXME\|HACK" client/src/ server/src/ --include="*.js" --include="*.jsx" | grep -v node_modules | grep -v "__tests__"
```
Flag any suspicious entries for review.

### 4. Environment Variable Sync
Compare `.env.example` against actual env var usage in code:
```bash
grep -roh "process\.env\.\w\+" server/src/ | sort -u
```
Ensure every env var used in code has a corresponding entry in `.env.example`.

### 5. Git Status Check
```bash
git status
git diff --cached --name-only
```
Verify:
- No `.env` files staged
- No `*.db` files staged
- No `node_modules/` staged
- No unintended files included

### 6. Security Quick Check
- Verify no API keys or secrets are hardcoded in source files
- Check that CORS is properly configured for production
- Verify rate limiters are enabled

## Result
If all checks pass, report: **✅ Safe to push — all checks passed**
Include a summary of what's changed since last push.

If any check fails, report: **❌ Issues found — do NOT push**
List each issue with the file path and what needs fixing.
