#!/bin/env bash

# Check if venv directory exists
if [ ! -d "venv" ]; then
    echo "[-] Virtual environment 'venv' not found. Please setup-environment.sh to build the test environment"
    exit 1
fi

# Check if docker-compose.yml exists and handle Docker services
if [ -f "docker-compose.yml" ]; then
    echo "[+] Checking for tidecloak container..."
    
    if ! docker ps --filter "name=tidecloak" --format "table {{.Names}}" | grep -q "tidecloak"; then
        echo "[+] No running tidecloak container found, starting Docker Compose services..."
        docker compose up -d
        
        # Wait a moment for services to start
        echo "[+] Waiting for services to be ready..."
        sleep 10
    else
        echo "[+] tidecloak container is already running"
    fi
else
    echo "[-] docker-compose.yml not found, skipping Docker services"
fi

# Activate virtual environment
echo "[+] Activating virtual environment..."
source venv/bin/activate

while ! curl -Is http://localhost:8080 >/dev/null 2>&1; do
    echo "[x] Service not ready, waiting..."
    sleep 5
done
echo "[+] Service is up!"

if [ -n "$VIRTUAL_ENV" ]; then
    echo "[+] Running tests and generating reports..."
    pytest

    TEST_EXIT_CODE=$?
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo "[+] All tests passed successfully!"
    else
        echo "[+]  Some tests failed, but generating report anyway..."
    fi
        echo "[+] Starting web server..."
        echo ""
        echo "[+] Open the reports in your browser"
        echo "[+] Press Ctrl+C when you're done viewing the report"
        echo ""

        cleanup() {
            echo ""
            echo "[+] Stopping web server..."
            rm -rf ./reports
            echo "[+] Cleanup completed. Goodbye!"
            exit 0
        }

        trap cleanup SIGINT SIGTERM
        allure serve ./reports

else
    echo "[-] Failed to activate virtual environment..." && exit 1
fi