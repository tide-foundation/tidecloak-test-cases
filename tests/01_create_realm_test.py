from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page
import re, os, pytest
from dotenv import load_dotenv

load_dotenv()

scenarios("create_realm.feature")

@given("the admin is logged in to the tide admin console")
def admin_logged_in(logged_in_admin: Page) -> Page:
    return logged_in_admin

@when(parsers.parse("the admin creates a realm {realm_name}"))
def create_realm(logged_in_admin: Page, realm_name: str) -> None:
    
    page = logged_in_admin
    
    page.get_by_role("link", name="Manage realms").click()
    page.get_by_role("button", name="Create realm").click()
    page.get_by_role("textbox", name="Realm name").fill(realm_name)
    page.get_by_role("button", name="Create").click()

@then(parsers.parse("the realm {realm_name} should be visible in the realm list"))
def verify_realm(logged_in_admin: Page, realm_name: str) -> None:
    page = logged_in_admin

    # Checks for alert to have Realm created successful message
    expect(page.get_by_test_id("last-alert")).to_be_visible()
    expect(page.get_by_test_id("last-alert")).to_contain_text("Realm created successfully")
    page.get_by_role("button", name="Close alert: Realm created").click()

    # Issue: Lets say we have hudrends of realm and we need find the realm name in the list
    # so rather than iterating over all page(pagination)
    # Solution 2: Search option
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    expect(page.get_by_role("gridcell", name=realm_name)).to_be_visible()
    
    expect(page.get_by_test_id("currentRealm").filter(has_text=realm_name)).to_be_visible()
    page.get_by_role("link", name="Realm settings").click()
    expect(page.get_by_role("heading", name=realm_name)).to_be_visible()
    page.get_by_role("textbox", name="Copyable input").wait_for(state="visible")
    expect(page.get_by_role("textbox", name="Copyable input")).to_be_visible()

@then(parsers.parse("enable email verification and configure smtp server {admin_name}"))
def configure_realm(logged_in_admin: Page, admin_name: str) -> None:
    
    configured: str = f"{os.getenv('CONFIGURED')}"

    if configured.lower() == 'false':
        pytest.skip(reason="SMPT server is not configured check the .env file!, if configured properly set 'CONFIGURED' value to 'true'")

    mail_username = f"{str(os.getenv('TEMP_EMAIL_DEBUG_MAIL')).split('@')[0]}"
    page = logged_in_admin

    page.get_by_test_id("rs-login-tab").click()

    page.locator("div").filter(has_text=re.compile(r"^Verify email OnOff$")).locator("label").nth(1).click()
    expect(page.get_by_test_id("last-alert")).to_be_visible()
    expect(page.get_by_test_id("last-alert")).to_contain_text("Verify email changed")
    page.get_by_role("button", name="Close alert: Verify email").click()
    
    page.get_by_test_id("rs-email-tab").click()
    page.get_by_test_id("smtpServer.from").fill(f"{os.getenv('TEMP_EMAIL_DEBUG_MAIL')}")
    page.get_by_test_id("smtpServer.fromDisplayName").fill(f"{admin_name}")
    page.get_by_test_id("smtpServer.host").fill(f"{os.getenv('SMTP_HOST')}")
    page.get_by_test_id("smtpServer.port").fill(f"{os.getenv('SMTP_PORT')}")
    page.locator("div").filter(has_text=re.compile(r"^Authentication EnabledDisabled$")).locator("span").nth(1).click()
    page.get_by_test_id("smtpServer.user").fill(f"{mail_username}")
    page.get_by_test_id("smtpServer.password").fill(f"{os.getenv('TEMP_EMAIL_PASSWORD')}")
    page.get_by_test_id("email-tab-save").click()
    page.get_by_test_id("test-connection-button").click()


@then(parsers.parse("verify smtp configuration"))
def verify_smtp(logged_in_admin: Page) -> None:

    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("Success! SMTP connection")
    page.get_by_role("button", name="Close alert: Success! SMTP").click()