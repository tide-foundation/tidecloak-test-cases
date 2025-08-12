import pytest
from playwright.sync_api import sync_playwright
import requests
import os
from dotenv import load_dotenv

load_dotenv()

ADMIN_URL = os.getenv('ADMIN_URL')
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')


@pytest.fixture(scope="session", autouse=True)
def check_tidecloak_running():
    """Check if Tidecloak instance is running before running tests."""
    try:
        response = requests.get(ADMIN_URL, timeout=5)
        if response.status_code != 200:
            pytest.skip("Tidecloak is not running or returned non-200 response.")
    except requests.exceptions.RequestException:
        pytest.skip("Tidecloak instance is not running or unreachable.")

@pytest.fixture
def browser_page():
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=False)
    page = browser.new_page()
    yield page
    browser.close()
    playwright.stop()

@pytest.fixture
def logged_in_admin(browser_page):
    """Logs into Tidecloak as admin and returns a logged-in page."""
    page = browser_page
    page.goto(f"{ADMIN_URL}")
    page.get_by_role("textbox", name="username").fill(ADMIN_USERNAME)
    page.get_by_role("textbox", name="password").fill(ADMIN_PASSWORD)
    page.get_by_role("button", name="Sign In").click()
    page.get_by_test_id("currentRealm").filter(has_text="Keycloak").wait_for()
    return page