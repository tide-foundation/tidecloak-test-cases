from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page

scenarios("09_disable_user.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when(parsers.parse("the admin searches for user {username} goto user page and disables"))
def disable_user(logged_in_admin: Page, username: str) -> None:
    page = logged_in_admin
    
    page.get_by_test_id("nav-item-users").click()
    
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(username)

    page.get_by_test_id("table-search-input").get_by_role("button", name="Search").click()
    page.get_by_role("link", name=username).click()
    
    page.locator("label").filter(has_text="EnabledDisabled").locator("span").first.click()
    page.get_by_test_id("confirm").click()  

  
@then(parsers.parse("the user {username} will have disable status in the user list"))
def verify_user_status_from_user_list(logged_in_admin: Page, username: str) -> None:

    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("The user has been saved")
    page.get_by_role("button", name="Close alert: The user has").click()

    page.get_by_test_id("nav-item-users").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(username)
    page.get_by_test_id("table-search-input").get_by_role("button", name="Search").click()

    expect(page.get_by_role("link", name=f"{username} Disabled")).to_be_visible()


@then(parsers.parse("then user tries to login in with valid credentials {username} {password} but shows account disabled message in login page"))
def verify_user_login(logged_in_admin: Page, username: str, password: str) -> None:

    page = logged_in_admin

    page.get_by_test_id("nav-item-clients").click()
    with page.expect_popup() as new_page:
        page.get_by_test_id("client-home-url-account").click()
    
    client_account_page = new_page.value

    client_account_page.get_by_role("textbox", name="Username or email").click()
    client_account_page.get_by_role("textbox", name="Username or email").fill(username)
    client_account_page.get_by_role("textbox", name="Password").click()
    client_account_page.get_by_role("textbox", name="Password").fill(password)
    client_account_page.get_by_role("button", name="Sign In").click()
    expect(client_account_page.get_by_text("Account is disabled, contact")).to_be_visible()
    

