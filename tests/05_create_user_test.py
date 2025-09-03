from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 

scenarios("create_user.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()


    return logged_in_admin

@when(parsers.parse("the admin creates a user with {username}, {email},  {first_name} and {last_name} in realm"))
def create_user(logged_in_admin: Page, username: str, email: str, first_name: str, last_name: str) -> None:
    
    page = logged_in_admin
    
    page.get_by_test_id("nav-item-users").click()

    try:
        # this button is only visible when creating first user
        expect(page.get_by_test_id("no-users-found-empty-action")).to_be_visible()
        page.get_by_test_id("no-users-found-empty-action").click()
    except:
        # this button is visible when creating next users
        page.get_by_test_id("add-user").click()

    page.get_by_role("combobox", name="Type to filter").click()
    page.get_by_role("option", name="Update Password").click()
    page.get_by_role("button", name="Menu toggle").click()

    page.get_by_test_id("username").fill(username)
    page.get_by_test_id("email").fill(email)
    page.get_by_test_id("firstName").fill(first_name)
    page.get_by_test_id("lastName").fill(last_name)

    page.get_by_test_id("user-creation-save").click()
    

@then("the user tide id, created at and other settings tabs should be visible")
def verify_user_creation(logged_in_admin: Page) -> None:
    page = logged_in_admin

    # Checking for tide id and created at visible
    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_role("textbox", name="Created at")).to_be_visible()
    
    # Checking for other setting tabs visible
    expect(page.get_by_test_id("credentials")).to_be_visible()
    expect(page.get_by_test_id("role-mapping-tab")).to_be_visible()
    expect(page.get_by_test_id("user-groups-tab")).to_be_visible()
    expect(page.get_by_test_id("user-sessions-tab")).to_be_visible()
    expect(page.get_by_test_id("events-tab")).to_be_visible()
        
