Feature: Admin login to Tidecloak
  As a Tide Cloak admin user
  I want to login to admin account
  So that I can access the admin dashboard

  Scenario: Login with admin credentials
    Given I open the tide admin login page
    When I login as admin user with <username> and <password>
    Then I should redirected to page with heading <heading> login page or dashboard page

    Examples:

      | username | password | heading                 | comments_for_testers                 |
      | admin    | admin    | master realm            | valid creds - redirects to dashboard |
      | admin    | user     | Sign in to your account | invalid creds - stays on login page  |