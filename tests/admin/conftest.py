import pytest
import os
from dotenv import load_dotenv
import allure
from datetime import datetime

load_dotenv()

ADMIN_URL = os.getenv('ADMIN_URL')
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')


@pytest.fixture()
@allure.title("Get admin session")
def logged_in_admin(browser_page):
    page = browser_page
    page.goto(f"{ADMIN_URL}")
    page.get_by_role("textbox", name="username").fill(ADMIN_USERNAME)
    page.get_by_role("textbox", name="password").fill(ADMIN_PASSWORD)
    page.get_by_role("button", name="Sign In").click()
    page.get_by_test_id("currentRealm").filter(has_text="Keycloak").wait_for()
    return page

# Helper function for taking screenshots during test execution
def take_screenshot(page, name="screenshot"):
    """Helper function to take screenshots during test execution"""
    screenshot_dir = "screenshots"
    os.makedirs(screenshot_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    screenshot_path = f"{screenshot_dir}/{name}_{timestamp}.png"
    
    page.screenshot(path=screenshot_path, full_page=True)
    
    allure.attach.file(
        screenshot_path,
        name=name,
        attachment_type=allure.attachment_type.PNG
    )
    
    return screenshot_path