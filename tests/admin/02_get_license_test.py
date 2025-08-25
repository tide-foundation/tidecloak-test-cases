from pytest_bdd import given, when, then, scenarios
from playwright.sync_api import expect 
import pytest
from conftest import take_screenshot

scenarios("admin/get_license.feature")

# GLOBAL VARIABLES
realm_name = "testrealm"
test_user_email = "admin@admin.com"
tidecloak_url = "localhost:8080"
stripe_url = "checkout.stripe.com"

@given("the admin is logged in to the Tidecloak admin console")
def admin_logged_in(logged_in_admin):
    return logged_in_admin

@when('the admin adds Tide provider to "testrealm" and get license')
def add_license_to_realm(logged_in_admin):
    page = logged_in_admin
    
    page.get_by_role("link", name="Manage realms").click()
    page.get_by_role("link", name=realm_name).click()

    page.get_by_role("link", name="Identity providers").click()
    page.get_by_test_id("tide-card").click()

    # Close Toast
    page.get_by_role("button", name="Close  alert: Identity provider successfully created").click()
    
    page.get_by_role("button", name="Manage License").click()
    page.get_by_role("button", name="Request License").click()

    # Wait for redirection to Stipe gateway
    page.wait_for_url(f"**/{stripe_url}/**")

    # Subscribing via Stipe gateway
    page.get_by_role("textbox", name="email").fill(test_user_email)
    page.get_by_role("button", name="Subscribe").click()

    # Wait for redirection to tidecloak
    page.wait_for_url(f"**/{tidecloak_url}/**")

    # Waiting for spinner to load the detail and check for visiblity state of "License Details"
    page.get_by_role("progressbar", name="Contents").wait_for(state="visible")
    page.get_by_role("progressbar", name="Contents").wait_for(state="detached")



@then('the realm "testrealm" should have a visible license details')
def verify_license(logged_in_admin):
    page = logged_in_admin

    try:
        page.get_by_text("License Details").wait_for(state="visible")
        expect(page.get_by_role("textbox", name="Copyable input")).to_be_visible()
        expect(page.get_by_role("button", name="Copy to clipboard")).to_be_visible()
        expect(page.get_by_role("button", name="Export")).to_be_visible()
        expect(page.get_by_role("button", name="Manage")).to_be_visible()

        take_screenshot(page, "Get License Successful")
    
    except:
        take_screenshot(page, "Get License Failure")
        raise    

