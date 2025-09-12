from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page
import re, os, pytest
from dotenv import load_dotenv

load_dotenv()

scenarios("configure_admin_email.feature")

@given(parsers.parse("the admin selects the {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name : str) -> Page:
    page = logged_in_admin

    configured: str = f"{os.getenv('CONFIGURED')}"

    if configured.lower() == 'false':
        pytest.skip(reason="SMTP server is not configured check the .env file!, if configured properly set 'CONFIGURED' value to 'true'")
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()
    page.get_by_test_id("nav-item-realm-settings").click()

    return logged_in_admin

@when(parsers.parse("the admin enable email verification and configure smtp server with admin username {admin_name}"))
def configure_smtp(logged_in_admin: Page, admin_name: str) -> None:
    
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

    # This 
    # page.get_by_test_id("test-connection-button").click()

@then("the verification of smtp configuration done via sending a test mail to email address")
def verify_smtp(logged_in_admin: Page) -> None:
   
    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("Realm successfully updated")
    page.get_by_role("button", name="Close alert: Realm successfully updated").click()

    # Setting email address to admin in master realm for sending emails
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("link", name="master").click()
    page.get_by_test_id("nav-item-users").click()
    page.get_by_role("link", name="admin").click()
    page.get_by_test_id("email").fill(f"{os.getenv('TEMP_EMAIL_DEBUG_MAIL')}")
    page.get_by_test_id("user-creation-save").click()
    
    expect(page.get_by_test_id("last-alert")).to_be_visible()
    expect(page.get_by_test_id("last-alert")).to_contain_text("The user has been saved")
    page.get_by_role("button", name="Close alert: The user has been saved").click()


