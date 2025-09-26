from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 
import uuid, csv

scenarios("link_tide_account.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when(parsers.parse("the admin searches for user {username} and copy link to link tide account"))
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
    page.get_by_role("option", name="Link Tide Account").click()
    page.get_by_role("button", name="Copy Link").click()
    

@when("the copies link and opens it in new tab and email is verified")
def opens_link_in_new_tab(logged_in_admin: Page) -> Page:

    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("Link copied to clipboard")
    page.get_by_role("button", name="Close alert: Link copied to clipboard").click()
    
    clipboard_url = page.evaluate("async () => await navigator.clipboard.readText()")
    
    page.goto(clipboard_url)

    expect(page.get_by_text("Link your Tide Account")).to_be_visible()
    expect(page.get_by_role("link", name="Link Account")).to_be_visible()

    return page


@when(parsers.parse("user links tide account with creds {tide_username} and {tide_password}"))
def links_tide_account(logged_in_admin: Page, tide_username: str, tide_password: str) -> None:

    page = logged_in_admin
    page.get_by_role("link", name="Link Account").click()

    # try:
    #     page.locator("#sign-up-nav").click()
    #     page.locator("#sign_up-input_username").nth(1).fill(f"{tide_username}")
    #     page.locator("custom-input").filter(has_text="Create the most secure").locator("#sign_up-input_password").fill(f"{tide_password}")
    #     page.locator("#sign_up-input_repeat_password").nth(1).fill(f"{tide_password}")
    #     page.locator("#sign_up-button").click()

    #     # if visible, If username already exists, then account exists go to sign in
    #     expect(page.get_by_text("Error creating user account.")).not_to_be_visible(timeout=1000)

    #     page.locator("#sign_up-email-container-1").get_by_role("textbox").fill(f"{tide_username}@gmail.com")
    #     page.locator("#sign_up_email-button").click()
    #     page.locator("#root").wait_for(state="visible")
    
    # except:
    #     page.locator("#login-nav").click()
    #     page.locator("#sign_in-input_name").nth(1).fill(f"{tide_username}")
    #     page.locator("#sign_in-input_password").nth(1).fill(f"{tide_password}")
    #     page.get_by_text("Sign InProcessing").click()
    #     page.locator("#root").wait_for(state="visible")


    page.locator("#sign-up-nav").click()
    page.locator("#sign_up-input_username").nth(1).fill(f"{tide_username}")
    page.locator("custom-input").filter(has_text="Create the most secure").locator("#sign_up-input_password").fill(f"{tide_password}")
    page.locator("#sign_up-input_repeat_password").nth(1).fill(f"{tide_password}")
    page.locator("#sign_up-button").click()

    page.locator("#sign_up-email-container-1").get_by_role("textbox").fill(f"{tide_username}@gmail.com")
    page.locator("#sign_up_email-button").click()
    page.locator("#root").wait_for(state="visible")



@then("verify account updated")
def verify_account_linked(logged_in_admin: Page) -> None:

    page = logged_in_admin

    # expect(page.locator("span")).to_contain_text("Your account has been updated.")
    expect(page.get_by_role("paragraph")).to_contain_text("Your account has been updated.")
