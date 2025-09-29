from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page
from dotenv import load_dotenv

load_dotenv()

scenarios("01_create_realm.feature")

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
    page.get_by_test_id("last-alert").wait_for(state="visible")
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
