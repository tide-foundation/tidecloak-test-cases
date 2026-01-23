#!/bin/bash

# Playwright Test Setup Script
# Run this from the tests directory
# This script sets up Tidecloak and configures the test-app

set -e

# Track the last command and line for error reporting
LAST_COMMAND=""
LAST_LINE=0
trap 'LAST_COMMAND=$BASH_COMMAND; LAST_LINE=$LINENO' DEBUG

# Parse command line arguments
TEST_PATTERN=""
CLEANUP_ONLY=false
FULL_REINIT=false
KEEP_RUNNING=false
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--test)
            TEST_PATTERN="$2"
            shift 2
            ;;
        -c|--cleanup)
            CLEANUP_ONLY=true
            shift
            ;;
        --full)
            FULL_REINIT=true
            shift
            ;;
        --keep)
            KEEP_RUNNING=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -t, --test PATTERN   Run specific test(s) matching PATTERN"
            echo "                       Examples:"
            echo "                         -t 01           Run tests matching '01'"
            echo "                         -t 02_get       Run tests matching '02_get'"
            echo "                         -t test_login   Run tests matching 'test_login'"
            echo "  -c, --cleanup        Run cleanup only (stop containers, clean credentials)"
            echo "  --full               Re-initialize Tidecloak realm without prompting"
            echo "  --keep               Keep TideCloak and test-app running after tests"
            echo "  -h, --help           Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                   Run all tests"
            echo "  $0 -t 01             Run test 01 only"
            echo "  $0 -t 02             Run test 02 only"
            echo "  $0 -c                Cleanup only"
            echo "  $0 --full            Full setup with realm re-initialization"
            echo "  $0 --full --keep     Full setup, run tests, keep running"
            echo ""
            echo "Environment Variables:"
            echo "  TIDE_ENV             Set to 'staging' (default) or 'production'"
            echo "                       staging    -> tideorg/tidecloak-stg-dev:latest"
            echo "                       production -> tideorg/tidecloak-dev:latest"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_note() {
    echo -e "${BLUE}[NOTE]${NC} $1"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

check_port() {
    local port=$1
    if command_exists lsof; then
        lsof -i :$port > /dev/null 2>&1
    elif command_exists netstat; then
        netstat -tuln | grep -q ":$port "
    elif command_exists ss; then
        ss -tuln | grep -q ":$port "
    else
        return 1
    fi
}

find_port_user() {
    local port=$1
    if command_exists lsof; then
        lsof -i :$port 2>/dev/null
    elif command_exists netstat; then
        netstat -tulnp 2>/dev/null | grep ":$port "
    elif command_exists ss; then
        ss -tulnp 2>/dev/null | grep ":$port "
    fi
}

# Cleanup function to be called on exit or error
cleanup() {
    local exit_code=$?

    echo ""
    # Show error information if script failed (not cleanup-only mode)
    if [ $exit_code -ne 0 ] && [ "$CLEANUP_ONLY" != "true" ]; then
        log_error "Script failed with exit code: $exit_code"
        log_error "Failed at line $LAST_LINE: $LAST_COMMAND"
    fi

    # Skip cleanup if --keep flag was passed
    if [ "$KEEP_RUNNING" = "true" ]; then
        log_info "Keeping TideCloak and test-app running (--keep flag)"
        log_info "TideCloak: http://localhost:8080"
        log_info "test-app: http://localhost:3000"
        log_info "Run 'scripts/setup.sh --cleanup' to stop them later"
        return $exit_code
    fi

    log_warn "Cleaning up resources..."

    # Stop test-app/Next.js processes
    log_info "Stopping test-app Node processes..."
    pkill -f "next-server" 2>/dev/null || true
    pkill -f "npm start" 2>/dev/null || true
    pkill -f "next start" 2>/dev/null || true
    pkill -f "node.*test-app" 2>/dev/null || true

    # Stop Tidecloak
    if [ "${USE_LOCAL_TIDECLOAK_COMPOSE:-false}" = "true" ] && [ -n "${LOCAL_TIDECLOAK_COMPOSE_DIR:-}" ]; then
        log_info "Stopping local Tidecloak compose stack..."
        (cd "$LOCAL_TIDECLOAK_COMPOSE_DIR" && docker compose down 2>/dev/null || true)
    else
        log_info "Stopping Tidecloak container..."
        docker stop tidecloak 2>/dev/null || true
        docker rm tidecloak 2>/dev/null || true
    fi

    log_info "Cleanup complete."
    return $exit_code
}

# Set trap to run cleanup on EXIT, ERR, INT (Ctrl+C), and TERM signals
trap cleanup EXIT

# Load .env file if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [ -f "$ENV_FILE" ]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

# Set default for LOCAL_TIDECLOAK_COMPOSE_DIR if not set
LOCAL_TIDECLOAK_COMPOSE_DIR="${LOCAL_TIDECLOAK_COMPOSE_DIR:-$HOME/project/tidecloak/Tidified/localtest}"

# If cleanup only, run cleanup and exit
if [ "$CLEANUP_ONLY" = true ]; then
    echo "Running cleanup only..."
    cleanup
    exit 0
fi

echo "================================================"
echo "  Playwright Test Setup & Execution"
echo "================================================"
echo ""

# Check prerequisites
log_info "Checking prerequisites..."
MISSING_DEPS=()
for cmd in node npm curl jq uuidgen ; do
    if ! command -v $cmd &> /dev/null; then
        MISSING_DEPS+=($cmd)
    fi
done

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
    log_error "Missing prerequisites: ${MISSING_DEPS[*]}"
    echo ""
    echo "Please install the required dependencies:"
    echo ""
    echo "  sudo apt-get update"
    echo "  sudo apt-get install -y docker.io nodejs npm curl jq uuid-runtime "
    echo ""
    exit 1
fi
log_info "✓ All prerequisites installed"

if [ -f "$ENV_FILE" ]; then
    log_info "Loading environment from: $ENV_FILE"
    log_info "✓ Environment loaded"
else
    log_warn ".env file not found at: $ENV_FILE"
    log_note "You can create one with TIDECLOAK_PORT, etc."
fi

echo ""

# Configuration
TIDECLOAK_PORT="${TIDECLOAK_PORT:-8080}"
PORT="${PORT:-3000}"
USE_LOCAL_TIDECLOAK_COMPOSE="${USE_LOCAL_TIDECLOAK_COMPOSE:-false}"
LOCAL_TIDECLOAK_COMPOSE_DIR="${LOCAL_TIDECLOAK_COMPOSE_DIR:-$HOME/project/tidecloak/Tidified/localtest}"

# TideCloak Docker image selection based on TIDE_ENV
# TIDE_ENV=staging  -> tideorg/tidecloak-stg-dev:latest (default)
# TIDE_ENV=production -> tideorg/tidecloak-dev:latest
TIDE_ENV="${TIDE_ENV:-staging}"
if [ "$TIDE_ENV" = "production" ]; then
    TIDECLOAK_IMAGE="tideorg/tidecloak-dev:latest"
else
    TIDECLOAK_IMAGE="tideorg/tidecloak-stg-dev:latest"
fi

# Paths
TEST_REPO_DIR="$ROOT_DIR"
TEST_APP_DIR="$(dirname "$ROOT_DIR")/test-app"

log_info "Configuration:"
log_info "  Test repo directory: $TEST_REPO_DIR"
log_info "  test-app directory: $TEST_APP_DIR"
log_info "  Tidecloak Port: $TIDECLOAK_PORT"
log_info "  test-app Port: $PORT"
log_info "  Use Local Tidecloak Compose: $USE_LOCAL_TIDECLOAK_COMPOSE"
if [ "$USE_LOCAL_TIDECLOAK_COMPOSE" = "true" ]; then
    log_info "  Local Tidecloak Compose Dir: $LOCAL_TIDECLOAK_COMPOSE_DIR"
else
    log_info "  Tide Environment: $TIDE_ENV"
    log_info "  Tidecloak Docker Image: $TIDECLOAK_IMAGE"
fi
echo ""

# Check prerequisites
log_info "Checking prerequisites..."

if ! command_exists docker; then
    log_error "Docker is not installed."
    log_note "Install Docker Desktop or run: sudo apt-get install -y docker.io"
    exit 1
fi

if ! docker ps >/dev/null 2>&1; then
    log_error "Docker daemon is not running."
    log_note "Start Docker Desktop or run: sudo service docker start"
    exit 1
fi

if ! command_exists node; then
    log_error "Node.js is not installed."
    log_note "Install with: sudo apt-get install -y nodejs npm"
    exit 1
fi

if ! command_exists npm; then
    log_error "npm is not installed."
    exit 1
fi

log_info "✓ All prerequisites are installed."
echo ""

# Clean up any existing processes
log_info "Cleaning up existing processes..."
pkill -9 -f "next-server" 2>/dev/null || true
pkill -9 -f "npm start" 2>/dev/null || true
pkill -9 -f "next start" 2>/dev/null || true
sleep 2
log_info "✓ Cleanup complete"
echo ""

# Check for port conflicts
log_info "Checking for port conflicts..."

if check_port $TIDECLOAK_PORT; then
    log_warn "Port $TIDECLOAK_PORT is already in use - assuming TideCloak is running"
    TIDECLOAK_ALREADY_RUNNING=true
else
    TIDECLOAK_ALREADY_RUNNING=false
fi

if check_port $PORT; then
    log_error "Port $PORT is already in use!"
    echo ""
    find_port_user $PORT
    log_note "Add PORT=3001 to your .env file or stop the conflicting service"
    exit 1
fi

log_info "✓ Ports checked."
echo ""

# Step 1: Pull and run Tidecloak Docker container
log_info "Step 1: Setting up Tidecloak Docker container..."
echo "================================================"

if [ "$TIDECLOAK_ALREADY_RUNNING" = "true" ]; then
    log_info "TideCloak appears to be already running on port $TIDECLOAK_PORT"

    # Verify it's actually responding
    for i in {1..10}; do
        if curl -s -o /dev/null -w "" "http://localhost:$TIDECLOAK_PORT" 2>/dev/null; then
            log_info "✓ Tidecloak is available on port $TIDECLOAK_PORT"
            break
        fi
        if [ $i -eq 10 ]; then
            log_error "Port $TIDECLOAK_PORT is in use but TideCloak is not responding"
            exit 1
        fi
        sleep 1
    done
elif [ "$USE_LOCAL_TIDECLOAK_COMPOSE" = "true" ]; then
    # Use local docker compose for Tidecloak
    log_info "Using local docker compose for Tidecloak..."

    # Expand tilde in path
    LOCAL_TIDECLOAK_COMPOSE_DIR=$(eval echo "$LOCAL_TIDECLOAK_COMPOSE_DIR")

    if [ ! -d "$LOCAL_TIDECLOAK_COMPOSE_DIR" ]; then
        log_error "Local Tidecloak compose directory not found: $LOCAL_TIDECLOAK_COMPOSE_DIR"
        exit 1
    fi

    if [ ! -f "$LOCAL_TIDECLOAK_COMPOSE_DIR/docker-compose.yml" ] && [ ! -f "$LOCAL_TIDECLOAK_COMPOSE_DIR/compose.yml" ]; then
        log_error "No docker-compose.yml or compose.yml found in: $LOCAL_TIDECLOAK_COMPOSE_DIR"
        exit 1
    fi

    log_info "Bringing down any existing local Tidecloak compose stack..."
    (cd "$LOCAL_TIDECLOAK_COMPOSE_DIR" && docker compose down 2>/dev/null || true)

    log_info "Starting local Tidecloak with docker compose..."
    (cd "$LOCAL_TIDECLOAK_COMPOSE_DIR" && docker compose up -d)

    log_info "Waiting for Tidecloak to be ready..."
    sleep 15

    log_info "✓ Local Tidecloak compose stack is running"
    (cd "$LOCAL_TIDECLOAK_COMPOSE_DIR" && docker compose ps)
else
    # Use standard docker run for Tidecloak
    log_info "Pulling Tidecloak Docker image ($TIDECLOAK_IMAGE)..."
    docker pull "$TIDECLOAK_IMAGE"

    log_info "Checking if Tidecloak container is already running..."
    if docker ps -a --format '{{.Names}}' | grep -q '^tidecloak$'; then
        log_warn "Tidecloak container exists. Removing it..."
        docker stop tidecloak 2>/dev/null || true
        docker rm tidecloak 2>/dev/null || true
    fi

    log_info "Starting Tidecloak Docker container on port $TIDECLOAK_PORT..."

    docker run -d \
        --name tidecloak \
        -p $TIDECLOAK_PORT:8080 \
        -e KC_BOOTSTRAP_ADMIN_USERNAME="admin" \
        -e KC_BOOTSTRAP_ADMIN_PASSWORD="password" \
        -e KC_HOSTNAME_STRICT="false" \
        -e KC_HOSTNAME=http://localhost:8080 \
        -e SYSTEM_HOME_ORK=https://sork1.tideprotocol.com \
        -e USER_HOME_ORK=https://sork1.tideprotocol.com \
        -e THRESHOLD_T=3 \
        -e THRESHOLD_N=5 \
        -e PAYER_PUBLIC=20000011d6a0e8212d682657147d864b82d10e92776c15ead43dcfdc100ebf4dcfe6a8 \
        "$TIDECLOAK_IMAGE"

    log_info "Waiting for Tidecloak to be ready..."

    # Wait for container to be running first
    for i in {1..30}; do
        if docker ps --format '{{.Names}}' | grep -q '^tidecloak$'; then
            log_info "✓ Tidecloak container is running"
            break
        fi
        if [ $i -eq 30 ]; then
            log_error "Failed to start Tidecloak container."
            docker logs tidecloak 2>/dev/null || true
            exit 1
        fi
        sleep 2
    done

    # Wait for Tidecloak HTTP endpoint to be ready
    log_info "Waiting for Tidecloak HTTP endpoint..."
    for i in {1..90}; do
        if curl -s -f --connect-timeout 5 "http://localhost:$TIDECLOAK_PORT" > /dev/null 2>&1; then
            log_info "✓ Tidecloak HTTP endpoint is responding"
            break
        fi
        if [ $i -eq 90 ]; then
            log_error "Tidecloak HTTP endpoint not responding after 180 seconds"
            docker logs tidecloak 2>/dev/null | tail -50
            exit 1
        fi
        if [ $((i % 15)) -eq 0 ]; then
            log_info "  Still waiting for Tidecloak (attempt $i/90)..."
        fi
        sleep 2
    done

    # Wait for admin API to be ready (the real health check)
    log_info "Waiting for Tidecloak admin API to be ready..."
    for i in {1..45}; do
        if curl -s -f --connect-timeout 5 "http://localhost:$TIDECLOAK_PORT/realms/master" > /dev/null 2>&1; then
            log_info "✓ Tidecloak admin API is ready"
            break
        fi
        if [ $i -eq 45 ]; then
            log_error "Tidecloak admin API not ready after 90 seconds"
            docker logs tidecloak 2>/dev/null | tail -50
            exit 1
        fi
        if [ $((i % 10)) -eq 0 ]; then
            log_info "  Still waiting for Tidecloak admin API (attempt $i/45)..."
        fi
        sleep 2
    done

    # Additional settling time for TideCloak in CI environments
    if [ "${CI:-false}" = "true" ]; then
        log_info "CI environment detected - allowing additional settling time..."
        sleep 5
    fi

    log_info "✓ Tidecloak is running on port $TIDECLOAK_PORT"
    docker ps | grep tidecloak
fi

echo ""

# Step 2: Initialize Tidecloak realm
log_info "Step 2: Initializing Tidecloak realm..."
echo "================================================"

cd "$SCRIPT_DIR"

# Check if init-tidecloak.sh exists
if [ ! -f "init-tidecloak.sh" ]; then
    log_error "init-tidecloak.sh not found!"
    log_error "This script is required to configure Tidecloak"
    exit 1
fi

# Check if tidecloak.json already exists in test-app/data (expected location)
TIDECLOAK_JSON_PATH="$TEST_APP_DIR/data/tidecloak.json"
SKIP_TIDECLOAK_INIT=false

if [ -f "$TIDECLOAK_JSON_PATH" ]; then
    log_warn "tidecloak.json already exists in test-app/data"
    if [ "$FULL_REINIT" = true ]; then
        log_info "Re-initializing Tidecloak (--full flag)..."
        rm "$TIDECLOAK_JSON_PATH"
        chmod +x init-tidecloak.sh
        export ADAPTER_OUTPUT_PATH="$TIDECLOAK_JSON_PATH"
        ./init-tidecloak.sh
    else
        read -p "Do you want to re-initialize Tidecloak realm? This will create a new realm. (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Re-initializing Tidecloak..."
            rm "$TIDECLOAK_JSON_PATH"
            chmod +x init-tidecloak.sh
            export ADAPTER_OUTPUT_PATH="$TIDECLOAK_JSON_PATH"
            ./init-tidecloak.sh
        else
            log_info "Using existing tidecloak.json from test-app/data"
            SKIP_TIDECLOAK_INIT=true
        fi
    fi
else
    log_info "Running init-tidecloak.sh to configure Tidecloak..."
    chmod +x init-tidecloak.sh
    # Create data folder if it doesn't exist and set output path
    mkdir -p "$TEST_APP_DIR/data"
    export ADAPTER_OUTPUT_PATH="$TEST_APP_DIR/data/tidecloak.json"
    ./init-tidecloak.sh
fi

# Only verify if we ran init-tidecloak.sh
if [ "$SKIP_TIDECLOAK_INIT" = false ]; then
    # Verify tidecloak.json was created in test-app/data
    if [ ! -f "$TEST_APP_DIR/data/tidecloak.json" ]; then
        log_error "tidecloak.json was not created in $TEST_APP_DIR/data/"
        log_error "Tidecloak initialization may have failed"
        exit 1
    fi

    log_info "✓ Tidecloak realm initialized"
    log_info "✓ tidecloak.json saved to $TEST_APP_DIR/data/"
else
    log_info "✓ Using existing Tidecloak configuration"
fi
echo ""

# Step 3: Build test-app
log_info "Step 3: Building test-app..."
echo "================================================"

cd "$TEST_APP_DIR"

# Delete the SQLite database to ensure clean state for tests
if [ -d "$TEST_APP_DIR/db" ]; then
    log_info "Removing test-app database for clean test run..."
    rm -rf "$TEST_APP_DIR/db"
    log_info "✓ Database removed"
fi

log_info "Installing dependencies..."
npm install

log_info "Building test-app..."
npm run build

log_info "✓ test-app built successfully"
echo ""

# Step 4: Start test-app
log_info "Step 4: Starting test-app..."
echo "================================================"

log_info "Starting test-app on port $PORT..."
PORT=$PORT npm run start &
TEST_APP_PID=$!

log_info "Waiting for test-app to be ready..."
for i in {1..60}; do
    if curl -s -f --connect-timeout 5 "http://localhost:$PORT" > /dev/null 2>&1; then
        log_info "✓ test-app HTTP endpoint is responding"
        # Verify the health endpoint as well
        if curl -s -f --connect-timeout 5 "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
            log_info "✓ test-app health check passed"
            break
        fi
    fi
    if [ $i -eq 60 ]; then
        log_error "test-app failed to start on port $PORT after 60 seconds"
        exit 1
    fi
    if [ $((i % 10)) -eq 0 ]; then
        log_info "  Still waiting for test-app (attempt $i/60)..."
    fi
    sleep 1
done

# Additional settling time for test-app in CI environments
if [ "${CI:-false}" = "true" ]; then
    log_info "CI environment detected - allowing test-app to fully initialize..."
    sleep 3
fi

echo ""
log_info "✓ Setup complete! test-app is running at http://localhost:$PORT"
echo ""

# Step 5: Run Playwright tests
log_info "Step 5: Running Playwright tests..."
echo "================================================"

cd "$ROOT_DIR"

# Install test dependencies
log_info "Installing test dependencies..."
npm install

# Ensure the required Playwright browser is present for this repo's config (firefox-only).
# Idempotent; avoids CI/local failures where browser downloads were skipped or cached elsewhere.
log_info "Ensuring Playwright browsers are installed..."
npx playwright install firefox

# Run tests with optional pattern
if [ -n "$TEST_PATTERN" ]; then
    log_info "Running tests matching pattern: $TEST_PATTERN"
    npx playwright test "$TEST_PATTERN"
    TEST_EXIT_CODE=$?
else
    log_info "Running all tests..."
    npx playwright test
    TEST_EXIT_CODE=$?
fi

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
    log_info "✓ All tests passed!"
else
    log_error "Tests failed with exit code: $TEST_EXIT_CODE"
fi

# Exit with test exit code (cleanup will run via trap)
exit $TEST_EXIT_CODE
