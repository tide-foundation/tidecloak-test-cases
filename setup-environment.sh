#!/bin/env bash

# Python Virtual Environment and Allure Setup Script
# This script creates a Python virtual environment, installs requirements, and downloads Allure

set -e  # Exit on any error

# Configuration
VENV_NAME="venv"
REQUIREMENTS_FILE="requirements.txt"
ALLURE_INSTALL_DIR="$HOME/.local/bin"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    print_error "Python3 is not installed. Please install Python3 first."
    exit 1
fi

print_status "Python3 found: $(python3 --version)"

# Create virtual environment
print_status "Creating virtual environment: $VENV_NAME"
python3 -m venv "$VENV_NAME"

# Activate virtual environment
print_status "Activating virtual environment"
source "$VENV_NAME/bin/activate"

# Upgrade pip
print_status "Upgrading pip"
pip install --upgrade pip

# Install requirements if file exists
if [ -f "$REQUIREMENTS_FILE" ]; then
    print_status "Installing requirements from $REQUIREMENTS_FILE"
    pip install -r "$REQUIREMENTS_FILE"
    playwright install
else
    print_warning "$REQUIREMENTS_FILE not found, skipping requirements installation"
fi

# Check if Java is installed (required for Allure)
if ! command -v java &> /dev/null; then
    print_error "Java is not installed. Allure requires Java 8 or higher."
    print_error "Please install Java before running this script."
    exit 1
fi

print_status "Java found: $(java -version 2>&1 | head -n 1)"

# Get latest Allure release URL from GitHub API
print_status "Fetching latest Allure release information"
LATEST_RELEASE=$(curl -s https://api.github.com/repos/allure-framework/allure2/releases/latest)
DOWNLOAD_URL=$(echo "$LATEST_RELEASE" | grep -o '"browser_download_url": "[^"]*\.deb"' | grep -o 'https://[^"]*')
VERSION=$(echo "$LATEST_RELEASE" | grep -o '"tag_name": "[^"]*"' | cut -d'"' -f4)

if [ -z "$DOWNLOAD_URL" ]; then
    print_error "Failed to get Allure download URL"
    exit 1
fi

print_status "Found Allure version: $VERSION"
print_status "Download URL: $DOWNLOAD_URL"

# Download Allure
TEMP_DIR=$(mktemp -d)
ALLURE_DEB="$TEMP_DIR/allure.deb"

print_status "Downloading Allure to temporary location"e
curl -L -o "$ALLURE_DEB" "$DOWNLOAD_URL"

# Extract Allure
print_status "Extracting Allure"
sudo dpkg -i "$ALLURE_DEB"


# Clean up temporary files
rm -rf "$TEMP_DIR"

# Verify installations
print_status "Verifying installations"
echo "Python virtual environment: $(which python)"
echo "Pip version: $(pip --version)"

if command -v allure &> /dev/null; then
    echo "Allure version: $(allure --version)"
else
    echo "Allure: Not installed"
fi

print_status "Setup completed successfully!"


echo ""
print_status "Next steps:"
echo "1. Your virtual environment is now active"
echo "2. Install any additional packages with: pip install <package>"
echo "3. To activate this environment in the future, run: source $VENV_NAME/bin/activate"