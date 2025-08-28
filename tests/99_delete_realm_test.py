from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page

scenarios("delete_realm.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:
    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when(parsers.parse("the admin deletes a realm named {realm_name}"))
def delete_realm(logged_in_admin: Page) -> None:
    
    page = logged_in_admin
    
    page.get_by_role("link", name="Realm settings").click()
    page.get_by_role("button", name="Action").click()
    page.get_by_role("menuitem", name="Delete").click()
    page.get_by_role("button", name="Delete").click()


@then(parsers.parse("the realm {realm_name} should not be visible in the realm list"))
def verify_realm(logged_in_admin: Page, realm_name: str) -> None:
    page = logged_in_admin
    
    expect(page.get_by_test_id("last-alert")).to_be_visible()
    expect(page.get_by_test_id("last-alert")).to_contain_text("The realm has been deleted")
    page.get_by_role("button", name="Close alert: The realm has").click()

    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()

    expect(page.get_by_role("heading", name="No search results")).to_be_visible()



