from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 

scenarios("copy_email_invite.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when(parsers.parse("the admin searches for user {username} and copy link for email for verification"))
def copy_email_invite(logged_in_admin: Page, username: str) -> None:

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
    page.get_by_role("button", name="Copy Link").click()
    

@then("the copies link and opens it in new tab and email is verified")
def verify_email_link(logged_in_admin: Page) -> None:

    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("Link copied to clipboard")
    page.get_by_role("button", name="Close alert: Link copied to clipboard").click()
    
    clipboard_url = page.evaluate("async () => await navigator.clipboard.readText()")
    
    page.goto(clipboard_url)

    expect(page.get_by_role("link", name="» Click here to proceed")).to_be_visible()
    # expect(page.locator("#kc-info-message")).to_contain_text("Perform the following action(s): Verify Email")

