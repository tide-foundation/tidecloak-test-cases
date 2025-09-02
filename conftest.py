from playwright.sync_api import sync_playwright, Page
from dotenv import load_dotenv
from utils.screenshot import take_screenshot
import pytest ,allure, os, json, time

load_dotenv()

@pytest.fixture()
def browser_page(request):
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch()
    context = browser.new_context() 
    page = context.new_page()
    
    # Store page reference for cleanup hook
    request.node.page = page
    
    yield page
    
    context.close()
    browser.close()
    playwright.stop()

@pytest.fixture()
@allure.title("Logged In as admin")
def logged_in_admin(request):

    if not os.path.exists('auth.json'):
        create_auth_state()
    else: 
        check_for_auth_state_expiry()

    playwright = sync_playwright().start()
    # browser = playwright.chromium.launch()
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context(storage_state='auth.json')
    page = context.new_page()
    page.goto(f"{os.getenv('ADMIN_DASHBOARD_URL')}")
    
    # Store page reference for cleanup hook
    request.node.page = page
    
    yield page
    
    context.close()
    browser.close()
    playwright.stop()


# Pytest hook to automatically take screenshots on failure
@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    # Execute all other hooks to obtain the report object
    outcome = yield
    rep = outcome.get_result()
    
    # Only take screenshot on test failure during the 'call' phase (not setup/teardown)
    if rep.when == "call" and rep.failed:
        # Check if the test has a page object available
        if hasattr(item, 'page'):
            page = item.page
            test_name = item.nodeid.replace("::", "_").replace("/", "_")
            take_screenshot(page, f"FAILED_{test_name}")

def create_auth_state() -> None:
    with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context()
            page = context.new_page()
            page.goto(f"{os.getenv('TIDE_INSTANCE_URL')}")
            page.get_by_role("textbox", name="username").fill(f"{os.getenv('ADMIN_USERNAME')}")
            page.get_by_role("textbox", name="password").fill(f"{os.getenv('ADMIN_PASSWORD')}")
            page.get_by_role("button", name="Sign In").click()
            page.get_by_test_id("currentRealm").filter(has_text="Keycloak").wait_for()
            
            context.storage_state(path='auth.json')
            context.close()
            browser.close()

def check_for_auth_state_expiry() -> None:
    
    with open('auth.json', 'r')as f:
        data = json.load(f)
    
    token_time = int(data["cookies"][1]['expires'])
    # token_new_time = token_time + (60*60)
    # if int(time.time()) - token_new_time >= 0:
    if int(time.time())-token_time >= 20*60:
        os.remove('auth.json')
        create_auth_state()

