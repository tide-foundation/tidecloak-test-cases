from pytest_bdd import scenarios, given, when, then
from dotenv import load_dotenv
import os
from playwright.sync_api import expect
from conftest import take_screenshot


load_dotenv()

scenarios('admin/admin_login.feature')

ADMIN_URL = os.getenv('ADMIN_URL')
ADMIN_USERNAME = os.getenv('ADMIN_USERNAME')
ADMIN_PASSWORD = os.getenv('ADMIN_PASSWORD')

@given("I open the Tidecloak admin login page")
def open_login_page(browser_page):
    browser_page.goto(ADMIN_URL)

@when("I login as admin user")
def login_admin(browser_page):
    page = browser_page
    page.goto(f"{ADMIN_URL}")
    page.get_by_role("textbox", name="username").fill(ADMIN_USERNAME)
    page.get_by_role("textbox", name="password").fill(ADMIN_PASSWORD)
    page.get_by_role("button", name="Sign In").click()

@then("I should see the admin dashboard")
def verify_dashboard(browser_page):
    page = browser_page
    try:

        assert page.title() == "Keycloak Administration Console"
        expect(page.get_by_test_id("currentRealm").filter(has_text="Keycloak")).to_be_visible()
        expect(page.get_by_role("button", name="admin")).to_be_visible()
        page.get_by_role("button", name="admin").click()
        expect(page.get_by_role("menuitem", name="Sign out")).to_be_visible()
        page.get_by_role("button", name="admin").click()
        
        take_screenshot(page, "Admin Login Successful")
    
    except:
        take_screenshot(page, "Admin Login Failure")
        raise