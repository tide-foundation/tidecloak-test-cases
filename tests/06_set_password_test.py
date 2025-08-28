from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 

scenarios("set_password.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when(parsers.parse("the admin sets default password {password} for user {username}"))
def set_password(logged_in_admin: Page, username: str, password: str) -> None:
    
    page = logged_in_admin
    
    page.get_by_test_id("nav-item-users").click()
    
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(username)

    page.get_by_test_id("table-search-input").get_by_role("button", name="Search").click()
    page.get_by_role("link", name=username).click()
    
    page.get_by_test_id("credentials").click()
    page.get_by_test_id("no-credentials-empty-action").click()

    page.get_by_test_id("passwordField").click()
    page.get_by_test_id("passwordField").fill(password)
    
    page.get_by_test_id("passwordConfirmationField").click()
    page.get_by_test_id("passwordConfirmationField").fill(password)

    expect(page.get_by_text("OnOff")).to_be_checked()
    page.get_by_test_id("confirm").click()
    page.get_by_test_id("confirm").click()
    

@then("the admin can see password has been created and has reset button under credentials tab")
def verify_user_creation(logged_in_admin: Page) -> None:
    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("The password has been set")
    page.get_by_role("button", name="Close alert: The password has").click()
   
    # Checking for tide id and created at visible
    expect(page.get_by_test_id("showDataBtn")).to_be_visible()
    expect(page.get_by_test_id("resetPasswordBtn")).to_be_visible()
        
