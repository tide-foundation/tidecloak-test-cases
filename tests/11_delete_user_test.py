from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page, TimeoutError as PlaywrightTimeoutError 
import pytest

scenarios("delete_user.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when(parsers.parse("the admin searches for user {username} goto user page and delete"))
def delete_user(logged_in_admin: Page, username: str) -> None:
    page = logged_in_admin
    
    page.get_by_test_id("nav-item-users").click()
    
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(username)

    try:
        page.get_by_test_id("table-search-input").get_by_role("button", name="Search").click(timeout=5000)
        page.get_by_role("link", name=username).click(timeout=5000)
    except PlaywrightTimeoutError:
        pytest.fail("User not Found!")

    page.get_by_test_id("action-dropdown").click()
    page.get_by_role("menuitem", name="Delete").click()
    page.get_by_test_id("confirm").click()

  
@then(parsers.parse("the user {username} will not be visible in the user list"))
def verify_user_deletion(logged_in_admin: Page, username: str) -> None:

    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("The user has been deleted")
    page.get_by_role("button", name="Close alert: The user has been deleted").click()

    page.get_by_test_id("nav-item-users").click()

    try:
        page.get_by_role("textbox", name="Search").click(timeout=5000)
        page.get_by_role("textbox", name="Search").fill(username)
        page.get_by_test_id("table-search-input").get_by_role("button", name="Search").click(timeout=5000)
        expect(page.get_by_role("heading", name="No search results")).to_be_visible(timeout=5000)
    except:
        expect(page.get_by_role("heading", name="No users found")).to_be_visible(timeout=5000)


