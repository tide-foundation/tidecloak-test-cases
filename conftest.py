import pytest
from playwright.sync_api import sync_playwright
import allure 

@allure.title("Prepare for the test")
@pytest.fixture
def browser_page():
    playwright = sync_playwright().start()
    # browser = playwright.chromium.launch(headless=False)
    browser = playwright.chromium.launch()
    page = browser.new_page()
    yield page
    browser.close()
    playwright.stop()
