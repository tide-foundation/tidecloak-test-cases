#!/bin/bash

if [ -n "$VIRTUAL_ENV" ]; then
    echo "[+] Running tests and generating reports..."
    pytest -v -s --alluredir=./reports
    
    TEST_EXIT_CODE=$?
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo "[+] All tests passed successfully!"
    else
        echo "[+]  Some tests failed, but generating report anyway..."
    fi
        echo "[+] Starting Allure server..."
        echo ""
        echo "[+] Report will open in your browser"
        echo "[+] Press Ctrl+C when you're done viewing the report"
        echo ""
        
        cleanup() {
            echo ""
            echo "[+] Stopping Allure server..."
			rm -rf ./reports
            echo "[+] Cleanup completed. Goodbye!"
            exit 0
        }
        
        trap cleanup SIGINT SIGTERM
        
        allure serve ./reports
        
else 
    echo "[+] Virtual environment not active..." && exit 1
fi
