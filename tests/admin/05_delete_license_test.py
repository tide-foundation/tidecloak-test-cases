from pytest_bdd import given, when, then, scenarios
from playwright.sync_api import expect 
import pytest
from conftest import take_screenshot

scenarios("admin/delete_license.feature")

# GLOBAL VARIABLES
realm_name = "testrealm"
test_user_email = "admin@admin.com"
tidecloak_url = "localhost:8080"
billing_stripe_url = "billing.stripe.com"

@pytest.mark.dependency(name="delete_license", depends=["get_license"], scope="session")
@given("the admin is logged in to the Tidecloak admin console")
def admin_logged_in(logged_in_admin):
    return logged_in_admin

@when('the admin deletes license and deletes Tide provider in "testrealm"')
def delete_license_in_realm(logged_in_admin):
    page = logged_in_admin
    
    page.get_by_role("link", name="Manage realms").click()
    page.get_by_role("link", name=realm_name).click()
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
    page.get_by_role("link", name="Identity providers").click()
    page.get_by_role("button", name="Kebab toggle").click()
    page.get_by_role("menuitem", name="Delete").click()

    # Confirm Deletion
    page.get_by_role("button", name="Delete").click()

    # Close Toast
    page.get_by_role("button", name="Close  alert: Provider successfully deleted.").click()

    
@then('the realm "testrealm" should have all providers visible in the Identity provider page')
def verify_license(logged_in_admin):
    page = logged_in_admin

    try:
        expect(page.get_by_role("heading", name="User-defined")).to_be_visible()
        expect(page.get_by_role("heading", name="Social")).to_be_visible()

        take_screenshot(page, "Delete License Successful")
    
    except:
        take_screenshot(page, "Deletes License Failure")
        raise    