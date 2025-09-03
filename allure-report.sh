#!/bin/bash

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
        echo "[+] Open the reports in your browser at http://0.0.0.0:3000"
        echo "[+] Press Ctrl+C when you're done viewing the report"
        echo ""

        cleanup() {
            echo ""
            echo "[+] Stopping web server..."
            cd ..
            rm -rf ./reports
            rm -rf ./allure-report
            echo "[+] Cleanup completed. Goodbye!"
            exit 0
        }

        trap cleanup SIGINT SIGTERM

        allure generate ./reports --clean
        cd allure-report
        command -v python3 >/dev/null && python3 -m http.server 3000 || python -m http.server 3000

else
    echo "[+] Virtual environment not active..." && exit 1
fi
