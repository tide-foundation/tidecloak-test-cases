from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 

scenarios("get_license.feature")

# GLOBAL VARIABLES
tidecloak_url = "localhost:8080"
stripe_url = "checkout.stripe.com"

@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:
    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when(parsers.parse("the admin adds Tide provider to the realm and subscribe to tide with {email} and get license"))
def add_license_to_realm(logged_in_admin: Page, email: str) -> None:
    page = logged_in_admin
    
    page.get_by_role("link", name="Identity providers").click()
    page.get_by_test_id("tide-card").click()

    # Close Toast
    page.get_by_role("button", name="Close  alert: Identity provider successfully created").click()
    
    page.get_by_role("button", name="Manage License").click()
    page.get_by_role("button", name="Request License").click()

    # Wait for redirection to Stipe gateway
    page.wait_for_url(f"**/{stripe_url}/**")

    # Subscribing via Stipe gateway
    page.get_by_role("textbox", name="email").fill(email)
    page.get_by_role("button", name="Subscribe").click()

    # Wait for redirection to tidecloak
    page.wait_for_url(f"**/{tidecloak_url}/**")

    # Waiting for spinner to load the detail and check for visiblity state of "License Details"
    page.get_by_role("progressbar", name="Contents").wait_for(state="visible")
    page.get_by_role("progressbar", name="Contents").wait_for(state="detached")



@then(parsers.parse("the realm {realm_name} should have a visible license details"))
def verify_license(logged_in_admin: Page, realm_name: str) -> None:
    
    page = logged_in_admin

    
    expect(page.get_by_role("heading", name=f"{realm_name} Current realm")).to_be_visible()
    
    page.get_by_text("License Details").wait_for(state="visible")
    
    expect(page.get_by_role("textbox", name="Copyable input")).to_be_visible()
    expect(page.get_by_role("button", name="Copy to clipboard")).to_be_visible()
    expect(page.get_by_role("button", name="Export")).to_be_visible()
    expect(page.get_by_role("button", name="Manage")).to_be_visible()


    # Enable the link tide account
    page.get_by_test_id("nav-item-authentication").click()
    page.get_by_test_id("requiredActions").click()
    page.locator("[id=\"Link Tide Account\"]").get_by_text("OnOff").click()
    
    expect(page.get_by_test_id("last-alert")).to_be_visible()
    expect(page.get_by_test_id("last-alert")).to_contain_text("Updated required action successfully")
    page.get_by_role("button", name="Close alert: Updated required action successfully").click()
