from pytest_bdd import scenarios, given, when, then

scenarios('../features/admin_login.feature')

ADMIN_URL = "http://localhost:8080"
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin"

@given("I open the Tidecloak admin login page")
def open_login_page(browser_page):
    browser_page.goto(ADMIN_URL)

@when("I login as admin user")
def login_admin(browser_page):
    browser_page.fill('input#username', ADMIN_USERNAME)
    browser_page.fill('input#password', ADMIN_PASSWORD)
    browser_page.click('button#kc-login')

@then("I should see the admin dashboard")
def verify_dashboard(browser_page):
    assert browser_page.title() == "Keycloak Administration Console"
    browser_page.click('button#nav-toggle')
    assert browser_page.is_visible('button[data-testid="options-toggle"]:has-text("admin")')
    assert browser_page.is_visible('a:has-text("Manage Realms")')
    assert browser_page.is_visible('a:has-text("Realm settings")')
