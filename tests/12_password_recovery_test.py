from pytest_bdd import given, when, then, scenarios, parsers
import pytest
from playwright.sync_api import expect, Page 
import mailslurp_client
from dotenv import load_dotenv
import os, random, time
from bs4 import BeautifulSoup

load_dotenv()

scenarios("12_password_recovery.feature")


@given(parsers.parse("the admin in the tide admin console selects realm {realm_name}"))
def admin_logged_in(logged_in_admin: Page, realm_name: str) -> Page:

    page = logged_in_admin
    
    page.get_by_test_id("nav-item-realms").click()
    page.get_by_role("textbox", name="Search").click()
    page.get_by_role("textbox", name="Search").fill(realm_name)
    page.get_by_role("button", name="Search").click()
    page.get_by_role("link", name=realm_name).click()


    return logged_in_admin

@when(parsers.parse("the user {username} gets recovery link to email and takes action and changes to new password {new_passwd}"))
def create_realm_admin(logged_in_admin: Page, username: str, new_passwd: str) -> Page:
    
    page = logged_in_admin
    recovery_link_list = []

    configuration = mailslurp_client.Configuration()
    configuration.api_key["x-api-key"] = os.getenv('MAILSLURP_API')
    inbox_id = os.getenv('MAILSLURP_INBOX_ID')

    # Send the recovery links
    page.get_by_test_id("nav-item-clients").click()
    with page.expect_popup() as passwd_recovery_page_info:
        page.get_by_test_id("client-home-url-account-console").click()
    passwd_recovery_page = passwd_recovery_page_info.value
    passwd_recovery_page.locator("#forgot-password-nav").click()
    passwd_recovery_page.get_by_role("textbox").fill(f"{username}")
    time.sleep(2)
    passwd_recovery_page.get_by_text("Request Account RecoveryProcessing").click()
    passwd_recovery_page.get_by_text("2Assemble").nth(1).wait_for(state="visible")

    # wait for the ork to send email
    time.sleep(10)

    # Fetch the email content
    with mailslurp_client.ApiClient(configuration) as api_client:

        # list all emails in inbox, returns the email id
        inbox_controller = mailslurp_client.InboxControllerApi(api_client)
        emails = inbox_controller.get_emails(inbox_id=inbox_id, size=5)

        # for each mail get its id and then fetch the email content
        for mail in emails:

            email_id = mail.id
            email_controller = mailslurp_client.EmailControllerApi(api_client)
            full_email = email_controller.get_email(email_id=email_id)
          
            try:
                soup = BeautifulSoup(full_email.body, 'html.parser')
                p_tag = soup.find('p', class_='full-url')
                recovery_link_list.append(p_tag.get_text())
                email_controller.delete_email(email_id=email_id)

            except mailslurp_client.ApiException as e:
                # print(f"Error deleting email: {e}")
                pytest.fail("Error fetching the recovery URL's")

    # Since only 3 links is enough for recovery
    for _ in range(3):
        choice = random.choice(recovery_link_list)
        recovery_link_list.remove(choice)

        page.get_by_test_id("nav-item-clients").click()
        with page.expect_popup() as recovery_link_page_info:
            page.get_by_test_id("client-home-url-account-console").click()

        recovery_link_page = recovery_link_page_info.value
        recovery_link_page.goto(f"{choice}")
        time.sleep(2)
        recovery_link_page.close()


    # return to password recovery page and submit new password
    passwd_recovery_page.locator("#forgot_password_step_3-input_new_password").nth(1).fill(f"{new_passwd}")
    passwd_recovery_page.locator("#forgot_password_step_3-input_repeat_new_password").nth(1).fill(f"{new_passwd}")
    passwd_recovery_page.get_by_text("SubmitProcessing").click()
    
    return passwd_recovery_page


@then("the user gets account recovered success message")
def verify_password_change(logged_in_admin: Page) -> None:
    page = logged_in_admin

    # navigates to user page
    expect(page.get_by_text("Account Recovered. Please log")).to_be_visible()
    expect(page.locator("#changePasswordSuccess")).to_contain_text("Account Recovered. Please log in.")



