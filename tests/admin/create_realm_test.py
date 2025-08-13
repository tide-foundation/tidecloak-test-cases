from pytest_bdd import given, when, then, scenarios
from playwright.sync_api import expect 

scenarios("admin/create_realm.feature")

# GLOBAL VARIABLES
realm_name = "testrealm"

@given("the admin is logged in to the Tidecloak admin console")
def admin_logged_in(logged_in_admin):
    return logged_in_admin

@when('the admin creates a realm named "testrealm"')
def create_realm(logged_in_admin):
    
    page = logged_in_admin
    
    page.get_by_role("link", name="Manage realms").click()
    page.get_by_role("button", name="Create realm").click()
    page.get_by_role("textbox", name="Realm name").fill(realm_name)
    page.get_by_role("button", name="Create").click()
    page.get_by_role("button", name="Close  alert: Realm created successfully").click()

@then('the realm "testrealm" should be visible in the realm list')
def verify_realm(logged_in_admin):
    page = logged_in_admin
    table_locator = page.locator("table[aria-label='selectRealm']")
    expect(table_locator).to_contain_text(realm_name)
    expect(page.get_by_test_id("currentRealm").filter(has_text=realm_name)).to_be_visible()
    page.get_by_role("link", name="Realm settings").click()
    expect(page.get_by_role("heading", name=realm_name)).to_be_visible()

