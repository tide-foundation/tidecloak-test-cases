import pytest
from playwright.sync_api import sync_playwright
import allure
import os 

@allure.title("Prepare for the test")
@pytest.fixture
def browser_page():
    playwright = sync_playwright().start()
    # browser = playwright.chromium.launch(headless=False)
    browser = playwright.chromium.launch()
    
    if os.path.exists('auth.json'):
        context = browser.new_context(storage_state='auth.json')
    else:
        context = browser.new_context()

    page = context.new_page()

    yield page
    context.close()
    browser.close()
    playwright.stop()
