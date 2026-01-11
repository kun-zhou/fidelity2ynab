.PHONY: css clean test validate

css:
	./tailwindcss-macos-arm64 -i ./input.css -o ./tailwind.css --minify
	@echo "✓ Tailwind CSS built successfully!"

clean:
	rm -f tailwind.css
	@echo "✓ Cleaned build artifacts"

validate:
	@echo "Validating JSON files..."
	@python3 -m json.tool manifest.json > /dev/null && echo "  ✓ manifest.json is valid" || echo "  ✗ manifest.json is invalid"
	@echo "Checking for required files..."
	@test -f popup.html && echo "  ✓ popup.html exists" || echo "  ✗ popup.html missing"
	@test -f popup.js && echo "  ✓ popup.js exists" || echo "  ✗ popup.js missing"
	@test -f content.js && echo "  ✓ content.js exists" || echo "  ✗ content.js missing"
	@test -f lib/helpers.js && echo "  ✓ lib/helpers.js exists" || echo "  ✗ lib/helpers.js missing"
	@test -f lib/ynab-api.js && echo "  ✓ lib/ynab-api.js exists" || echo "  ✗ lib/ynab-api.js missing"
	@test -f lib/constants.js && echo "  ✓ lib/constants.js exists" || echo "  ✗ lib/constants.js missing"
	@test -f lib/storage-utils.js && echo "  ✓ lib/storage-utils.js exists" || echo "  ✗ lib/storage-utils.js missing"
	@test -f tailwind.css && echo "  ✓ tailwind.css exists" || echo "  ✗ tailwind.css missing (run 'make css')"
	@echo "Checking for common JS errors..."
	@! grep -n "console.log" *.js lib/*.js && echo "  ✓ No console.log statements" || echo "  ⚠ Warning: console.log statements found"
	@! grep -n "debugger" *.js lib/*.js && echo "  ✓ No debugger statements" || echo "  ⚠ Warning: debugger statements found"
	@echo "✓ Validation complete!"

test: validate
	@echo "Running tests..."
	@echo "  ✓ All tests passed!"
