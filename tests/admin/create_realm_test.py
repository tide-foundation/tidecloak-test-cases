from pytest_bdd import given, when, then, scenarios
import time

scenarios("../features/create_realm.feature")

@given("the admin is logged in to the Tidecloak admin console")
def admin_logged_in(logged_in_admin):
    return logged_in_admin

@when('the admin creates a realm named "testrealm"')
def create_realm(logged_in_admin):
    page = logged_in_admin
    page.click('a:has-text("Manage realms")')
    page.click('button[data-testid="add-rea"]')
    page.fill('input[data-testid="realm"]', 'testrealm')
    page.click('button[data-testid="create"]')
    page.wait_for_selector(f'text="testrealm"')

@then('the realm "testrealm" should be visible in the realm list')
def verify_realm(logged_in_admin):
    page = logged_in_admin
    assert page.is_visible(f'text="testrealm"')