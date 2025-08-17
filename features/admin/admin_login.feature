Feature: Admin login to Tidecloak
  As a Tide Cloak admin user
  I want to login to admin account
  So that I can access the admin dashboard

  Scenario: Login with admin credentials
    Given I open the Tidecloak admin login page
    When I login as admin user
    Then I should see the admin dashboard