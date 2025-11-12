Feature: Admin login to Tidecloak
  As a Tide Cloak admin user
  I want to login to admin account
  So that I can access the admin dashboard
  
  Scenario: Login with admin credentials
    Given I open the tide admin login page
    When I login as admin user with <credential_type>
    Then I should redirected to page with heading <heading> login page or dashboard page
    
    Examples:
      | credential_type | heading                 | comments_for_testers                 |
      | valid           | master realm            | valid creds - redirects to dashboard |
      | invalid         | Sign in to your account | invalid creds - stays on login page  |
