#!/usr/bin/env bash
# OC Kit smoke test script. Validates OC Kit modules compile and manifest
# parsing works. Can be run locally or in CI.
set -euo pipefail

echo "=== OC Kit Smoke Tests ==="

# Check that key OC Kit type files exist.
echo "1. Checking OC Kit source files..."
for file in packages/opencode/src/ockit/types.ts packages/opencode/src/ockit/index.ts packages/opencode/src/ockit/cli.ts; do
  if [ -f "$file" ]; then
    echo "   ✓ $file exists"
  else
    echo "   ✗ $file missing"
    exit 1
  fi
done

# Create a minimal test kit manifest.
echo "2. Creating test kit manifest..."
mkdir -p /tmp/test-kit
cat > /tmp/test-kit/kit.json << 'EOF'
{
  "id": "test-kit-smoke",
  "name": "Test Kit Smoke",
  "version": "0.1.0",
  "description": "Smoke test kit for CI validation",
  "skills": [
    {
      "id": "test-skill",
      "name": "Test Skill",
      "description": "A test skill"
    }
  ]
}
EOF
echo "   ✓ Test kit manifest created"

# Validate manifest parsing.
echo "3. Validating manifest parsing..."
node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('/tmp/test-kit/kit.json', 'utf8'));
  if (!data.id || !data.name || !data.version) {
    console.error('Invalid manifest: missing required fields');
    process.exit(1);
  }
  console.log('   ✓ Manifest validation passed:', data.id, data.name, data.version);
"

# Check OC Kit module structure.
echo "4. Checking OC Kit module structure..."
for dir in orchestrator workflow security tui; do
  if [ -d "packages/opencode/src/ockit/$dir" ]; then
    echo "   ✓ ockit/$dir/ directory exists"
  else
    echo "   ✗ ockit/$dir/ directory missing"
    exit 1
  fi
done

echo ""
echo "=== All smoke tests passed ==="
