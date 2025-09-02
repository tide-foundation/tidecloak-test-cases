from pytest_bdd import given, when, then, scenarios, parsers
from playwright.sync_api import expect, Page 

scenarios("delete_license.feature")

# GLOBAL VARIABLES
tidecloak_url = "localhost:8080"
billing_stripe_url = "billing.stripe.com"

@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:
    page = logged_in_admin

    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()

    return logged_in_admin

@when("the admin deletes license with and deletes tide provider in realm")
def delete_license_in_realm(logged_in_admin: Page) -> None:
    page = logged_in_admin
    
    page.get_by_role("link", name="Identity providers").click()

    page.get_by_role("link", name="tide").click()
    page.get_by_role("button", name="Manage License").click()

    page.get_by_role("button", name="Manage").click()

    # Wait for redirection to Stipe gateway
    page.wait_for_url(f"**/{billing_stripe_url}/**")

    # Remove subscription Stipe gateway
    page.get_by_role("link", name="Cancel Subscription").wait_for(state="visible")
    page.get_by_role("link", name="Cancel Subscription").click()
    page.get_by_role("button", name="Cancel Subscription").click()
    page.get_by_role("button", name="No thanks").click()
    page.get_by_role("link", name="Return to Tide").click()

    # Wait for redirection to tidecloak
    page.wait_for_url(f"**/{tidecloak_url}/**")

    # Go back to Identity providers to delete tide provider
    page.get_by_test_id("nav-item-identity-providers").click()
    page.get_by_role("link", name="tide").click()
    page.get_by_test_id("action-dropdown").click()
    page.get_by_role("menuitem", name="Delete").click()
    page.get_by_test_id("confirm").click()

    
@then(parsers.parse("the realm {realm_name} should have all providers visible in the Identity provider page"))
def verify_license(logged_in_admin: Page, realm_name: str) -> None:
    page = logged_in_admin

    page.get_by_test_id("last-alert").wait_for(state="visible")
    expect(page.get_by_test_id("last-alert")).to_contain_text("Provider successfully deleted.")
    
    expect(page.get_by_role("heading", name=f"{realm_name} Current realm")).to_be_visible()
    
    page.get_by_role("button", name="Close alert: Provider").click()
    expect(page.get_by_role("heading", name="User-defined")).to_be_visible()
    expect(page.get_by_role("heading", name="Social")).to_be_visible()
