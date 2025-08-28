import allure
from datetime import datetime
from playwright.sync_api import Page

def take_screenshot(page: Page, name: str):

    timestamp = datetime.now().strftime("%d%m%Y_%H%M%S")
    fullname = f"{name}_{timestamp}"
    try:
        png = page.screenshot(full_page=True)
        allure.attach(png, name=fullname, attachment_type=allure.attachment_type.PNG)
    except Exception as e:
        allure.attach(str(e), name=f"{fullname}-error", attachment_type=allure.attachment_type.TEXT)
