#!/bin/bash
# Install Tesseract OCR with language packs

set -e

echo "Installing Tesseract OCR..."

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y tesseract-ocr

        # Install language packs
        sudo apt-get install -y \
            tesseract-ocr-fra \
            tesseract-ocr-eng \
            tesseract-ocr-deu \
            tesseract-ocr-spa \
            tesseract-ocr-ita \
            tesseract-ocr-por \
            tesseract-ocr-nld \
            tesseract-ocr-rus \
            tesseract-ocr-chi-sim \
            tesseract-ocr-chi-tra \
            tesseract-ocr-jpn \
            tesseract-ocr-kor \
            tesseract-ocr-ara

    elif command -v yum &> /dev/null; then
        # RHEL/CentOS/Fedora
        sudo yum install -y tesseract tesseract-langpack-fra tesseract-langpack-eng
    elif command -v pacman &> /dev/null; then
        # Arch Linux
        sudo pacman -S tesseract tesseract-data-fra tesseract-data-eng
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    if command -v brew &> /dev/null; then
        brew install tesseract
        brew install tesseract-lang
    else
        echo "Please install Homebrew first: https://brew.sh"
        exit 1
    fi
else
    echo "Unsupported operating system"
    exit 1
fi

# Verify installation
echo ""
echo "Tesseract installation complete!"
echo "Version: $(tesseract --version | head -1)"
echo "Available languages:"
tesseract --list-langs
