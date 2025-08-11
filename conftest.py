import pytest
from playwright.sync_api import sync_playwright
from keycloak import KeycloakAdmin
import requests

ADMIN_URL = "http://localhost:8080"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin"

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
    page.fill('input#username', ADMIN_USERNAME)
    page.fill('input#password', ADMIN_PASSWORD)
    page.click('button#kc-login')
    page.wait_for_selector("text=Master")
    return page