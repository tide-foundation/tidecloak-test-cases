Feature: Admin login to Tidecloak
  As a Tide Cloak admin user
  I want to login to admin account
  So that I can access the admin dashboard

  Scenario: Login with admin credentials
    Given I open the tide admin login page
    When I login as admin user with <username> and <password>
    Then I should redirected to page <path> login page or dashboard page

    Examples:

      | username | password | path                                      | comments_for_testers                 |
      | admin    | admin1   | /admin/master/console/                    | valid creds - redirects to dashboard |
      | admin    | admin    | /realms/master/login-actions/authenticate | invalid creds - stays on login page  |