from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 
import time

scenarios("11_assign_admin_role.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()


    return logged_in_admin

@when(parsers.parse("the admin approves, number of approvals {no_approval} for user {username} and assigns admin role and approves"))
def create_realm_admin(logged_in_admin: Page, username: str, no_approval: str) -> None:
    
    n = int(no_approval)
    # n = 3
    
    page = logged_in_admin
    
    # Selects user
    page.get_by_test_id("nav-item-users").click()
    page.get_by_role("textbox", name="Search").fill(username)
    page.get_by_test_id("table-search-input").get_by_role("button", name="Search").click()
    page.get_by_role("link", name=username).click()
    
    # Assigns admin role
    page.get_by_test_id("role-mapping-tab").click()
    page.get_by_test_id("assignRole").click()
    page.get_by_role("textbox", name="Search").fill("tide")
    page.get_by_role("button", name="Search").click()
    page.get_by_role("checkbox", name="Select row").check()
    page.get_by_test_id("assign").click()

    page.get_by_test_id("last-alert").wait_for(state="visible")

    # Commit and Approve Draft
    if n == 0:
        page.get_by_test_id("nav-item-change-requests").click()
        page.get_by_role("radio", name="Select row").check()
        page.get_by_role("button", name="Review Draft").click()
        page.get_by_role("radio", name="Select row").wait_for(state="visible")
        time.sleep(2)
        page.get_by_role("radio", name="Select row").check()
        page.get_by_role("button", name="Commit Draft").click()
    
    elif n > 0:
        for i in range(n):
            page.get_by_test_id("nav-item-clients").click()
            with page.expect_popup() as admin_security_console_page_info:
                page.get_by_test_id("client-home-url-security-admin-console").click()
            
            # Login as different user
            admin_security_console_page = admin_security_console_page_info.value
            admin_security_console_page.get_by_role("link", name="Tide").click()
            admin_security_console_page.locator("#sign_in-input_name").nth(1).fill(f"adminuser{i+1}") # username
            admin_security_console_page.locator("#sign_in-input_password").nth(1).fill(f"adminuser{i+1}") # password
            admin_security_console_page.get_by_text("Sign InProcessing").click()

            # Go to change request draft
            admin_security_console_page.get_by_test_id("nav-item-change-requests").click()
            admin_security_console_page.get_by_role("radio", name="Select row").check()
            admin_security_console_page.get_by_role("button", name="Review Draft").click()
            
            # Pop page for approving the draft
            with admin_security_console_page.expect_popup() as approval_page_info:
                approval_page = approval_page_info.value
                approval_page.locator("#sign_in-input_name").nth(1).click()
                approval_page.locator("#sign_in-input_name").nth(1).fill(f"adminuser{i+1}")
                approval_page.locator("#sign_in-input_password").nth(1).click()
                approval_page.locator("#sign_in-input_password").nth(1).fill(f"adminuser{i+1}")
                approval_page.get_by_text("Sign InProcessing").click()
                approval_page.get_by_text("AcceptProcessing").click()
                time.sleep(2)
                approval_page.close()
            
            time.sleep(2)

            if i == n - 1:
                admin_security_console_page.get_by_role("radio", name="Select row").wait_for(state="visible")
                expect(admin_security_console_page.get_by_role("gridcell", name="APPROVED")).to_be_visible()
                admin_security_console_page.get_by_role("radio", name="Select row").check()
                admin_security_console_page.get_by_role("button", name="Commit Draft").click()

            admin_security_console_page.get_by_test_id("options-toggle").click()
            admin_security_console_page.get_by_role("menuitem", name="Sign out").click()

            admin_security_console_page.close()

@then(parsers.parse("the admin goes back to user page selects user {username} and verifies ACTIVE status beside the role in role mapping tab"))
def verify_user_creation(logged_in_admin: Page, username: str) -> None:
    page = logged_in_admin

    # navigates to user page
    page.get_by_test_id("nav-item-users").click()
    page.get_by_role("textbox", name="Search").fill(f"{username}")
    page.get_by_test_id("table-search-input").get_by_role("button", name="Search").click()
    page.get_by_role("link", name=username).click()

    # verifies the ACTIVE status
    page.get_by_test_id("role-mapping-tab").click()  
    expect(page.locator("tbody")).to_match_aria_snapshot("- gridcell \"realm-management tide-realm-admin ACTIVE\"")


