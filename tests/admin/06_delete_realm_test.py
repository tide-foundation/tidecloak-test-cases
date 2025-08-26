from pytest_bdd import given, when, then, scenarios
from playwright.sync_api import expect
from conftest import take_screenshot

scenarios("admin/delete_realm.feature")

# GLOBAL VARIABLES
realm_name = "testrealm"

@given("the admin is logged in to the Tidecloak admin console")
def admin_logged_in(logged_in_admin):
    return logged_in_admin

@when('the admin deletes a realm named "testrealm"')
def delete_realm(logged_in_admin):
    
    page = logged_in_admin
    
    page.get_by_role("link", name="Manage realms").click()
    page.get_by_role("link", name=realm_name).click()
    page.get_by_role("link", name="Realm settings").click()
    page.get_by_role("button", name="Action").click()
    page.get_by_role("menuitem", name="Delete").click()
    page.get_by_role("button", name="Delete").click()

    page.get_by_role("button", name="Close  alert: The realm has been deleted").click()
    
    page.get_by_role("link", name="Manage realms").click()


@then('the realm "testrealm" should not be visible in the realm list')
def verify_realm(logged_in_admin):
    page = logged_in_admin
    
    try:
        table_locator = page.locator("table[aria-label='selectRealm']") # no available playwright api to select the table hence the css selector
        expect(table_locator).not_to_contain_text(realm_name)

        take_screenshot(page, "Delete Realm Successful")
    
    except:
        take_screenshot(page, "Delete Realm Failure")
        raise
