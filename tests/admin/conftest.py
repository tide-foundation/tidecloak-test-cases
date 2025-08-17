import pytest
import os
from dotenv import load_dotenv

load_dotenv()

ADMIN_URL = os.getenv('ADMIN_URL')
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')


@pytest.fixture
def logged_in_admin(browser_page):
    page = browser_page
    page.goto(f"{ADMIN_URL}")
    page.get_by_role("textbox", name="username").fill(ADMIN_USERNAME)
    page.get_by_role("textbox", name="password").fill(ADMIN_PASSWORD)
    page.get_by_role("button", name="Sign In").click()
    page.get_by_test_id("currentRealm").filter(has_text="Keycloak").wait_for()
    return page