from pytest_bdd import scenarios, given, when, then, parsers
from dotenv import load_dotenv
import os, re, time
from playwright.sync_api import expect, Page


load_dotenv()

scenarios('admin_login.feature')

@given("I open the tide admin login page")
def open_login_page(browser_page: Page) -> Page:
    browser_page.goto(f"{os.getenv('TIDE_INSTANCE_URL')}")
    return browser_page

@when(parsers.parse("I login as admin user with {username} and {password}"))
def login_admin(browser_page: Page, username: str, password: str) -> None:
    page = browser_page
    page.get_by_role("textbox", name="username").fill(username)
    page.get_by_role("textbox", name="password").fill(password)
    page.get_by_role("button", name="Sign In").click()

@then(parsers.parse("I should redirected to page with heading {heading} login page or dashboard page"))
def verify_dashboard(browser_page: Page, heading: str) -> None:
    
    page = browser_page

    expect(page.get_by_role("heading", name=heading)).to_be_visible()