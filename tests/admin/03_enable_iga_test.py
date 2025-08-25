from pytest_bdd import given, when, then, scenarios
from playwright.sync_api import expect 
import pytest
from conftest import take_screenshot

scenarios("admin/enable_iga.feature")

realm_name = "testrealm"

@given("the admin is logged in to the Tidecloak admin console")
def admin_logged_in(logged_in_admin):
    return logged_in_admin

@when('the admin enables IGA')
def enable_iga(logged_in_admin):
    page = logged_in_admin
    
    page.get_by_role("link", name="Manage realms").click()
    page.get_by_role("link", name=realm_name).click()

    page.get_by_role("link", name="Realm settings").click()
    page.get_by_test_id('rs-general-tab').click()

    page.locator("label[for='tide-realm-iga-switch']").click()
    page.get_by_role("button", name="Close  alert: IGA changed successfully").click()


@then('table in change request for clients is visible')
def verify_iga(logged_in_admin):
    page = logged_in_admin

    try:
        expect(page.locator("label[for='tide-realm-iga-switch']")).to_be_checked()
        
        take_screenshot(page, "Enable IGA Successful")

        page.get_by_role("link", name="Change Requests").click()
        page.get_by_role("tab", name="Clients").click()

        expect(page.get_by_role("button", name="Review Draft")).to_be_visible()
        expect(page.get_by_role("button", name="Commit Draft")).to_be_visible()
        expect(page.get_by_role("button", name="Cancel Draft")).to_be_visible()
        expect(page.get_by_role("grid", name="clientChangeRequestsList")).to_be_visible()

    
    except:
        take_screenshot(page, "Enable IGA Failure")
        raise        
