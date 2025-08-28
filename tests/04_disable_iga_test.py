from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 

scenarios("disable_iga.feature")


@given(parsers.parse("the admin in the Tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:
    page = logged_in_admin

    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when("the admin disables IGA for the realm")
def disable_iga(logged_in_admin: Page) -> None:
    page = logged_in_admin

    page.get_by_role("link", name="Realm settings").click()
    page.get_by_test_id('rs-general-tab').click()

    page.locator("label[for='tide-realm-iga-switch']").click()


@then("the table in change request for clients is not visible")
def verify_iga(logged_in_admin: Page) -> None:
    page = logged_in_admin
    
    
    expect(page.get_by_test_id("last-alert")).to_be_visible()
    expect(page.get_by_test_id("last-alert")).to_contain_text("IGA changed successfully")
    page.get_by_role("button", name="Close alert: IGA changed").click()

    expect(page.locator("label[for='tide-realm-iga-switch']")).not_to_be_checked()

    page.get_by_role("link", name="Change Requests").click()
    page.get_by_role("tab", name="Clients").click()

    expect(page.get_by_role("button", name="Review Draft")).not_to_be_visible()
    expect(page.get_by_role("button", name="Commit Draft")).not_to_be_visible()
    expect(page.get_by_role("button", name="Cancel Draft")).not_to_be_visible()
    expect(page.get_by_role("grid", name="clientChangeRequestsList")).not_to_be_visible()

    