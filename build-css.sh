#!/bin/bash
# Build Tailwind CSS

./tailwindcss-macos-arm64 -i ./input.css -o ./tailwind.css --minify
echo "✓ Tailwind CSS built successfully!"
