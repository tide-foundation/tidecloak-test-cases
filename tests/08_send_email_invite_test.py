from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 
import os, pytest
from dotenv import load_dotenv

load_dotenv()

scenarios("send_email_invite.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin

    configured: str = f"{os.getenv('CONFIGURED')}"

    if configured.lower() == 'false':
        pytest.skip(reason="SMPT server is not configured check the .env file!, if configured properly set 'CONFIGURED' value to 'true'")
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when(parsers.parse("the admin searches for user {username} and sends email for verification"))
def send_email_invite(logged_in_admin: Page, username: str) -> None:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-users").click()
    
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(username)

    page.get_by_test_id("table-search-input").get_by_role("button", name="Search").click()
    page.get_by_role("link", name=username).click()

    page.get_by_test_id("credentials").click(timeout=5000)
    page.get_by_test_id("credentialResetBtn").click(timeout=5000)
    
    page.get_by_role("combobox", name="Type to filter").click()
    page.get_by_role("option", name="Verify Email").click()
    page.get_by_test_id("confirm").click()

    

@then("the admin open mail service provider link login in")
def login_email_service_provider(logged_in_admin: Page) -> Page:

   
    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("Email sent to user.")
    page.get_by_role("button", name="Close alert: Email sent to user.").click()
    
    page.goto("https://app.debugmail.io/app")

    page.locator("input[type=\"email\"]").fill(f"{os.getenv("MAIL_DEBUG_EMAIL")}")
    page.locator("input[type=\"password\"]").fill(f"{os.getenv("MAIL_DEBUG_PASSWORD")}")

    page.locator("#login-signin-button").click()

    return page
   

@then("then verifies if email is received")
def verify_email_link(logged_in_admin: Page) -> None:

    project_name: str = f"{os.getenv('PROJECT_NAME')}"
    
    page = logged_in_admin
    page.get_by_text(project_name, exact=True).click()
    expect(page.get_by_text("Update Your Account").first).to_be_visible()